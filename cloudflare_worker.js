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

// Rewrites relative URLs in M3U8 manifests so video chunks continue through this proxy
function rewriteManifestUrls(manifestText, baseUrl, workerBaseUrl) {
    if (!manifestText || typeof manifestText !== 'string') return manifestText;
    const lines = manifestText.split('\n');
    return lines.map(line => {
        const trimmed = line.trim();
        if (!trimmed) return line;

        // Rewrite URI="..." attributes (e.g. #EXT-X-KEY, #EXT-X-MEDIA, #EXT-X-MAP)
        if (trimmed.startsWith('#')) {
            return line.replace(/URI="([^"]+)"/g, (match, uri) => {
                try {
                    const abs = new URL(uri, baseUrl).href;
                    return `URI="${workerBaseUrl}?${encodeURIComponent(abs)}"`;
                } catch (e) {
                    return match;
                }
            });
        }

        // Child playlist or media segment line
        try {
            const abs = new URL(trimmed, baseUrl).href;
            return `${workerBaseUrl}?${encodeURIComponent(abs)}`;
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
        const workerOrigin = new URL(request.url).origin;
        const workerBaseUrl = `${workerOrigin}/`;

        // 3. Construct headers for upstream media server
        const forwardHeaders = new Headers();

        // Anti-Block: Emulate media player User-Agent (VLC/Kodi/Lavf) to bypass browser blocks
        const incomingUA = request.headers.get('User-Agent') || '';
        if (incomingUA.includes('VLC') || incomingUA.includes('Kodi') || incomingUA.includes('Lavf')) {
            forwardHeaders.set('User-Agent', incomingUA);
        } else {
            // Emulate standard VLC media player which has the highest IPTV server acceptance
            forwardHeaders.set('User-Agent', 'VLC/3.0.18 LibVLC/3.0.18');
        }

        // Auto-Referer: Automatically set Referer to target origin to bypass hotlink protection
        forwardHeaders.set('Referer', `${targetParsed.protocol}//${targetParsed.host}/`);
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

        // For manifests: disable cache and rewrite relative segment URLs to stay proxied
        if (isManifest && upstreamResponse.status === 200) {
            responseHeaders.set('Cache-Control', 'no-cache, no-store, must-revalidate');
            responseHeaders.set('Content-Type', 'application/vnd.apple.mpegurl; charset=utf-8');

            const manifestText = await upstreamResponse.text();
            const rewrittenManifest = rewriteManifestUrls(manifestText, targetUrl, workerBaseUrl);

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

// 1. ES Modules format (Default in Cloudflare Workers editor)
export default {
    async fetch(request, env, ctx) {
        return handleProxyRequest(request);
    }
};

// 2. Classic Service Worker format (Fallback if worker uses addEventListener)
if (typeof addEventListener !== 'undefined') {
    try {
        addEventListener('fetch', event => {
            event.respondWith(handleProxyRequest(event.request));
        });
    } catch (e) {}
}
