const { test } = require('node:test');
const assert = require('node:assert/strict');
const { fetchPublicHttpOrigin, supportsPublicHttpOrigin } = require('../tools/public-http-origin.mjs');

function socketFixture(parts) {
    let request = '', closed = false;
    const socket = {
        opened: Promise.resolve(), closed: Promise.resolve(),
        readable: new ReadableStream({ start(controller) {
            parts.forEach(part => controller.enqueue(new TextEncoder().encode(part)));
            controller.close();
        } }),
        writable: new WritableStream({ write(bytes) { request += new TextDecoder().decode(bytes); } }),
        close: async () => { closed = true; }
    };
    return { connect: () => socket, get request() { return request; }, get closed() { return closed; } };
}
const origin = 'http://103.16.24.4:8083/live.m3u8?sig=a%2Fb';

test('public HTTP transport is limited to the observed public origin and port', async () => {
    assert.equal(supportsPublicHttpOrigin(origin), true);
    for (const url of ['http://172.16.15.5:8083/', 'http://127.0.0.1:8083/', 'https://103.16.24.4:8083/', 'http://103.16.24.4:80/']) {
        assert.equal(supportsPublicHttpOrigin(url), false);
        await assert.rejects(fetchPublicHttpOrigin(url, {}, () => { throw new Error('must not connect'); }), /not configured/);
    }
});

test('HTTP socket transport handles split headers, byte ranges and signed request paths', async () => {
    const fixture = socketFixture(['HTTP/1.1 206 Partial Content\r\nContent-Len', 'gth: 6\r\nContent-Range: bytes 0-5/100\r\n\r\nab', 'cdef']);
    const response = await fetchPublicHttpOrigin(origin, { headers: { Range: 'bytes=0-5' } }, fixture.connect);
    assert.equal(response.status, 206);
    assert.equal(await response.text(), 'abcdef');
    assert.match(fixture.request, /^GET \/live.m3u8\?sig=a%2Fb HTTP\/1.1/);
    assert.match(fixture.request, /range: bytes=0-5/i);
    assert.equal(fixture.closed, true);
});

test('HTTP socket transport removes chunk framing and connection headers', async () => {
    const fixture = socketFixture(['HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\nConnection: close, X-Hop\r\nX-Hop: drop\r\n\r\n3\r\na', 'bc\r\n2;ext=yes\r\nde\r\n0\r\n\r\n']);
    const response = await fetchPublicHttpOrigin(origin, {}, fixture.connect);
    assert.equal(await response.text(), 'abcde');
    assert.equal(response.headers.has('transfer-encoding'), false);
    assert.equal(response.headers.has('x-hop'), false);
    assert.equal(fixture.closed, true);
});

test('HTTP socket transport closes HEAD requests and canceled bodies', async () => {
    const head = socketFixture(['HTTP/1.1 200 OK\r\nContent-Length: 100\r\n\r\n']);
    const response = await fetchPublicHttpOrigin(origin, { method: 'HEAD' }, head.connect);
    assert.equal(await response.text(), '');
    assert.equal(head.closed, true);
    const body = socketFixture(['HTTP/1.1 200 OK\r\nContent-Length: 3\r\n\r\nabc']);
    const stream = await fetchPublicHttpOrigin(origin, {}, body.connect);
    await stream.body.cancel();
    assert.equal(body.closed, true);
});

test('HTTP socket transport rejects truncated bodies', async () => {
    const fixture = socketFixture(['HTTP/1.1 200 OK\r\nContent-Length: 10\r\n\r\nshort']);
    const response = await fetchPublicHttpOrigin(origin, {}, fixture.connect);
    await assert.rejects(response.text(), /Truncated HTTP body/);
    assert.equal(fixture.closed, true);
});
