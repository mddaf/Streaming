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
        if (Date.now() - entry.timestamp > this.cacheTTL) {
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

    /**
     * Queue a channel URL (or object) for health verification
     */
    queueCheck(channelOrUrl, highPriority = false) {
        const url = typeof channelOrUrl === 'string' ? channelOrUrl : (channelOrUrl ? channelOrUrl.url : null);
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
     */
    async probeSingleUrl(url, timeoutMs) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);

        const testTarget = window.SmartProxyEngine 
            ? window.SmartProxyEngine.buildProxyUrl(url, 0)
            : `https://sports-proxy.md-daf001.workers.dev/?${encodeURIComponent(url)}`;

        try {
            const response = await fetch(testTarget, {
                method: 'GET',
                signal: controller.signal,
                headers: {
                    'Accept': '*/*',
                    'Range': 'bytes=0-512' // Fast partial fetch
                }
            });

            clearTimeout(timer);

            if (!response.ok) {
                return {
                    status: 'offline',
                    code: response.status,
                    reason: `HTTP ${response.status} (${response.statusText || 'Error'})`
                };
            }

            const text = await response.text();
            if (text.includes('#EXTM3U') || text.includes('#EXT-X-')) {
                return { status: 'online', code: 200, reason: 'Stream Verified Live' };
            }

            return { status: 'offline', code: response.status, reason: 'Invalid Manifest' };
        } catch (err) {
            clearTimeout(timer);
            const isTimeout = err.name === 'AbortError';
            return {
                status: 'offline',
                code: 0,
                reason: isTimeout ? 'Connection Timed Out' : 'Server Unreachable / Blocked'
            };
        }
    }

    /**
     * Perform health probe with alternate server mirror failover
     */
    async performCheck(task) {
        const channel = typeof task === 'object' ? task : { url: task };
        const mainUrl = channel.url;

        const mainController = new AbortController();
        this.abortControllers.set(mainUrl, mainController);

        this.notifyChange(mainUrl, { status: 'checking', url: mainUrl });

        let entry = null;

        try {
            // Check primary URL
            const primaryResult = await this.probeSingleUrl(mainUrl, this.timeoutMs);

            if (primaryResult.status === 'online') {
                entry = { ...primaryResult, timestamp: Date.now() };
            } 
            // If primary failed, but channel has alternate server mirrors, test them!
            else if (channel.servers && channel.servers.length > 1) {
                let foundWorkingMirror = false;
                for (let i = 1; i < channel.servers.length; i++) {
                    const mirror = channel.servers[i];
                    if (!mirror.url || mirror.url === mainUrl) continue;

                    const mirrorResult = await this.probeSingleUrl(mirror.url, 3000);
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
            this.abortControllers.delete(mainUrl);
            if (entry) {
                this.cache.set(mainUrl, entry);
                this.persistCache();
                this.notifyChange(mainUrl, entry);
            }
        }
    }
}

// Global instance
window.streamHealthChecker = new StreamHealthChecker({
    concurrency: 4,
    timeoutMs: 4000
});
