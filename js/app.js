/**
 * StreamPulse Main Application Controller
 * - Merges multiple GitHub & IPTV M3U/M3U8 playlists by default into a unified database
 * - Restores category & country filter chips in the toolbar
 * - Displays interactive server options in the channel card image area and player screen area
 * - Automatic failover for geo-blocked/location-restricted streams
 */

(function () {
    'use strict';

    // Default Playlists to Merge Simultaneously on Launch
    const DEFAULT_PLAYLIST_SOURCES = [
        {
            name: 'FTV Local BDIX (172.16.15.5)',
            url: './ftv_channels.m3u',
            defaultCountry: 'bd'
        },
        {
            name: 'Verified Sports Live HD',
            url: './working_iptv_org_sports.m3u',
            defaultCategory: 'Sports'
        },
        {
            name: 'Verified Bangladesh Live',
            url: './working_iptv_org_bd.m3u',
            defaultCountry: 'bd'
        },
        {
            name: 'Free-TV Global HD',
            url: 'https://raw.githubusercontent.com/Free-TV/IPTV/master/playlist.m3u8',
            defaultCategory: 'General'
        },
        {
            name: 'IPTV-org Sports',
            url: 'https://iptv-org.github.io/iptv/categories/sports.m3u',
            defaultCategory: 'Sports'
        },
        {
            name: 'IPTV-org News',
            url: 'https://iptv-org.github.io/iptv/categories/news.m3u',
            defaultCategory: 'News'
        },
        {
            name: 'IPTV-org Movies',
            url: 'https://iptv-org.github.io/iptv/categories/movies.m3u',
            defaultCategory: 'Movies'
        },
        {
            name: 'IPTV-org Entertainment',
            url: 'https://iptv-org.github.io/iptv/categories/entertainment.m3u',
            defaultCategory: 'Entertainment'
        },
        {
            name: 'IPTV-org Documentaries',
            url: 'https://iptv-org.github.io/iptv/categories/documentary.m3u',
            defaultCategory: 'Documentaries'
        },
        {
            name: 'IPTV-org Music',
            url: 'https://iptv-org.github.io/iptv/categories/music.m3u',
            defaultCategory: 'Music'
        },
        {
            name: 'Bangladesh (BD)',
            url: 'https://iptv-org.github.io/iptv/countries/bd.m3u',
            defaultCountry: 'bd'
        },
        {
            name: 'India (IN)',
            url: 'https://iptv-org.github.io/iptv/countries/in.m3u',
            defaultCountry: 'in'
        },
        {
            name: 'United States (US)',
            url: 'https://iptv-org.github.io/iptv/countries/us.m3u',
            defaultCountry: 'us'
        },
        {
            name: 'United Kingdom (UK)',
            url: 'https://iptv-org.github.io/iptv/countries/uk.m3u',
            defaultCountry: 'uk'
        }
    ];

    // Filter Categories
    const CATEGORIES = [
        { id: 'all', name: 'All Channels', icon: '🌟' },
        { id: 'sports', name: 'Sports', icon: '⚽' },
        { id: 'news', name: 'News', icon: '📰' },
        { id: 'movies', name: 'Movies', icon: '🎬' },
        { id: 'entertainment', name: 'Entertainment', icon: '🎭' },
        { id: 'documentary', name: 'Documentaries', icon: '🌿' },
        { id: 'music', name: 'Music', icon: '🎵' },
        { id: 'kids', name: 'Kids', icon: '🧸' },
        { id: 'comedy', name: 'Comedy', icon: '😂' },
        { id: 'animation', name: 'Animation', icon: '🎨' }
    ];

    // Filter Countries
    const COUNTRIES = [
        { id: 'all', name: 'All Countries', icon: '🌐' },
        { id: 'bd', name: 'Bangladesh', icon: '🇧🇩' },
        { id: 'us', name: 'United States', icon: '🇺🇸' },
        { id: 'uk', name: 'United Kingdom', icon: '🇬🇧' },
        { id: 'in', name: 'India', icon: '🇮🇳' },
        { id: 'ca', name: 'Canada', icon: '🇨🇦' },
        { id: 'au', name: 'Australia', icon: '🇦🇺' },
        { id: 'pk', name: 'Pakistan', icon: '🇵🇰' },
        { id: 'ae', name: 'UAE', icon: '🇦🇪' },
        { id: 'sa', name: 'Saudi Arabia', icon: '🇸🇦' },
        { id: 'de', name: 'Germany', icon: '🇩🇪' },
        { id: 'fr', name: 'France', icon: '🇫🇷' },
        { id: 'es', name: 'Spain', icon: '🇪🇸' },
        { id: 'it', name: 'Italy', icon: '🇮🇹' }
    ];

    // Featured Web Sports Streams (incorporating stream.html)
    const FEATURED_SPORTS = [
        {
            name: 'beIN Sports HD 1',
            type: 'web',
            url: 'https://1.kooralive360.com/albaplayer/bein-sports-hd-1/?serv=0',
            logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/e/e6/BeIN_Sports_1.svg/512px-BeIN_Sports_1.svg.png',
            group: 'Live Football / Sports',
            category: 'sports',
            servers: [
                { name: 'Auto / HD (Server 1)', url: 'https://1.kooralive360.com/albaplayer/bein-sports-hd-1/?serv=0' },
                { name: 'Server 2 (Backup)', url: 'https://1.kooralive360.com/albaplayer/bein-sports-hd-1/?serv=1' },
                { name: 'Server 3 (Low Latency)', url: 'https://1.kooralive360.com/albaplayer/bein-sports-hd-1/?serv=2' }
            ]
        },
        {
            name: 'beIN Sports HD 2',
            type: 'web',
            url: 'https://1.kooralive360.com/albaplayer/bein-sports-hd-2/?serv=0',
            logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/e/e6/BeIN_Sports_1.svg/512px-BeIN_Sports_1.svg.png',
            group: 'Live Football / Sports',
            category: 'sports',
            servers: [
                { name: 'Server 1', url: 'https://1.kooralive360.com/albaplayer/bein-sports-hd-2/?serv=0' },
                { name: 'Server 2', url: 'https://1.kooralive360.com/albaplayer/bein-sports-hd-2/?serv=1' }
            ]
        }
    ];

    // State
    const state = {
        activeTab: 'channels', // 'channels' | 'sports' | 'favorites' | 'recents'
        filterMode: 'category', // 'category' | 'country'
        selectedCategory: 'all',
        selectedCountry: 'all',
        customSources: [],
        searchQuery: '',
        hideOffline: false, // Show all channels with live/dead status badges by default
        viewMode: 'grid', // 'grid' | 'list'
        routingMode: 'auto', // 'auto' | 'proxy' | 'direct'
        masterChannels: [], // Unified multi-source merged catalog
        displayedChannels: [],
        currentChannel: null,
        currentServerIndex: 0,
        favorites: new Set(),
        recentChannels: [],
        hlsInstance: null,
        theaterMode: false,
        diagnosticsOpen: false,
        diagTimer: null,
        isLoading: false,
        bdixServers: [],
        bdixActiveCategory: 'all',
        bdixSearchQuery: ''
    };

    // DOM Elements
    const elements = {
        video: document.getElementById('main-video'),
        sportsIframe: document.getElementById('sports-iframe'),
        playerPane: document.getElementById('player-pane'),
        channelsContainer: document.getElementById('channels-container'),
        chipsContainer: document.getElementById('chips-container'),
        searchInput: document.getElementById('search-input'),
        searchClearBtn: document.getElementById('search-clear-btn'),
        hideOfflineToggle: document.getElementById('hide-offline-toggle'),
        statsBadge: document.getElementById('stats-badge'),
        currentChannelName: document.getElementById('current-channel-name'),
        activeChannelLogo: document.getElementById('active-channel-logo'),
        currentChannelCategory: document.getElementById('current-channel-category'),
        currentChannelStatus: document.getElementById('current-channel-status'),
        currentStreamUrlBadge: document.getElementById('current-stream-url-badge'),
        favActiveBtn: document.getElementById('fav-active-btn'),
        qualitySelect: document.getElementById('quality-select'),
        serverSelect: document.getElementById('server-select'),
        playerActionServerGroup: document.getElementById('player-action-server-group'),
        playerScreenServers: document.getElementById('player-screen-servers'),
        playerScreenServerButtons: document.getElementById('player-screen-server-buttons'),
        routingBadge: document.getElementById('routing-badge'),
        theaterBtn: document.getElementById('theater-btn'),
        pipBtn: document.getElementById('pip-btn'),
        fullscreenBtn: document.getElementById('fullscreen-btn'),
        reloadBtn: document.getElementById('reload-btn'),
        popoutBtn: document.getElementById('popout-btn'),
        diagToggleBtn: document.getElementById('diag-toggle-btn'),
        diagPanel: document.getElementById('diag-panel'),
        diagRes: document.getElementById('diag-res'),
        diagBitrate: document.getElementById('diag-bitrate'),
        diagBuffer: document.getElementById('diag-buffer'),
        diagDropped: document.getElementById('diag-dropped'),
        diagRoute: document.getElementById('diag-route'),
        routingModal: document.getElementById('routing-modal'),
        customModal: document.getElementById('custom-modal'),
        sourcesModal: document.getElementById('sources-modal'),
        geoGuideModal: document.getElementById('geo-guide-modal'),
        customUrlInput: document.getElementById('custom-url-input'),
        customNameInput: document.getElementById('custom-name-input'),
        saveCustomBtn: document.getElementById('save-custom-btn'),
        sourcesListContainer: document.getElementById('sources-list-container'),
        applySourcesBtn: document.getElementById('apply-sources-btn'),
        geoAlertBanner: document.getElementById('geo-alert-banner'),
        openSourcesBtn: document.getElementById('open-sources-btn'),
        openGeoGuideBtn: document.getElementById('open-geo-guide-btn'),
        openBdixHubBtn: document.getElementById('open-bdix-hub-btn'),
        bdixHubModal: document.getElementById('bdix-hub-modal'),
        bdixSearchInput: document.getElementById('bdix-search-input'),
        bdixCardsGrid: document.getElementById('bdix-cards-grid'),
        bdixCountLabel: document.getElementById('bdix-count-label'),
        refreshFtvBtn: document.getElementById('refresh-ftv-btn')
    };

    /* --------------------------------------------------------------------------
       Initialization
       -------------------------------------------------------------------------- */
    function init() {
        loadSavedData();
        setupEventListeners();
        setupHealthCheckerSubscription();
        renderFilterChips();
        renderSourcesModalList();
        loadAndMergeAllSources();
    }

    function loadSavedData() {
        try {
            const favs = localStorage.getItem('streampulse_favs');
            if (favs) state.favorites = new Set(JSON.parse(favs));
            const recents = localStorage.getItem('streampulse_recents');
            if (recents) state.recentChannels = JSON.parse(recents);
            const savedView = localStorage.getItem('streampulse_view');
            if (savedView) state.viewMode = savedView;
            const customSrcs = localStorage.getItem('streampulse_custom_sources');
            if (customSrcs) state.customSources = JSON.parse(customSrcs);
        } catch (e) {
            console.warn('Storage read error:', e);
        }
    }

    function saveFavorites() {
        try {
            localStorage.setItem('streampulse_favs', JSON.stringify(Array.from(state.favorites)));
            updateFavoritesTabBadge();
        } catch (e) {}
    }

    function saveRecents() {
        try {
            localStorage.setItem('streampulse_recents', JSON.stringify(state.recentChannels.slice(0, 15)));
        } catch (e) {}
    }

    function saveCustomSources() {
        try {
            localStorage.setItem('streampulse_custom_sources', JSON.stringify(state.customSources));
        } catch (e) {}
    }

    function updateFavoritesTabBadge() {
        const badge = document.getElementById('fav-count-badge');
        if (badge) badge.textContent = state.favorites.size;
    }

    /* --------------------------------------------------------------------------
       Filter Chips Rendering (Restored Category & Country Filters)
       -------------------------------------------------------------------------- */
    function renderFilterChips() {
        elements.chipsContainer.innerHTML = '';

        if (state.activeTab === 'sports') {
            elements.chipsContainer.innerHTML = '<span style="color:var(--text-muted);font-size:0.82rem;padding:6px 0;">⚡ Live Sports Arena (Web Feeds & Direct Relays)</span>';
            return;
        }

        if (state.activeTab === 'favorites') {
            elements.chipsContainer.innerHTML = `<span style="color:var(--text-muted);font-size:0.82rem;padding:6px 0;">⭐ Your Starred Channels (${state.favorites.size})</span>`;
            return;
        }

        if (state.activeTab === 'recents') {
            elements.chipsContainer.innerHTML = `<span style="color:var(--text-muted);font-size:0.82rem;padding:6px 0;">🕒 Recently Played Channels (${state.recentChannels.length})</span>`;
            return;
        }

        // Toggle Type Pills: By Category | By Country
        const filterTypeToggle = document.createElement('div');
        filterTypeToggle.style.display = 'inline-flex';
        filterTypeToggle.style.gap = '4px';
        filterTypeToggle.style.marginRight = '8px';
        filterTypeToggle.style.background = 'rgba(0,0,0,0.35)';
        filterTypeToggle.style.padding = '2px';
        filterTypeToggle.style.borderRadius = 'var(--radius-full)';
        filterTypeToggle.style.border = '1px solid var(--border-subtle)';
        filterTypeToggle.innerHTML = `
            <button type="button" class="chip-btn ${state.filterMode === 'category' ? 'active' : ''}" id="btn-mode-cat">Categories</button>
            <button type="button" class="chip-btn ${state.filterMode === 'country' ? 'active' : ''}" id="btn-mode-country">Countries</button>
        `;
        elements.chipsContainer.appendChild(filterTypeToggle);

        document.getElementById('btn-mode-cat').onclick = () => {
            state.filterMode = 'category';
            renderFilterChips();
            applyFiltersAndRender();
        };

        document.getElementById('btn-mode-country').onclick = () => {
            state.filterMode = 'country';
            renderFilterChips();
            applyFiltersAndRender();
        };

        // Render Category Chips or Country Chips
        if (state.filterMode === 'category') {
            CATEGORIES.forEach(cat => {
                const isSelected = state.selectedCategory === cat.id;
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = `chip-btn ${isSelected ? 'active' : ''}`;
                btn.innerHTML = `<span>${cat.icon}</span> <span>${cat.name}</span>`;
                btn.onclick = () => {
                    state.selectedCategory = cat.id;
                    renderFilterChips();
                    applyFiltersAndRender();
                };
                elements.chipsContainer.appendChild(btn);
            });
        } else {
            COUNTRIES.forEach(c => {
                const isSelected = state.selectedCountry === c.id;
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = `chip-btn ${isSelected ? 'active' : ''}`;
                btn.innerHTML = `<span>${c.icon}</span> <span>${c.name}</span>`;
                btn.onclick = () => {
                    state.selectedCountry = c.id;
                    renderFilterChips();
                    applyFiltersAndRender();
                };
                elements.chipsContainer.appendChild(btn);
            });
        }
    }

    /* --------------------------------------------------------------------------
       Multi-Source Aggregator: Merges Multiple M3U/M3U8 Playlists by Default
       -------------------------------------------------------------------------- */
    function normalizeChannelName(name) {
        if (!name) return '';
        return name.toLowerCase()
            .replace(/\s*\(\d+p\)/g, '')
            .replace(/\s*\[.*?\]/g, '')
            .replace(/hd$/i, '')
            .replace(/fhd$/i, '')
            .replace(/[^a-z0-9]/g, '')
            .trim();
    }

    function detectCategoryAndCountry(channel, sourceInfo) {
        let cat = 'general';
        let country = 'unknown';

        const nameLower = (channel.name || '').toLowerCase();
        const groupLower = (channel.group || '').toLowerCase();
        const idLower = (channel.id || '').toLowerCase();

        // 1. Category Detection
        if (sourceInfo.defaultCategory) {
            cat = sourceInfo.defaultCategory.toLowerCase();
        } else if (groupLower.includes('sport') || nameLower.includes('sport') || nameLower.includes('football') || nameLower.includes('cricket')) {
            cat = 'sports';
        } else if (groupLower.includes('news') || nameLower.includes('news') || nameLower.includes('cnn') || nameLower.includes('bbc')) {
            cat = 'news';
        } else if (groupLower.includes('movie') || groupLower.includes('cinema') || nameLower.includes('movie') || nameLower.includes('cinema') || nameLower.includes('hbo')) {
            cat = 'movies';
        } else if (groupLower.includes('music') || nameLower.includes('music') || nameLower.includes('mtv')) {
            cat = 'music';
        } else if (groupLower.includes('doc') || nameLower.includes('nat geo') || nameLower.includes('discovery') || nameLower.includes('history')) {
            cat = 'documentary';
        } else if (groupLower.includes('kid') || groupLower.includes('cartoon') || nameLower.includes('disney') || nameLower.includes('nickelodeon')) {
            cat = 'kids';
        } else if (groupLower.includes('animation') || nameLower.includes('anime')) {
            cat = 'animation';
        } else if (groupLower.includes('comedy')) {
            cat = 'comedy';
        } else if (groupLower.includes('entertain') || nameLower.includes('tv')) {
            cat = 'entertainment';
        }

        // 2. Country Detection
        if (sourceInfo.defaultCountry) {
            country = sourceInfo.defaultCountry.toLowerCase();
        } else if (channel.country) {
            country = channel.country.toLowerCase();
        } else {
            // Extract from tvg-id (e.g., 'Channel.bd', 'CNN.us', 'BBC.uk', 'Sony.in')
            const idCountryMatch = idLower.match(/\.([a-z]{2})(?:@|$)/);
            if (idCountryMatch) {
                country = idCountryMatch[1];
            } else if (groupLower.includes('bangladesh') || nameLower.includes('bangla') || nameLower.includes('dhaka')) {
                country = 'bd';
            } else if (groupLower.includes('india') || nameLower.includes('india') || nameLower.includes('hindi')) {
                country = 'in';
            } else if (groupLower.includes('united states') || groupLower.includes('usa')) {
                country = 'us';
            } else if (groupLower.includes('united kingdom') || groupLower.includes('uk')) {
                country = 'uk';
            }
        }

        return { category: cat, country };
    }

    async function loadAndMergeAllSources() {
        elements.channelsContainer.innerHTML = `
            <div class="loading-box">
                <div class="spinner"></div>
                <p>Merging multiple IPTV & GitHub sources by default...</p>
                <p style="font-size:0.75rem;color:var(--text-muted);margin-top:4px;">Aggregating Free-TV HD, Sports, News, Movies, Bangladesh & Global feeds...</p>
            </div>
        `;

        state.isLoading = true;

        // Combine default preset sources and custom sources
        const sourcesToFetch = [...DEFAULT_PLAYLIST_SOURCES, ...state.customSources];

        try {
            // Cancel any old health probes
            if (window.streamHealthChecker) {
                window.streamHealthChecker.cancelAllPending();
            }

            // Fetch all playlists concurrently in parallel
            const fetchPromises = sourcesToFetch.map(async (src) => {
                const res = await fetch(src.url);
                if (!res.ok) throw new Error(`${src.name} HTTP ${res.status}`);
                const text = await res.text();
                return { src, channels: parseM3U(text, src.name) };
            });

            const results = await Promise.allSettled(fetchPromises);
            const mergedMap = new Map();

            // First add featured web sports streams (beIN Sports etc.)
            FEATURED_SPORTS.forEach(fs => {
                const norm = normalizeChannelName(fs.name);
                mergedMap.set(norm, { ...fs });
            });

            // Process all fetched sources
            results.forEach((res) => {
                if (res.status === 'fulfilled') {
                    const { src, channels } = res.value;
                    channels.forEach(ch => {
                        const normKey = normalizeChannelName(ch.name);
                        if (!normKey) return;

                        const meta = detectCategoryAndCountry(ch, src);
                        ch.category = meta.category;
                        ch.country = meta.country;

                        if (!mergedMap.has(normKey)) {
                            // First occurrence: create channel entry with Server 1
                            ch.servers = [{ name: `Server 1 (${src.name})`, url: ch.url }];
                            ch.sources = [src.name];
                            mergedMap.set(normKey, ch);
                        } else {
                            // Multiple Server Mirror: Attach as Server 2, Server 3, etc.!
                            const existing = mergedMap.get(normKey);
                            const alreadyHasUrl = existing.servers.some(s => s.url === ch.url);
                            if (!alreadyHasUrl) {
                                existing.servers.push({
                                    name: `Server ${existing.servers.length + 1} (${src.name})`,
                                    url: ch.url
                                });
                                if (!existing.sources.includes(src.name)) {
                                    existing.sources.push(src.name);
                                }
                                if (!existing.logo && ch.logo) {
                                    existing.logo = ch.logo;
                                }
                            }
                        }
                    });
                }
            });

            state.masterChannels = Array.from(mergedMap.values());
            state.isLoading = false;

            applyFiltersAndRender();

            // Queue background health checks for visible channels
            if (window.streamHealthChecker && state.masterChannels.length > 0) {
                window.streamHealthChecker.queueBatch(state.masterChannels, 50);
            }
        } catch (err) {
            state.isLoading = false;
            elements.channelsContainer.innerHTML = `
                <div class="empty-box">
                    <p style="color:var(--accent-rose);margin-bottom:8px;">⚠️ Failed to load merged playlists</p>
                    <p style="font-size:0.85rem;">${err.message}</p>
                    <button class="action-btn" style="margin-top:14px;" onclick="location.reload()">Retry</button>
                </div>
            `;
        }
    }

    function parseM3U(content, sourceName = '') {
        const lines = content.split('\n');
        const channels = [];
        let current = {};

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            if (line.startsWith('#EXTINF:')) {
                // Name
                const nameMatch = line.match(/,(.+)$/);
                if (nameMatch) current.name = nameMatch[1].trim();

                // Logo
                const logoMatch = line.match(/tvg-logo="([^"]+)"/);
                if (logoMatch) current.logo = logoMatch[1];

                // Group
                const groupMatch = line.match(/group-title="([^"]+)"/);
                if (groupMatch) current.group = groupMatch[1];

                // Country
                const countryMatch = line.match(/tvg-country="([^"]+)"/);
                if (countryMatch) current.country = countryMatch[1];

                // TV ID
                const idMatch = line.match(/tvg-id="([^"]+)"/);
                if (idMatch) current.id = idMatch[1];
            } else if (line.startsWith('http://') || line.startsWith('https://')) {
                current.url = line;
                if (!current.name) current.name = 'Channel ' + (channels.length + 1);
                current.source = sourceName;
                channels.push(current);
                current = {};
            }
        }
        return channels;
    }

    /* --------------------------------------------------------------------------
       Filters & Rendering (Using Restored Category / Country Filters)
       -------------------------------------------------------------------------- */
    function applyFiltersAndRender() {
        if (state.activeTab === 'sports') {
            state.displayedChannels = FEATURED_SPORTS;
            renderChannels();
            updateStats();
            return;
        }

        if (state.activeTab === 'favorites') {
            renderFavoritesList();
            return;
        }

        if (state.activeTab === 'recents') {
            state.displayedChannels = state.recentChannels;
            renderChannels();
            updateStats();
            return;
        }

        const query = state.searchQuery.toLowerCase().trim();

        state.displayedChannels = state.masterChannels.filter(ch => {
            // Search query filter
            if (query) {
                const matchName = ch.name.toLowerCase().includes(query);
                const matchGroup = ch.group && ch.group.toLowerCase().includes(query);
                const matchCountry = ch.country && ch.country.toLowerCase().includes(query);
                if (!matchName && !matchGroup && !matchCountry) return false;
            }

            // Category filter (if mode is category and not 'all')
            if (state.filterMode === 'category' && state.selectedCategory !== 'all') {
                const matchCat = ch.category === state.selectedCategory || (ch.group && ch.group.toLowerCase().includes(state.selectedCategory));
                if (!matchCat) return false;
            }

            // Country filter (if mode is country and not 'all')
            if (state.filterMode === 'country' && state.selectedCountry !== 'all') {
                const matchCountry = ch.country === state.selectedCountry;
                if (!matchCountry) return false;
            }

            // Hide offline filter
            if (state.hideOffline && window.streamHealthChecker) {
                const status = window.streamHealthChecker.getStatus(ch.url);
                if (status === 'offline') return false;
            }

            return true;
        });

        renderChannels();
        updateStats();
    }

    function updateStats() {
        if (!elements.statsBadge) return;

        let onlineCount = 0;
        let offlineCount = 0;

        if (window.streamHealthChecker) {
            state.displayedChannels.forEach(ch => {
                const s = window.streamHealthChecker.getStatus(ch.url);
                if (s === 'online') onlineCount++;
                else if (s === 'offline') offlineCount++;
            });
        }

        elements.statsBadge.innerHTML = `Showing <b>${state.displayedChannels.length}</b> channels &bull; <span style="color:var(--accent-emerald)">${onlineCount} Online</span> &bull; <span style="color:var(--accent-rose)">${offlineCount} Offline</span>`;
    }

    function renderChannels() {
        const container = elements.channelsContainer;
        container.innerHTML = '';

        if (state.displayedChannels.length === 0) {
            container.innerHTML = `
                <div class="empty-box">
                    <p style="font-size:1.1rem;margin-bottom:6px;">No channels found</p>
                    <p style="font-size:0.85rem;">Try selecting "All Channels" or toggling off "Hide Offline".</p>
                </div>
            `;
            return;
        }

        const isGrid = state.viewMode === 'grid';
        const wrapper = document.createElement('div');
        wrapper.className = isGrid ? 'channels-grid' : 'channels-list-view';

        state.displayedChannels.forEach(channel => {
            const card = isGrid ? createChannelCard(channel) : createChannelListItem(channel);
            wrapper.appendChild(card);
        });

        container.appendChild(wrapper);
    }

    /**
     * Create Grid Card with Server Options in the Image Area
     */
    function createChannelCard(channel) {
        const card = document.createElement('div');
        const isCurrent = state.currentChannel && state.currentChannel.url === channel.url;
        const status = window.streamHealthChecker ? window.streamHealthChecker.getStatus(channel.url) : 'unknown';
        const isFav = state.favorites.has(channel.url);
        const servers = channel.servers || [{ name: 'Server 1', url: channel.url }];

        card.className = `channel-card ${isCurrent ? 'active-playing' : ''} status-${status}`;
        card.setAttribute('data-url', channel.url);

        // Status badge UI
        let statusBadgeHtml = '';
        if (status === 'online') {
            statusBadgeHtml = `<span class="card-status-badge status-badge-online" title="Stream Verified Live"><span class="live-pulse-dot" style="width:6px;height:6px;"></span> Live</span>`;
        } else if (status === 'offline') {
            const details = window.streamHealthChecker ? window.streamHealthChecker.getCached(channel.url) : null;
            const errType = details ? details.errorType : null;
            const reason = details ? details.reason : 'Offline / Blocked';
            if (errType === 'dead') {
                statusBadgeHtml = `<span class="card-status-badge status-badge-dead" title="${reason}">🔗 Dead (404)</span>`;
            } else if (errType === 'geo') {
                statusBadgeHtml = `<span class="card-status-badge status-badge-geo" title="${reason}">🌍 Geo (403)</span>`;
            } else {
                statusBadgeHtml = `<span class="card-status-badge status-badge-offline" title="${reason}">Offline</span>`;
            }
        } else if (status === 'checking') {
            statusBadgeHtml = `<span class="card-status-badge status-badge-checking" title="Testing availability...">Checking</span>`;
        }

        // Server options overlay in the IMAGE AREA (when multiple servers exist)
        let serverOverlayHtml = '';
        if (servers.length > 1) {
            serverOverlayHtml = `
                <div class="card-server-overlay" title="Select Stream Server">
                    ${servers.map((s, idx) => `
                        <button type="button" class="card-srv-btn ${idx === 0 ? 'active' : ''}" data-srv-idx="${idx}" title="${s.name}">
                            S${idx + 1}
                        </button>
                    `).join('')}
                </div>
            `;
        }

        // Logo with fallback
        const logoUrl = channel.logo || '';
        const fallbackMonogram = channel.name.slice(0, 2).toUpperCase();

        card.innerHTML = `
            <button class="card-fav-btn ${isFav ? 'is-fav' : ''}" title="Save to Favorites" data-fav-url="${channel.url}">
                ${isFav ? '★' : '☆'}
            </button>
            ${statusBadgeHtml}
            <div class="card-logo-shell">
                ${logoUrl 
                    ? `<img src="${logoUrl}" class="card-logo-img" alt="${channel.name}" onerror="this.style.display='none';this.nextElementSibling.style.display='block';">
                       <span style="display:none;font-weight:700;font-size:1.1rem;color:var(--accent-cyan);">${fallbackMonogram}</span>`
                    : `<span style="font-weight:700;font-size:1.1rem;color:var(--accent-cyan);">${fallbackMonogram}</span>`
                }
                ${serverOverlayHtml}
            </div>
            <div class="card-name" title="${channel.name}">${channel.name}</div>
            <div class="card-subtext">${servers.length > 1 ? `${servers.length} Servers Available` : (channel.group || 'Live Stream')}</div>
        `;

        // Card click plays primary server
        card.onclick = (e) => {
            if (e.target.closest('.card-fav-btn') || e.target.closest('.card-srv-btn')) return;
            playChannel(channel, 0);
        };

        // Server buttons inside the image area
        card.querySelectorAll('.card-srv-btn').forEach(btn => {
            btn.onclick = (e) => {
                e.stopPropagation();
                const idx = parseInt(btn.getAttribute('data-srv-idx'), 10);
                card.querySelectorAll('.card-srv-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                playChannel(channel, idx);
            };
        });

        // Favorite button
        const favBtn = card.querySelector('.card-fav-btn');
        favBtn.onclick = (e) => {
            e.stopPropagation();
            toggleFavorite(channel);
        };

        return card;
    }

    /**
     * Create List Item with Server Options in the Image Area
     */
    function createChannelListItem(channel) {
        const item = document.createElement('div');
        const isCurrent = state.currentChannel && state.currentChannel.url === channel.url;
        const status = window.streamHealthChecker ? window.streamHealthChecker.getStatus(channel.url) : 'unknown';
        const isFav = state.favorites.has(channel.url);
        const servers = channel.servers || [{ name: 'Server 1', url: channel.url }];

        item.className = `channel-list-item ${isCurrent ? 'active-playing' : ''} status-${status}`;
        item.setAttribute('data-url', channel.url);

        let statusBadgeHtml = '';
        if (status === 'online') {
            statusBadgeHtml = `<span class="badge-pill badge-health-online" title="Stream Verified Live"><span class="live-pulse-dot" style="width:5px;height:5px;"></span> Live</span>`;
        } else if (status === 'offline') {
            const details = window.streamHealthChecker ? window.streamHealthChecker.getCached(channel.url) : null;
            const errType = details ? details.errorType : null;
            const reason = details ? details.reason : 'Offline';
            if (errType === 'dead') {
                statusBadgeHtml = `<span class="badge-pill badge-health-dead" title="${reason}">🔗 404</span>`;
            } else if (errType === 'geo') {
                statusBadgeHtml = `<span class="badge-pill badge-health-geo" title="${reason}">🌍 403</span>`;
            } else {
                statusBadgeHtml = `<span class="badge-pill badge-health-offline" title="${reason}">Offline</span>`;
            }
        }

        const logoUrl = channel.logo || '';
        const fallbackMonogram = channel.name.slice(0, 2).toUpperCase();

        item.innerHTML = `
            <div class="list-item-left">
                <button class="card-fav-btn ${isFav ? 'is-fav' : ''}" style="position:static;" data-fav-url="${channel.url}">
                    ${isFav ? '★' : '☆'}
                </button>
                <div class="card-logo-shell" style="width:38px;height:38px;">
                    ${logoUrl 
                        ? `<img src="${logoUrl}" class="card-logo-img" alt="${channel.name}" onerror="this.style.display='none';this.nextElementSibling.style.display='block';">
                           <span style="display:none;font-size:0.8rem;color:var(--accent-cyan);">${fallbackMonogram}</span>`
                        : `<span style="font-size:0.8rem;color:var(--accent-cyan);">${fallbackMonogram}</span>`
                    }
                </div>
                <div class="list-item-info">
                    <div class="list-item-name">${channel.name}</div>
                    <div style="font-size:0.72rem;color:var(--text-muted);">${channel.group || 'IPTV Stream'}</div>
                </div>
            </div>
            <div style="display:flex;align-items:center;gap:6px;">
                ${servers.length > 1 ? `
                    <div style="display:flex;gap:3px;">
                        ${servers.map((s, idx) => `
                            <button type="button" class="card-srv-btn" data-srv-idx="${idx}" style="font-size:0.7rem;padding:2px 6px;">S${idx + 1}</button>
                        `).join('')}
                    </div>
                ` : ''}
                ${statusBadgeHtml}
            </div>
        `;

        item.onclick = (e) => {
            if (e.target.closest('.card-fav-btn') || e.target.closest('.card-srv-btn')) return;
            playChannel(channel, 0);
        };

        item.querySelectorAll('.card-srv-btn').forEach(btn => {
            btn.onclick = (e) => {
                e.stopPropagation();
                const idx = parseInt(btn.getAttribute('data-srv-idx'), 10);
                playChannel(channel, idx);
            };
        });

        const favBtn = item.querySelector('.card-fav-btn');
        favBtn.onclick = (e) => {
            e.stopPropagation();
            toggleFavorite(channel);
        };

        return item;
    }

    /* --------------------------------------------------------------------------
       Health Checker Updates Listener
       -------------------------------------------------------------------------- */
    function setupHealthCheckerSubscription() {
        if (!window.streamHealthChecker) return;

        window.streamHealthChecker.subscribe((url, entry) => {
            updateStats();

            const cards = document.querySelectorAll(`[data-url="${CSS.escape(url)}"]`);
            cards.forEach(card => {
                if (!entry) return;

                card.classList.remove('status-online', 'status-offline', 'status-checking', 'status-geo', 'status-dead');
                card.classList.add(`status-${entry.status}`);
                if (entry.errorType) card.classList.add(`status-${entry.errorType}`);

                if (state.hideOffline && entry.status === 'offline') {
                    card.style.display = 'none';
                    return;
                } else {
                    card.style.display = '';
                }

                // Update Grid Card Badge
                const badge = card.querySelector('.card-status-badge');
                if (badge) {
                    badge.className = 'card-status-badge';
                    if (entry.status === 'online') {
                        badge.classList.add('status-badge-online');
                        badge.innerHTML = `<span class="live-pulse-dot" style="width:6px;height:6px;"></span> Live`;
                        badge.title = entry.reason || 'Stream Verified Live';
                    } else if (entry.status === 'offline') {
                        if (entry.errorType === 'dead') {
                            badge.classList.add('status-badge-dead');
                            badge.innerHTML = '🔗 Dead (404)';
                            badge.title = entry.reason || 'Dead Link (404 Not Found)';
                        } else if (entry.errorType === 'geo') {
                            badge.classList.add('status-badge-geo');
                            badge.innerHTML = '🌍 Geo (403)';
                            badge.title = entry.reason || 'Geo-Blocked (403 Forbidden)';
                        } else {
                            badge.classList.add('status-badge-offline');
                            badge.innerHTML = 'Offline';
                            badge.title = entry.reason || 'Offline / Blocked';
                        }
                    } else if (entry.status === 'checking') {
                        badge.classList.add('status-badge-checking');
                        badge.innerHTML = 'Checking';
                        badge.title = 'Testing availability...';
                    }
                }

                // Update List View Badge
                const listBadge = card.querySelector('.badge-pill');
                if (listBadge) {
                    listBadge.className = 'badge-pill';
                    if (entry.status === 'online') {
                        listBadge.classList.add('badge-health-online');
                        listBadge.innerHTML = `<span class="live-pulse-dot" style="width:5px;height:5px;"></span> Live`;
                        listBadge.title = entry.reason || 'Stream Verified Live';
                    } else if (entry.status === 'offline') {
                        if (entry.errorType === 'dead') {
                            listBadge.classList.add('badge-health-dead');
                            listBadge.innerHTML = '🔗 404';
                            listBadge.title = entry.reason || 'Dead Link (404)';
                        } else if (entry.errorType === 'geo') {
                            listBadge.classList.add('badge-health-geo');
                            listBadge.innerHTML = '🌍 403';
                            listBadge.title = entry.reason || 'Geo-Blocked (403)';
                        } else {
                            listBadge.classList.add('badge-health-offline');
                            listBadge.innerHTML = 'Offline';
                            listBadge.title = entry.reason || 'Offline';
                        }
                    }
                }
            });
        });
    }

    /* --------------------------------------------------------------------------
       Stream Playback Controller with On-Screen Server Switcher & Geo-Bypass
       -------------------------------------------------------------------------- */
    function playChannel(channel, serverIndex = 0, forceProxy = false, proxyIndex = 0) {
        state.currentChannel = channel;
        state.currentServerIndex = serverIndex;

        // Hide geo-alert
        if (elements.geoAlertBanner) elements.geoAlertBanner.style.display = 'none';

        // Record to recently played
        state.recentChannels = [channel, ...state.recentChannels.filter(c => c.url !== channel.url)].slice(0, 15);
        saveRecents();

        // Update Channel Meta UI
        elements.currentChannelName.textContent = channel.name;
        if (channel.logo) {
            elements.activeChannelLogo.src = channel.logo;
            elements.activeChannelLogo.style.display = 'block';
        } else {
            elements.activeChannelLogo.style.display = 'none';
        }

        elements.currentChannelCategory.textContent = channel.group || 'Live Stream';

        // Favorite button state
        const isFav = state.favorites.has(channel.url);
        elements.favActiveBtn.innerHTML = isFav ? '★ Favorited' : '☆ Favorite';
        elements.favActiveBtn.classList.toggle('active', isFav);

        // Highlight active card
        document.querySelectorAll('.channel-card, .channel-list-item').forEach(el => {
            el.classList.toggle('active-playing', el.getAttribute('data-url') === channel.url);
        });

        // Determine active stream URL from servers
        const servers = channel.servers && channel.servers.length > 0 
            ? channel.servers 
            : [{ name: 'Server 1', url: channel.url }];

        const currentServer = servers[serverIndex] || servers[0];
        const streamUrl = currentServer.url;

        elements.currentStreamUrlBadge.textContent = streamUrl ? streamUrl.split('/')[2] || 'Stream Host' : '';
        elements.currentStreamUrlBadge.title = streamUrl || '';

        // 1. UPDATE FLOATING ON-SCREEN SERVER OPTIONS IN THE VIDEO IMAGE AREA
        if (servers.length > 1) {
            elements.playerScreenServers.style.display = 'flex';
            elements.playerScreenServerButtons.innerHTML = servers.map((srv, idx) => `
                <button type="button" class="screen-srv-btn ${idx === serverIndex ? 'active' : ''}" data-screen-srv="${idx}">
                    ${srv.name.replace(/\(.*?\)/, '').trim() || 'Server ' + (idx + 1)}
                </button>
            `).join('');

            elements.playerScreenServerButtons.querySelectorAll('.screen-srv-btn').forEach(btn => {
                btn.onclick = () => {
                    const idx = parseInt(btn.getAttribute('data-screen-srv'), 10);
                    playChannel(channel, idx);
                };
            });
        } else {
            elements.playerScreenServers.style.display = 'none';
        }

        // 2. UPDATE SERVER BUTTONS IN THE PLAYER ACTION BAR
        if (servers.length > 1) {
            elements.playerActionServerGroup.style.display = 'flex';
            elements.playerActionServerGroup.innerHTML = servers.map((srv, idx) => `
                <button type="button" class="action-btn ${idx === serverIndex ? 'active' : ''}" data-act-srv="${idx}" style="padding:5px 9px;font-size:0.75rem;">
                    S${idx + 1}
                </button>
            `).join('');

            elements.playerActionServerGroup.querySelectorAll('[data-act-srv]').forEach(btn => {
                btn.onclick = () => {
                    const idx = parseInt(btn.getAttribute('data-act-srv'), 10);
                    playChannel(channel, idx);
                };
            });
        } else {
            elements.playerActionServerGroup.style.display = 'none';
        }

        // Check if Web Feed (Iframe mode for beIN Sports etc.)
        if (channel.type === 'web') {
            elements.video.style.display = 'none';
            elements.sportsIframe.style.display = 'block';
            elements.sportsIframe.src = streamUrl;
            elements.routingBadge.innerHTML = '🌐 Web Feed';
            elements.currentChannelStatus.innerHTML = '<span class="live-pulse-dot"></span> Live Broadcast';
            return;
        }

        // HLS Stream mode
        elements.sportsIframe.style.display = 'none';
        elements.video.style.display = 'block';

        const needProxy = forceProxy || (window.SmartProxyEngine && window.SmartProxyEngine.shouldRouteThroughProxy(streamUrl));

        // Update routing badge
        elements.routingBadge.innerHTML = needProxy 
            ? (proxyIndex === 0 ? '🟢 Cloudflare Proxy' : '🌐 Global Proxy') 
            : '⚡ Direct Stream';

        elements.currentChannelStatus.innerHTML = needProxy 
            ? '<span style="color:var(--accent-amber)">Routing via Smart Proxy...</span>'
            : '<span style="color:var(--text-muted)">Connecting direct...</span>';

        // Play via Hls.js
        if (window.Hls && Hls.isSupported()) {
            if (state.hlsInstance) {
                state.hlsInstance.destroy();
            }

            const CustomLoader = window.SmartProxyEngine 
                ? window.SmartProxyEngine.createSmartProxyLoader(Hls, needProxy, proxyIndex) 
                : Hls.DefaultConfig.loader;

            const hlsConfig = {
                loader: CustomLoader,
                enableWorker: true,
                lowLatencyMode: true,
                backBufferLength: 60
            };

            const hls = new Hls(hlsConfig);
            state.hlsInstance = hls;

            hls.loadSource(streamUrl);
            hls.attachMedia(elements.video);

            hls.on(Hls.Events.MANIFEST_PARSED, (event, data) => {
                elements.currentChannelStatus.innerHTML = '<span class="live-pulse-dot"></span> Stream Live';
                elements.video.play().catch(() => {
                    console.log('Autoplay blocked by browser; user interaction required');
                });
                populateQualityLevels(data.levels);
            });

            hls.on(Hls.Events.LEVEL_SWITCHED, (event, data) => {
                const level = hls.levels[data.level];
                if (level && elements.diagRes) {
                    elements.diagRes.textContent = `${level.width || '?'}x${level.height || '?'}`;
                    elements.diagBitrate.textContent = `${Math.round(level.bitrate / 1000)} kbps`;
                }
            });

            hls.on(Hls.Events.ERROR, async (event, data) => {
                if (data.fatal) {
                    console.warn('HLS Error on Server', serverIndex, ':', data.type, data.details, data);

                    // Auto-refresh token for FTV local stream if token expired (HTTP 403 / 404)
                    if (streamUrl.includes('172.16.15.5')) {
                        const ftvMatch = streamUrl.match(/172\.16\.15\.5:8666\/([^/]+)\//);
                        const streamId = ftvMatch ? ftvMatch[1] : null;
                        if (streamId) {
                            try {
                                elements.currentChannelStatus.innerHTML = '<span style="color:var(--accent-cyan)">Refreshing local FTV token...</span>';
                                const ftvRes = await fetch(`http://172.16.15.5/play.php?stream=${encodeURIComponent(streamId)}`);
                                if (ftvRes.ok) {
                                    const ftvHtml = await ftvRes.text();
                                    const srcMatch = ftvHtml.match(/var videoSrc = ['"]([^'"]+)['"]/);
                                    if (srcMatch && srcMatch[1] && srcMatch[1] !== streamUrl) {
                                        currentServer.url = srcMatch[1];
                                        hls.loadSource(srcMatch[1]);
                                        hls.startLoad();
                                        return;
                                    }
                                }
                            } catch (e) {
                                console.warn('FTV token refresh failed:', e.message);
                            }
                        }
                    }

                    // Detect HTTP error code from HLS error data
                    const httpCode = data.response && data.response.code ? data.response.code : 0;
                    const isDeadLink = httpCode === 404 || httpCode === 410;
                    const isGeoBlocked = httpCode === 403 || httpCode === 451;

                    // Step 1: Direct failed -> Retry Cloudflare Proxy (only if not a dead link)
                    if (!needProxy && !isDeadLink) {
                        playChannel(channel, serverIndex, true, 0);
                        return;
                    }

                    // Step 2: Primary proxy failed -> Try Alternate Global Proxy (only if not dead link)
                    if (needProxy && proxyIndex === 0 && !isDeadLink) {
                        playChannel(channel, serverIndex, true, 1);
                        return;
                    }

                    // Step 3: All proxies on this mirror failed -> If another server mirror exists, auto-failover!
                    if (servers.length > serverIndex + 1) {
                        const nextIdx = serverIndex + 1;
                        elements.currentChannelStatus.innerHTML = `<span style="color:var(--accent-amber)">Auto-switching to Server ${nextIdx + 1}...</span>`;
                        setTimeout(() => playChannel(channel, nextIdx), 800);
                        return;
                    }

                    // Step 4: Determine error type and show appropriate message
                    if (isDeadLink) {
                        elements.currentChannelStatus.innerHTML = '<span style="color:var(--accent-rose)">🔗 Stream URL Expired / Not Found (404)</span>';
                        showStreamErrorBanner(channel, servers, 'dead');
                    } else if (isGeoBlocked) {
                        elements.currentChannelStatus.innerHTML = '<span style="color:var(--accent-rose)">🌍 Stream Geo-Blocked (403 Forbidden)</span>';
                        showStreamErrorBanner(channel, servers, 'geo');
                    } else {
                        elements.currentChannelStatus.innerHTML = '<span style="color:var(--accent-rose)">⚠️ Stream Unavailable — CORS or Network Error</span>';
                        showStreamErrorBanner(channel, servers, 'cors');
                    }
                }
            });
        } 
        // Fallback for Native Safari / iOS
        else if (elements.video.canPlayType('application/vnd.apple.mpegurl')) {
            const playUrl = needProxy && window.SmartProxyEngine 
                ? window.SmartProxyEngine.buildProxyUrl(streamUrl, proxyIndex) 
                : streamUrl;

            elements.video.src = playUrl;
            elements.video.addEventListener('loadedmetadata', () => {
                elements.currentChannelStatus.innerHTML = '<span class="live-pulse-dot"></span> Stream Live';
                elements.video.play();
            });

            elements.video.addEventListener('error', () => {
                if (!needProxy) {
                    playChannel(channel, serverIndex, true, 0);
                } else if (servers.length > serverIndex + 1) {
                    playChannel(channel, serverIndex + 1);
                } else {
                    elements.currentChannelStatus.innerHTML = '<span style="color:var(--accent-rose)">⚠️ Stream unavailable</span>';
                    showStreamErrorBanner(channel, servers, 'unknown');
                }
            });
        }

        startDiagnosticsTimer();
    }

    /**
     * Show stream error banner with smart messaging based on error type:
     * - 'dead': 404 / expired URL
     * - 'geo': 403 / geo-blocked
     * - 'cors': CORS / network error
     * - 'unknown': fallback
     */
    function showStreamErrorBanner(channel, servers, errorType) {
        if (!elements.geoAlertBanner) return;

        const hasAltServers = servers && servers.length > 1;

        let icon, title, description;
        if (errorType === 'dead') {
            icon = '🔗';
            title = 'Stream URL Expired or Not Found';
            description = 'This stream link (404) is dead or the provider rotated its URL. Try an alternate server or update the URL via Sources.';
        } else if (errorType === 'geo') {
            icon = '🌍';
            title = 'Stream Geo-Blocked (403 Forbidden)';
            description = 'This stream restricts access based on your country or IP. Try an alternate server — some mirrors are not geo-restricted.';
        } else if (errorType === 'cors') {
            icon = '🔒';
            title = 'CORS / Network Error';
            description = 'The stream host rejected the request. This is usually a CORS policy or mixed content block.';
        } else {
            icon = '⚠️';
            title = 'Stream Unavailable';
            description = 'Could not load this stream. Try an alternate server or reload.';
        }

        elements.geoAlertBanner.style.display = 'block';
        elements.geoAlertBanner.innerHTML = `
            <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;">
                <div style="display:flex;align-items:center;gap:10px;">
                    <span style="font-size:1.3rem;">${icon}</span>
                    <div>
                        <div style="font-weight:700;color:var(--accent-amber);">${title}</div>
                        <div style="font-size:0.78rem;color:var(--text-secondary);">${description}</div>
                    </div>
                </div>
                <div style="display:flex;align-items:center;gap:8px;">
                    ${hasAltServers ? `<button type="button" class="action-btn" id="geo-btn-next-mirror" style="background:var(--accent-cyan);color:#000;font-weight:700;">🔄 Try Alternate Server</button>` : ''}
                    ${errorType !== 'dead' ? `<button type="button" class="action-btn" id="geo-btn-alt-proxy">🌐 Force Global Proxy</button>` : ''}
                    <button type="button" class="action-btn" id="geo-btn-reload">🔃 Reload</button>
                    <button type="button" class="action-btn" id="geo-btn-guide">ℹ️ Geo-Tips</button>
                </div>
            </div>
        `;

        const nextMirrorBtn = document.getElementById('geo-btn-next-mirror');
        if (nextMirrorBtn) {
            nextMirrorBtn.onclick = () => {
                elements.geoAlertBanner.style.display = 'none';
                const nextIdx = (state.currentServerIndex + 1) % servers.length;
                playChannel(channel, nextIdx);
            };
        }

        const altProxyBtn = document.getElementById('geo-btn-alt-proxy');
        if (altProxyBtn) {
            altProxyBtn.onclick = () => {
                playChannel(channel, state.currentServerIndex, true, 1);
            };
        }

        document.getElementById('geo-btn-reload').onclick = () => {
            elements.geoAlertBanner.style.display = 'none';
            playChannel(channel, state.currentServerIndex);
        };

        document.getElementById('geo-btn-guide').onclick = () => {
            openModal(elements.geoGuideModal);
        };
    }

    /**
     * Legacy alias kept for compatibility
     */
    function showGeoAlertBanner(channel, servers) {
        showStreamErrorBanner(channel, servers, 'geo');
    }

    function populateQualityLevels(levels) {
        if (!elements.qualitySelect) return;
        elements.qualitySelect.innerHTML = '<option value="-1">Auto (Adapt)</option>';
        if (!levels || levels.length === 0) return;

        levels.forEach((lvl, idx) => {
            const opt = document.createElement('option');
            opt.value = idx;
            opt.textContent = `${lvl.height || lvl.bitrate ? (lvl.height ? lvl.height + 'p' : Math.round(lvl.bitrate/1000) + 'k') : 'Level ' + (idx + 1)}`;
            elements.qualitySelect.appendChild(opt);
        });

        elements.qualitySelect.onchange = (e) => {
            if (state.hlsInstance) {
                state.hlsInstance.currentLevel = parseInt(e.target.value, 10);
            }
        };
    }

    /* --------------------------------------------------------------------------
       Favorites Management
       -------------------------------------------------------------------------- */
    function toggleFavorite(channel) {
        if (state.favorites.has(channel.url)) {
            state.favorites.delete(channel.url);
        } else {
            state.favorites.add(channel.url);
        }
        saveFavorites();

        if (state.currentChannel && state.currentChannel.url === channel.url) {
            const isFav = state.favorites.has(channel.url);
            elements.favActiveBtn.innerHTML = isFav ? '★ Favorited' : '☆ Favorite';
            elements.favActiveBtn.classList.toggle('active', isFav);
        }

        document.querySelectorAll(`[data-fav-url="${CSS.escape(channel.url)}"]`).forEach(btn => {
            const isFav = state.favorites.has(channel.url);
            btn.innerHTML = isFav ? '★' : '☆';
            btn.classList.toggle('is-fav', isFav);
        });

        if (state.activeTab === 'favorites') {
            renderFavoritesList();
        }
    }

    function renderFavoritesList() {
        const favUrls = Array.from(state.favorites);
        state.displayedChannels = favUrls.map(url => {
            const existing = state.masterChannels.find(c => c.url === url) || state.recentChannels.find(c => c.url === url);
            return existing || { name: 'Saved Channel', url: url, group: 'Favorite' };
        });

        renderChannels();
        updateStats();
    }

    /* --------------------------------------------------------------------------
       Sources Modal Checklist
       -------------------------------------------------------------------------- */
    function renderSourcesModalList() {
        if (!elements.sourcesListContainer) return;
        elements.sourcesListContainer.innerHTML = '';

        const allSources = [...DEFAULT_PLAYLIST_SOURCES, ...state.customSources];

        allSources.forEach((src, idx) => {
            const row = document.createElement('div');
            row.style.display = 'flex';
            row.style.alignItems = 'center';
            row.style.justifyContent = 'space-between';
            row.style.padding = '8px 12px';
            row.style.background = 'var(--bg-card)';
            row.style.borderRadius = 'var(--radius-sm)';
            row.style.border = '1px solid var(--border-subtle)';
            row.style.marginBottom = '6px';

            row.innerHTML = `
                <div style="overflow:hidden;">
                    <div style="font-weight:600;color:#fff;font-size:0.85rem;">${src.name}</div>
                    <div style="font-size:0.72rem;color:var(--text-muted);">${src.url}</div>
                </div>
                <span class="badge-pill" style="background:rgba(16,185,129,0.15);color:var(--accent-emerald);">Merged Active</span>
            `;
            elements.sourcesListContainer.appendChild(row);
        });
    }

    /* --------------------------------------------------------------------------
       BDIX & Local FTP Media Hub Manager
       -------------------------------------------------------------------------- */
    async function loadAndRenderBdixHub() {
        if (!state.bdixServers || state.bdixServers.length === 0) {
            try {
                const res = await fetch('./bdix_ftp_servers.json');
                if (res.ok) {
                    state.bdixServers = await res.json();
                }
            } catch (e) {
                console.warn('Could not load bdix_ftp_servers.json:', e);
            }
        }
        renderBdixCards();
    }

    function renderBdixCards() {
        if (!elements.bdixCardsGrid) return;
        elements.bdixCardsGrid.innerHTML = '';

        const servers = state.bdixServers || [];
        const query = state.bdixSearchQuery || '';
        const cat = state.bdixActiveCategory || 'all';

        const filtered = servers.filter(s => {
            // Category check
            if (cat === 'lan' && s.tier !== 'lan') return false;
            if (cat === 'ftp' && s.category !== 'ftp') return false;
            if (cat === 'movies' && s.category !== 'movies') return false;
            if (cat === 'tv' && s.category !== 'tv') return false;

            // Search query check
            if (query) {
                const matchStr = `${s.name} ${s.url} ${s.description} ${s.category} ${s.speed}`.toLowerCase();
                if (!matchStr.includes(query)) return false;
            }
            return true;
        });

        if (elements.bdixCountLabel) {
            elements.bdixCountLabel.textContent = `Showing ${filtered.length} of ${servers.length} verified servers`;
        }

        if (filtered.length === 0) {
            elements.bdixCardsGrid.innerHTML = `
                <div style="grid-column: 1 / -1; text-align: center; padding: 24px; color: var(--text-muted);">
                    <p>No servers match your search filter.</p>
                </div>
            `;
            return;
        }

        filtered.forEach(srv => {
            const card = document.createElement('div');
            card.style.background = 'var(--bg-card)';
            card.style.border = '1px solid var(--border-subtle)';
            card.style.borderRadius = 'var(--radius-sm)';
            card.style.padding = '12px';
            card.style.display = 'flex';
            card.style.flexDirection = 'column';
            card.style.justifyContent = 'space-between';
            card.style.gap = '8px';
            card.style.transition = 'var(--transition-fast)';

            const isLan = srv.tier === 'lan';
            const tierBadgeColor = isLan ? 'var(--accent-emerald)' : 'var(--accent-cyan)';
            const tierBadgeBg = isLan ? 'rgba(16,185,129,0.15)' : 'rgba(0,210,255,0.15)';

            card.innerHTML = `
                <div>
                    <div style="display:flex;align-items:center;justify-content:space-between;gap:6px;margin-bottom:4px;">
                        <span style="font-weight:700;color:#fff;font-size:0.88rem;">${srv.name}</span>
                        <span style="font-size:0.65rem;background:${tierBadgeBg};color:${tierBadgeColor};padding:2px 6px;border-radius:4px;font-weight:700;white-space:nowrap;">
                            ${isLan ? '⚡ ' + srv.speed : '🌐 ' + srv.speed}
                        </span>
                    </div>
                    <div style="font-size:0.7rem;color:var(--text-muted);word-break:break-all;margin-bottom:6px;font-family:monospace;">
                        ${srv.url}
                    </div>
                    <p style="font-size:0.74rem;color:var(--text-secondary);line-height:1.4;margin:0;">
                        ${srv.description || ''}
                    </p>
                </div>
                <div style="display:flex;align-items:center;gap:6px;margin-top:4px;">
                    <a href="${srv.url}" target="_blank" rel="noopener noreferrer" class="action-btn" style="flex:1;text-decoration:none;font-size:0.72rem;padding:5px 8px;justify-content:center;background:rgba(0,210,255,0.1);color:var(--accent-cyan);border-color:rgba(0,210,255,0.3);">
                        Open Portal ↗
                    </a>
                    <button type="button" class="action-btn copy-url-btn" data-url="${srv.url}" style="font-size:0.72rem;padding:5px 8px;" title="Copy server URL">
                        📋 Copy
                    </button>
                </div>
            `;

            // Hover effect
            card.addEventListener('mouseenter', () => {
                card.style.borderColor = isLan ? 'rgba(16,185,129,0.5)' : 'rgba(0,210,255,0.5)';
                card.style.transform = 'translateY(-2px)';
            });
            card.addEventListener('mouseleave', () => {
                card.style.borderColor = 'var(--border-subtle)';
                card.style.transform = 'none';
            });

            // Copy button
            const copyBtn = card.querySelector('.copy-url-btn');
            copyBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                navigator.clipboard.writeText(srv.url).then(() => {
                    copyBtn.textContent = '✅ Copied!';
                    setTimeout(() => { copyBtn.textContent = '📋 Copy'; }, 1500);
                });
            });

            elements.bdixCardsGrid.appendChild(card);
        });
    }

    /* --------------------------------------------------------------------------
       Diagnostics & Stats Monitor
       -------------------------------------------------------------------------- */
    function startDiagnosticsTimer() {
        if (state.diagTimer) clearInterval(state.diagTimer);
        state.diagTimer = setInterval(() => {
            if (!state.diagnosticsOpen || !state.hlsInstance) return;

            const video = elements.video;
            if (elements.diagRes) {
                elements.diagRes.textContent = `${video.videoWidth || 0}x${video.videoHeight || 0}`;
            }

            if (elements.diagBuffer && video.buffered.length > 0) {
                const current = video.currentTime;
                const bufferEnd = video.buffered.end(video.buffered.length - 1);
                elements.diagBuffer.textContent = `${Math.max(0, bufferEnd - current).toFixed(1)}s`;
            }

            if (elements.diagDropped && video.getVideoPlaybackQuality) {
                const quality = video.getVideoPlaybackQuality();
                elements.diagDropped.textContent = quality.droppedVideoFrames;
            }

            if (elements.diagRoute) {
                elements.diagRoute.textContent = window.SmartProxyEngine ? window.SmartProxyEngine.CONFIG.currentMode : 'auto';
            }
        }, 1000);
    }

    /* --------------------------------------------------------------------------
       Event Listeners & Hotkeys
       -------------------------------------------------------------------------- */
    function setupEventListeners() {
        // Nav tabs switching
        document.querySelectorAll('.nav-tab-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const tab = btn.getAttribute('data-tab');
                if (!tab) return;

                document.querySelectorAll('.nav-tab-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                state.activeTab = tab;

                if (state.activeTab === 'custom') {
                    openModal(elements.customModal);
                    return;
                }

                renderFilterChips();
                applyFiltersAndRender();
            });
        });

        // Search Input
        elements.searchInput.addEventListener('input', (e) => {
            state.searchQuery = e.target.value;
            elements.searchClearBtn.style.display = state.searchQuery ? 'block' : 'none';
            applyFiltersAndRender();
        });

        elements.searchClearBtn.addEventListener('click', () => {
            elements.searchInput.value = '';
            state.searchQuery = '';
            elements.searchClearBtn.style.display = 'none';
            applyFiltersAndRender();
            elements.searchInput.focus();
        });

        // Hide Offline Toggle
        if (elements.hideOfflineToggle) {
            elements.hideOfflineToggle.checked = state.hideOffline;
            elements.hideOfflineToggle.addEventListener('change', (e) => {
                state.hideOffline = e.target.checked;
                applyFiltersAndRender();
            });
        }

        // View Mode Toggle (Grid vs List)
        document.getElementById('view-grid-btn').addEventListener('click', () => {
            state.viewMode = 'grid';
            document.getElementById('view-grid-btn').classList.add('active');
            document.getElementById('view-list-btn').classList.remove('active');
            localStorage.setItem('streampulse_view', 'grid');
            renderChannels();
        });

        document.getElementById('view-list-btn').addEventListener('click', () => {
            state.viewMode = 'list';
            document.getElementById('view-list-btn').classList.add('active');
            document.getElementById('view-grid-btn').classList.remove('active');
            localStorage.setItem('streampulse_view', 'list');
            renderChannels();
        });

        // Sources Modal triggers
        if (elements.openSourcesBtn) {
            elements.openSourcesBtn.addEventListener('click', () => {
                renderSourcesModalList();
                openModal(elements.sourcesModal);
            });
        }

        // Add Custom Source from Sources Modal
        const addCustomSourceBtn = document.getElementById('add-custom-source-btn');
        if (addCustomSourceBtn) {
            addCustomSourceBtn.addEventListener('click', () => {
                const nameInput = document.getElementById('new-source-name');
                const urlInput = document.getElementById('new-source-url');
                const name = nameInput.value.trim();
                const url = urlInput.value.trim();
                if (!url) return;

                const newSrc = {
                    id: 'custom_' + Date.now(),
                    name: name || 'Custom M3U Playlist',
                    url: url
                };

                state.customSources.push(newSrc);
                saveCustomSources();
                nameInput.value = '';
                urlInput.value = '';
                closeModals();
                loadAndMergeAllSources();
            });
        }

        // Routing badge click -> Open routing modal
        elements.routingBadge.addEventListener('click', () => {
            openModal(elements.routingModal);
        });

        // Open Geo-Guide Modal
        if (elements.openGeoGuideBtn) {
            elements.openGeoGuideBtn.addEventListener('click', () => {
                openModal(elements.geoGuideModal);
            });
        }

        // Open BDIX & FTP Hub Modal
        if (elements.openBdixHubBtn) {
            elements.openBdixHubBtn.addEventListener('click', () => {
                loadAndRenderBdixHub();
                openModal(elements.bdixHubModal);
            });
        }

        // BDIX Search Input inside Modal
        if (elements.bdixSearchInput) {
            elements.bdixSearchInput.addEventListener('input', (e) => {
                state.bdixSearchQuery = e.target.value.toLowerCase().trim();
                renderBdixCards();
            });
        }

        // BDIX Category Filter Chips inside Modal
        document.querySelectorAll('#bdix-filter-chips [data-bdix-cat]').forEach(chip => {
            chip.addEventListener('click', () => {
                document.querySelectorAll('#bdix-filter-chips [data-bdix-cat]').forEach(c => c.classList.remove('active'));
                chip.classList.add('active');
                state.bdixActiveCategory = chip.getAttribute('data-bdix-cat');
                renderBdixCards();
            });
        });

        // Rescan FTV Channels Button
        if (elements.refreshFtvBtn) {
            elements.refreshFtvBtn.addEventListener('click', async () => {
                elements.refreshFtvBtn.disabled = true;
                const prevText = elements.refreshFtvBtn.textContent;
                elements.refreshFtvBtn.textContent = '⏳ Rescanning...';
                try {
                    await loadAndMergeAllSources();
                    elements.refreshFtvBtn.textContent = '✅ Rescanned!';
                } catch (e) {
                    console.error('Error rescanning FTV:', e);
                    elements.refreshFtvBtn.textContent = '❌ Error';
                }
                setTimeout(() => {
                    elements.refreshFtvBtn.disabled = false;
                    elements.refreshFtvBtn.textContent = prevText;
                }, 2000);
            });
        }

        // Player Actions
        elements.theaterBtn.addEventListener('click', () => {
            state.theaterMode = !state.theaterMode;
            elements.playerPane.classList.toggle('theater-mode', state.theaterMode);
            elements.theaterBtn.classList.toggle('active', state.theaterMode);
        });

        elements.fullscreenBtn.addEventListener('click', () => {
            const pane = elements.playerPane;
            if (document.fullscreenElement) {
                document.exitFullscreen();
            } else if (pane.requestFullscreen) {
                pane.requestFullscreen();
            }
        });

        elements.pipBtn.addEventListener('click', async () => {
            try {
                if (document.pictureInPictureElement) {
                    await document.exitPictureInPicture();
                } else if (elements.video.requestPictureInPicture) {
                    await elements.video.requestPictureInPicture();
                }
            } catch (e) {
                console.warn('PiP error:', e);
            }
        });

        elements.reloadBtn.addEventListener('click', () => {
            if (state.currentChannel) {
                playChannel(state.currentChannel, state.currentServerIndex);
            }
        });

        elements.popoutBtn.addEventListener('click', () => {
            if (state.currentChannel) {
                const targetUrl = state.currentChannel.url;
                window.open(targetUrl, '_blank', 'width=1280,height=720,toolbar=0,menubar=0');
            }
        });

        elements.favActiveBtn.addEventListener('click', () => {
            if (state.currentChannel) {
                toggleFavorite(state.currentChannel);
            }
        });

        elements.diagToggleBtn.addEventListener('click', () => {
            state.diagnosticsOpen = !state.diagnosticsOpen;
            elements.diagPanel.classList.toggle('open', state.diagnosticsOpen);
            elements.diagToggleBtn.classList.toggle('active', state.diagnosticsOpen);
        });

        // Custom Stream Save
        elements.saveCustomBtn.addEventListener('click', () => {
            const url = elements.customUrlInput.value.trim();
            const name = elements.customNameInput.value.trim() || 'Custom Stream';
            if (!url) return;

            const customChannel = { name, url, group: 'Custom Stream' };
            playChannel(customChannel);
            closeModals();
            elements.customUrlInput.value = '';
            elements.customNameInput.value = '';
        });

        // Global Keyboard Shortcuts
        document.addEventListener('keydown', (e) => {
            if (['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement.tagName)) {
                if (e.key === 'Escape') document.activeElement.blur();
                return;
            }

            if (e.key === '/') {
                e.preventDefault();
                elements.searchInput.focus();
            } else if (e.key === ' ' || e.key === 'k') {
                e.preventDefault();
                if (elements.video.paused) elements.video.play();
                else elements.video.pause();
            } else if (e.key === 'm') {
                elements.video.muted = !elements.video.muted;
            } else if (e.key === 'f') {
                elements.fullscreenBtn.click();
            } else if (e.key === 't') {
                elements.theaterBtn.click();
            } else if (e.key === 'r') {
                elements.reloadBtn.click();
            } else if (e.key === 'Escape') {
                closeModals();
            }
        });

        // Modal Close handlers
        document.querySelectorAll('.modal-close-btn, .modal-cancel-btn').forEach(btn => {
            btn.addEventListener('click', closeModals);
        });

        document.querySelectorAll('.modal-overlay').forEach(overlay => {
            overlay.addEventListener('click', (e) => {
                if (e.target === overlay) closeModals();
            });
        });

        // Routing Option Selection
        document.querySelectorAll('.routing-option-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const mode = btn.getAttribute('data-mode');
                state.routingMode = mode;
                if (window.SmartProxyEngine) {
                    window.SmartProxyEngine.CONFIG.currentMode = mode;
                }
                closeModals();
                if (state.currentChannel) {
                    playChannel(state.currentChannel, state.currentServerIndex);
                }
            });
        });
    }

    function openModal(modal) {
        if (modal) modal.classList.add('show');
    }

    function closeModals() {
        document.querySelectorAll('.modal-overlay').forEach(m => m.classList.remove('show'));
    }

    // Run when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
