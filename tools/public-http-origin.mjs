// Observed public catalogue origins only; this is not a general TCP proxy.
const PUBLIC_HTTP_ORIGINS = new Set(['103.16.24.4:8083', '103.114.11.37:8081']);
export function supportsPublicHttpOrigin(url) {
    const target = new URL(url);
    return target.protocol === 'http:' && !target.username && !target.password && PUBLIC_HTTP_ORIGINS.has(target.host);
}

export async function fetchPublicHttpOrigin(url, options, connect) {
    if (!supportsPublicHttpOrigin(url)) throw new Error('Public HTTP origin is not configured');
    const target = new URL(url);
    const method = options.method === 'HEAD' ? 'HEAD' : 'GET';
    const socket = connect({ hostname: target.hostname, port: Number(target.port) }, { secureTransport: 'off' });
    socket.closed.catch(() => {});
    let reader;
    let closed = false;
    const close = () => {
        if (closed) return;
        closed = true;
        options.signal?.removeEventListener('abort', close);
        if (reader) reader.cancel().catch(() => {});
        socket.close().catch(() => {});
    };
    if (options.signal?.aborted) { close(); throw new Error('HTTP origin request canceled'); }
    options.signal?.addEventListener('abort', close, { once: true });
    try {
        await socket.opened;
        const headers = new Headers(options.headers);
        headers.set('Host', target.host);
        headers.set('Connection', 'close');
        headers.set('Accept-Encoding', 'identity');
        let request = `${method} ${target.pathname}${target.search} HTTP/1.1\r\n`;
        headers.forEach((value, key) => {
            if (/[\r\n]/.test(key + value)) throw new Error('Invalid origin header');
            request += `${key}: ${value}\r\n`;
        });
        const writer = socket.writable.getWriter();
        await writer.write(new TextEncoder().encode(request + '\r\n'));
        writer.releaseLock();
        reader = socket.readable.getReader();
        let buffer = new Uint8Array();
        const append = async () => {
            const { value, done } = await reader.read();
            if (done) return false;
            const joined = new Uint8Array(buffer.length + value.length);
            joined.set(buffer); joined.set(value, buffer.length); buffer = joined;
            return true;
        };
        const find = sequence => {
            outer: for (let i = 0; i <= buffer.length - sequence.length; i++) {
                for (let j = 0; j < sequence.length; j++) if (buffer[i + j] !== sequence[j]) continue outer;
                return i;
            }
            return -1;
        };
        let headerEnd;
        while ((headerEnd = find([13, 10, 13, 10])) < 0) {
            if (buffer.length > 32768) throw new Error('Origin response headers too large');
            if (!await append()) throw new Error('Origin closed before response headers');
        }
        if (headerEnd > 32768) throw new Error('Origin response headers too large');
        const lines = new TextDecoder().decode(buffer.subarray(0, headerEnd)).split('\r\n');
        buffer = buffer.subarray(headerEnd + 4);
        const status = /^HTTP\/1\.[01] (\d{3})(?: |$)/.exec(lines.shift());
        if (!status || Number(status[1]) < 200) throw new Error('Invalid HTTP origin response');
        const responseHeaders = new Headers();
        for (const line of lines) {
            const colon = line.indexOf(':');
            if (colon <= 0) throw new Error('Invalid HTTP origin header');
            responseHeaders.append(line.slice(0, colon), line.slice(colon + 1).trim());
        }
        const transferEncoding = responseHeaders.get('transfer-encoding');
        const chunked = /(?:^|,)\s*chunked\s*$/i.test(transferEncoding || '');
        if (transferEncoding && !/^chunked$/i.test(transferEncoding)) throw new Error('Unsupported HTTP transfer encoding');
        const rawLength = responseHeaders.get('content-length');
        let remaining = rawLength == null ? Infinity : Number(rawLength);
        if (rawLength != null && (!/^\d+$/.test(rawLength) || !Number.isSafeInteger(remaining))) throw new Error('Invalid HTTP content length');
        const connectionHeaders = (responseHeaders.get('connection') || '').split(',').map(name => name.trim());
        for (const name of ['connection', 'transfer-encoding', 'keep-alive', 'trailer', 'upgrade', ...connectionHeaders]) {
            if (name) responseHeaders.delete(name);
        }
        if (chunked) { remaining = Infinity; responseHeaders.delete('content-length'); }
        const code = Number(status[1]);
        if (method === 'HEAD' || [204, 205, 304].includes(code) || remaining === 0) {
            close(); return new Response(null, { status: code, headers: responseHeaders });
        }
        let chunkRemaining = null;
        let delimiter = false;
        const body = new ReadableStream({
            async pull(controller) {
                try {
                    if (chunked) {
                        if (delimiter) {
                            while (buffer.length < 2) if (!await append()) throw new Error('Truncated chunk delimiter');
                            if (buffer[0] !== 13 || buffer[1] !== 10) throw new Error('Invalid chunk delimiter');
                            buffer = buffer.subarray(2); delimiter = false;
                        }
                        if (chunkRemaining === null) {
                            let end;
                            while ((end = find([13, 10])) < 0) {
                                if (buffer.length > 8192 || !await append()) throw new Error('Invalid chunk size');
                            }
                            const size = new TextDecoder().decode(buffer.subarray(0, end)).split(';')[0];
                            if (!/^[0-9a-f]+$/i.test(size)) throw new Error('Invalid chunk size');
                            chunkRemaining = Number.parseInt(size, 16);
                            if (!Number.isSafeInteger(chunkRemaining)) throw new Error('Invalid chunk size');
                            buffer = buffer.subarray(end + 2);
                            if (chunkRemaining === 0) { controller.close(); close(); return; }
                        }
                    }
                    if (!buffer.length && !await append()) {
                        if (chunked || remaining !== Infinity && remaining > 0) throw new Error('Truncated HTTP body');
                        controller.close(); close(); return;
                    }
                    const length = Math.min(buffer.length, chunked ? chunkRemaining : remaining);
                    controller.enqueue(buffer.slice(0, length));
                    buffer = buffer.subarray(length);
                    if (chunked) {
                        chunkRemaining -= length;
                        if (!chunkRemaining) { chunkRemaining = null; delimiter = true; }
                    } else {
                        remaining -= length;
                        if (!remaining) { controller.close(); close(); }
                    }
                } catch (error) { controller.error(error); close(); }
            },
            cancel: close
        });
        return new Response(body, { status: code, headers: responseHeaders });
    } catch (error) { close(); throw error; }
}
