// client/js/trading.js

// Отваряне на позиция
function openPosition(side) {
    const tab = getActiveTab();
    if (!tab || tab.position || tab.currentPrice <= 0) return;

    const openCount = appState.tabs.filter(t => t.position !== null).length;
    if (openCount >= appState.maxPos) {
        alert(`Достигнахте максималния брой отворени позиции (${appState.maxPos}).`);
        return;
    }

    const posSizeUSD = appState.capital * (appState.posPct / 100);
    if (posSizeUSD > getFreeCapital()) {
        alert("Няма достатъчно свободен капитал.");
        return;
    }

    const qty = (posSizeUSD * (1 - FEE_RATE)) / tab.currentPrice;
    const tpPct = 0.0030;
    const slPct = 0.0010;

    let sl, tp;
    if (side === 'buy') {
        sl = tab.currentPrice * (1 - slPct);
        tp = tab.currentPrice * (1 + tpPct);
    } else {
        sl = tab.currentPrice * (1 + slPct);
        tp = tab.currentPrice * (1 - tpPct);
    }

    tab.position = {
        side, entry: tab.currentPrice, qty, sl, tp, sizeUSD: posSizeUSD, feeOpen: posSizeUSD * FEE_RATE,
        lines: {
            entry: createLine('entry', tab.currentPrice),
            tp: candleSeries.createPriceLine({ price: tp, color: COLORS.tp, lineWidth: 2, axisLabelVisible: true, title: `TP +30 bps` }),
            sl: candleSeries.createPriceLine({ price: sl, color: COLORS.sl, lineWidth: 2, axisLabelVisible: true, title: `SL -10 bps` })
        }
    };

    addTabHistory(tab, `Отвори ${side === 'buy' ? 'Long' : 'Short'} @ ${tab.currentPrice.toFixed(2)}`);
    updateActiveTabUI();
    updateGlobalStats();
    setTimeout(updateBpsOverlay, 50);
}

// Затваряне на позиция
function closePosition(reason) {
    const tab = getActiveTab();
    if (!tab || !tab.position) return;

    const p = tab.position;
    const exit = tab.currentPrice;

    let rawPnl = p.side === 'buy' ? (exit - p.entry) * p.qty : (p.entry - exit) * p.qty;
    const feeClose = (p.qty * exit) * FEE_RATE;
    const totalFees = p.feeOpen + feeClose;
    const netPnl = rawPnl - totalFees;

    appState.realizedPnl += netPnl;
    appState.capital += netPnl;

    if (p.lines) Object.values(p.lines).forEach(ref => { if (ref) candleSeries.removePriceLine(ref); });
    if(labelTPEl) labelTPEl.style.display = 'none';
    if(labelSLEl) labelSLEl.style.display = 'none';

    const pnlStr = netPnl >= 0 ? `+${netPnl.toFixed(3)}` : netPnl.toFixed(3);
    const cls = netPnl >= 0 ? 'pos' : 'neg';

    addTabHistory(tab, `Затвори (${reason}) @ ${exit.toFixed(2)}`, `Net: ${pnlStr}`, cls, `Gross: ${rawPnl.toFixed(3)} | Fees: -${totalFees.toFixed(3)}`);
    tab.position = null;
    updateActiveTabUI();
    updateGlobalStats();
}

// Проверка за TP/SL (извиква се при всяка нова цена)
function checkTabTPSL(tab, price) {
    const p = tab.position;
    if (!p) return;
    if (p.side === 'buy') {
        if (price <= p.sl) { appState.activeTabId = tab.id; closePosition('SL'); }
        else if (price >= p.tp) { appState.activeTabId = tab.id; closePosition('TP'); }
    } else {
        if (price >= p.sl) { appState.activeTabId = tab.id; closePosition('SL'); }
        else if (price <= p.tp) { appState.activeTabId = tab.id; closePosition('TP'); }
    }
}

// Изчисляване на свободен капитал
function getFreeCapital() {
    let inPos = 0;
    appState.tabs.forEach(t => { if (t.position) inPos += t.position.sizeUSD; });
    return appState.capital - inPos;
}

// Обновяване на глобалните статистики (Balance и Unrealized PnL)
function updateGlobalStats() {
    let inPos = 0;
    let globalUpnl = 0;

    appState.tabs.forEach(t => {
        if (t.position) {
            inPos += t.position.sizeUSD;
            const p = t.position;
            globalUpnl += p.side === 'buy' ? (t.currentPrice - p.entry) * p.qty : (p.entry - t.currentPrice) * p.qty;
        }
    });

    const freeCap = appState.capital - inPos;
    const totalBalance = freeCap + inPos + globalUpnl;

    document.getElementById('globalBalance').textContent = `$${totalBalance.toFixed(2)}`;
    const upnlEl = document.getElementById('globalUpnl');
    upnlEl.textContent = `${globalUpnl >= 0 ? '+' : ''}$${globalUpnl.toFixed(2)}`;
    upnlEl.className = `stat-val ${globalUpnl >= 0 ? 'pos' : 'neg'}`;
    upnlEl.style.color = globalUpnl >= 0 ? 'var(--green)' : 'var(--red)';
}

// Настройки (капитал, процент, макс позиции)
function updateSettings() {
    appState.capital = parseFloat(document.getElementById('setCapital').value) || 500;
    appState.posPct = parseFloat(document.getElementById('setPosPct').value) || 10;
    appState.maxPos = parseInt(document.getElementById('setMaxPos').value) || 3;
    updateGlobalStats();
    updateActiveTabUI();
}

// Отваряне/затваряне на страничното меню
function toggleMenu() {
    document.getElementById('settingsSidebar').classList.toggle('open');
}
