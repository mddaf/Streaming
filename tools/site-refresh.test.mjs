import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, sep, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

test('real website refreshes its guide while its resolved embed keeps playing', async () => {
    const root = fileURLToPath(new URL('../', import.meta.url));
    const server = createServer(async (request, response) => {
        const pathname = new URL(request.url, 'http://local').pathname;
        if (pathname === '/fixture-player') {
            response.writeHead(200, { 'Content-Type': 'text/html' });
            return response.end('<html><body>Fixture player</body></html>');
        }
        const file = resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
        if (!file.startsWith(resolve(root) + sep)) { response.writeHead(403); return response.end(); }
        try {
            const body = await readFile(file);
            const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.m3u': 'audio/x-mpegurl', '.json': 'application/json' };
            response.writeHead(200, { 'Content-Type': types[extname(file)] || 'text/plain' });
            response.end(body);
        } catch (_) { response.writeHead(404); response.end(); }
    });
    await new Promise(done => server.listen(0, '127.0.0.1', done));
    const base = 'http://127.0.0.1:' + server.address().port;
    const executablePath = [process.env.BROWSER_EXECUTABLE_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/google-chrome', '/usr/bin/chromium'].find(path => path && existsSync(path));
    let browser;
    try {
        browser = await chromium.launch({ headless: true, executablePath });
        const page = await browser.newPage();
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        let name = 'AAA Auto Refresh Fixture';
        await page.route('**/*', async route => {
            const url = new URL(route.request().url());
            if (url.hostname === '127.0.0.1') return route.continue();
            if (url.hostname.endsWith('workers.dev') && url.pathname === '/catalog') return route.fulfill({ json: [{ id: 'fixture', name, group: 'Sports', type: 'feed' }] });
            if (url.hostname.endsWith('workers.dev') && url.pathname === '/resolve') return route.fulfill({ json: { url: base + '/fixture-player', type: 'web' } });
            if (url.hostname === 'raw.githubusercontent.com' || url.hostname === 'iptv-org.github.io') return route.fulfill({ body: '#EXTM3U\n' });
            return route.abort();
        });
        await page.addInitScript(() => {
            const original = window.setInterval;
            window.setInterval = (callback, delay, ...args) => {
                if (delay === 300000) window.fixtureCatalogTick = callback;
                return original(callback, delay, ...args);
            };
        });
        await page.goto(base);
        await page.locator('#search-input').fill('AAA Auto Refresh');
        await page.getByText(name, { exact: true }).first().click();
        await page.waitForFunction(() => document.querySelector('#sports-iframe').src.endsWith('/fixture-player'));
        await page.evaluate(() => { window.fixtureFrame = document.querySelector('#sports-iframe').contentWindow; });
        name = 'AAA Auto Refresh Updated';
        await page.evaluate(() => window.fixtureCatalogTick());
        await page.getByText(name, { exact: true }).first().waitFor();
        assert.equal(await page.evaluate(() => window.fixtureFrame === document.querySelector('#sports-iframe').contentWindow), true);
        assert.equal(await page.locator('#sports-iframe').getAttribute('src'), base + '/fixture-player');
        // The explanatory UI is available on narrow screens without relying on a browser permission API.
        await page.setViewportSize({ width: 390, height: 844 });
        await page.locator('#tab-custom').click();
        await page.locator('#custom-url-input').fill('http://192.168.1.20/live.m3u8');
        await page.locator('#save-custom-btn').click();
        const localHelp = page.locator('#local-network-help');
        assert.equal(await localHelp.isVisible(), true);
        if (await localHelp.getAttribute('open') === null) await localHelp.locator('summary').click();
        assert.equal(await localHelp.getAttribute('open') !== null, true);
        assert.match(await localHelp.innerText(), /website cannot accept browser permissions/);
        assert.deepEqual(errors, []);
    } finally {
        if (browser) await browser.close();
        server.closeAllConnections();
        await new Promise(done => server.close(done));
    }
});
