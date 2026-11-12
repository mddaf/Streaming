/**
 * StreamPulse - Cloudflare Worker Smart Stream Proxy (Geo-Bypass & CORS Fix)
 * 
 * How to deploy:
 * 1. Go to https://dash.cloudflare.com/ -> Workers & Pages
 * 2. Select your worker (e.g. sports-proxy)
 * 3. Click "Edit Code"
 * 4. Replace everything with this code and click "Deploy"!
 * 
 * Features:
 * - Full CORS enablement (Access-Control-Allow-Origin: * on ALL responses including 403/502)
 * - Geo-Bypass: Anonymizes client IP headers (strips cf-connecting-ip, x-forwarded-for, x-real-ip)
 * - Anti-Block: Emulates standard IPTV media player (VLC/Kodi) User-Agent to bypass browser blocks
 * - Auto-Referer: Automatically sets Referer to target origin to bypass hotlink protection
 * - Full Byte-Range support (forwards Range header and passes 206 Partial Content for HLS)
 * - Smart M3U8 Manifest Rewriting: Automatically rewrites relative chunk/segment paths to route
 *   through this proxy so sub-streams and video segments never fail in browser
 * - Safe Token Handling: Preserves query parameters and authentication tokens without URI errors
 * - Dual Runtime Support: Works with both ES Modules (export default) and Service Worker formats
 */

// Safely extract target stream URL while preserving tokens (?token=...&id=...)
function extractTargetUrl(requestUrl) {
    const url = new URL(requestUrl);
    let target = '';

    // 1. Check ?url= parameter
    if (url.searchParams.has('url')) {
        const fullSearch = url.search;
        const match = fullSearch.match(/[?&]url=([^&]+.*)/);
        if (match && match[1]) {
            target = match[1];
        } else {
            target = url.searchParams.get('url');
        }
    } else if (url.search.length > 1) {
        // 2. Direct ?https://... format
        target = url.search.slice(1);
    }

    if (!target) return '';

    // Safely decode only if URL-encoded
    try {
        if (target.startsWith('http%3A') || target.startsWith('https%3A') || target.includes('%2F') || target.includes('%3A')) {
            target = decodeURIComponent(target);
        }
    } catch (e) {
        // Keep as-is if malformed percent encoding
    }

    return target.trim();
}

// Optional per-stream header overrides (ref/origin/ua). Many protected CDNs
// (e.g. newkso.ru) require the EMBED-page Referer, not the stream host — so these
// must pass through unchanged to every child manifest and segment.
function extractOverrides(requestUrl) {
    const sp = new URL(requestUrl).searchParams;
    return { ref: sp.get('ref') || '', origin: sp.get('origin') || '', ua: sp.get('ua') || '' };
}

// Serialize overrides back into a querystring prefix (ends with '&' when non-empty)
function overridesToQS(ov) {
    let qs = '';
    if (ov.ref) qs += 'ref=' + encodeURIComponent(ov.ref) + '&';
    if (ov.origin) qs += 'origin=' + encodeURIComponent(ov.origin) + '&';
    if (ov.ua) qs += 'ua=' + encodeURIComponent(ov.ua) + '&';
    return qs;
}

// Rewrites relative URLs in M3U8 manifests so video chunks continue through this proxy,
// carrying the same header overrides so protected segments keep their Referer/UA.
function rewriteManifestUrls(manifestText, baseUrl, workerBaseUrl, ovQS = '') {
    if (!manifestText || typeof manifestText !== 'string') return manifestText;
    const wrap = abs => `${workerBaseUrl}?${ovQS}url=${encodeURIComponent(abs)}`;
    const lines = manifestText.split('\n');
    return lines.map(line => {
        const trimmed = line.trim();
        if (!trimmed) return line;

        // Rewrite URI="..." attributes (e.g. #EXT-X-KEY, #EXT-X-MEDIA, #EXT-X-MAP)
        if (trimmed.startsWith('#')) {
            return line.replace(/URI="([^"]+)"/g, (match, uri) => {
                try {
                    return `URI="${wrap(new URL(uri, baseUrl).href)}"`;
                } catch (e) {
                    return match;
                }
            });
        }

        // Child playlist or media segment line
        try {
            return wrap(new URL(trimmed, baseUrl).href);
        } catch (e) {
            return line;
        }
    }).join('\n');
}

// Core proxy request handler
async function handleProxyRequest(request) {
    // 1. Handle CORS preflight OPTIONS request
    if (request.method === 'OPTIONS') {
        return new Response(null, {
            status: 204,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, HEAD, POST, OPTIONS',
                'Access-Control-Allow-Headers': '*',
                'Access-Control-Max-Age': '86400',
            }
        });
    }

    // 2. Extract target URL from query: '?https://...' or '?url=https://...'
    const targetUrl = extractTargetUrl(request.url);

    if (!targetUrl || !targetUrl.startsWith('http')) {
        return new Response(JSON.stringify({
            status: 'online',
            service: 'StreamPulse Smart Stream Proxy',
            message: 'Proxy is active. Pass target stream: /?https://example.com/stream.m3u8',
            features: [
                'Full CORS Enablement',
                'Geo-Bypass & Anonymization',
                'IPTV Player (VLC) Emulation',
                'Auto-Referer Anti-Hotlink',
                'Byte-Range (206) Video Streaming',
                'Smart M3U8 Manifest Path Rewriting'
            ]
        }), {
            status: 200,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            }
        });
    }

    try {
        const targetParsed = new URL(targetUrl);
        const reqParsed = new URL(request.url);
        const workerBaseUrl = `${reqParsed.origin}${reqParsed.pathname.endsWith('/') ? reqParsed.pathname : reqParsed.pathname + '/'}`;

        // 3. Construct headers for upstream media server
        const forwardHeaders = new Headers();

        // Per-stream header overrides (take precedence over auto-referer below)
        const ov = extractOverrides(request.url);

        // Anti-Block User-Agent: explicit ?ua= wins; then VLC/Kodi passthrough; else VLC default
        const incomingUA = request.headers.get('User-Agent') || '';
        if (ov.ua) {
            forwardHeaders.set('User-Agent', ov.ua);
        } else if (incomingUA.includes('VLC') || incomingUA.includes('Kodi') || incomingUA.includes('Lavf')) {
            forwardHeaders.set('User-Agent', incomingUA);
        } else {
            // Emulate standard VLC media player which has the highest IPTV server acceptance
            forwardHeaders.set('User-Agent', 'VLC/3.0.18 LibVLC/3.0.18');
        }

        // Referer & Origin: explicit ?ref=/?origin= wins (needed for embed-gated CDNs like
        // newkso.ru which require the embed-page referer, NOT the stream host); else auto.
        forwardHeaders.set('Referer', ov.ref || `${targetParsed.protocol}//${targetParsed.host}/`);
        forwardHeaders.set('Origin', ov.origin || ov.ref?.replace(/\/$/, '') || `${targetParsed.protocol}//${targetParsed.host}`);
        forwardHeaders.set('Accept', '*/*');
        forwardHeaders.set('Accept-Encoding', 'identity'); // Avoid compression mismatch on manifests

        // Full Byte-Range support: Forward Range header if present (crucial for HLS video segments)
        const range = request.headers.get('Range');
        if (range) {
            forwardHeaders.set('Range', range);
        }

        // CRITICAL GEO-BYPASS: Do NOT forward client IP headers
        // (Cloudflare will act as the request origin, masking user local country and IP)

        // 4. Perform fetch to upstream media server
        const upstreamResponse = await fetch(targetUrl, {
            method: request.method === 'HEAD' ? 'HEAD' : 'GET',
            headers: forwardHeaders,
            redirect: 'follow'
        });

        // 5. Clone and modify response headers for browser delivery
        const responseHeaders = new Headers(upstreamResponse.headers);
        responseHeaders.set('Access-Control-Allow-Origin', '*');
        responseHeaders.set('Access-Control-Allow-Methods', 'GET, HEAD, POST, OPTIONS');
        responseHeaders.set('Access-Control-Allow-Headers', '*');
        responseHeaders.set('Access-Control-Expose-Headers', '*');

        // Check if response is an M3U8 playlist
        const contentType = upstreamResponse.headers.get('content-type') || '';
        const isManifest = targetUrl.includes('.m3u8') ||
                           targetUrl.includes('.m3u') ||
                           contentType.includes('mpegurl') ||
                           contentType.includes('application/x-mpegURL');

        // For manifests: disable cache, remove old content-length/encoding, and rewrite relative segment URLs
        if (isManifest && upstreamResponse.status === 200) {
            responseHeaders.set('Cache-Control', 'no-cache, no-store, must-revalidate');
            responseHeaders.set('Content-Type', 'application/vnd.apple.mpegurl; charset=utf-8');
            responseHeaders.delete('content-length');
            responseHeaders.delete('content-encoding');

            const manifestText = await upstreamResponse.text();
            const rewrittenManifest = rewriteManifestUrls(manifestText, upstreamResponse.url || targetUrl, workerBaseUrl, overridesToQS(ov));

            return new Response(rewrittenManifest, {
                status: upstreamResponse.status,
                statusText: upstreamResponse.statusText,
                headers: responseHeaders
            });
        }

        // For video segments (.ts, .m4s, .mp4, audio), stream body directly with range support
        return new Response(upstreamResponse.body, {
            status: upstreamResponse.status,
            statusText: upstreamResponse.statusText,
            headers: responseHeaders
        });

    } catch (error) {
        return new Response(JSON.stringify({
            error: 'Proxy Fetch Failed',
            message: error.message,
            target: targetUrl,
            status: 502
        }), {
            status: 502,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, HEAD, POST, OPTIONS',
                'Access-Control-Allow-Headers': '*'
            }
        });
    }
}

/* ===========================================================================
   STREAM RESOLVER — catalog, lookup/API chains, feed and embed discovery
   ---------------------------------------------------------------------------
   The reference apps don't ship stream URLs; they resolve them at play time.
   Sources and per-channel resolver chains are configured through CATALOG_URL.

   Each channel mirrors the app's model {id, name, type, link, api, headers}:
     type "direct" : link is already the .m3u8                      -> play as-is
     type "api"    : GET api (optionally %s = last path seg of link),
                     read a (dotted) field for the URL              (app resolver B)
     type "lookup" : GET api, read a key, fill a {key}/{id} template(app resolver A /
                     server_lookup -> server_key -> URL template)
   Swap DEMO_CATALOG for your own, or set env.CATALOG_URL to a JSON array.
   =========================================================================== */
const DEMO_CATALOG = [
    { id: 'sportzfy-live', name: 'SportzFY Feed', group: 'Sports', type: 'feed',
      api: 'https://raw.githubusercontent.com/smtpatel9211/2026/refs/heads/main/com.SportzFY.SportzFYLiveFootballTVApp', field: 'livetv' },
    { id: "apple-bipbop", name: "Apple BipBop (fMP4)", group: "Test", type: "direct",
      link: "https://devstreaming-cdn.apple.com/videos/streaming/examples/img_bipbop_adv_example_fmp4/master.m3u8" },
    { id: "mux-test", name: "Mux Test Stream", group: "Test", type: "direct",
      link: "https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8" },
    // "api": fetch endpoint, read a dotted field for the playback URL (httpbin echoes it back)
    { id: "api-demo", name: "API-resolver Demo", group: "Test", type: "api",
      api: "https://httpbin.org/get?playback_url=https%3A%2F%2Ftest-streams.mux.dev%2Fx36xhzz%2Fx36xhzz.m3u8",
      field: "args.playback_url" },
    // "lookup": fetch endpoint, read a key, then fill a template (mirrors server_lookup -> key -> URL)
    { id: "lookup-demo", name: "Lookup-resolver Demo", group: "Test", type: "lookup",
      api: "https://httpbin.org/get?server_key=test-streams.mux.dev",
      key: "args.server_key", template: "https://{key}/x36xhzz/x36xhzz.m3u8" }
];

// Recovered from res/xml/remote_config_defaults.xml in CRICFy_v7.2.apk.
// Firebase Remote Config can replace this host at runtime.
const CRICFY_DEFAULT_CATALOG = 'https://cfydjjufvbh146.top/categories/sports.txt';
const HDSTREAMZ_DEFAULT_BASE = 'https://service6af36c220c8d5-file-delivery-prd-uk.nomox.ru/h98H1H48izQD1UvJUjjpgOdWjuJvJ5AC/';
const HDSTREAMZ_DEFAULT_IMAGES = 'https://global6af36c235d5b0-srv-prod-dc.cachora.life/h98H1H48izQD1UvJUjjpgOdWjuJvJ5AC/';
const sourceCache = new Map();

function normalizeHdCatalog(document, env) {
    const channels = document?.data?.channels;
    if (!Array.isArray(channels)) throw new Error('HD Streamz catalog has no data.channels');
    const sourceUrl = env?.HDSTREAMZ_SOURCE_URL || new URL('313537.php', env?.HDSTREAMZ_BASE_URL || HDSTREAMZ_DEFAULT_BASE).href;
    return channels.filter(channel => channel.status === 'yes' && channel.type === 't' && channel.id != null && channel.title && channel.sources?.length).map(channel => ({
        id: 'hdstreamz:' + channel.id, name: channel.title, group: channel.cat_title || 'General',
        category: ({ Sports: 'sports', News: 'news', Entertainment: 'entertainment', Movies: 'movies', Music: 'music', Kids: 'kids', Documentary: 'documentary' })[channel.cat_title] || 'general',
        country: ({ Bangladesh: 'bd', India: 'in', Pakistan: 'pk', UK: 'uk', USA: 'us', 'United Kingdom': 'uk', 'United States': 'us', Canada: 'ca', Australia: 'au', Germany: 'de', France: 'fr', Italy: 'it', Spain: 'es' })[channel.cou_title] || 'unknown',
        logo: channel.logo ? mediaUrl(channel.logo, env?.HDSTREAMZ_IMAGE_URL || HDSTREAMZ_DEFAULT_IMAGES) : '',
        type: 'chain',
        resolvers: channel.sources.slice(0, 12).map((source, quality) => ({ type: 'hdstreamz', channelId: channel.id, quality, api: sourceUrl }))
    }));
}

async function hdSourceJson(response, env) {
    const text = (await response.text()).trim();
    try { return JSON.parse(text); } catch (_) { /* encoded source response */ }
    const hex = env?.HDSTREAMZ_CODEC_KEY;
    if (typeof hex !== 'string' || !/^[0-9a-f]{64}$/i.test(hex)) throw new Error('Encoded HD Streamz response requires HDSTREAMZ_CODEC_KEY');
    const bytes = Uint8Array.from(atob(text), character => character.charCodeAt(0));
    if (bytes.length <= 256) throw new Error('Invalid HD Streamz encoded response');
    const key = Uint8Array.from(hex.match(/../g), value => {
        const byte = parseInt(value, 16);
        return ((byte << 7) | (byte >>> 3)) & 255;
    });
    const inverse = new Uint8Array(256);
    const permutation = bytes.subarray(bytes.length - 256);
    if (new Set(permutation).size !== 256) throw new Error('Invalid HD Streamz response permutation');
    permutation.forEach((value, index) => { inverse[value] = index; });
    const clear = new Uint8Array(bytes.length - 256);
    clear.forEach((_, index) => {
        const byte = bytes[index];
        clear[index] = inverse[((byte << 5) | (byte >>> 3)) & 255] ^ key[index % 32];
    });
    return JSON.parse(new TextDecoder().decode(clear));
}

async function resolveHdStream(channel, env) {
    const url = new URL(mediaUrl(channel.api));
    url.searchParams.set('id', String(channel.channelId));
    url.searchParams.set('quality', String(channel.quality || 0));
    url.searchParams.set('type', '0');
    url.searchParams.set('app', '188');
    const response = await hdSourceJson(await resolverFetch(url.href), env);
    const source = response?.data;
    if (response.status !== 'ok' || !source) throw new Error('HD Streamz source unavailable');
    if (source.drmType || source.lUrl || /\.mpd(?:[?#]|$)/i.test(source.link || '')) throw new Error('HD Streamz DRM/DASH source is unsupported');
    if (source.method && source.method !== 'default') throw new Error('Unsupported HD Streamz playback method: ' + source.method);
    if (source.token || source.url_modifier?.length) throw new Error('HD Streamz source requires a native token or URL modifier');
    let extra = {};
    if (source.h?.length > 2) {
        try {
            const bytes = Uint8Array.from(atob(source.h.slice(2)), character => character.charCodeAt(0));
            extra = JSON.parse(new TextDecoder().decode(bytes));
        } catch (_) { throw new Error('Invalid HD Streamz playback headers'); }
    }
    return { url: mediaUrl(source.link), headers: normalizeHeaders({ userAgent: source.ua || '', referer: source.ref || '', ...normalizeHeaders(extra) }) };
}

function normalizeCatalog(catalog, base) {
    if (!Array.isArray(catalog)) throw new Error('Catalog must return a JSON array');
    return catalog.filter(channel => channel && channel.id != null).map(channel => {
        if (!Array.isArray(channel.formats)) return { ...channel, id: String(channel.id) };
        const resolvers = channel.formats.filter(format => format.webLink).map(format => ({
            type: 'channel-item', api: mediaUrl(format.webLink, base), title: format.title
        }));
        // Empty webLink means the APK uses its standard channel-detail route.
        if (channel.slug) resolvers.unshift({ type: 'channel-item', api: mediaUrl('channels/' + encodeURIComponent(String(channel.slug).toLowerCase()) + '.txt', new URL('../', base).href) });
        return {
            id: 'cricfy:' + channel.id, name: channel.title, logo: channel.image,
            group: channel.cat || 'Sports', type: 'chain',
            resolvers
        };
    }).filter(channel => channel.id && channel.name);
}

function apkStream(stream, base) {
    if (stream.drmType || stream.drmLicense) throw new Error('DRM stream requires a compatible licensed player');
    const type = Number(stream.type || 0);
    const [link, ...extra] = String(stream.link || '').split('|');
    const inlineHeaders = normalizeHeaders(Object.fromEntries(new URLSearchParams(extra.join('|'))));
    const headers = { ...inlineHeaders, ...normalizeHeaders(stream.headers) };
    const common = { headers, requestHeaders: headers };
    if (type === 9) return { ...common, type: 'premium', id: link, channelId: link };
    if (type === 6) return { ...common, type: 'api', api: mediaUrl(stream.api, base), link: mediaUrl(link, base) };
    if ([1, 2, 3].includes(type)) return { ...common, type: 'suffix', variant: type, link, api: mediaUrl(stream.api, base) };
    if ([4, 5].includes(type)) return { ...common, type: 'sniff', link: mediaUrl(link, type === 5 ? 'https://vk.com/' : base) };
    if (type === 0) return { ...common, type: 'direct', link: mediaUrl(link, base) };
    throw new Error('Unsupported APK stream type: ' + type);
}

// wn2.e: reverse the suffix, remove the inserted characters, then reverse back.
function decodeApkSuffix(value, variant) {
    const reversed = [...value].reverse();
    const positions = variant === 1 ? [10, 22, 34, 46, 58] : [33, 42, 51, 58];
    if (value.length < 59) throw new Error('Malformed APK suffix');
    return reversed.filter((_, index) => !positions.includes(index)).reverse().join('');
}

const JSON_CORS = {
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': '*'
};

// Read "a.b.c" out of a nested object
function getByPath(obj, path) {
    return String(path).split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

// Resolve one channel to { url, headers } by its type (the core app pattern)
function mediaUrl(value, base) {
    if (typeof value !== 'string' || !value.trim()) throw new Error('missing URL');
    const url = new URL(value, base);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('URL must use HTTP or HTTPS');
    return url.href;
}

function normalizeHeaders(input = {}) {
    const out = {};
    for (const [key, value] of Object.entries(input || {})) {
        const name = { referer: 'referer', referrer: 'referer', origin: 'origin', 'user-agent': 'userAgent', useragent: 'userAgent' }[key.toLowerCase()];
        if (name && typeof value === 'string') out[name] = value;
    }
    return out;
}

async function resolverFetch(url, overrides, signal) {
    const h = normalizeHeaders(overrides);
    const headers = new Headers();
    if (h.referer) headers.set('Referer', h.referer);
    if (h.origin) headers.set('Origin', h.origin);
    headers.set('User-Agent', h.userAgent || 'Mozilla/5.0');
    const timeout = AbortSignal.timeout(10000);
    const response = await fetch(mediaUrl(url), { headers, redirect: 'follow', signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
    if (!response.ok) throw new Error('Upstream HTTP ' + response.status);
    return response;
}

// Supports plain JSON and the APK's legacy AES-CBC catalog transport.
// Codec keys are server-side deployment secrets; they are never sent to clients.
async function sourceJson(response, env) {
    const text = (await response.text()).trim();
    try { return JSON.parse(text); } catch (_) { /* encoded source */ }
    const pairs = env?.CRICFY_CODEC_KEYS ? JSON.parse(env.CRICFY_CODEC_KEYS) : [];
    if (!Array.isArray(pairs) || !pairs.length) throw new Error('Encoded catalog requires CRICFY_CODEC_KEYS');
    const bytes = Uint8Array.from(atob(text), character => character.charCodeAt(0));
    const fromHex = value => {
        if (typeof value !== 'string' || !/^[0-9a-f]{32}$/i.test(value)) throw new Error('Invalid catalog codec key or IV');
        return Uint8Array.from(value.match(/../g), byte => parseInt(byte, 16));
    };
    for (const pair of pairs.slice(0, 4)) {
        try {
            const key = await crypto.subtle.importKey('raw', fromHex(pair.key), 'AES-CBC', false, ['decrypt']);
            const clear = await crypto.subtle.decrypt({ name: 'AES-CBC', iv: fromHex(pair.iv) }, key, bytes);
            return JSON.parse(new TextDecoder().decode(clear));
        } catch (_) { /* try the next observed codec version */ }
    }
    throw new Error('Catalog codec did not match this response');
}

// Static extraction only: never execute untrusted scripts in the Worker.
function sniffCandidates(text, base) {
    const found = new Set();
    const decoded = text.replace(/\\\//g, '/').replace(/\\u002[fF]/g, '/').replace(/\\u0026/g, '&').replace(/&amp;|&#38;/g, '&').replace(/&quot;/g, '"');
    const add = value => { try { found.add(mediaUrl(value, base)); } catch (_) {} };
    for (const m of decoded.matchAll(/(?:https?:)?\/\/[^\s"'<>\\]+\.m3u8[^\s"'<>\\]*/gi)) add(m[0]);
    for (const m of decoded.matchAll(/data-(?:hls|m3u8|source|stream)\s*=\s*["']([^"']+)["']/gi)) add(m[1]);
    for (const m of decoded.matchAll(/(?:["'](?:file|src|hls|hls_ondemand|hlsManifestUrl|m3u8)["']|\b(?:file|src|hls|hls_ondemand|hlsManifestUrl|m3u8))\s*[:=]\s*["']([^"']+)["']/gi)) {
        if (/\.m3u8(?:[?#]|$)/i.test(m[1])) add(m[1]);
    }
    for (const m of decoded.matchAll(/["']([A-Za-z0-9+/]{16,}={0,2})["']/g)) {
        try { const value = atob(m[1]); if (/\.m3u8(?:[?#]|$)/i.test(value)) add(value); } catch (_) {}
    }
    return [...found];
}

async function sniffStream(ch, depth = 0) {
    const signal = ch._signal || AbortSignal.timeout(5000);
    const link = mediaUrl(ch.link);
    const response = await resolverFetch(link, ch.requestHeaders || ch.headers, signal);
    const base = response.url || link;
    const text = await response.text();
    const headers = normalizeHeaders({ referer: base, origin: new URL(base).origin, ...normalizeHeaders(ch.headers) });
    if (text.trimStart().startsWith('#EXTM3U')) return { url: base, headers };
    for (const candidate of sniffCandidates(text, base).slice(0, 8)) {
        try {
            const manifest = await resolverFetch(candidate, headers, signal);
            if ((await manifest.text()).trimStart().startsWith('#EXTM3U')) return { url: manifest.url || candidate, headers };
        } catch (_) { /* try the next candidate */ }
    }
    if (depth < 2) {
        const frames = [...text.matchAll(/<iframe\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi),
            ...text.matchAll(/itemprop\s*=\s*["']embedUrl["']\s+(?:href|content)\s*=\s*["']([^"']+)["']/gi)].slice(0, 3);
        for (const frame of frames) {
            try { return await sniffStream({ link: mediaUrl(frame[1].replace(/&amp;/g, '&'), base), requestHeaders: headers, headers: ch.headers, _signal: signal }, depth + 1); }
            catch (_) { /* try the next frame */ }
        }
    }
    throw new Error('No playable M3U8 found; this page may require browser execution');
}

async function discoverStream(ch, env) {
    try { return await sniffStream(ch); }
    catch (error) {
        if (!env?.DYNAMIC_SNIFFER && !env?.DYNAMIC_SNIFFER_URL) throw error;
        const target = env.DYNAMIC_SNIFFER ? 'https://sniffer.internal/sniff' : mediaUrl(env.DYNAMIC_SNIFFER_URL);
        const options = {
            method: 'POST', headers: { 'Content-Type': 'application/json',
                Authorization: 'Bearer ' + (env.DYNAMIC_SNIFFER_TOKEN || '') },
            body: JSON.stringify({ url: mediaUrl(ch.link), headers: normalizeHeaders(ch.headers) }),
            signal: AbortSignal.timeout(15000)
        };
        const response = env.DYNAMIC_SNIFFER
            ? await env.DYNAMIC_SNIFFER.fetch(new Request(target, options))
            : await fetch(target, options);
        const result = await response.json();
        if (!response.ok || result.error) throw new Error(result.error || 'Browser sniffer HTTP ' + response.status);
        return { url: mediaUrl(result.url), headers: normalizeHeaders(result.headers) };
    }
}

async function resolveChannel(ch, depth = 0, env) {
    if (depth > 5) throw new Error('resolver chain too deep');
    if (ch.type === 'hdstreamz') return resolveHdStream(ch, env);
    if (Array.isArray(ch.resolvers)) {
        const errors = [];
        for (const resolver of ch.resolvers) {
            try { return await resolveChannel({ ...ch, resolvers: null, ...resolver }, depth + 1, env); }
            catch (e) { errors.push(e.message); }
        }
        throw new Error('All resolvers failed: ' + errors.join('; '));
    }
    if (ch.type === 'channel-item') {
        const response = await resolverFetch(ch.api, ch.requestHeaders || ch.headers);
        const item = await sourceJson(response, env);
        if (!Array.isArray(item.streamUrls) || !item.streamUrls.length) throw new Error('ChannelItem has no streamUrls');
        const errors = [];
        for (const stream of item.streamUrls) {
            try { return await resolveChannel(apkStream(stream, response.url || ch.api), depth + 1, env); }
            catch (e) { errors.push(e.message); }
        }
        throw new Error('ChannelItem resolvers failed: ' + errors.join('; '));
    }
    if (ch.type === 'suffix') {
        const suffix = await (await resolverFetch(ch.api, ch.requestHeaders || ch.headers)).text();
        return { url: mediaUrl(ch.link + (ch.variant === 2 ? suffix : decodeApkSuffix(suffix, ch.variant))), headers: normalizeHeaders(ch.headers) };
    }
    if (ch.type === 'premium') {
        const id = String(ch.channelId || ch.id).replace(/^premium/, '');
        if (!/^\d+$/.test(id)) throw new Error('premium channelId must be numeric');
        return resolveChannel({
            ...ch, type: 'lookup',
            api: 'https://dokoplay.xyz/server_lookup.php?channel_id=premium' + id,
            requestHeaders: { referer: 'https://dokoplay.xyz/', userAgent: 'Mozilla/5.0', ...ch.requestHeaders },
            template: 'https://{key}new.newkso.ru/{key}/premium' + id + '/mono.m3u8',
            headers: { referer: 'https://newembedplay.xyz', origin: 'https://newembedplay.xyz', userAgent: 'Mozilla/5.0 (Linux; Android 13; 22101316I) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.6261.105 Mobile Safari/537.36', ...normalizeHeaders(ch.headers) }
        }, depth + 1, env);
    }
    if (ch.type === 'sniff' || ch.type === 'embed') return discoverStream(ch, env);
    if (ch.type === 'feed') {
        const config = await (await resolverFetch(ch.api, ch.requestHeaders)).json();
        const link = mediaUrl(getByPath(config, ch.field || 'livetv'), ch.api);
        try { return await discoverStream({ ...ch, type: 'sniff', link }, env); }
        catch (error) {
            if (ch.embedFallback === false) throw error;
            return { url: link, type: 'web', headers: {}, message: 'Feed page; no static HLS manifest found' };
        }
    }
    const headers = normalizeHeaders(ch.headers);
    if (!ch.type || ch.type === 'direct') {
        return { url: mediaUrl(ch.link), headers };
    }
    if (ch.type === 'api') {
        const apiUrl = (ch.api || '').includes('%s')
            ? ch.api.replace('%s', encodeURIComponent(new URL(ch.link).pathname.split('/').filter(Boolean).pop() || ''))
            : ch.api;
        const j = await (await resolverFetch(apiUrl, ch.requestHeaders || ch.headers)).json();
        const url = getByPath(j, ch.field || 'playback_url');
        if (!url) throw new Error('playback field not found: ' + (ch.field || 'playback_url'));
        return { url: mediaUrl(url, apiUrl), headers };
    }
    if (ch.type === 'lookup') {
        const j = await (await resolverFetch(ch.api, ch.requestHeaders || ch.headers)).json();
        const keyVal = getByPath(j, ch.key || 'server_key');
        if (keyVal == null) throw new Error('lookup key not found: ' + (ch.key || 'server_key'));
        if (!/^[a-zA-Z0-9.-]+$/.test(String(keyVal))) throw new Error('invalid server key');
        const url = String(ch.template || '').replace(/\{key\}/g, keyVal).replace(/\{id\}/g, ch.id);
        return { url: mediaUrl(url), headers };
    }
    throw new Error('unknown channel type: ' + ch.type);
}

async function loadCatalog(env) {
    if (env && env.CATALOG_URL) {
        const catalog = await sourceJson(await resolverFetch(env.CATALOG_URL), env);
        return normalizeCatalog(catalog, env.CATALOG_URL);
    }
    const catalog = DEMO_CATALOG.map(channel => channel.type === 'feed' ? {
        ...channel, api: env?.SPORTZ_CONFIG_URL || channel.api, field: env?.SPORTZ_FEED_FIELD || channel.field
    } : channel);
    const sources = await loadAppSources(env);
    return [...catalog, ...sources.flatMap(source => source.channels)];
}

async function loadAppSources(env) {
    return Promise.all([
        env?.CRICFY_ENABLED === 'false' ? { id: 'cricfy', status: 'disabled', channels: [], count: 0 } : loadCricfySource(env),
        env?.HDSTREAMZ_ENABLED === 'false' ? { id: 'hdstreamz', status: 'disabled', channels: [], count: 0 } : loadHdSource(env)
    ]);
}

async function loadHdSource(env) {
    const url = env?.HDSTREAMZ_CATALOG_URL || new URL('data179.json', env?.HDSTREAMZ_BASE_URL || HDSTREAMZ_DEFAULT_BASE).href;
    const cacheKey = 'hdstreamz:' + url;
    const cached = sourceCache.get(cacheKey);
    if (cached && cached.expires > Date.now()) return cached.promise;
    const promise = (async () => {
        try {
            const channels = normalizeHdCatalog(await hdSourceJson(await resolverFetch(url), env), env);
            return { id: 'hdstreamz', url, status: 'available', channels, count: channels.length };
        } catch (error) {
            const channels = cached ? (await cached.promise).channels : [];
            return { id: 'hdstreamz', url, status: channels.length ? 'stale' : 'unavailable', channels, count: channels.length, message: error.message };
        }
    })();
    if (sourceCache.size >= 8) sourceCache.delete(sourceCache.keys().next().value);
    sourceCache.set(cacheKey, { promise, expires: Date.now() + 60000 });
    return promise;
}

async function loadCricfySource(env) {
    const url = env?.CRICFY_CATALOG_URL || CRICFY_DEFAULT_CATALOG;
    const cached = sourceCache.get(url);
    if (cached && cached.expires > Date.now()) return cached.promise;
    const promise = (async () => {
        try {
            const channels = normalizeCatalog(await sourceJson(await resolverFetch(url), env), url);
            return { id: 'cricfy', url, status: 'available', channels, count: channels.length };
        } catch (e) {
            const previous = cached ? await cached.promise : null;
            const channels = previous?.channels || [];
            return { id: 'cricfy', url, status: channels.length ? 'stale' : 'unavailable', channels, count: channels.length, message: e.message };
        }
    })();
    // Cache both success and failure to avoid repeating dead-host requests on every play.
    if (sourceCache.size >= 8) sourceCache.delete(sourceCache.keys().next().value);
    sourceCache.set(url, { promise, expires: Date.now() + 60000 });
    return promise;
}

// GET /catalog  -> public channel list (no internal api/template fields leaked)
async function handleCatalog(env) {
    const cat = await loadCatalog(env);
    const pub = cat.map(c => ({ id: c.id, name: c.name, logo: c.logo || '', group: c.group || '', category: c.category || '', country: c.country || '', type: c.type || 'direct',
        ...(c.resolvers?.[0]?.type === 'hdstreamz' ? { variants: c.resolvers.map((resolver, index) => ({ index, name: 'Source ' + (index + 1) })) } : {}) }));
    return new Response(JSON.stringify(pub), { headers: JSON_CORS });
}

// GET /resolve?id=X -> { url, headers }  (play url through the proxy with headers)
async function handleResolve(request, env) {
    const id = new URL(request.url).searchParams.get('id');
    const cat = await loadCatalog(env);
    const ch = cat.find(c => c.id === id);
    if (!ch) return new Response(JSON.stringify({ error: 'unknown channel id', id }), { status: 404, headers: JSON_CORS });
    const variant = new URL(request.url).searchParams.get('variant');
    let selected = ch;
    if (variant !== null) {
        const index = Number(variant);
        if (!/^\d+$/.test(variant) || !Number.isSafeInteger(index) || ch.resolvers?.[index]?.type !== 'hdstreamz') {
            return new Response(JSON.stringify({ error: 'unknown source variant' }), { status: 400, headers: JSON_CORS });
        }
        selected = ch.resolvers[index];
    }
    try {
        return new Response(JSON.stringify(await resolveChannel(selected, 0, env)), { headers: JSON_CORS });
    } catch (e) {
        return new Response(JSON.stringify({ error: 'resolve failed', message: e.message, id }), { status: 502, headers: JSON_CORS });
    }
}

// Resolver endpoints share JSON error handling; all other requests use the proxy.
async function handleRequest(request, env) {
    const path = new URL(request.url).pathname;
    const resolverRoute = ['/catalog', '/resolve', '/sniff', '/feed', '/sources'].includes(path);
    if (resolverRoute && !['GET', 'OPTIONS'].includes(request.method)) {
        return new Response(JSON.stringify({ error: 'method not allowed' }), { status: 405, headers: { ...JSON_CORS, Allow: 'GET, OPTIONS' } });
    }
    if (resolverRoute && request.method === 'OPTIONS') return new Response(null, { status: 204, headers: JSON_CORS });
    try {
        if (path === '/sources') {
            const sniffer = { id: 'sniffer', status: env?.DYNAMIC_SNIFFER || env?.DYNAMIC_SNIFFER_URL ? 'configured' : 'not configured' };
            const sources = await loadAppSources(env);
            const status = sources.map(({ channels, ...metadata }) => metadata);
            return new Response(JSON.stringify([...status, sniffer]), { headers: JSON_CORS });
        }
        if (path === '/sniff') {
            const link = new URL(request.url).searchParams.get('url');
            return new Response(JSON.stringify(await discoverStream({ link }, env)), { headers: JSON_CORS });
        }
        if (path === '/feed') {
            const configUrl = env?.SPORTZ_CONFIG_URL || 'https://raw.githubusercontent.com/smtpatel9211/2026/refs/heads/main/com.SportzFY.SportzFYLiveFootballTVApp';
            const config = await (await resolverFetch(configUrl)).json();
            const url = mediaUrl(getByPath(config, env?.SPORTZ_FEED_FIELD || 'livetv'), configUrl);
            return new Response(JSON.stringify({ url, type: 'embed' }), { headers: JSON_CORS });
        }
        if (path === '/catalog') return await handleCatalog(env);
        if (path === '/resolve') return await handleResolve(request, env);
    } catch (e) {
        return new Response(JSON.stringify({ error: 'resolver request failed', message: e.message }), { status: 502, headers: JSON_CORS });
    }
    return handleProxyRequest(request);
}

// 1. ES Modules format (Default in Cloudflare Workers editor)
export default {
    async fetch(request, env, ctx) {
        return handleRequest(request, env);
    }
};

// 2. Classic Service Worker format (Fallback if worker uses addEventListener)
if (typeof addEventListener !== 'undefined') {
    try {
        addEventListener('fetch', event => {
            event.respondWith(handleRequest(event.request, (typeof globalThis !== 'undefined' ? globalThis : {})));
        });
    } catch (e) {}
}
