const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function worker(routes = {}) {
    const calls = [];
    const context = vm.createContext({ URL, Headers, Request, Response, AbortSignal, atob,
        fetch: async (url, options) => {
            calls.push({ url, options });
            const result = routes[url];
            if (!result) throw new Error('Unexpected fetch: ' + url);
            return new Response(typeof result === 'string' ? result : JSON.stringify(result.body), { status: result.status || 200 });
        }
    });
    vm.runInContext(fs.readFileSync('cloudflare_worker.js', 'utf8').replace('export default {', 'const worker = {'), context);
    return { context, calls };
}

test('premium lookup uses separate lookup and playback headers', async () => {
    const { context, calls } = worker({ 'https://dokoplay.xyz/server_lookup.php?channel_id=premium45': { body: { server_key: 'edge3' } } });
    const result = await context.resolveChannel({ id: 'sports', channelId: '45', type: 'premium' });
    assert.equal(result.url, 'https://edge3new.newkso.ru/edge3/premium45/mono.m3u8');
    assert.equal(result.headers.origin, 'https://newembedplay.xyz');
    assert.equal(calls[0].options.headers.get('Referer'), 'https://dokoplay.xyz/');
});

test('API resolver substitutes path ID, normalizes headers and relative playback URL', async () => {
    const { context, calls } = worker({ 'https://api.test/45': { body: { playback_url: '/live.m3u8' } } });
    const result = await context.resolveChannel({ type: 'api', api: 'https://api.test/%s', link: 'https://embed.test/45?token=x', headers: { Referer: 'https://embed.test/', 'User-Agent': 'test-agent' } });
    assert.equal(result.url, 'https://api.test/live.m3u8');
    assert.equal(result.headers.userAgent, 'test-agent');
    assert.equal(calls[0].options.headers.get('User-Agent'), 'test-agent');
});

test('resolver chain continues after HTTP failure and rejects invalid URLs', async () => {
    const { context } = worker({ 'https://api.test/down': { status: 503 } });
    const result = await context.resolveChannel({ resolvers: [
        { type: 'api', api: 'https://api.test/down' },
        { type: 'direct', link: 'javascript:bad' },
        { type: 'direct', link: 'https://cdn.test/live.m3u8' }
    ] });
    assert.equal(result.url, 'https://cdn.test/live.m3u8');
    await assert.rejects(context.resolveChannel({ type: 'direct' }), /missing URL/);
});

test('sniffer extracts escaped, relative, entity-encoded and base64 URLs', () => {
    const { context } = worker();
    const encoded = Buffer.from('https://cdn.test/hidden.m3u8?t=9').toString('base64');
    const hits = context.sniffCandidates(`data-hls="../live.m3u8?t=1&amp;x=2"; file: "https:\\/\\/cdn.test\\/master.m3u8"; "${encoded}"`, 'https://embed.test/player/1');
    assert.ok(hits.includes('https://embed.test/live.m3u8?t=1&x=2'));
    assert.ok(hits.includes('https://cdn.test/master.m3u8'));
    assert.ok(hits.includes('https://cdn.test/hidden.m3u8?t=9'));
});

test('sniffer follows iframe, skips invalid manifest and carries child referer', async () => {
    const { context, calls } = worker({
        'https://embed.test/': '<iframe src="/child"></iframe>',
        'https://embed.test/child': '<div data-hls="/bad.m3u8"></div><div data-m3u8="/good.m3u8"></div>',
        'https://embed.test/bad.m3u8': '<html>expired</html>',
        'https://embed.test/good.m3u8': '#EXTM3U\n#EXTINF:4\nsegment.ts'
    });
    const result = await context.sniffStream({ link: 'https://embed.test/' });
    assert.equal(result.url, 'https://embed.test/good.m3u8');
    assert.equal(result.headers.referer, 'https://embed.test/child');
    assert.equal(calls.at(-1).options.headers.get('Referer'), result.headers.referer);
});

test('catalog errors are surfaced, routes enforce methods, and OPTIONS supports sniffer', async () => {
    const { context } = worker({ 'https://config.test/catalog': { body: {} } });
    const response = await context.handleRequest(new Request('https://worker.test/catalog'), { CATALOG_URL: 'https://config.test/catalog' });
    assert.equal(response.status, 502);
    assert.equal(response.headers.get('Access-Control-Allow-Origin'), '*');
    assert.equal((await context.handleRequest(new Request('https://worker.test/sniff', { method: 'OPTIONS' }))).status, 204);
    assert.equal((await context.handleRequest(new Request('https://worker.test/resolve', { method: 'POST' }))).status, 405);
});

test('feed discovers current URL through remote config, then sniffs stream', async () => {
    const api = 'https://config.test/app';
    const { context } = worker({
        [api]: { body: { livetv: 'https://feed.test/' } },
        'https://feed.test/': '<video data-hls="https://cdn.test/live.m3u8"></video>',
        'https://cdn.test/live.m3u8': '#EXTM3U\nsegment.ts'
    });
    const result = await context.resolveChannel({ type: 'feed', api });
    assert.equal(result.url, 'https://cdn.test/live.m3u8');
    const response = await context.handleRequest(new Request('https://worker.test/feed'), { SPORTZ_CONFIG_URL: api });
    assert.equal((await response.json()).url, 'https://feed.test/');
});

test('rewritten keys and segments retain playback header overrides', () => {
    const { context } = worker();
    const text = context.rewriteManifestUrls('#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="key.bin"\nchunk.ts', 'https://cdn.test/live/master.m3u8', 'https://worker.test/', 'ref=https%3A%2F%2Fembed.test&');
    assert.ok(text.includes('ref=https%3A%2F%2Fembed.test&url=https%3A%2F%2Fcdn.test%2Flive%2Fkey.bin'));
    assert.ok(text.includes('url=https%3A%2F%2Fcdn.test%2Flive%2Fchunk.ts'));
});

test('CRICFy formats -> ChannelItem -> numeric stream types resolve with fallback', async () => {
    const { context } = worker({
        'https://catalog.test/channel/45': { body: { streamUrls: [
            { link: 'https://cdn.test/drm.m3u8', type: 0, drmType: 'widevine', drmLicense: 'https://license.test/' },
            { link: 'https://embed.test/45', api: 'https://api.test/%s', type: 6, headers: { Referer: 'https://embed.test/' } }
        ] } },
        'https://api.test/45': { body: { playback_url: 'https://cdn.test/live.m3u8' } }
    });
    const channels = context.normalizeCatalog([{ id: 45, title: 'Test Sports', image: 'https://img.test/logo.png', cat: 'sports', formats: [{ title: 'HD', webLink: '/channel/45' }] }], 'https://catalog.test/categories/sports.txt');
    assert.equal(channels[0].id, 'cricfy:45');
    assert.equal(channels[0].logo, 'https://img.test/logo.png');
    const result = await context.resolveChannel(channels[0]);
    assert.equal(result.url, 'https://cdn.test/live.m3u8');
    assert.equal(result.headers.referer, 'https://embed.test/');
});

test('APK suffix variants remove only the observed inserted positions', async () => {
    const { context } = worker({ 'https://api.test/suffix': '?token=abc' });
    for (const variant of [1, 3]) {
        const token = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890';
        const positions = variant === 1 ? [10, 22, 34, 46, 58] : [33, 42, 51, 58];
        const characters = [...token].reverse();
        for (const position of positions) characters.splice(position, 0, '!');
        assert.equal(context.decodeApkSuffix(characters.reverse().join(''), variant), token);
    }
    const result = await context.resolveChannel({ type: 'suffix', variant: 2, link: 'https://cdn.test/live.m3u8', api: 'https://api.test/suffix' });
    assert.equal(result.url, 'https://cdn.test/live.m3u8?token=abc');
});

test('feed without an HLS source returns an explicit web result', async () => {
    const { context } = worker({
        'https://config.test/app': { body: { livetv: 'https://feed.test/' } },
        'https://feed.test/': '<html><title>Highlights</title></html>'
    });
    const result = await context.resolveChannel({ type: 'feed', api: 'https://config.test/app' });
    assert.equal(result.type, 'web');
    assert.equal(result.url, 'https://feed.test/');
});

test('unavailable APK catalog does not hide default channels and exposes source status', async () => {
    const { context, calls } = worker();
    const catalog = await context.loadCatalog({});
    assert.ok(catalog.some(channel => channel.id === 'sportzfy-live'));
    assert.ok(!catalog.some(channel => channel.id.startsWith('cricfy:')));
    const response = await context.handleRequest(new Request('https://worker.test/sources'), {});
    const [source] = await response.json();
    assert.equal(source.status, 'unavailable');
    assert.equal(source.count, 0);
    assert.equal(calls.length, 1, 'failed source should be cached');
});

test('dynamic sniffer fallback forwards the service token and captured headers', async () => {
    const { context, calls } = worker({
        'https://embed.test/': '<script>/* runtime URL */</script>',
        'https://sniffer.test/sniff': { body: { url: 'https://cdn.test/runtime.m3u8', headers: { Referer: 'https://embed.test/' } } }
    });
    const result = await context.resolveChannel({ type: 'sniff', link: 'https://embed.test/' }, 0, { DYNAMIC_SNIFFER_URL: 'https://sniffer.test/sniff', DYNAMIC_SNIFFER_TOKEN: 'test-only' });
    assert.equal(result.url, 'https://cdn.test/runtime.m3u8');
    assert.equal(result.headers.referer, 'https://embed.test/');
    assert.equal(calls.at(-1).options.headers.Authorization, 'Bearer test-only');
});

test('private Cloudflare service binding supports dynamic capture without a URL or secret', async () => {
    const { context } = worker({ 'https://embed.test/': '<html>runtime player</html>' });
    const env = { DYNAMIC_SNIFFER: { fetch: async request => {
        assert.equal(request.method, 'POST');
        assert.equal((await request.json()).url, 'https://embed.test/');
        return Response.json({ url: 'https://cdn.test/runtime.m3u8', headers: { referer: 'https://embed.test/' } });
    } } };
    const result = await context.resolveChannel({ type: 'sniff', link: 'https://embed.test/' }, 0, env);
    assert.equal(result.url, 'https://cdn.test/runtime.m3u8');
});

test('automatic source refresh preserves the last good catalog during an upstream outage', async () => {
    const url = 'https://catalog.test/sports';
    const routes = { [url]: { body: [{ id: 45, title: 'Saved Sports', cat: 'sports', formats: [{ webLink: '/45' }] }] } };
    const { context } = worker(routes);
    let now = 100000;
    context.Date = { now: () => now };
    assert.equal((await context.loadCricfySource({ CRICFY_CATALOG_URL: url })).status, 'available');
    now += 61000;
    routes[url] = { status: 503 };
    const stale = await context.loadCricfySource({ CRICFY_CATALOG_URL: url });
    assert.equal(stale.status, 'stale');
    assert.equal(stale.channels[0].name, 'Saved Sports');
    assert.equal(stale.count, 1);
});
