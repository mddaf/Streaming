const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function checker(fetch) {
    const context = vm.createContext({ window: { SmartProxyEngine: {
        isPrivateUrl: url => url.startsWith('http://192.168.'),
        buildProxyUrl: url => 'https://proxy.test/?url=' + encodeURIComponent(url)
    } }, fetch, AbortController, AbortSignal, TextDecoder, setTimeout, clearTimeout,
    sessionStorage: { getItem() {}, setItem() {} }, console });
    vm.runInContext(fs.readFileSync('js/health-checker.js', 'utf8'), context);
    const health = context.window.streamHealthChecker;
    health.engine = context.window.SmartProxyEngine;
    return health;
}

test('health probes cancel a server that ignores Range instead of downloading an endless live stream', async () => {
    let canceled = false;
    const health = checker(async () => new Response(new ReadableStream({
        start(controller) { controller.enqueue(new TextEncoder().encode('#EXTM3U\n')); },
        cancel() { canceled = true; }
    })));
    const result = await health.probeSingleUrl('https://cdn.test/live.m3u8', 100);
    assert.equal(result.status, 'online');
    assert.equal(canceled, true);
});

test('the health timeout covers stalled response bodies as well as headers', async () => {
    let canceled = 0;
    const health = checker(async (url, { signal }) => ({ ok: true, status: 200, body: { getReader: () => ({
        read: () => new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })),
        cancel: async () => { canceled++; }
    }) } }));
    const result = await health.probeSingleUrl('https://cdn.test/live.m3u8', 15);
    assert.equal(result.status, 'unknown');
    assert.equal(canceled, 2, 'both bounded direct and proxy attempts were canceled');
});

test('selecting playback cancels in-flight health requests and stops background queue work', async () => {
    let started;
    let aborted = false;
    const began = new Promise(resolve => { started = resolve; });
    const health = checker((url, { signal }) => new Promise((resolve, reject) => {
        signal.addEventListener('abort', () => { aborted = true; reject(new Error('canceled')); }, { once: true });
        started();
    }));
    health.queueCheck({ url: 'https://cdn.test/one.m3u8' });
    await began;
    health.setPaused(true);
    health.queueCheck({ url: 'https://cdn.test/two.m3u8' });
    await new Promise(setImmediate);
    assert.equal(aborted, true);
    assert.equal(health.queue.length, 0);
    assert.equal(health.activeWorkers, 0);
    assert.equal(health.cache.size, 0, 'cancellation must not label a channel offline');
});

test('local and embedded channels never trigger background network access', async () => {
    let calls = 0;
    const health = checker(async () => { calls++; throw new Error('Unexpected request'); });
    await health.performCheck({ url: 'http://192.168.1.2/live.m3u8' });
    await health.performCheck({ url: 'https://embed.test/', type: 'web' });
    clearTimeout(health.persistTimer);
    assert.equal(calls, 0);
    assert.equal(health.getStatus('http://192.168.1.2/live.m3u8'), 'local');
});

test('a failed first catalog source does not hide a channel with untested alternatives', async () => {
    const health = checker(async () => new Response('', { status: 404 }));
    health.engine.resolveStream = async () => ({ url: 'https://dead.test/live.m3u8', variants: [{ index: 0 }, { index: 1 }] });
    await health.performCheck({ url: 'catalog://cricfy:33', catalogId: 'cricfy:33' });
    clearTimeout(health.persistTimer);
    assert.equal(health.getStatus('catalog://cricfy:33'), 'unknown');
});

test('background mirror checks never send catalog:// URLs to the media proxy', async () => {
    const calls = [];
    const health = checker(async url => { calls.push(url); return new Response('', { status: 404 }); });
    await health.performCheck({ url: 'https://dead.test/live.m3u8', servers: [
        { url: 'https://dead.test/live.m3u8' }, { url: 'catalog://hdstreamz:1035', isCatalog: true }
    ] });
    clearTimeout(health.persistTimer);
    assert.ok(!calls.some(url => url.includes('catalog')));
    assert.equal(health.getStatus('https://dead.test/live.m3u8'), 'unknown');
});
