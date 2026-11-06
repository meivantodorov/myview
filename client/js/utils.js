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
    tagEl.innerHTML = "Изчисляване на хешове...";
    tagEl.style.color = 'var(--yellow)';
    tagEl.style.borderColor = 'var(--yellow)';

    CLIENT_HASH = await calculateClientHash();

    try {
        const res = await fetch(`${PYTHON_SERVICE_URL}/api/integrity`);
        if (res.ok) {
            const data = await res.json();
            BACKEND_HASH = data.hash;
        } else {
            BACKEND_HASH = "OFFLINE";
        }
    } catch (e) {
        BACKEND_HASH = "OFFLINE";
    }

    if (BACKEND_HASH === "OFFLINE") {
        tagEl.innerHTML = `❌ Backend Offline<br>Client: ${CLIENT_HASH.substring(0, 8)}...`;
        tagEl.style.color = 'var(--red)';
        tagEl.style.borderColor = 'var(--red)';
    } else {
        tagEl.innerHTML = `✅ ${VERSION}<br>C: ${CLIENT_HASH.substring(0, 8)}... | B: ${BACKEND_HASH.substring(0, 8)}...`;
        tagEl.style.color = 'var(--green)';
        tagEl.style.borderColor = 'var(--green)';
    }
}

function copyDebugLog() {
    const logData = {
        integrity: { client: CLIENT_HASH, backend: BACKEND_HASH, version: VERSION },
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