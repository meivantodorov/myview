// client/js/tabs.js

function getActiveTab() { 
    return appState.tabs.find(t => t.id === appState.activeTabId); 
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
    const newTab = { id: Date.now(), symbol, position: null, history: [], currentPrice: 0, customLines: [], timeframe: '1m' };
    appState.tabs.push(newTab);
    renderTabs();
    switchTab(newTab.id);
}

function closeTab(id, event) {
    if(event) event.stopPropagation();
    const tab = appState.tabs.find(t => t.id === id);
    if (tab.position && !confirm("Имате отворена позиция. Сигурни ли сте?")) return;
    if (tab.position) { appState.activeTabId = id; closePosition('Close Tab'); }
    appState.tabs = appState.tabs.filter(t => t.id !== id);
    if (appState.activeTabId === id) {
        if (appState.tabs.length > 0) switchTab(appState.tabs[appState.tabs.length - 1].id);
        else { appState.activeTabId = null; if (candleSeries) candleSeries.setData([]); document.getElementById('chartSymbolLabel').textContent = '—'; }
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

    await fetchHistoryAndRender(tab);

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
    }, 500);
}

function renderTabs() {
    const container = document.getElementById('tabsContainer');
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
    
    if (candleSeries) candleSeries.setData([]);
    
    Object.keys(activeIndicators).forEach(indId => {
        window.Indicators[indId].destroy(chartObj, activeIndicators[indId].refs);
        const ind = window.Indicators[indId];
        activeIndicators[indId].refs = ind.init(chartObj, candleSeries, activeIndicators[indId].config);
    });

    fetchHistoryAndRender(tab);
}

async function fetchHistoryAndRender(tab) {
    try {
        const res = await fetch(`${PYTHON_SERVICE_URL}/api/history/${tab.symbol}`);
        if (res.ok) {
            const rawCandles = await res.json();
            // ВЕЧЕ НЯМА OFFSET. Подаваме суровите данни.
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
            }
        }
    } catch (e) { console.error("Грешка при връзка със сървиза", e); }
}

function updateActiveTabUI() {
    const tab = getActiveTab();
    if (!tab) {
        document.getElementById('btnBuy').disabled = true;
        document.getElementById('btnSell').disabled = true;
        document.getElementById('btnClose').disabled = true;
        document.getElementById('positionInfo').innerHTML = '<div class="pos-row"><span class="lbl">Няма активен таб</span></div>';
        document.getElementById('dispRR').textContent = 'R = —';
        document.getElementById('dispTPDist').textContent = '—';
        document.getElementById('dispSLDist').textContent = '—';
        document.getElementById('historyList').innerHTML = '';
        return;
    }
    
    const isMaxed = appState.tabs.filter(t => t.position).length >= appState.maxPos;
    document.getElementById('btnBuy').disabled = !!tab.position || tab.currentPrice <= 0 || isMaxed;
    document.getElementById('btnSell').disabled = !!tab.position || tab.currentPrice <= 0 || isMaxed;
    document.getElementById('btnClose').disabled = !tab.position;

    const el = document.getElementById('positionInfo');
    const dispRR = document.getElementById('dispRR');
    const dispTPDist = document.getElementById('dispTPDist');
    const dispSLDist = document.getElementById('dispSLDist');
    
    if (!tab.position) {
        el.innerHTML = '<div class="pos-row"><span class="lbl">Няма отворена позиция</span></div>';
        dispRR.textContent = 'R = —';
        dispRR.style.color = 'var(--yellow)';
        dispTPDist.textContent = '—';
        dispSLDist.textContent = '—';
        renderHistory(tab);
        return;
    }
    
    const p = tab.position;
    const cur = tab.currentPrice;
    const upnl = p.side === 'buy' ? (cur - p.entry) * p.qty : (p.entry - cur) * p.qty;
    const cls = upnl >= 0 ? 'pos' : 'neg';
    const currentR = Math.abs(p.side === 'buy' ? (cur - p.entry) / p.entry : (p.entry - cur) / p.entry) / Math.abs((p.sl - p.entry) / p.entry);

    el.innerHTML = `
        <div class="pos-row"><span class="lbl">Посока / Размер</span><span class="val">${p.side === 'buy' ? 'Long' : 'Short'} ($${p.sizeUSD.toFixed(0)})</span></div>
        <div class="pos-row"><span class="lbl">Вход</span><span class="val" style="color:var(--blue)">${p.entry.toFixed(2)}</span></div>
        <div class="pos-row"><span class="lbl">uPnL</span><span class="val ${cls}">${upnl >= 0 ? '+' : ''}${upnl.toFixed(3)} USDT</span></div>
        <div class="pos-row"><span class="lbl">Текущ R</span><span class="val ${cls}">${currentR.toFixed(2)}</span></div>
    `;
    
    const tpPct = Math.abs((p.tp - p.entry) / p.entry) * 100;
    const slPct = Math.abs((p.sl - p.entry) / p.entry) * 100;
    
    dispTPDist.textContent = `${tpPct.toFixed(2)}% (${Math.round(tpPct * 100)} bps)`;
    dispSLDist.textContent = `${slPct.toFixed(2)}% (${Math.round(slPct * 100)} bps)`;

    const rMult = tpPct / slPct;
    dispRR.textContent = `R = ${rMult.toFixed(2)}`;
    dispRR.style.color = rMult >= 2 ? 'var(--green)' : rMult >= 1 ? 'var(--yellow)' : 'var(--red)';
    renderHistory(tab);
}

function addTabHistory(tab, text, pnlText = '', pnlCls = '', subText = '') {
    tab.history.unshift({ text, pnlText, pnlCls, subText });
    if (appState.activeTabId === tab.id) renderHistory(tab);
}

function renderHistory(tab) {
    const el = document.getElementById('historyList');
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