// client/js/tabs.js

function getActiveTab() {
    return appState.tabs.find(t => t.id === appState.activeTabId);
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
    const newTab = { id: Date.now(), symbol, position: null, history: [], currentPrice: 0, customLines: [], timeframe: '1m', rawCandles: [], totalCandles: 0 };
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

    tab.timeframe = tf;
    document.querySelectorAll('.tf-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tf === tf);
    });

    Object.keys(activeIndicators).forEach(indId => {
        window.Indicators[indId].destroy(chartObj, activeIndicators[indId].refs);
        const ind = window.Indicators[indId];
        activeIndicators[indId].refs = ind.init(chartObj, candleSeries, activeIndicators[indId].config);
    });

    fetchHistoryAndRender(tab, false);
}

async function fetchHistoryAndRender(tab, isNewLoad = false) {
    const startTime = performance.now();
    try {
        const limit = 2000;
        const res = await fetch(`${PYTHON_SERVICE_URL}/api/history/${tab.symbol}?limit=${limit}`);

        if (res.ok) {
            const rawCandles = await res.json();

            if (rawCandles.length === 0) return;

            tab.rawCandles = rawCandles;
            tab.totalCandles = rawCandles.length;

            debugStats.loadedCandles = rawCandles.length;
            debugStats.totalBackendCandles = tab.totalCandles;
            debugStats.currentBatches = Math.ceil(rawCandles.length / 5000);
            debugStats.totalBatches = Math.ceil(tab.totalCandles / 5000);

            const aggregated = aggregateCandles(rawCandles, tab.timeframe);
            candleSeries.setData(aggregated);

            Object.keys(activeIndicators).forEach(indId => {
                const ind = window.Indicators[indId];
                const refs = activeIndicators[indId].refs;
                const cfg = activeIndicators[indId].config;

                if (refs.volumeSeries) refs.volumeSeries.setData([]);
                if (refs.volumeMaSeries) refs.volumeMaSeries.setData([]);
                if (refs.maSeries) refs.maSeries.setData([]);

                aggregated.forEach(c => ind.update(refs, c, cfg));
            });

            if (aggregated.length > 0) {
                tab.currentPrice = aggregated[aggregated.length - 1].close;
                document.getElementById('chartLivePrice').textContent = tab.currentPrice.toFixed(2) + ' USDT';

                const fixStart = performance.now();
                if (aggregated.length > 150) {
                    const lastIndex = aggregated.length - 1;
                    chartObj.timeScale().setVisibleLogicalRange({ from: lastIndex - 150, to: lastIndex });
                } else {
                    chartObj.timeScale().fitContent();
                }
                debugStats.lastGraphFixTime = (performance.now() - fixStart) / 1000;
            }
        }
    } catch (e) { console.error("Грешка при връзка със сървиза", e); }
    finally {
        debugStats.initialLoadTime = (performance.now() - startTime) / 1000;
        updateDebugPanel();
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