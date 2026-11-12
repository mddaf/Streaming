import puppeteer from '@cloudflare/puppeteer';

function httpUrl(value) {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Expected an HTTP(S) URL');
    return url.href;
}

export async function captureBrowser(browser, url, headers = {}, timeoutMs = 12000) {
    let timer;
    try {
        const page = await browser.newPage();
        if (headers.userAgent) await page.setUserAgent(headers.userAgent);
        const extraHeaders = {};
        if (headers.referer) extraHeaders.Referer = headers.referer;
        if (headers.origin) extraHeaders.Origin = headers.origin;
        await page.setExtraHTTPHeaders(extraHeaders);
        const result = new Promise((resolve, reject) => {
            timer = setTimeout(() => reject(new Error('No playable runtime M3U8 found before timeout')), timeoutMs);
            page.on('response', async response => {
                try {
                    if (!response.ok()) return;
                    const type = response.headers()['content-type'] || '';
                    if (!/\.m3u8(?:[?#]|$)/i.test(response.url()) && !/mpegurl/i.test(type)) return;
                    if (!(await response.text()).trimStart().startsWith('#EXTM3U')) return;
                    const requestHeaders = response.request().headers();
                    const referer = requestHeaders.referer || url;
                    resolve({ url: httpUrl(response.url()), headers: {
                        referer, origin: requestHeaders.origin || new URL(referer).origin,
                        userAgent: requestHeaders['user-agent'] || headers.userAgent || ''
                    }, method: 'browser' });
                } catch (_) { /* try the next response */ }
            });
        });
        page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs }).then(() => page.evaluate(() => {
            document.querySelectorAll('video').forEach(video => { video.muted = true; video.play().catch(() => {}); });
        })).catch(() => {});
        return await result;
    } finally {
        clearTimeout(timer);
        await browser.close();
    }
}

const captures = new Map();

// Private Worker: called through the proxy's service binding. No public URL.
export default {
    async fetch(request, env) {
        const reply = (body, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
        if (request.method !== 'POST' || new URL(request.url).pathname !== '/sniff') return reply({ error: 'Not found' }, 404);
        if (!env.BROWSER) return reply({ error: 'BROWSER binding is missing' }, 503);
        try {
            const text = await request.text();
            if (text.length > 16384) return reply({ error: 'Request too large' }, 413);
            const input = JSON.parse(text);
            const url = httpUrl(input.url);
            const headers = input.headers || {};
            const key = JSON.stringify([url, headers.referer || '', headers.origin || '', headers.userAgent || '']);
            const cached = captures.get(key);
            if (cached && cached.expires > Date.now()) return reply(await cached.promise);
            const promise = (async () => captureBrowser(await puppeteer.launch(env.BROWSER), url, headers))();
            if (captures.size >= 32) captures.delete(captures.keys().next().value);
            captures.set(key, { promise, expires: Date.now() + 30000 });
            try { return reply(await promise); }
            catch (error) { captures.delete(key); throw error; }
        } catch (error) {
            return reply({ error: error.message }, 502);
        }
    }
};
