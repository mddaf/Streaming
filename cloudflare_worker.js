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
            const rewrittenManifest = rewriteManifestUrls(manifestText, targetUrl, workerBaseUrl, overridesToQS(ov));

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
   STREAM RESOLVER  (learning build — mirrors the reference app's architecture)
   ---------------------------------------------------------------------------
   The reference apps don't ship stream URLs; they resolve them at play time.
   This reproduces that pattern GENERICALLY, against sources YOU control/own.
   Point it at your own origin or legal/free sources — not at anyone's catalog.

   Each channel mirrors the app's model {id, name, type, link, api, headers}:
     type "direct" : link is already the .m3u8                      -> play as-is
     type "api"    : GET api (optionally %s = last path seg of link),
                     read a (dotted) field for the URL              (app resolver B)
     type "lookup" : GET api, read a key, fill a {key}/{id} template(app resolver A /
                     server_lookup -> server_key -> URL template)
   Swap DEMO_CATALOG for your own, or set env.CATALOG_URL to a JSON array.
   =========================================================================== */
const DEMO_CATALOG = [
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

const JSON_CORS = {
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
async function resolveChannel(ch) {
    const headers = ch.headers || {};
    if (!ch.type || ch.type === 'direct') {
        return { url: ch.link, headers };
    }
    if (ch.type === 'api') {
        const apiUrl = (ch.api || '').includes('%s')
            ? ch.api.replace('%s', String(ch.link || '').split('/').pop())
            : ch.api;
        const j = await (await fetch(apiUrl)).json();
        const url = getByPath(j, ch.field || 'playback_url');
        if (!url) throw new Error('playback field not found: ' + (ch.field || 'playback_url'));
        return { url, headers };
    }
    if (ch.type === 'lookup') {
        const j = await (await fetch(ch.api)).json();
        const keyVal = getByPath(j, ch.key || 'server_key');
        if (keyVal == null) throw new Error('lookup key not found: ' + (ch.key || 'server_key'));
        const url = String(ch.template || '').replace(/\{key\}/g, keyVal).replace(/\{id\}/g, ch.id);
        return { url, headers };
    }
    throw new Error('unknown channel type: ' + ch.type);
}

async function loadCatalog(env) {
    if (env && env.CATALOG_URL) {
        try { return await (await fetch(env.CATALOG_URL)).json(); } catch (e) { /* fall back to demo */ }
    }
    return DEMO_CATALOG;
}

// GET /catalog  -> public channel list (no internal api/template fields leaked)
async function handleCatalog(env) {
    const cat = await loadCatalog(env);
    const pub = cat.map(c => ({ id: c.id, name: c.name, group: c.group || '', type: c.type || 'direct' }));
    return new Response(JSON.stringify(pub), { headers: JSON_CORS });
}

// GET /resolve?id=X -> { url, headers }  (play url through the proxy with headers)
async function handleResolve(request, env) {
    const id = new URL(request.url).searchParams.get('id');
    const cat = await loadCatalog(env);
    const ch = cat.find(c => c.id === id);
    if (!ch) return new Response(JSON.stringify({ error: 'unknown channel id', id }), { status: 404, headers: JSON_CORS });
    try {
        return new Response(JSON.stringify(await resolveChannel(ch)), { headers: JSON_CORS });
    } catch (e) {
        return new Response(JSON.stringify({ error: 'resolve failed', message: e.message, id }), { status: 502, headers: JSON_CORS });
    }
}

// Router: /catalog and /resolve go to the resolver; everything else is the proxy
async function handleRequest(request, env) {
    const path = new URL(request.url).pathname;
    if (request.method === 'OPTIONS' && (path.endsWith('/catalog') || path.endsWith('/resolve'))) {
        return new Response(null, { status: 204, headers: JSON_CORS });
    }
    if (path.endsWith('/catalog')) return handleCatalog(env);
    if (path.endsWith('/resolve')) return handleResolve(request, env);
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
