import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { EventEmitter } from 'node:events';

function sniffer({ manifest = true } = {}) {
    let closed = 0;
    const page = new EventEmitter();
    page.setExtraHTTPHeaders = async () => {};
    page.setUserAgent = async () => {};
    page.evaluate = async () => {};
    page.goto = async () => {
        if (manifest) setTimeout(() => page.emit('response', {
            ok: () => true, url: () => 'https://cdn.test/live.m3u8',
            headers: () => ({ 'content-type': 'application/vnd.apple.mpegurl' }),
            text: async () => '#EXTM3U\nsegment.ts',
            request: () => ({ headers: () => ({ referer: 'https://embed.test/player', 'user-agent': 'fixture' }) })
        }), 1);
    };
    const browser = { newPage: async () => page, close: async () => { closed++; } };
    const context = vm.createContext({ Request, Response, URL, setTimeout, clearTimeout,
        puppeteer: { launch: async () => browser } });
    const source = readFileSync(new URL('./cloudflare-sniffer.mjs', import.meta.url), 'utf8')
        .replace("import puppeteer from '@cloudflare/puppeteer';", '')
        .replace('export async function', 'async function')
        .replace('export default {', 'globalThis.worker = {');
    vm.runInContext(source, context);
    return { context, browser, closed: () => closed };
}

test('Cloudflare capture returns actual media headers and closes its browser', async () => {
    const { context, browser, closed } = sniffer();
    const result = await context.captureBrowser(browser, 'https://embed.test/');
    assert.equal(result.url, 'https://cdn.test/live.m3u8');
    assert.equal(result.headers.referer, 'https://embed.test/player');
    assert.equal(closed(), 1);
});

test('Cloudflare capture closes the browser after a timeout', async () => {
    const { context, browser, closed } = sniffer({ manifest: false });
    await assert.rejects(context.captureBrowser(browser, 'https://embed.test/', {}, 5), /timeout/);
    assert.equal(closed(), 1);
});

test('private Worker coalesces repeated requests and reports missing bindings', async () => {
    const { context, closed } = sniffer();
    const makeRequest = () => new Request('https://internal/sniff', { method: 'POST', body: JSON.stringify({ url: 'https://embed.test/' }) });
    assert.equal((await context.worker.fetch(makeRequest(), {})).status, 503);
    const first = await context.worker.fetch(makeRequest(), { BROWSER: {} });
    const second = await context.worker.fetch(makeRequest(), { BROWSER: {} });
    assert.equal((await first.json()).url, 'https://cdn.test/live.m3u8');
    assert.equal(second.status, 200);
    assert.equal(closed(), 1);
});
