/**
 * StreamPulse - Cloudflare Worker Smart Stream Proxy (Geo-Bypass & CORS Fix)
 * 
 * How to deploy:
 * 1. Go to https://dash.cloudflare.com/ -> Workers & Pages
 * 2. Select your worker (or create one: e.g. sports-proxy)
 * 3. Click "Edit Code"
 * 4. Paste this code and click "Deploy"!
 * 
 * Features:
 * - Full CORS enablement (Access-Control-Allow-Origin: *)
 * - Geo-Bypass: Anonymizes client IP headers (strips cf-connecting-ip, x-forwarded-for)
 * - Anti-Block: Emulates standard IPTV media player (VLC/Kodi) User-Agent
 * - Auto-Referer: Automatically sets Referer to target origin to bypass hotlink protection
 * - Full Byte-Range support (206 Partial Content) for smooth HLS video streaming
 */

export default {
    async fetch(request, env, ctx) {
        // Handle CORS preflight OPTIONS request
        if (request.method === 'OPTIONS') {
            return new Response(null, {
                status: 204,
                headers: {
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
                    'Access-Control-Allow-Headers': '*',
                    'Access-Control-Max-Age': '86400',
                }
            });
        }

        const url = new URL(request.url);
        let targetUrl = '';

        // Extract target URL from query: '?https://...' or '?url=https://...'
        if (url.searchParams.has('url')) {
            targetUrl = url.searchParams.get('url');
        } else if (url.search.length > 1) {
            targetUrl = decodeURIComponent(url.search.slice(1));
        }

        if (!targetUrl || !targetUrl.startsWith('http')) {
            return new Response(JSON.stringify({
                status: 'ready',
                message: 'StreamPulse Smart Proxy is online. Usage: /?https://example.com/stream.m3u8'
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

            // Construct forward headers
            const forwardHeaders = new Headers();

            // 1. Emulate media player User-Agent (bypasses browser user-agent blocks)
            const incomingUA = request.headers.get('User-Agent') || '';
            if (incomingUA.includes('VLC') || incomingUA.includes('Kodi')) {
                forwardHeaders.set('User-Agent', incomingUA);
            } else {
                forwardHeaders.set('User-Agent', 'VLC/3.0.18 LibVLC/3.0.18');
            }

            // 2. Set Referer to target domain origin to bypass hotlink protection
            forwardHeaders.set('Referer', `${targetParsed.protocol}//${targetParsed.host}/`);
            forwardHeaders.set('Origin', `${targetParsed.protocol}//${targetParsed.host}`);
            forwardHeaders.set('Accept', '*/*');

            // 3. Forward Range header if present (crucial for HLS video segments)
            const range = request.headers.get('Range');
            if (range) {
                forwardHeaders.set('Range', range);
            }

            // 4. CRITICAL GEO-BYPASS: Do NOT forward client IP headers
            // (Cloudflare will act as the request origin, masking user local country)

            // Perform fetch to upstream media server
            const response = await fetch(targetUrl, {
                method: request.method,
                headers: forwardHeaders,
                redirect: 'follow'
            });

            // Clone and modify response headers for browser delivery
            const responseHeaders = new Headers(response.headers);
            responseHeaders.set('Access-Control-Allow-Origin', '*');
            responseHeaders.set('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
            responseHeaders.set('Access-Control-Allow-Headers', '*');
            responseHeaders.set('Access-Control-Expose-Headers', '*');
            // Disable caching on manifest files to ensure live updates
            if (targetUrl.endsWith('.m3u8') || targetUrl.endsWith('.m3u')) {
                responseHeaders.set('Cache-Control', 'no-cache, no-store, must-revalidate');
            }

            return new Response(response.body, {
                status: response.status,
                statusText: response.statusText,
                headers: responseHeaders
            });
        } catch (error) {
            return new Response(JSON.stringify({
                error: 'Proxy Fetch Failed',
                message: error.message,
                target: targetUrl
            }), {
                status: 502,
                headers: {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*'
                }
            });
        }
    }
};
