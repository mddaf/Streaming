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
    currentMode: 'auto'
};

/**
 * Clean any proxy wrapper from a URL to get the raw target URL
 */
function unwrapProxyUrl(url) {
    if (!url) return '';
    if (url.includes('workers.dev/?') || url.includes('corsproxy.io/?') || url.includes('allorigins.win')) {
        const parts = url.split('?');
        if (parts.length > 1) {
            let rest = parts.slice(1).join('?');
            if (rest.startsWith('url=')) rest = rest.slice(4);
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
function buildProxyUrl(rawUrl, proxyIndex = null) {
    const clean = unwrapProxyUrl(rawUrl);
    const idx = proxyIndex !== null ? proxyIndex : PROXY_CONFIG.activeProxyIndex;

    if (idx === 3 && PROXY_CONFIG.customProxy) {
        const base = PROXY_CONFIG.customProxy.endsWith('?') ? PROXY_CONFIG.customProxy : (PROXY_CONFIG.customProxy + '?');
        return base + encodeURIComponent(clean);
    } else if (idx === 1) {
        return PROXY_CONFIG.fallbacks[0] + encodeURIComponent(clean);
    } else if (idx === 2) {
        return PROXY_CONFIG.fallbacks[1] + encodeURIComponent(clean);
    } else {
        return PROXY_CONFIG.primary + encodeURIComponent(clean);
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

// Export to window for browser use
window.SmartProxyEngine = {
    CONFIG: PROXY_CONFIG,
    unwrapProxyUrl,
    buildProxyUrl,
    shouldRouteThroughProxy,
    resolveM3u8RelativeUrls,
    createSmartProxyLoader
};
