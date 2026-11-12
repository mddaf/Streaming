import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { sniffInBrowser, createSnifferServer } from './browser-sniffer.mjs';

test('captures a runtime-built M3U8 request from a nested iframe with its Referer', async () => {
    const fixture = createServer((request, response) => {
        if (request.url === '/live/index.m3u8') {
            response.writeHead(200, { 'Content-Type': 'application/vnd.apple.mpegurl' });
            return response.end('#EXTM3U\n#EXT-X-TARGETDURATION:4\n#EXTINF:4\nsegment.ts');
        }
        response.writeHead(200, { 'Content-Type': 'text/html' });
        response.end(request.url === '/child' ? `<script>setTimeout(() => fetch('/live/' + ['index', 'm3u8'].join('.')), 100)</script>` : '<iframe src="/child"></iframe>');
    });
    await new Promise(resolve => fixture.listen(0, '127.0.0.1', resolve));
    const base = 'http://127.0.0.1:' + fixture.address().port;
    try {
        const result = await sniffInBrowser(base + '/', {}, { timeoutMs: 5000 });
        assert.equal(result.url, base + '/live/index.m3u8');
        assert.equal(result.headers.referer, base + '/child');
        assert.equal(result.method, 'browser');
    } finally {
        fixture.closeAllConnections();
        await new Promise(resolve => fixture.close(resolve));
    }
});

test('sniffer rejects unauthenticated HTTP requests before launching a browser', async () => {
    const server = createSnifferServer({ token: 'test-only' });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
        const response = await fetch('http://127.0.0.1:' + server.address().port + '/sniff', { method: 'POST' });
        assert.equal(response.status, 401);
    } finally {
        server.closeAllConnections();
        await new Promise(resolve => server.close(resolve));
    }
});
