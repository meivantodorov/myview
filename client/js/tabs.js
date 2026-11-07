// client/js/tabs.js

function getActiveTab() {
    return appState.tabs.find(t => t.id === appState.activeTabId);
}

const TIMEFRAME_STORAGE_KEY = 'myview.timeframes.v1';
const VALID_TIMEFRAMES = ['1m', '5m', '15m', '30m', '1h', '4h', '1d', '1w'];

function readSavedTimeframes() {
    try {
        const saved = JSON.parse(localStorage.getItem(TIMEFRAME_STORAGE_KEY) || '{}');
        return saved && typeof saved === 'object' && !Array.isArray(saved) ? saved : {};
    } catch (_) {
        return {};
    }
}

function saveTabTimeframe(symbol, timeframe) {
    if (!VALID_TIMEFRAMES.includes(timeframe)) return;
    const saved = readSavedTimeframes();
    saved[String(symbol).toUpperCase()] = timeframe;
    try { localStorage.setItem(TIMEFRAME_STORAGE_KEY, JSON.stringify(saved)); } catch (_) {}
}

function getSavedTimeframe(symbol) {
    const saved = readSavedTimeframes();
    const value = saved[String(symbol).toUpperCase()];
    return VALID_TIMEFRAMES.includes(value) ? value : '1m';
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
    const sym = prompt("Въведи двойка (напр. ETHUSDT):");
    if (sym && sym.trim() !== "") createTab(sym.trim().toUpperCase());
}

function createTab(symbol) {
    if (appState.tabs.find(t => t.symbol === symbol)) {
        switchTab(appState.tabs.find(t => t.symbol === symbol).id);
        return;
    }
    const newTab = { id: Date.now(), symbol, position: null, history: [], currentPrice: 0, customLines: [], timeframe: getSavedTimeframe(symbol), rawCandles: [], totalCandles: 0, hasMore: true, oldestTime: null, loadingOlder: false, liveMinuteTime: null, liveBaseVolume: 0 };
    appState.tabs.push(newTab);
    renderTabs();
    switchTab(newTab.id);
}

function closeTab(id, event) {
    if (event) event.stopPropagation();
    const tab = appState.tabs.find(t => t.id === id);
    if (!tab) return;
    if (tab.position && !confirm("Имате отворена позиция. Сигурни ли сте?")) return;
    if (tab.position) { appState.activeTabId = id; closePosition('Close Tab'); }
    if (tab.historyRefreshTimer) clearInterval(tab.historyRefreshTimer);
    appState.tabs = appState.tabs.filter(t => t.id !== id);
    if (appState.activeTabId === id) {
        if (appState.tabs.length > 0) switchTab(appState.tabs[appState.tabs.length - 1].id);
        else {
            appState.activeTabId = null;
            if (candleSeries) candleSeries.setData([]);
            document.getElementById('chartSymbolLabel').textContent = '—';
        }
    }
    renderTabs();
    updateGlobalStats();
}

async function switchTab(id) {
    if (isSwitchingTab) return;
    isSwitchingTab = true;
    appState.activeTabId = id;
    renderTabs();

    const tab = getActiveTab();
    if (!tab) { isSwitchingTab = false; return; }

    document.getElementById('chartSymbolLabel').textContent = tab.symbol;
    document.getElementById('chartLivePrice').textContent = '—';

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
        el.innerHTML = `${t.symbol} ${t.position ? '🟢' : ''} <span class="close-btn" onclick="closeTab(${t.id}, event)">×</span>`;
        container.appendChild(el);
    });

    const addBtn = document.createElement('button');
    addBtn.className = 'tab-add-btn';
    addBtn.innerHTML = '+';
    addBtn.onclick = addTabPrompt;
    container.appendChild(addBtn);
}

function setTimeframe(tf) {
    const tab = getActiveTab();
    if (!tab) return;

    if (!VALID_TIMEFRAMES.includes(tf)) return;
    tab.timeframe = tf;
    saveTabTimeframe(tab.symbol, tf);
    document.querySelectorAll('.tf-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tf === tf);
    });

    Object.keys(activeIndicators).forEach(indId => {
        window.Indicators[indId].destroy(chartObj, activeIndicators[indId].refs);
        const ind = window.Indicators[indId];
        activeIndicators[indId].refs = ind.init(chartObj, candleSeries, activeIndicators[indId].config);
    });

    fetchHistoryAndRender(tab, true);
}

// Нова функция за ръчно центриране
function resetChartToLatest() {
    const tab = getActiveTab();
    if (!tab || !tab.rawCandles || !tab.rawCandles.length) return;
    const count = (tab.rawSeries || tab.rawCandles).length;
    chartObj.timeScale().setVisibleLogicalRange({ from: Math.max(0, count - 150), to: count + 10 });
}

const TF_SECONDS = { '1m': 60, '5m': 300, '15m': 900, '30m': 1800, '1h': 3600, '4h': 14400, '1d': 86400, '1w': 604800 };
const WEEK_OFFSET_SECONDS = 345600;   // Binance седмиците започват в понеделник, епохата - в четвъртък
const MAX_GAP_PLACEHOLDERS = 24;      // най-много празни места, показвани за един пропуск

function bucketStart(time, seconds) {
    const off = seconds === 604800 ? WEEK_OFFSET_SECONDS : 0;
    return Math.floor((time - off) / seconds) * seconds + off;
}

// lightweight-charts е индексна ос: без празни точки липсващите периоди се "слепват" и
// данни от различни години изглеждат като една непрекъсната история.
// Тук вмъкваме празни точки (само time) на мястото на липсващите свещи (с таван MAX_GAP_PLACEHOLDERS).
function withGaps(candles, seconds) {
    const out = [];
    for (let i = 0; i < candles.length; i++) {
        const c = candles[i];
        if (i > 0) {
            const missing = Math.round((c.time - candles[i - 1].time) / seconds) - 1;
            const n = Math.min(missing, MAX_GAP_PLACEHOLDERS);
            for (let k = 1; k <= n; k++) out.push({ time: candles[i - 1].time + k * seconds, gap: true });
        }
        out.push(c);
    }
    return out;
}

// Връща данните за графиката (с празни точки) и пази в tab.rawSeries същите точки със суров UTC час.
function chartDataFor(tab) {
    const seconds = TF_SECONDS[tab.timeframe] || 60;
    tab.rawSeries = withGaps(tab.rawCandles, seconds);
    return tab.rawSeries.map(c => c.gap
        ? { time: c.time + TIMEZONE_OFFSET_SECONDS }
        : { ...c, time: c.time + TIMEZONE_OFFSET_SECONDS });
}

function candlesSignature(candles) {
    // Последната свещ е жива (WebSocket) и не се сравнява.
    const n = candles.length - 1;
    if (n <= 0) return String(candles.length);
    let vol = 0;
    for (let i = 0; i < n; i++) vol += candles[i].volume;
    return `${n}|${candles[0].time}|${candles[n - 1].time}|${vol.toFixed(2)}`;
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
        data.forEach(c => { if (c.close !== undefined) ind.update(refs, c, cfg); });
    });
}

function findCandleIndexAtOrAfter(candles, timestamp) {
    let low = 0, high = candles.length;
    while (low < high) {
        const mid = (low + high) >> 1;
        if (candles[mid].time < timestamp) low = mid + 1;
        else high = mid;
    }
    return Math.min(low, Math.max(0, candles.length - 1));
}

function startHistoryRefresh(tab) {
    if (tab.historyRefreshTimer) clearInterval(tab.historyRefreshTimer);
    tab.historyRefreshTimer = setInterval(async () => {
        if (appState.activeTabId !== tab.id || isSwitchingTab || tab.loadingOlder || !candleSeries) return;
        try {
            const timeframe = tab.timeframe;
            const response = await fetch(`${PYTHON_SERVICE_URL}/api/history/${tab.symbol}?timeframe=${encodeURIComponent(timeframe)}&limit=1500`);
            if (!response.ok) return;
            const payload = await response.json();
            if (appState.activeTabId !== tab.id || timeframe !== tab.timeframe) return;

            const incoming = payload.candles || [];
            const old = tab.rawCandles || [];

            if (incoming.length) {
                // Сменяме само опашката: вече заредените по-стари страници се запазват.
                const firstIncoming = incoming[0].time;
                const keepOlder = old.filter(c => c.time < firstIncoming);
                const oldTail = old.filter(c => c.time >= firstIncoming);

                if (candlesSignature(incoming) !== candlesSignature(oldTail)) {
                    const range = chartObj.timeScale().getVisibleLogicalRange();
                    const oldSeries = tab.rawSeries || [];
                    let fromTime = null, toTime = null, fromFraction = 0, toFraction = 0;
                    if (range && oldSeries.length) {
                        const fromIndex = Math.max(0, Math.min(oldSeries.length - 1, Math.floor(range.from)));
                        const toIndex = Math.max(0, Math.min(oldSeries.length - 1, Math.floor(range.to)));
                        fromTime = oldSeries[fromIndex].time;
                        toTime = oldSeries[toIndex].time;
                        fromFraction = range.from - Math.floor(range.from);
                        toFraction = range.to - Math.floor(range.to);
                    }

                    tab.rawCandles = keepOlder.concat(incoming);
                    tab.oldestTime = tab.rawCandles[0].time;
                    if (!keepOlder.length) tab.hasMore = !!payload.has_more;
                    tab.totalCandles = Number(payload.total_candles || tab.rawCandles.length);
                    const renderStart = performance.now();
                    const chartData = chartDataFor(tab);
                    candleSeries.setData(chartData);
                    rebuildIndicators(chartData);
                    debugStats.lastGraphFixTime = (performance.now() - renderStart) / 1000;

                    if (range && fromTime !== null && toTime !== null) {
                        const fromIndex = findCandleIndexAtOrAfter(tab.rawSeries, fromTime);
                        const toIndex = findCandleIndexAtOrAfter(tab.rawSeries, toTime);
                        chartObj.timeScale().setVisibleLogicalRange({
                            from: fromIndex + fromFraction,
                            to: Math.max(fromIndex + fromFraction + 1, toIndex + toFraction)
                        });
                    }
                    debugStats.loadedCandles = tab.rawCandles.length;
                    debugStats.totalBackendCandles = tab.totalCandles;
                    debugStats.currentBatches = Math.ceil(tab.rawCandles.length / 1500);
                    debugStats.totalBatches = Math.max(debugStats.currentBatches, Math.ceil(tab.totalCandles / 1500));
                    updateDebugPanel();
                }
            }

            if (payload.backfill === 'complete') {
                clearInterval(tab.historyRefreshTimer);
                tab.historyRefreshTimer = null;
            }
        } catch (error) {
            console.warn('Background history refresh failed:', error);
        }
    }, 15000);
}

async function fetchHistoryAndRender(tab, isNewLoad = false) {
    const startTime = performance.now();
    try {
        const requestId = tab.historyRequestId = (tab.historyRequestId || 0) + 1;
        const requestedTimeframe = tab.timeframe;
        if (isNewLoad) {
            tab.rawCandles = [];
            tab.oldestTime = null;
            tab.hasMore = true;
            tab.loadingOlder = false;
            tab.liveMinuteTime = null;
            tab.liveBaseVolume = 0;
        }
        const res = await fetch(`${PYTHON_SERVICE_URL}/api/history/${tab.symbol}?timeframe=${encodeURIComponent(tab.timeframe)}&limit=1500`);
        if (!res.ok) throw new Error(`History HTTP ${res.status}`);
        const payload = await res.json();
        if (appState.activeTabId !== tab.id || requestId !== tab.historyRequestId || requestedTimeframe !== tab.timeframe) return;

        const rawCandles = payload.candles || [];
        if (!rawCandles.length) {
            tab.hasMore = !!payload.has_more;
            tab.totalCandles = Number(payload.total_candles || 0);
            return;
        }

        tab.rawCandles = rawCandles;
        tab.liveMinuteTime = null;
        tab.liveBaseVolume = 0;
        tab.oldestTime = payload.oldest_time;
        tab.hasMore = !!payload.has_more;
        tab.totalCandles = Number(payload.total_candles || rawCandles.length);

        const renderStart = performance.now();
        const chartData = chartDataFor(tab);
        candleSeries.setData(chartData);
        rebuildIndicators(chartData);
        debugStats.lastGraphFixTime = (performance.now() - renderStart) / 1000;

        debugStats.loadedCandles = rawCandles.length;
        debugStats.totalBackendCandles = tab.totalCandles;
        debugStats.currentBatches = 1;
        debugStats.totalBatches = Math.max(1, Math.ceil(tab.totalCandles / 1500));

        const last = chartData[chartData.length - 1];
        tab.currentPrice = last.close;
        const priceEl = document.getElementById('chartLivePrice');
        if (priceEl) priceEl.textContent = tab.currentPrice.toFixed(2) + ' USDT';

        if (isNewLoad) resetChartToLatest();
    } catch (e) {
        console.error('Грешка при зареждане на историята', e);
    } finally {
        debugStats.initialLoadTime = (performance.now() - startTime) / 1000;
        updateDebugPanel();
        if (appState.activeTabId === tab.id) startHistoryRefresh(tab);
    }
}


async function loadOlderCandles(tab) {
    if (!tab || !tab.hasMore || tab.loadingOlder || !tab.oldestTime || appState.activeTabId !== tab.id) return;
    tab.loadingOlder = true;
    const oldRange = chartObj.timeScale().getVisibleLogicalRange();
    const requestedTimeframe = tab.timeframe;
    try {
        const url = `${PYTHON_SERVICE_URL}/api/history/${tab.symbol}?timeframe=${encodeURIComponent(tab.timeframe)}&limit=1500&before=${tab.oldestTime}`;
        const res = await fetch(url);
        if (!res.ok) throw new Error(`Older history HTTP ${res.status}`);
        const payload = await res.json();
        if (appState.activeTabId !== tab.id || requestedTimeframe !== tab.timeframe || !payload.candles || !payload.candles.length) {
            tab.hasMore = false;
            return;
        }
        const existingFirst = tab.oldestTime;
        const older = payload.candles.filter(c => c.time < existingFirst);
        if (!older.length) {
            tab.hasMore = false;
            return;
        }
        const oldSeriesLength = (tab.rawSeries || tab.rawCandles).length;
        tab.rawCandles = older.concat(tab.rawCandles);
        tab.oldestTime = tab.rawCandles[0].time;
        tab.hasMore = !!payload.has_more;
        const renderStart = performance.now();
        const data = chartDataFor(tab);
        candleSeries.setData(data);
        rebuildIndicators(data);
        debugStats.lastGraphFixTime = (performance.now() - renderStart) / 1000;
        tab.totalCandles = Number(payload.total_candles || tab.totalCandles || tab.rawCandles.length);
        if (oldRange) {
            const shift = tab.rawSeries.length - oldSeriesLength;   // включва и празните точки
            chartObj.timeScale().setVisibleLogicalRange({ from: oldRange.from + shift, to: oldRange.to + shift });
        }
        debugStats.loadedCandles = tab.rawCandles.length;
        debugStats.totalBackendCandles = tab.totalCandles;
        debugStats.currentBatches = Math.ceil(tab.rawCandles.length / 1500);
        debugStats.totalBatches = Math.max(debugStats.currentBatches, Math.ceil(tab.totalCandles / 1500));
        updateDebugPanel();
    } catch (e) {
        console.error('Грешка при зареждане на по-стара история', e);
    } finally {
        tab.loadingOlder = false;
    }
}

function applyLiveCandle(tab, candle) {
    const seconds = TF_SECONDS[tab.timeframe] || 60;
    const bucket = bucketStart(candle.time, seconds);
    const bars = tab.rawCandles || (tab.rawCandles = []);
    let bar = bars.length ? bars[bars.length - 1] : null;

    if (seconds === 60) {
        if (bar && bar.time === candle.time) bars[bars.length - 1] = { ...candle };
        else { bars.push({ ...candle }); if (bars.length > 5000) bars.shift(); }
    } else {
        if (tab.liveMinuteTime !== candle.time) {
            tab.liveMinuteTime = candle.time;
            tab.liveBaseVolume = bar && bar.time === bucket ? bar.volume : 0;
        }
        if (bar && bar.time === bucket) {
            bars[bars.length - 1] = {
                time: bucket, open: bar.open,
                high: Math.max(bar.high, candle.high), low: Math.min(bar.low, candle.low),
                close: candle.close, volume: tab.liveBaseVolume + candle.volume
            };
        } else {
            bars.push({ time: bucket, open: candle.open, high: candle.high, low: candle.low, close: candle.close, volume: candle.volume });
            if (bars.length > 5000) bars.shift();
            tab.liveBaseVolume = 0;
        }
    }
    const latest = bars[bars.length - 1];
    const adjusted = { ...latest, time: latest.time + TIMEZONE_OFFSET_SECONDS };
    if (appState.activeTabId === tab.id && candleSeries) {
        candleSeries.update(adjusted);
        // Indicator history is rebuilt on historical loads; update the live point without a full history request.
        Object.keys(activeIndicators).forEach(id => {
            const refs = activeIndicators[id].refs;
            if (id === 'Volume' && refs.volumeSeries) {
                refs.volumeSeries.update({ time: adjusted.time, value: adjusted.volume, color: adjusted.close >= adjusted.open ? activeIndicators[id].config.upColor : activeIndicators[id].config.downColor });
            }
        });
    }
}

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
        if (positionInfo) positionInfo.innerHTML = '<div class="pos-row"><span class="lbl">Няма активен таб</span></div>';
        if (dispRR) { dispRR.textContent = 'R = —'; dispRR.style.color = 'var(--yellow)'; }
        if (dispTPDist) dispTPDist.textContent = '—';
        if (dispSLDist) dispSLDist.textContent = '—';
        if (historyList) historyList.innerHTML = '';
        return;
    }

    const isMaxed = appState.tabs.filter(t => t.position).length >= appState.maxPos;
    if (btnBuy) btnBuy.disabled = !!tab.position || tab.currentPrice <= 0 || isMaxed;
    if (btnSell) btnSell.disabled = !!tab.position || tab.currentPrice <= 0 || isMaxed;
    if (btnClose) btnClose.disabled = !tab.position;

    if (!tab.position) {
        if (positionInfo) positionInfo.innerHTML = '<div class="pos-row"><span class="lbl">Няма отворена позиция</span></div>';
        if (dispRR) { dispRR.textContent = 'R = —'; dispRR.style.color = 'var(--yellow)'; }
        if (dispTPDist) dispTPDist.textContent = '—';
        if (dispSLDist) dispSLDist.textContent = '—';
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
            <div class="pos-row"><span class="lbl">Посока / Размер</span><span class="val">${p.side === 'buy' ? 'Long' : 'Short'} ($${p.sizeUSD.toFixed(0)})</span></div>
            <div class="pos-row"><span class="lbl">Вход</span><span class="val" style="color:var(--blue)">${p.entry.toFixed(2)}</span></div>
            <div class="pos-row"><span class="lbl">uPnL</span><span class="val ${cls}">${upnl >= 0 ? '+' : ''}${upnl.toFixed(3)} USDT</span></div>
            <div class="pos-row"><span class="lbl">Текущ R</span><span class="val ${cls}">${currentR.toFixed(2)}</span></div>
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
