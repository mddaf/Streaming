const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function app() {
    const nodes = new Map();
    const element = () => ({
        style: {}, classList: { add() {}, toggle() {} },
        getBoundingClientRect: () => ({ top: 150, bottom: 500 }),
        querySelectorAll: () => [], removeAttribute(key) { delete this[key]; },
        pause() {}, play: () => Promise.resolve(), canPlayType: () => true,
        innerHTML: '', textContent: ''
    });
    const document = { getElementById(id) {
        if (!nodes.has(id)) nodes.set(id, { ...element(), parentElement: element() });
        return nodes.get(id);
    }, querySelectorAll: () => [] };
    const pending = [];
    const headers = [];
    const engine = {
        resolveStream: (id, signal) => new Promise((resolve, reject) => pending.push({ id, signal, resolve, reject })),
        sniffStream: (url, signal) => new Promise((resolve, reject) => pending.push({ url, signal, resolve, reject })),
        shouldRouteThroughProxy: () => false,
        setStreamHeaders: value => headers.push(value),
        buildProxyUrl: url => 'https://proxy.test/?url=' + encodeURIComponent(url), CONFIG: {}
    };
    const window = { innerHeight: 900, SmartProxyEngine: engine };
    const context = vm.createContext({ window, document, AbortController, console,
        setInterval: () => 1, clearInterval() {}, setTimeout,
        localStorage: { setItem() {} }
    });
    const source = fs.readFileSync('js/app.js', 'utf8').replace(/\/\/ Run when DOM is ready[\s\S]*$/, 'applyFiltersAndRender = () => {}; window.testApp = { playChannel, state, reconcileWorkerCatalog, refreshWorkerCatalog }; })();');
    vm.runInContext(source, context);
    return { ...window.testApp, nodes, pending, headers, engine, document };
}
const flush = () => new Promise(setImmediate);
const catalog = id => ({ name: id, url: 'catalog://' + id, servers: [{ url: 'catalog://' + id, isCatalog: true, catalogId: id }] });

test('a stale resolver cannot replace a newly selected channel', async () => {
    const { playChannel, pending, nodes, state } = app();
    playChannel(catalog('first'));
    const direct = { name: 'Second', url: 'https://cdn.test/second.m3u8' };
    playChannel(direct);
    assert.equal(pending[0].signal.aborted, true);
    pending[0].resolve({ url: 'https://cdn.test/first.m3u8' });
    await flush();
    assert.equal(state.currentChannel, direct);
    assert.equal(nodes.get('main-video').src, direct.url);
});

test('catalog playback preserves canonical server and recents, forwards playback headers, resolves on reload', async () => {
    const { playChannel, pending, state, headers, nodes } = app();
    const channel = catalog('live');
    playChannel(channel);
    pending[0].resolve({ url: 'https://cdn.test/live.m3u8', headers: { referer: 'https://embed.test/' } });
    await flush();
    assert.equal(channel.servers[0].url, 'catalog://live');
    assert.equal(state.recentChannels[0], channel);
    assert.equal(headers.at(-1).referer, 'https://embed.test/');
    assert.ok(nodes.get('main-video').src.startsWith('https://proxy.test/'));
    playChannel(state.currentChannel);
    assert.equal(pending.length, 2);
});

test('web feed discovery falls back to its iframe on static sniff failure', async () => {
    const { playChannel, pending, nodes } = app();
    const channel = { name: 'Embed', type: 'web', url: 'https://embed.test/' };
    playChannel(channel);
    pending[0].reject(new Error('requires runtime JavaScript'));
    await flush();
    assert.equal(nodes.get('sports-iframe').src, channel.url);
    assert.equal(nodes.get('sports-iframe').style.display, 'block');
});

test('catalog feed can explicitly return a web page without sending HTML to HLS', async () => {
    const { playChannel, pending, nodes, state } = app();
    playChannel(catalog('feed'));
    pending[0].resolve({ url: 'https://feed.test/highlights', type: 'web' });
    await flush();
    assert.equal(nodes.get('sports-iframe').src, 'https://feed.test/highlights');
    assert.equal(nodes.get('main-video').style.display, 'none');
    assert.equal(state.currentChannel.url, 'catalog://feed');
    assert.equal(state.activePlaybackUrl, 'https://feed.test/highlights');
});

test('catalog refresh adds and removes mirrors without changing static servers or duplicating them', () => {
    const { reconcileWorkerCatalog } = app();
    const staticChannel = { name: 'Local Sports', url: 'https://cdn.test/live.m3u8', servers: [
        { url: 'https://cdn.test/live.m3u8' },
        { url: 'catalog://old', isCatalog: true, catalogId: 'old' }
    ], sources: ['Local', 'Cloudflare Catalog'] };
    const input = [staticChannel, catalog('removed')];
    const next = [{ id: 'fresh', name: 'Local Sports' }, { id: 'added', name: 'New Sports' }];
    const result = reconcileWorkerCatalog(input, next);
    assert.equal(result.length, 2);
    assert.equal(result[0].servers.length, 2);
    assert.equal(result[0].servers[0].url, staticChannel.url);
    assert.equal(result[0].servers[1].url, 'catalog://fresh');
    assert.equal(staticChannel.servers[1].url, 'catalog://old');
    assert.equal(reconcileWorkerCatalog(result, next)[0].servers.length, 2);
});

test('automatic refresh retains the old guide on failure and keeps playback unchanged on success', async () => {
    const { state, engine, refreshWorkerCatalog } = app();
    const playing = catalog('playing');
    const oldGuide = [playing];
    state.masterChannels = oldGuide;
    state.currentChannel = playing;
    engine.fetchCatalog = async () => { throw new Error('offline'); };
    await refreshWorkerCatalog();
    assert.equal(state.masterChannels, oldGuide);
    assert.equal(state.catalogRefreshing, false);
    engine.fetchCatalog = async () => [{ id: 'new', name: 'Updated Sports' }];
    await refreshWorkerCatalog();
    assert.equal(state.masterChannels[0].url, 'catalog://new');
    assert.equal(state.currentChannel, playing);
    assert.ok(state.lastCatalogRefresh > 0);
});

test('automatic refresh pauses in hidden tabs and avoids overlapping fetches', async () => {
    const { engine, document, refreshWorkerCatalog } = app();
    let calls = 0;
    let finish;
    engine.fetchCatalog = () => { calls++; return new Promise(resolve => { finish = resolve; }); };
    document.hidden = true;
    await refreshWorkerCatalog();
    assert.equal(calls, 0);
    document.hidden = false;
    const running = refreshWorkerCatalog();
    await refreshWorkerCatalog();
    assert.equal(calls, 1);
    finish([]);
    await running;
});
