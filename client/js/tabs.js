// client/js/tabs.js

function getActiveTab() {
    return appState.tabs.find(t => t.id === appState.activeTabId);
}

function savedTimeframeFor(symbol) {
    try {
        const value = localStorage.getItem(`myview.timeframe.${symbol}`);
        return ['1m', '5m', '15m', '30m', '1h', '4h', '1d', '1w'].includes(value) ? value : '1m';
    } catch (_) { return '1m'; }
}

function saveTimeframeFor(symbol, timeframe) {
    try { localStorage.setItem(`myview.timeframe.${symbol}`, timeframe); } catch (_) {}
}


const CANDLE_HISTORY_PAGE_SIZE = 5000;
const CANDLE_HISTORY_PREFETCH_PAGES = 2;
const CANDLE_CACHE_DB = 'binance-micro-terminal-cache';
const CANDLE_CACHE_STORE = 'histories';
const CANDLE_CACHE_MAX_CANDLES = 100000;
const candleCacheWriteTimers = new Map();
let candleCacheDbPromise = null;

// IndexedDB keeps large candle histories without blocking the UI or exhausting localStorage.
function openCandleCache() {
    if (!('indexedDB' in window)) return Promise.resolve(null);
    if (candleCacheDbPromise) return candleCacheDbPromise;
    candleCacheDbPromise = new Promise(resolve => {
        const request = indexedDB.open(CANDLE_CACHE_DB, 1);
        request.onupgradeneeded = () => {
            const db = request.result;
            if (!db.objectStoreNames.contains(CANDLE_CACHE_STORE)) db.createObjectStore(CANDLE_CACHE_STORE, { keyPath: 'key' });
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => { console.warn('[Cache] IndexedDB unavailable:', request.error); resolve(null); };
        request.onblocked = () => resolve(null);
    });
    return candleCacheDbPromise;
}

async function readCandleCache(symbol, timeframe) {
    const db = await openCandleCache();
    if (!db) return null;
    return new Promise(resolve => {
        try {
            const request = db.transaction(CANDLE_CACHE_STORE, 'readonly').objectStore(CANDLE_CACHE_STORE).get(`${symbol}|${timeframe}`);
            request.onsuccess = () => {
                const record = request.result;
                const candles = Array.isArray(record?.candles) ? record.candles.map(normalizeServiceCandle).filter(Boolean) : [];
                resolve(candles.length ? { candles, savedAt: record.savedAt || 0 } : null);
            };
            request.onerror = () => resolve(null);
        } catch (_) { resolve(null); }
    });
}

async function writeCandleCache(symbol, timeframe, sourceCandles) {
    const db = await openCandleCache();
    if (!db || !sourceCandles?.length) return;
    const candles = sourceCandles.slice(-CANDLE_CACHE_MAX_CANDLES);
    return new Promise(resolve => {
        try {
            const tx = db.transaction(CANDLE_CACHE_STORE, 'readwrite');
            tx.objectStore(CANDLE_CACHE_STORE).put({ key: `${symbol}|${timeframe}`, savedAt: Date.now(), candles });
            tx.oncomplete = () => resolve(true);
            tx.onerror = tx.onabort = () => resolve(false);
        } catch (_) { resolve(false); }
    });
}

async function clearCandleCache(symbol, timeframe) {
    const db = await openCandleCache();
    if (!db) return;
    return new Promise(resolve => {
        try {
            const tx = db.transaction(CANDLE_CACHE_STORE, 'readwrite');
            tx.objectStore(CANDLE_CACHE_STORE).delete(symbol + '|' + timeframe);
            tx.oncomplete = () => resolve(true);
            tx.onerror = tx.onabort = () => resolve(false);
        } catch (_) { resolve(false); }
    });
}

function scheduleCandleCacheSave(tab) {
    if (!tab?.rawCandles?.length) return;
    const symbol = tab.symbol;
    const timeframe = tab.timeframe;
    const snapshot = tab.rawCandles.slice(-CANDLE_CACHE_MAX_CANDLES);
    const key = `${symbol}|${timeframe}`;
    const oldTimer = candleCacheWriteTimers.get(key);
    if (oldTimer) clearTimeout(oldTimer);
    candleCacheWriteTimers.set(key, setTimeout(() => {
        candleCacheWriteTimers.delete(key);
        void writeCandleCache(symbol, timeframe, snapshot);
    }, 1200));
}

function candleServiceHeaders(extra = {}) {
    const headers = { ...extra };
    let key = CANDLE_SERVICE_API_KEY;
    try { key = localStorage.getItem('myview.candleServiceApiKey') || key; } catch (_) {}
    if (key) headers['X-API-Key'] = key;
    return headers;
}

async function candleServiceFetch(path, options = {}) {
    const headers = candleServiceHeaders(options.headers || {});
    return fetch(`${PYTHON_SERVICE_URL}${path}`, { ...options, headers });
}

function normalizeServiceCandle(c) {
    if (!c) return null;
    let time = Number(c.time);
    if (!Number.isFinite(time)) {
        const raw = c.open_time ?? c.openTime;
        time = typeof raw === 'number' ? raw : Date.parse(raw);
    }
    if (!Number.isFinite(time)) return null;
    if (time > 1e12) time = Math.floor(time / 1000);
    else time = Math.floor(time);
    const open = Number(c.open), high = Number(c.high), low = Number(c.low), close = Number(c.close);
    const volume = Number(c.volume ?? 0);
    if (![open, high, low, close].every(Number.isFinite)) return null;
    return { time, open, high, low, close, volume: Number.isFinite(volume) ? volume : 0 };
}

function mergeCandlesByTime(existing, incoming) {
    const byTime = new Map((existing || []).map(c => [c.time, c]));
    for (const c of incoming || []) byTime.set(c.time, c);
    return Array.from(byTime.values()).sort((a, b) => a.time - b.time);
}

const historyDelay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function ensureSymbolRegistered(tab) {
    if (tab.registered) return;
    if (tab.registrationPromise) return tab.registrationPromise;
    tab.registrationPromise = (async () => {
        const symbol = encodeURIComponent(tab.symbol);
        const check = await candleServiceFetch(`/symbols/${symbol}`);
        if (check.ok) {
            const info = await check.json();
            if (info.active) { tab.registered = true; return; }
        } else if (check.status !== 404) {
            throw new Error(`Symbol check failed: HTTP ${check.status} ${await check.text()}`);
        }
        const response = await candleServiceFetch('/symbols', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ symbol: tab.symbol })
        });
        if (!response.ok) throw new Error(`Symbol registration failed: HTTP ${response.status} ${await response.text()}`);
        tab.registered = true;
    })();
    try { await tab.registrationPromise; }
    finally { tab.registrationPromise = null; }
}

function updateDebugPanel() {
    const loadEl = document.getElementById('dbgLoadTime');
    const fixEl = document.getElementById('dbgFixTime');
    const batchEl = document.getElementById('dbgBatches');
    const candleEl = document.getElementById('dbgCandles');

    if (loadEl) loadEl.textContent = debugStats.initialLoadTime.toFixed(2) + 's';
    if (fixEl) fixEl.textContent = debugStats.lastGraphFixTime > 0 ? debugStats.lastGraphFixTime.toFixed(2) + 's' : 'Never';
    if (batchEl) batchEl.textContent = `${debugStats.currentBatches} / ${debugStats.totalBatches}`;
    if (candleEl) candleEl.textContent = `${debugStats.loadedCandles} / ${debugStats.totalBackendCandles}`;
}

function addTabPrompt() {
    const sym = prompt("Ð’ÑŠÐ²ÐµÐ´Ð¸ Ð´Ð²Ð¾Ð¹ÐºÐ° (Ð½Ð°Ð¿Ñ€. ETHUSDT):");
    if (sym && sym.trim() !== "") createTab(sym.trim().toUpperCase());
}

function createTab(symbol) {
    if (appState.tabs.find(t => t.symbol === symbol)) {
        switchTab(appState.tabs.find(t => t.symbol === symbol).id);
        return;
    }
    const newTab = { id: Date.now(), symbol, position: null, history: [], currentPrice: 0, customLines: [], timeframe: savedTimeframeFor(symbol), rawCandles: [], totalCandles: 0, hasMore: true, oldestTime: null, loadingOlder: false, liveMinuteTime: null, liveBaseVolume: 0, registered: false, registrationPromise: null };
    appState.tabs.push(newTab);
    if (typeof saveTabsToStorage === 'function') saveTabsToStorage();
    renderTabs();
    switchTab(newTab.id);
}

function closeTab(id, event) {
    if (event) event.stopPropagation();
    const tab = appState.tabs.find(t => t.id === id);
    if (!tab) return;
    if (tab.position && !confirm("Ð˜Ð¼Ð°Ñ‚Ðµ Ð¾Ñ‚Ð²Ð¾Ñ€ÐµÐ½Ð° Ð¿Ð¾Ð·Ð¸Ñ†Ð¸Ñ. Ð¡Ð¸Ð³ÑƒÑ€Ð½Ð¸ Ð»Ð¸ ÑÑ‚Ðµ?")) return;
    if (tab.position) { appState.activeTabId = id;
    if (typeof saveTabsToStorage === 'function') saveTabsToStorage(); closePosition('Close Tab'); }
    appState.tabs = appState.tabs.filter(t => t.id !== id);
    if (typeof saveTabsToStorage === 'function') saveTabsToStorage();
    if (appState.activeTabId === id) {
        if (appState.tabs.length > 0) switchTab(appState.tabs[appState.tabs.length - 1].id);
        else {
            appState.activeTabId = null;
            if (candleSeries) candleSeries.setData([]);
            document.getElementById('chartSymbolLabel').textContent = 'â€”';
        }
    }
    renderTabs();
    updateGlobalStats();
}

async function switchTab(id) {
    if (isSwitchingTab) return;
    isSwitchingTab = true;
    appState.activeTabId = id;
    if (typeof saveTabsToStorage === 'function') saveTabsToStorage();
    renderTabs();

    const tab = getActiveTab();
    if (!tab) { isSwitchingTab = false; return; }

    document.getElementById('chartSymbolLabel').textContent = tab.symbol;
    document.getElementById('chartLivePrice').textContent = 'â€”';

    document.querySelectorAll('.tf-btn').forEach(btn => btn.classList.toggle('active', btn.dataset.tf === tab.timeframe));

    Object.keys(activeIndicators).forEach(indId => window.Indicators[indId].destroy(chartObj, activeIndicators[indId].refs));

    if (candleSeries) {
        chartObj.removeSeries(candleSeries);
        candleSeries = null;
    }

    candleSeries = chartObj.addCandlestickSeries({ upColor: COLORS.tp, downColor: COLORS.sl, borderUpColor: COLORS.tp, borderDownColor: COLORS.sl, wickUpColor: COLORS.tp, wickDownColor: COLORS.sl });

    Object.keys(activeIndicators).forEach(indId => {
        const ind = window.Indicators[indId];
        const cfg = activeIndicators[indId].config;
        activeIndicators[indId].refs = ind.init(chartObj, candleSeries, cfg);
    });

    await fetchHistoryAndRender(tab, true);
    updateVisibilityPanel();

    setTimeout(() => {
        if (appState.activeTabId === tab.id && tab.position) {
            const p = tab.position;
            p.lines = {
                entry: createLine('entry', p.entry),
                tp: candleSeries.createPriceLine({ price: p.tp, color: COLORS.tp, lineWidth: 2, axisLabelVisible: true, title: `TP +30 bps` }),
                sl: candleSeries.createPriceLine({ price: p.sl, color: COLORS.sl, lineWidth: 2, axisLabelVisible: true, title: `SL -10 bps` })
            };
        }
        updateBpsOverlay();
        updateActiveTabUI();
        isSwitchingTab = false;
    }, 300);
}

function renderTabs() {
    const container = document.getElementById('tabsContainer');
    if (!container) return;
    container.innerHTML = '';

    appState.tabs.forEach(t => {
        const el = document.createElement('div');
        el.className = `tab ${t.id === appState.activeTabId ? 'active' : ''}`;
        el.onclick = () => switchTab(t.id);
        el.innerHTML = `${t.symbol} ${t.position ? 'ðŸŸ¢' : ''} <span class="close-btn" onclick="closeTab(${t.id}, event)">Ã—</span>`;
        container.appendChild(el);
    });

    const addBtn = document.createElement('button');
    addBtn.className = 'tab-add-btn';
    addBtn.innerHTML = '+';
    addBtn.onclick = addTabPrompt;
    container.appendChild(addBtn);
}

function saveTabsState() {
    if (typeof saveTabsToStorage === 'function') saveTabsToStorage();
}

async function setTimeframe(tf) {
    const tab = getActiveTab();
    if (!tab) return;
    if (!['1m', '5m', '15m', '30m', '1h', '4h', '1d', '1w'].includes(tf)) return;
    if (tab.timeframe === tf) return;

    tab.timeframe = tf;
    saveTimeframeFor(tab.symbol, tf);
    tab.rawCandles = [];
    tab.oldestTime = null;
    tab.hasMore = true;
    tab.totalCandles = 0;
    tab.historyRequestId = (tab.historyRequestId || 0) + 1;
    tab.loadingOlder = false;

    document.querySelectorAll('.tf-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tf === tf);
    });

    // Изчистваме кеша за новия timeframe
    void clearCandleCache(tab.symbol, tf);

    // Премахваме и създаваме нова серия
    if (candleSeries) {
        try { candleSeries.setData([]); } catch(_) {}
        try { chartObj.removeSeries(candleSeries); } catch(_) {}
        candleSeries = null;
    }
    candleSeries = chartObj.addCandlestickSeries({
        upColor: COLORS.tp, downColor: COLORS.sl,
        borderUpColor: COLORS.tp, borderDownColor: COLORS.sl,
        wickUpColor: COLORS.tp, wickDownColor: COLORS.sl
    });

    if (typeof resetWebSocketSubscriptions === 'function') {
        resetWebSocketSubscriptions();
    }

    Object.keys(activeIndicators).forEach(indId => {
        window.Indicators[indId].destroy(chartObj, activeIndicators[indId].refs);
        const ind = window.Indicators[indId];
        activeIndicators[indId].refs = ind.init(chartObj, candleSeries, activeIndicators[indId].config);
    });

    // Зареждаме новите данни
    await fetchHistoryAndRender(tab, true);
    updateVisibilityPanel();
}

// ÐÐ¾Ð²Ð° Ñ„ÑƒÐ½ÐºÑ†Ð¸Ñ Ð·Ð° Ñ€ÑŠÑ‡Ð½Ð¾ Ñ†ÐµÐ½Ñ‚Ñ€Ð¸Ñ€Ð°Ð½Ðµ
function resetChartToLatest() {
    const tab = getActiveTab();
    if (!tab || !tab.rawCandles || !tab.rawCandles.length) return;
    const count = tab.rawCandles.length;
    chartObj.timeScale().setVisibleLogicalRange({ from: Math.max(0, count - 150), to: count + 10 });
}

function chartDataFor(tab) {
    return tab.rawCandles.map(c => ({ ...c, time: c.time + TIMEZONE_OFFSET_SECONDS }));
}

function rebuildIndicators(data) {
    Object.keys(activeIndicators).forEach(indId => {
        const ind = window.Indicators[indId];
        const refs = activeIndicators[indId].refs;
        const cfg = activeIndicators[indId].config;
        if (refs.volumeSeries) refs.volumeSeries.setData([]);
        if (refs.volumeMaSeries) refs.volumeMaSeries.setData([]);
        if (refs.maSeries) refs.maSeries.setData([]);
        if (ind._history) ind._history = [];
        data.forEach(c => ind.update(refs, c, cfg));
    });
}

function renderCachedCandles(tab, candles, isNewLoad) {
    tab.rawCandles = mergeCandlesByTime([], candles);
    tab.oldestTime = tab.rawCandles[0]?.time ?? null;
    tab.hasMore = true;
    tab.totalCandles = tab.rawCandles.length;
    tab.liveMinuteTime = null;
    tab.liveBaseVolume = 0;
    const data = chartDataFor(tab);
    if (candleSeries && appState.activeTabId === tab.id) {
        candleSeries.setData(data);
        try { chartObj.timeScale().fitContent(); } catch(_) {}
        rebuildIndicators(data);
    }
    debugStats.loadedCandles = tab.rawCandles.length;
    debugStats.totalBackendCandles = tab.rawCandles.length;
    debugStats.currentBatches = Math.max(1, Math.ceil(tab.rawCandles.length / CANDLE_HISTORY_PAGE_SIZE));
    debugStats.totalBatches = 'âˆž';
    const last = data[data.length - 1];
    if (last) {
        tab.currentPrice = last.close;
        if (appState.activeTabId === tab.id) {
            const priceEl = document.getElementById('chartLivePrice');
            if (priceEl) priceEl.textContent = tab.currentPrice.toFixed(2) + ' USDT';
        }
    }
    if (isNewLoad && appState.activeTabId === tab.id) resetChartToLatest();
    if (appState.activeTabId === tab.id) updateActiveTabUI();
    updateDebugPanel();
}

async function fetchHistoryAndRender(tab, isNewLoad = false) {
    const started = performance.now();
    const requestId = tab.historyRequestId = (tab.historyRequestId || 0) + 1;
    const requestedTimeframe = tab.timeframe;
    tab.historyLoading = true;
    if (isNewLoad) tab.loadingOlder = false;

    // Paint the previously saved history first. The network refresh runs afterwards.
    try {
        const cached = await readCandleCache(tab.symbol, requestedTimeframe);
        if (appState.activeTabId !== tab.id || requestId !== tab.historyRequestId || requestedTimeframe !== tab.timeframe) return;
        if (cached?.candles?.length) {
            renderCachedCandles(tab, cached.candles, isNewLoad);
            tab.historyLoading = false;
            debugStats.initialLoadTime = (performance.now() - started) / 1000;
            updateDebugPanel();
            // A stale cache is intentionally displayed immediately; latest candles are reconciled in background.
            void refreshHistoryFromService(tab, requestId, requestedTimeframe, isNewLoad);
            return;
        }
    } catch (e) {
        console.warn('[Cache] Read failed; falling back to network:', e);
    }

    await refreshHistoryFromService(tab, requestId, requestedTimeframe, isNewLoad);
    if (requestId === tab.historyRequestId) {
        tab.historyLoading = false;
        debugStats.initialLoadTime = (performance.now() - started) / 1000;
        updateDebugPanel();
    }
}

async function refreshHistoryFromService(tab, requestId, requestedTimeframe, isNewLoad) {
    try {
        await ensureSymbolRegistered(tab);
        if (requestId !== tab.historyRequestId || requestedTimeframe !== tab.timeframe) return;
        if (typeof subscribeTabToService === 'function') subscribeTabToService(tab);

        let payload = null;
        for (let attempt = 0; attempt < 10; attempt++) {
            const res = await candleServiceFetch(`/candles/${encodeURIComponent(tab.symbol)}/latest?timeframe=${encodeURIComponent(requestedTimeframe)}&limit=${CANDLE_HISTORY_PAGE_SIZE}`);
            if (!res.ok) throw new Error(`History HTTP ${res.status}: ${await res.text()}`);
            payload = await res.json();
            if (payload.candles?.length) break;
            if (attempt < 9) await historyDelay(500);
            if (requestId !== tab.historyRequestId || requestedTimeframe !== tab.timeframe) return;
        }
        if (requestId !== tab.historyRequestId || requestedTimeframe !== tab.timeframe) return;

        const incoming = (payload?.candles || []).map(normalizeServiceCandle).filter(Boolean);
        if (!incoming.length) {
            console.warn(`[Candle Service] No ${requestedTimeframe} candles yet for ${tab.symbol}.`);
            return;
        }

        const previous = tab.rawCandles || [];
        const previousByTime = new Map(previous.map(c => [c.time, c]));
        let changed = previous.length === 0;
        for (const c of incoming) {
            const old = previousByTime.get(c.time);
            if (!old || old.open !== c.open || old.high !== c.high || old.low !== c.low || old.close !== c.close || old.volume !== c.volume) {
                changed = true;
                break;
            }
        }
        tab.rawCandles = mergeCandlesByTime(previous, incoming);
        tab.oldestTime = tab.rawCandles[0]?.time ?? null;
        tab.hasMore = true;
        tab.totalCandles = tab.rawCandles.length;

        if (changed && appState.activeTabId === tab.id && candleSeries) {
            const data = chartDataFor(tab);
            candleSeries.setData(data);
        try { chartObj.timeScale().fitContent(); } catch(_) {}
            rebuildIndicators(data);
        }
        const last = tab.rawCandles[tab.rawCandles.length - 1];
        if (last) {
            tab.currentPrice = last.close;
            if (appState.activeTabId === tab.id) {
                const priceEl = document.getElementById('chartLivePrice');
                if (priceEl) priceEl.textContent = tab.currentPrice.toFixed(2) + ' USDT';
                updateActiveTabUI();
            }
        }
        debugStats.loadedCandles = tab.rawCandles.length;
        debugStats.totalBackendCandles = Number(payload.count) || tab.rawCandles.length;
        debugStats.currentBatches = Math.max(1, Math.ceil(tab.rawCandles.length / CANDLE_HISTORY_PAGE_SIZE));
        debugStats.totalBatches = 'âˆž';
        scheduleCandleCacheSave(tab);
        updateDebugPanel();

        if (isNewLoad && appState.activeTabId === tab.id) {
            resetChartToLatest();
            // Cached history may already be present; still fetch older backend pages
            // so the left edge can extend without waiting for a manual scroll.
            void prefetchOlderHistory(tab, requestId, CANDLE_HISTORY_PREFETCH_PAGES);
        }
    } catch (e) {
        console.error(`[Candle Service] History refresh failed for ${tab.symbol} ${requestedTimeframe}`, e);
    }
}

async function prefetchOlderHistory(tab, requestId, pages) {
    for (let i = 0; i < pages; i++) {
        if (appState.activeTabId !== tab.id || requestId !== tab.historyRequestId || !tab.hasMore) return;
        const before = tab.rawCandles?.length || 0;
        await loadOlderCandles(tab, { prefetch: true });
        if ((tab.rawCandles?.length || 0) <= before) return;
    }
}

async function loadOlderCandles(tab, options = {}) {
    if (!tab || tab.hasMore === false || tab.loadingOlder || !tab.oldestTime || appState.activeTabId !== tab.id) return;
    tab.loadingOlder = true;
    const oldRange = chartObj.timeScale().getVisibleLogicalRange();
    const requestedTimeframe = tab.timeframe;
    const requestId = tab.historyRequestId || 0;
    const requestedOldest = tab.oldestTime;
    const started = performance.now();
    try {
        let older = [];
        // Backfill runs independently on the service. Retry briefly if the requested older page has not landed yet.
        for (let attempt = 0; attempt < 9; attempt++) {
            const visibleTo = new Date((requestedOldest - 1) * 1000).toISOString();
            const query = new URLSearchParams({
                timeframe: requestedTimeframe,
                limit: String(CANDLE_HISTORY_PAGE_SIZE),
                visible_to: visibleTo
            });
            const res = await candleServiceFetch(`/candles/${encodeURIComponent(tab.symbol)}?${query.toString()}`);
            if (!res.ok) throw new Error(`Older history HTTP ${res.status}: ${await res.text()}`);
            const payload = await res.json();
            older = (payload.candles || []).map(normalizeServiceCandle).filter(c => c && c.time < requestedOldest);
            if (older.length) break;
            if (appState.activeTabId !== tab.id || requestedTimeframe !== tab.timeframe || requestId !== (tab.historyRequestId || 0)) return;
            if (attempt < 8) await historyDelay(750);
        }
        if (appState.activeTabId !== tab.id || requestedTimeframe !== tab.timeframe || requestId !== (tab.historyRequestId || 0)) return;
        if (!older.length) {
            tab.hasMore = false;
            debugStats.lastGraphFixTime = (performance.now() - started) / 1000;
            updateDebugPanel();
            return;
        }

        const oldCount = tab.rawCandles.length;
        tab.rawCandles = mergeCandlesByTime(older, tab.rawCandles);
        const added = tab.rawCandles.length - oldCount;
        if (added <= 0) { tab.hasMore = false; return; }
        tab.oldestTime = tab.rawCandles[0].time;
        tab.totalCandles = tab.rawCandles.length;
        scheduleCandleCacheSave(tab);
        const data = chartDataFor(tab);
        if (candleSeries) candleSeries.setData(data);
        try { chartObj.timeScale().fitContent(); } catch(_) {}
        rebuildIndicators(data);
        if (oldRange) {
            chartObj.timeScale().setVisibleLogicalRange({ from: oldRange.from + added, to: oldRange.to + added });
        }
        debugStats.loadedCandles = tab.rawCandles.length;
        debugStats.totalBackendCandles = tab.rawCandles.length;
        debugStats.currentBatches = Math.ceil(tab.rawCandles.length / CANDLE_HISTORY_PAGE_SIZE);
        debugStats.totalBatches = 'âˆž';
        debugStats.lastGraphFixTime = (performance.now() - started) / 1000;
        updateDebugPanel();
    } catch (e) {
        console.error(`[Candle Service] Older history failed for ${tab.symbol} ${tab.timeframe}`, e);
    } finally {
        if (requestId === (tab.historyRequestId || 0)) tab.loadingOlder = false;
    }
}

function applyServerCandle(tab, incoming) {
    const candle = normalizeServiceCandle(incoming);
    if (!tab || !candle) return;
    const bars = tab.rawCandles || (tab.rawCandles = []);
    let low = 0, high = bars.length - 1, index = bars.length;
    while (low <= high) {
        const mid = (low + high) >> 1;
        if (bars[mid].time < candle.time) low = mid + 1;
        else { index = mid; high = mid - 1; }
    }
    const existed = index < bars.length && bars[index].time === candle.time;
    const wasLatest = existed && index === bars.length - 1;
    if (existed) bars[index] = candle;
    else if (index === bars.length) bars.push(candle);
    else if (candle.time >= (bars[0]?.time ?? candle.time)) bars.splice(index, 0, candle);
    else return; // Do not grow the in-memory chart with history older than the loaded window.

    tab.currentPrice = candle.close;
    scheduleCandleCacheSave(tab);
    if (appState.activeTabId === tab.id && candleSeries) {
        const adjusted = { ...candle, time: candle.time + TIMEZONE_OFFSET_SECONDS };
        if (index === bars.length - 1 || wasLatest) {
            candleSeries.update(adjusted);
            Object.keys(activeIndicators).forEach(id => {
                const ind = window.Indicators[id];
                if (ind && ind.update) ind.update(activeIndicators[id].refs, adjusted, activeIndicators[id].config);
            });
        } else {
            const data = chartDataFor(tab);
            candleSeries.setData(data);
        try { chartObj.timeScale().fitContent(); } catch(_) {}
            rebuildIndicators(data);
        }
        const priceEl = document.getElementById('chartLivePrice');
        if (priceEl) priceEl.textContent = tab.currentPrice.toFixed(2) + ' USDT';
        updateBpsOverlay();
    }
}

// Backward-compatible alias for any older client code still calling this function.
function applyLiveCandle(tab, candle) { applyServerCandle(tab, candle); }

function updateActiveTabUI() {
    const tab = getActiveTab();

    const btnBuy = document.getElementById('btnBuy');
    const btnSell = document.getElementById('btnSell');
    const btnClose = document.getElementById('btnClose');
    const positionInfo = document.getElementById('positionInfo');
    const dispRR = document.getElementById('dispRR');
    const dispTPDist = document.getElementById('dispTPDist');
    const dispSLDist = document.getElementById('dispSLDist');
    const historyList = document.getElementById('historyList');

    if (!tab) {
        if (btnBuy) btnBuy.disabled = true;
        if (btnSell) btnSell.disabled = true;
        if (btnClose) btnClose.disabled = true;
        if (positionInfo) positionInfo.innerHTML = '<div class="pos-row"><span class="lbl">ÐÑÐ¼Ð° Ð°ÐºÑ‚Ð¸Ð²ÐµÐ½ Ñ‚Ð°Ð±</span></div>';
        if (dispRR) { dispRR.textContent = 'R = â€”'; dispRR.style.color = 'var(--yellow)'; }
        if (dispTPDist) dispTPDist.textContent = 'â€”';
        if (dispSLDist) dispSLDist.textContent = 'â€”';
        if (historyList) historyList.innerHTML = '';
        return;
    }

    const isMaxed = appState.tabs.filter(t => t.position).length >= appState.maxPos;
    if (btnBuy) btnBuy.disabled = !!tab.position || tab.currentPrice <= 0 || isMaxed;
    if (btnSell) btnSell.disabled = !!tab.position || tab.currentPrice <= 0 || isMaxed;
    if (btnClose) btnClose.disabled = !tab.position;

    if (!tab.position) {
        if (positionInfo) positionInfo.innerHTML = '<div class="pos-row"><span class="lbl">ÐÑÐ¼Ð° Ð¾Ñ‚Ð²Ð¾Ñ€ÐµÐ½Ð° Ð¿Ð¾Ð·Ð¸Ñ†Ð¸Ñ</span></div>';
        if (dispRR) { dispRR.textContent = 'R = â€”'; dispRR.style.color = 'var(--yellow)'; }
        if (dispTPDist) dispTPDist.textContent = 'â€”';
        if (dispSLDist) dispSLDist.textContent = 'â€”';
        renderHistory(tab);
        return;
    }

    const p = tab.position;
    const cur = tab.currentPrice;
    const upnl = p.side === 'buy' ? (cur - p.entry) * p.qty : (p.entry - cur) * p.qty;
    const cls = upnl >= 0 ? 'pos' : 'neg';
    const currentR = Math.abs(p.side === 'buy' ? (cur - p.entry) / p.entry : (p.entry - cur) / p.entry) / Math.abs((p.sl - p.entry) / p.entry);

    if (positionInfo) {
        positionInfo.innerHTML = `
            <div class="pos-row"><span class="lbl">ÐŸÐ¾ÑÐ¾ÐºÐ° / Ð Ð°Ð·Ð¼ÐµÑ€</span><span class="val">${p.side === 'buy' ? 'Long' : 'Short'} ($${p.sizeUSD.toFixed(0)})</span></div>
            <div class="pos-row"><span class="lbl">Ð’Ñ…Ð¾Ð´</span><span class="val" style="color:var(--blue)">${p.entry.toFixed(2)}</span></div>
            <div class="pos-row"><span class="lbl">uPnL</span><span class="val ${cls}">${upnl >= 0 ? '+' : ''}${upnl.toFixed(3)} USDT</span></div>
            <div class="pos-row"><span class="lbl">Ð¢ÐµÐºÑƒÑ‰ R</span><span class="val ${cls}">${currentR.toFixed(2)}</span></div>
        `;
    }

    const tpPct = Math.abs((p.tp - p.entry) / p.entry) * 100;
    const slPct = Math.abs((p.sl - p.entry) / p.entry) * 100;

    if (dispTPDist) dispTPDist.textContent = `${tpPct.toFixed(2)}% (${Math.round(tpPct * 100)} bps)`;
    if (dispSLDist) dispSLDist.textContent = `${slPct.toFixed(2)}% (${Math.round(slPct * 100)} bps)`;

    const rMult = tpPct / slPct;
    if (dispRR) {
        dispRR.textContent = `R = ${rMult.toFixed(2)}`;
        dispRR.style.color = rMult >= 2 ? 'var(--green)' : rMult >= 1 ? 'var(--yellow)' : 'var(--red)';
    }
    renderHistory(tab);
}

function addTabHistory(tab, text, pnlText = '', pnlCls = '', subText = '') {
    tab.history.unshift({ text, pnlText, pnlCls, subText });
    if (appState.activeTabId === tab.id) renderHistory(tab);
}

function renderHistory(tab) {
    const el = document.getElementById('historyList');
    if (!el || !tab) return;
    el.innerHTML = tab.history.slice(0, 20).map(item => {
        return `<div class="history-item">
            <div>
                <span>${item.text}</span>
                ${item.subText ? `<span class="history-sub">${item.subText}</span>` : ''}
            </div>
            ${item.pnlText ? `<span class="pnl ${item.pnlCls}">${item.pnlText}</span>` : ''}
        </div>`;
    }).join('');
}


// ============================================================
// VISIBILITY PANEL
// ============================================================
let _statsPollTimer = null;
let _statsLastFetch = 0;

async function updateVisibilityPanel() {
    const tab = getActiveTab();
    if (!tab) return;

    // Loaded candles
    const loadedEl = document.getElementById('dbgCandles');
    if (loadedEl) {
        loadedEl.textContent = `${tab.rawCandles?.length || 0} / ${tab.rawCandles?.length || 0}`;
    }

    // Stats от backend (на всеки 5 секунди)
    const now = Date.now();
    if (now - _statsLastFetch < 5000) return;
    _statsLastFetch = now;

    try {
        const res = await fetch(`${PYTHON_SERVICE_URL}/symbols/${encodeURIComponent(tab.symbol)}/stats`);
        if (!res.ok) return;
        const stats = await res.json();

        // Fetching indicator
        const fetchingEl = document.getElementById('dbgFetching');
        if (fetchingEl) {
            if (stats.fetching) {
                fetchingEl.textContent = 'FETCHING: YES';
                fetchingEl.style.color = 'var(--yellow)';
            } else {
                fetchingEl.textContent = 'FETCHING: NO';
                fetchingEl.style.color = 'var(--green)';
            }
        }

        // Persisted candles
        const persistedEl = document.getElementById('dbgPersisted');
        if (persistedEl) {
            const count = stats.count_1m || 0;
            const countStr = count >= 1000000 ? `${(count / 1000000).toFixed(2)}M` : count >= 1000 ? `${(count / 1000).toFixed(1)}K` : String(count);
            const oldestStr = stats.oldest_1m ? new Date(stats.oldest_1m).toISOString().slice(0, 10) : '—';
            persistedEl.textContent = `${countStr} (${oldestStr})`;
        }
    } catch (e) {
        // Тихо — не искаме да спамим console
    }
}

// Стартираме polling на всеки 5 секунди
function startVisibilityPolling() {
    if (_statsPollTimer) return;
    _statsPollTimer = setInterval(updateVisibilityPanel, 5000);
}