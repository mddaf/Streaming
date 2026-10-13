/**
 * Smart Proxy & Routing Engine for HLS Streams
 * - Resolves relative URLs in M3U8 playlists to absolute URLs against original media server
 * - Eliminates CORS and Mixed-Content (HTTP on HTTPS) blocking
 * - Multi-tier proxy fallbacks (Cloudflare Worker -> Global Proxies -> Custom)
 * - Custom Hls.js Loader integration with automatic Geo-Bypass failover
 */

const PROXY_CONFIG = {
    // Primary Cloudflare Worker proxy
    primary: 'https://sports-proxy.md-daf001.workers.dev/?',
    // Secondary fallback proxies
    fallbacks: [
        'https://corsproxy.io/?url=',
        'https://api.allorigins.win/raw?url='
    ],
    // Optional custom proxy specified by user
    customProxy: '',
    // Active proxy index (0: primary, 1: corsproxy, 2: allorigins, 3: custom)
    activeProxyIndex: 0,
    // Current active routing mode: 'auto' | 'proxy' | 'direct'
    currentMode: 'auto',
    // Per-stream header overrides {referer, origin, userAgent}. Protected CDNs
    // (e.g. newkso.ru) require the EMBED-page Referer, not the stream host.
    // Only the primary Cloudflare Worker honours these; public CORS proxies ignore them.
    streamHeaders: null
};

// Restore a user-saved custom/regional proxy (used to bypass true IP-geo blocks:
// point it at a header-capable proxy — another Cloudflare Worker or a VPS in the
// required country — that accepts ?ref=&origin=&ua=&url=, same as the primary).
try { const cp = localStorage.getItem('sp_custom_proxy'); if (cp) PROXY_CONFIG.customProxy = cp; } catch (e) {}

// Save/clear that custom proxy (persists across sessions)
function setCustomProxy(url) {
    PROXY_CONFIG.customProxy = (url || '').trim();
    try {
        if (PROXY_CONFIG.customProxy) localStorage.setItem('sp_custom_proxy', PROXY_CONFIG.customProxy);
        else localStorage.removeItem('sp_custom_proxy');
    } catch (e) {}
    return PROXY_CONFIG.customProxy;
}

// Set/clear the header overrides for the next stream (call before loading a channel)
function setStreamHeaders(headers) {
    PROXY_CONFIG.streamHeaders = headers && (headers.referer || headers.origin || headers.userAgent)
        ? headers : null;
}

// Build the ref/origin/ua querystring prefix for the Worker (ends with '&' when non-empty)
function buildHeaderQS(headers) {
    const h = headers || PROXY_CONFIG.streamHeaders;
    if (!h) return '';
    let qs = '';
    if (h.referer) qs += 'ref=' + encodeURIComponent(h.referer) + '&';
    if (h.origin) qs += 'origin=' + encodeURIComponent(h.origin) + '&';
    if (h.userAgent) qs += 'ua=' + encodeURIComponent(h.userAgent) + '&';
    return qs;
}

/**
 * Clean any proxy wrapper from a URL to get the raw target URL
 */
function unwrapProxyUrl(url) {
    if (!url) return '';
    if (url.includes('workers.dev/?') || url.includes('corsproxy.io/?') || url.includes('allorigins.win')) {
        const parts = url.split('?');
        if (parts.length > 1) {
            let rest = parts.slice(1).join('?');
            // New Worker form carries header overrides before the target: ...&url=<encoded>.
            // The encoded target has no literal '&url=' of its own, so match our param only.
            const m = rest.match(/(?:^|&)url=(.*)$/);
            if (m) rest = m[1];
            try {
                return decodeURIComponent(rest);
            } catch (e) {
                return rest;
            }
        }
    }
    return url;
}

/**
 * Build a proxy URL for a target URL using specified or active proxy index
 */
function buildProxyUrl(rawUrl, proxyIndex = null, headers = null) {
    const clean = unwrapProxyUrl(rawUrl);
    const idx = proxyIndex !== null ? proxyIndex : PROXY_CONFIG.activeProxyIndex;

    if (idx === 3 && PROXY_CONFIG.customProxy) {
        const base = PROXY_CONFIG.customProxy.endsWith('?') ? PROXY_CONFIG.customProxy : (PROXY_CONFIG.customProxy + '?');
        // Custom/regional proxy is treated as worker-style: pass Referer/UA too.
        const hqs = buildHeaderQS(headers);
        return hqs ? base + hqs + 'url=' + encodeURIComponent(clean) : base + encodeURIComponent(clean);
    } else if (idx === 1) {
        return PROXY_CONFIG.fallbacks[0] + encodeURIComponent(clean);
    } else if (idx === 2) {
        return PROXY_CONFIG.fallbacks[1] + encodeURIComponent(clean);
    } else {
        // Primary Worker: attach per-stream header overrides via url= form when present
        // (explicit `headers` arg wins — used by the health-checker per channel)
        const hqs = buildHeaderQS(headers);
        return hqs ? PROXY_CONFIG.primary + hqs + 'url=' + encodeURIComponent(clean)
                   : PROXY_CONFIG.primary + encodeURIComponent(clean);
    }
}

/**
 * Determine whether a given URL should go through the proxy based on routing mode and protocol
 */
function shouldRouteThroughProxy(url, forceProxy = false) {
    if (!url) return false;
    if (forceProxy || PROXY_CONFIG.currentMode === 'proxy') return true;
    if (PROXY_CONFIG.currentMode === 'direct') return false;

    // Private / Local ISP networks (172.16.x.x, 192.168.x.x, 10.x.x.x, localhost)
    // cannot be reached by cloud proxies (Cloudflare Workers). Connect to them directly!
    if (url.includes('172.16.') || url.includes('192.168.') || url.includes('10.') || url.includes('localhost') || url.includes('127.0.0.1')) {
        return false;
    }

    // In 'auto' mode: route public streams through proxy
    return true;
}

/**
 * Resolve any relative URIs inside an M3U8 playlist to absolute URLs based on the real media host
 */
function resolveM3u8RelativeUrls(manifestText, baseUrl) {
    if (!manifestText || typeof manifestText !== 'string') return manifestText;
    const lines = manifestText.split('\n');
    return lines.map(line => {
        const trimmed = line.trim();
        if (!trimmed) return line;

        // Tags like #EXT-X-KEY, #EXT-X-MEDIA, #EXT-X-MAP often have URI="..."
        if (trimmed.startsWith('#')) {
            return line.replace(/URI="([^"]+)"/g, (match, uri) => {
                try {
                    const abs = new URL(uri, baseUrl).href;
                    return `URI="${abs}"`;
                } catch (e) {
                    return match;
                }
            });
        }

        // Regular line (child playlist or media segment)
        try {
            return new URL(trimmed, baseUrl).href;
        } catch (e) {
            return line;
        }
    }).join('\n');
}

/**
 * Custom Hls.js Loader class extending the default Hls.js loader
 */
function createSmartProxyLoader(HlsClass, useProxyAlways = false, proxyIdx = null) {
    const BaseLoader = HlsClass.DefaultConfig.loader;

    return class SmartProxyLoader extends BaseLoader {
        constructor(config) {
            super(config);
        }

        load(context, config, callbacks) {
            const rawUrl = context.url;
            const cleanUrl = unwrapProxyUrl(rawUrl);

            const needProxy = useProxyAlways || shouldRouteThroughProxy(cleanUrl);
            const targetUrl = needProxy ? buildProxyUrl(cleanUrl, proxyIdx) : cleanUrl;

            // Wrap callbacks to preserve original URL and rewrite relative paths in manifest
            const wrappedCallbacks = Object.assign({}, callbacks, {
                onSuccess: (response, stats, ctx, networkDetails) => {
                    let data = response.data;

                    // If response is text manifest, resolve relative paths to absolute URLs
                    if (typeof data === 'string' && (data.includes('#EXTM3U') || data.includes('#EXT-X-'))) {
                        data = resolveM3u8RelativeUrls(data, cleanUrl);
                    }

                    // CRITICAL: response.url must point to cleanUrl so HLS internal state
                    // uses the true stream origin rather than the proxy host
                    const modifiedResponse = Object.assign({}, response, {
                        url: cleanUrl,
                        data: data
                    });

                    callbacks.onSuccess(modifiedResponse, stats, ctx, networkDetails);
                }
            });

            const modifiedContext = Object.assign({}, context, {
                url: targetUrl
            });

            super.load(modifiedContext, config, wrappedCallbacks);
        }
    };
}

/**
 * Resolve a channel id via the Worker's /resolve route -> { url, headers }.
 * Mirrors the reference app: ask the backend for a fresh URL at play time
 * instead of trusting a static playlist. Then: setStreamHeaders(r.headers);
 * play buildProxyUrl(r.url).
 */
async function resolveStream(id) {
    const base = PROXY_CONFIG.primary.replace(/\/?\?$/, ''); // strip trailing "/?"
    const res = await fetch(base + '/resolve?id=' + encodeURIComponent(id));
    let data;
    try {
        data = await res.json();
    } catch (e) {
        throw new Error(`HTTP ${res.status}: failed to parse resolver response`);
    }
    if (data.error) throw new Error(data.error + (data.message ? ': ' + data.message : ''));
    return data; // { url, headers:{referer,origin,userAgent} }
}

// Fetch the Worker's /catalog route -> [{id,name,group,type}]
async function fetchCatalog() {
    const base = PROXY_CONFIG.primary.replace(/\/?\?$/, '');
    const res = await fetch(base + '/catalog');
    if (!res.ok) throw new Error(`HTTP ${res.status} fetching catalog`);
    return await res.json();
}

// Export to window for browser use
window.SmartProxyEngine = {
    CONFIG: PROXY_CONFIG,
    setStreamHeaders,
    setCustomProxy,
    resolveStream,
    fetchCatalog,
    unwrapProxyUrl,
    buildProxyUrl,
    shouldRouteThroughProxy,
    resolveM3u8RelativeUrls,
    createSmartProxyLoader
};
