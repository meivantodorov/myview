// client/js/utils.js

async function checkServiceHealth() {
    const statusEl = document.getElementById('serviceStatus');
    if (!statusEl) return;
    statusEl.textContent = 'Проверка на Candle Service...';
    statusEl.style.color = 'var(--yellow)';
    statusEl.style.borderColor = 'var(--yellow)';

    try {
        const response = await fetch(`${PYTHON_SERVICE_URL}/health/ready`, { cache: 'no-store' });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        if (data.status !== 'ready' || !data.database) throw new Error('Service/database not ready');
        const workers = Array.isArray(data.active_workers) ? data.active_workers.length : 0;
        statusEl.textContent = `✓ Candle Service · ${workers} workers`;
        statusEl.style.color = 'var(--green)';
        statusEl.style.borderColor = 'var(--green)';
    } catch (error) {
        statusEl.textContent = '✕ Candle Service Offline';
        statusEl.style.color = 'var(--red)';
        statusEl.style.borderColor = 'var(--red)';
        console.warn('[Candle Service] Health check failed:', error.message);
    }
}

function copyDebugLog() {
    const logData = {
        service: { version: VERSION, url: PYTHON_SERVICE_URL, websocketState: wsConn ? wsConn.readyState : 'not-created' },
        indicators: Object.keys(activeIndicators),
        volumeConfig: window.Indicators.Volume ? window.Indicators.Volume.config : null,
        appState: { capital: appState.capital, posPct: appState.posPct, maxPos: appState.maxPos, activeTabId: appState.activeTabId, realizedPnl: appState.realizedPnl },
        tabs: appState.tabs.map(t => ({
            id: t.id,
            symbol: t.symbol,
            currentPrice: t.currentPrice,
            timeframe: t.timeframe,
            loadedCandles: t.rawCandles ? t.rawCandles.length : 0,
            totalCandlesInBackend: t.totalCandles || 0,
            position: t.position ? { side: t.position.side, entry: t.position.entry, sl: t.position.sl, tp: t.position.tp, sizeUSD: t.position.sizeUSD } : null,
            history: t.history
        }))
    };
    const str = JSON.stringify(logData, null, 2);
    navigator.clipboard.writeText(str).then(() => alert("Debug логът е копиран!"));
}