import { chromium } from 'playwright-core';
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

function httpUrl(value) {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Expected an HTTP(S) URL');
    return url.href;
}

function browserPath() {
    const candidates = [process.env.BROWSER_EXECUTABLE_PATH,
        'C:/Program Files/Google/Chrome/Application/chrome.exe',
        'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
        '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome'];
    const executablePath = candidates.find(path => path && existsSync(path));
    if (!executablePath) throw new Error('Set BROWSER_EXECUTABLE_PATH to an installed Chromium browser');
    return executablePath;
}

// Mirrors the APK's WebView network capture without running either APK.
export async function sniffInBrowser(url, headers = {}, options = {}) {
    url = httpUrl(url);
    const timeoutMs = options.timeoutMs || 12000;
    const browser = await chromium.launch({ headless: true, executablePath: browserPath() });
    let timer;
    try {
        const extraHTTPHeaders = {};
        if (headers.referer) extraHTTPHeaders.Referer = headers.referer;
        if (headers.origin) extraHTTPHeaders.Origin = headers.origin;
        const context = await browser.newContext({ extraHTTPHeaders,
            ...(headers.userAgent ? { userAgent: headers.userAgent } : {}),
            acceptDownloads: false, serviceWorkers: 'block' });
        const page = await context.newPage();
        const result = new Promise((resolve, reject) => {
            timer = setTimeout(() => reject(new Error('No playable runtime M3U8 found before timeout')), timeoutMs);
            page.on('response', async response => {
                try {
                    const type = response.headers()['content-type'] || '';
                    if (!response.ok() || (!/\.m3u8(?:[?#]|$)/i.test(response.url()) && !/mpegurl/i.test(type))) return;
                    if (!(await response.text()).trimStart().startsWith('#EXTM3U')) return;
                    const requestHeaders = await response.request().allHeaders();
                    resolve({ url: httpUrl(response.url()), headers: {
                        referer: requestHeaders.referer || url,
                        origin: requestHeaders.origin || new URL(requestHeaders.referer || url).origin,
                        userAgent: requestHeaders['user-agent'] || ''
                    }, method: 'browser' });
                } catch (_) { /* a closed page or an unreadable response is not a candidate */ }
            });
        });
        // Do not wait for network-idle: a live player may keep requesting forever.
        page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs }).then(async () => {
            await page.locator('video').evaluateAll(videos => videos.forEach(video => {
                video.muted = true;
                video.play().catch(() => {});
            }));
        }).catch(() => {});
        return await result;
    } finally {
        clearTimeout(timer);
        await browser.close();
    }
}

export function createSnifferServer({ token = process.env.SNIFFER_TOKEN } = {}) {
    if (!token) throw new Error('Set SNIFFER_TOKEN before starting the sniffer');
    let active = 0;
    return createServer(async (request, response) => {
        const send = (status, data) => {
            response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
            response.end(JSON.stringify(data));
        };
        if (request.headers.authorization !== 'Bearer ' + token) return send(401, { error: 'Unauthorized' });
        if (request.method !== 'POST' || request.url !== '/sniff') return send(404, { error: 'Not found' });
        if (active >= 2) return send(503, { error: 'Sniffer busy' });
        active++;
        try {
            let body = '';
            for await (const chunk of request) {
                body += chunk;
                if (body.length > 16384) return send(413, { error: 'Request too large' });
            }
            const input = JSON.parse(body);
            send(200, await sniffInBrowser(input.url, input.headers));
        } catch (error) {
            send(502, { error: error.message });
        } finally { active--; }
    });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const host = process.env.SNIFFER_HOST || '127.0.0.1';
    const port = Number(process.env.SNIFFER_PORT || 4174);
    createSnifferServer().listen(port, host, () => console.log(`Browser sniffer listening on http://${host}:${port}/sniff`));
}
