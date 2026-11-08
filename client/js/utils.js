// client/js/utils.js

async function calculateClientHash() {
    try {
        const res = await fetch(window.location.href);
        const text = await res.text();
        const normalized = text.replace(/\r\n/g, '\n');
        const msgBuffer = new TextEncoder().encode(normalized);
        const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    } catch (e) {
        return "ERROR";
    }
}

async function checkIntegrity() {
    const tagEl = document.getElementById('integrityTag');
    if (!tagEl) return;
    tagEl.textContent = "Проверка на Candle Service...";
    tagEl.style.color = 'var(--yellow)';
    tagEl.style.borderColor = 'var(--yellow)';

    CLIENT_HASH = await calculateClientHash();
    try {
        const res = await fetch(`${PYTHON_SERVICE_URL}/health/ready`);
        if (!res.ok) throw new Error(`Health HTTP ${res.status}`);
        const data = await res.json();
        BACKEND_HASH = data.status || 'UNKNOWN';
        if (data.status !== 'ready' || !data.database) throw new Error('Service is not ready');
        const workers = Array.isArray(data.active_workers) ? data.active_workers.length : 0;
        tagEl.textContent = `✓ Candle Service Ready\n${workers} active workers`;
        tagEl.style.color = 'var(--green)';
        tagEl.style.borderColor = 'var(--green)';
    } catch (e) {
        BACKEND_HASH = 'OFFLINE';
        tagEl.textContent = `✕ Candle Service Offline\n${e.message}`;
        tagEl.style.color = 'var(--red)';
        tagEl.style.borderColor = 'var(--red)';
        console.error('[Candle Service] Health check failed', e);
    }
}

function copyDebugLog() {
    const logData = {
        integrity: { client: CLIENT_HASH, backend: BACKEND_HASH, version: VERSION, serviceUrl: PYTHON_SERVICE_URL, websocket: wsConn ? wsConn.readyState : 'not-created' },
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