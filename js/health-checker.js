/**
 * StreamHealthChecker
 * - Checks live availability of IPTV streams asynchronously in the background
 * - Shows status (Online 🟢, Offline 🔴, Checking 🟡) before user clicks
 * - Concurrent queue with priority for visible channels
 * - Multi-server mirror support (checks alternate servers if primary fails)
 * - Persistent session cache with TTL
 */

class StreamHealthChecker {
    constructor(options = {}) {
        this.concurrency = options.concurrency || 4;
        this.timeoutMs = options.timeoutMs || 4000;
        this.cacheTTL = options.cacheTTL || 15 * 60 * 1000; // 15 minutes
        this.cacheKey = 'stream_health_cache_v2';

        this.cache = new Map();
        this.queue = [];
        this.activeWorkers = 0;
        this.subscribers = new Set();
        this.abortControllers = new Map();
        this.paused = false;
        this.persistTimer = null;

        this.loadCacheFromStorage();
    }

    /**
     * Load cached check results from sessionStorage
     */
    loadCacheFromStorage() {
        try {
            const raw = sessionStorage.getItem(this.cacheKey);
            if (!raw) return;
            const parsed = JSON.parse(raw);
            const now = Date.now();
            for (const [url, entry] of Object.entries(parsed)) {
                if (now - entry.timestamp < this.cacheTTL) {
                    this.cache.set(url, entry);
                }
            }
        } catch (e) {
            console.warn('Could not restore stream health cache:', e);
        }
    }

    /**
     * Persist current cache to sessionStorage
     */
    persistCache() {
        if (this.persistTimer) return;
        this.persistTimer = setTimeout(() => {
            this.persistTimer = null;
            this.flushCache();
        }, 1000);
    }

    flushCache() {
        try {
            const obj = {};
            for (const [url, entry] of this.cache.entries()) {
                obj[url] = entry;
            }
            sessionStorage.setItem(this.cacheKey, JSON.stringify(obj));
        } catch (e) {
            // Storage quota or disabled
        }
    }

    /**
     * Clear all cached health statuses
     */
    clearCache() {
        this.cache.clear();
        try {
            sessionStorage.removeItem(this.cacheKey);
        } catch (e) {}
        this.notifyChange('*', null);
    }

    /**
     * Subscribe to status updates: callback(url, statusEntry)
     */
    subscribe(callback) {
        this.subscribers.add(callback);
        return () => this.subscribers.delete(callback);
    }

    notifyChange(url, entry) {
        for (const cb of this.subscribers) {
            try {
                cb(url, entry);
            } catch (e) {
                console.error(e);
            }
        }
    }

    /**
     * Check if status is already cached and valid
     */
    getCached(url) {
        const entry = this.cache.get(url);
        if (!entry) return null;
        if (Date.now() - entry.timestamp > (entry.ttl || this.cacheTTL)) {
            this.cache.delete(url);
            return null;
        }
        return entry;
    }

    /**
     * Get status string: 'online' | 'offline' | 'checking' | 'unknown'
     */
    getStatus(url) {
        const cached = this.getCached(url);
        if (cached) return cached.status;
        if (this.abortControllers.has(url)) return 'checking';
        return 'unknown';
    }

    /**
     * Cancel pending checks when playlist changes
     */
    cancelAllPending() {
        this.queue = [];
        for (const [url, controller] of this.abortControllers.entries()) {
            controller.abort();
        }
        this.abortControllers.clear();
    }

    setPaused(paused) {
        this.paused = paused;
        if (paused) this.cancelAllPending();
        else this.processNext();
    }

    /**
     * Queue a channel URL (or object) for health verification
     */
    queueCheck(channelOrUrl, highPriority = false) {
        const url = typeof channelOrUrl === 'string' ? channelOrUrl : (channelOrUrl ? channelOrUrl.url : null);
        if (this.paused) return;
        if (!url || typeof url !== 'string') return;
        if (this.getCached(url)) return; // Already cached
        if (this.abortControllers.has(url)) return; // Already in-flight

        // Check if already in queue
        const existingIdx = this.queue.findIndex(item => (typeof item === 'string' ? item : item.url) === url);
        if (existingIdx !== -1) {
            if (highPriority) {
                const item = this.queue.splice(existingIdx, 1)[0];
                this.queue.unshift(item);
            }
            return;
        }

        const task = typeof channelOrUrl === 'object' ? channelOrUrl : { url };
        if (highPriority) {
            this.queue.unshift(task);
        } else {
            this.queue.push(task);
        }

        this.processNext();
    }

    /**
     * Queue multiple channels
     */
    queueBatch(channels, limit = 50) {
        const slice = channels.slice(0, limit);
        slice.forEach((ch, idx) => {
            // First 12 are high priority (immediately visible)
            this.queueCheck(ch, idx < 12);
        });
    }

    /**
     * Process next items in queue according to concurrency limit
     */
    processNext() {
        if (this.paused) return;
        while (this.activeWorkers < this.concurrency && this.queue.length > 0) {
            const task = this.queue.shift();
            if (!task) break;

            const url = typeof task === 'string' ? task : task.url;
            if (this.getCached(url)) continue;

            this.activeWorkers++;
            this.performCheck(task).finally(() => {
                this.activeWorkers--;
                this.processNext();
            });
        }
    }

    /**
     * Probe a single stream URL
     * Returns: { status: 'online'|'offline', code, reason, errorType }
     * errorType: 'dead' (404/410) | 'geo' (403/451) | 'cors' | 'timeout' | null
     */
    async probeSingleUrl(url, timeoutMs, headers = null, signal = null) {
        if (this.isLocalUrl(url)) return { status: 'local', code: 0, reason: 'Local stream; select it to connect' };
        const engine = window.SmartProxyEngine;
        const requiresHeaders = headers && (headers.referer || headers.origin || headers.userAgent);
        const targets = !requiresHeaders && /^https:/i.test(url) ? [url] : [];
        targets.push(engine ? engine.buildProxyUrl(url, 0, headers) : `https://sports-proxy.md-daf001.workers.dev/?${encodeURIComponent(url)}`);
        let result = { status: 'unknown', code: 0, reason: 'Availability check unavailable' };
        for (const target of [...new Set(targets)]) {
            if (signal?.aborted) return null;
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), timeoutMs);
            const combined = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
            let reader;
            try {
                const response = await fetch(target, { signal: combined, headers: { Accept: '*/*', Range: 'bytes=0-8191' } });
                if (!response.ok) {
                    await response.body?.cancel();
                    const code = response.status;
                    result = { status: 'offline', code, errorType: [404, 410].includes(code) ? 'dead' : [403, 451].includes(code) ? 'geo' : 'error', reason: `HTTP ${code}` };
                    continue;
                }
                // Servers can ignore Range and return an endless transport stream.
                // Bound both the body bytes and the entire request's lifetime.
                reader = response.body?.getReader();
                let text = '';
                if (reader) {
                    const chunk = await reader.read();
                    if (chunk.value) text = new TextDecoder().decode(chunk.value.subarray(0, 8192));
                }
                if (/<!doctype|<html/i.test(text)) {
                    result = { status: 'offline', code: 200, errorType: 'cors', reason: 'HTML page instead of video' };
                    continue;
                }
                return { status: 'online', code: response.status, errorType: null, reason: /#EXTM3U|#EXT-X-/.test(text) ? 'Manifest reachable; playback not yet verified' : 'Media endpoint reachable; playback not yet verified' };
            } catch (_) {
                if (signal?.aborted) return null;
                result = { status: 'unknown', code: 0, errorType: 'network', reason: 'Availability check timed out or was blocked' };
            } finally {
                if (reader) reader.cancel().catch(() => {});
                clearTimeout(timer);
            }
        }
        return result;
    }

    /**
     * Local/LAN streams can't be verified from a browser (CORS + mixed-content).
     */
    isLocalUrl(url) {
        return !!window.SmartProxyEngine && window.SmartProxyEngine.isPrivateUrl(url);
    }

    /**
     * Perform health probe with alternate server mirror failover
     */
    async performCheck(task) {
        const channel = typeof task === 'object' ? task : { url: task };
        const mainUrl = channel.url;
        if (channel.type === 'web' || channel.type === 'feed') {
            const entry = { status: 'unknown', code: 0, reason: 'Embedded feed; select it to check playback', timestamp: Date.now(), ttl: 60000 };
            this.cache.set(mainUrl, entry);
            this.notifyChange(mainUrl, entry);
            return;
        }

        // LAN/local streams can't be verified from a browser (cross-origin CORS, and
        // mixed-content when the page is served over HTTPS). Mark them 'local' (neutral)
        // rather than a misleading 'offline', so they aren't hidden by Hide-Offline.
        if (this.isLocalUrl(mainUrl)) {
            const entry = { status: 'local', code: 0, reason: 'Local network — open directly (not verifiable from browser)', timestamp: Date.now() };
            this.cache.set(mainUrl, entry);
            this.persistCache();
            this.notifyChange(mainUrl, entry);
            return;
        }

        // Catalog channels (catalog://<id> or channel.catalogId or channel.isCatalog)
        if (mainUrl && (mainUrl.startsWith('catalog://') || channel.catalogId || channel.isCatalog)) {
            const catId = channel.catalogId || mainUrl.replace(/^catalog:\/\//, '');
            const mainController = new AbortController();
            const checkSignal = AbortSignal.any([mainController.signal, AbortSignal.timeout(6000)]);
            this.abortControllers.set(mainUrl, mainController);
            this.notifyChange(mainUrl, { status: 'checking', url: mainUrl });

            let entry = null;
            try {
                if (window.SmartProxyEngine && typeof window.SmartProxyEngine.resolveStream === 'function') {
                    const resolved = await window.SmartProxyEngine.resolveStream(catId, checkSignal);
                    if (resolved && resolved.type === 'web') {
                        entry = { status: 'unknown', code: 0, reason: 'Embedded feed page; video availability is not verified', timestamp: Date.now() };
                    } else if (resolved && resolved.url) {
                        const probeRes = await this.probeSingleUrl(resolved.url, this.timeoutMs, resolved.headers, checkSignal);
                        if (!probeRes) return;
                        entry = { ...probeRes, timestamp: Date.now() };
                    } else {
                        entry = { status: 'offline', code: 0, reason: 'Resolver returned no stream URL', timestamp: Date.now() };
                    }
                } else {
                    entry = { status: 'unknown', code: 0, reason: 'Resolver engine not loaded', timestamp: Date.now() };
                }
            } catch (err) {
                entry = { status: checkSignal.aborted ? 'unknown' : 'offline', code: 0, reason: `Resolver failed: ${err.message}`, timestamp: Date.now() };
            } finally {
                if (this.abortControllers.get(mainUrl) === mainController) this.abortControllers.delete(mainUrl);
            }

            if (mainController.signal.aborted) return;
            if (!entry) {
                entry = { status: 'offline', code: 0, reason: 'Health check failed', timestamp: Date.now() };
            }
            if (entry.status === 'unknown') entry.ttl = 30000;
            this.cache.set(mainUrl, entry);
            this.persistCache();
            this.notifyChange(mainUrl, entry);
            return;
        }

        const mainController = new AbortController();
        const checkSignal = AbortSignal.any([mainController.signal, AbortSignal.timeout(8000)]);
        this.abortControllers.set(mainUrl, mainController);

        this.notifyChange(mainUrl, { status: 'checking', url: mainUrl });

        let entry = null;

        try {
            // Check primary URL (with this channel's playback headers, if any)
            const primaryResult = await this.probeSingleUrl(mainUrl, this.timeoutMs, channel.headers, checkSignal);

            if (!primaryResult) return;
            if (primaryResult.status === 'online') {
                entry = { ...primaryResult, timestamp: Date.now() };
            }
            // If primary failed, but channel has alternate server mirrors, test them!
            else if (channel.servers && channel.servers.length > 1) {
                let foundWorkingMirror = false;
                for (let i = 1; i < channel.servers.length; i++) {
                    if (checkSignal.aborted) break;
                    const mirror = channel.servers[i];
                    if (!mirror.url || mirror.url === mainUrl) continue;

                    const mirrorResult = await this.probeSingleUrl(mirror.url, 2000, mirror.headers || channel.headers, checkSignal);
                    if (!mirrorResult) break;
                    if (mirrorResult.status === 'online') {
                        entry = {
                            status: 'online',
                            code: 200,
                            reason: `Live via Mirror (${mirror.name || 'Server ' + (i+1)})`,
                            workingServerIndex: i,
                            timestamp: Date.now()
                        };
                        foundWorkingMirror = true;
                        break;
                    }
                }

                if (!foundWorkingMirror) {
                    entry = { ...primaryResult, timestamp: Date.now() };
                }
            } else {
                entry = { ...primaryResult, timestamp: Date.now() };
            }
        } catch (err) {
            entry = {
                status: 'offline',
                code: 0,
                reason: 'Check Failed',
                timestamp: Date.now()
            };
        } finally {
            if (this.abortControllers.get(mainUrl) === mainController) this.abortControllers.delete(mainUrl);
            if (entry && !mainController.signal.aborted) {
                // Retry unknown results later without hammering blocked endpoints on every render.
                if (entry.status === 'unknown') entry.ttl = 30000;
                this.cache.set(mainUrl, entry); this.persistCache();
                this.notifyChange(mainUrl, entry);
            }
        }
    }
}

// Global instance
window.streamHealthChecker = new StreamHealthChecker({
    concurrency: 2,
    timeoutMs: 4000
});
