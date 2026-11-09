// client/js/utils.js

async function checkServiceHealth() {
    const statusEl = document.getElementById('serviceStatus');
    if (!statusEl) return;
    statusEl.textContent = 'ÐŸÑ€Ð¾Ð²ÐµÑ€ÐºÐ° Ð½Ð° Candle Service...';
    statusEl.style.color = 'var(--yellow)';
    statusEl.style.borderColor = 'var(--yellow)';

    try {
        const response = await fetch(`${PYTHON_SERVICE_URL}/health/ready`, { cache: 'no-store' });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        if (data.status !== 'ready' || !data.database) throw new Error('Service/database not ready');
        const workers = Array.isArray(data.active_workers) ? data.active_workers.length : 0;
        statusEl.textContent = `âœ“ Candle Service Â· ${workers} workers`;
        statusEl.style.color = 'var(--green)';
        statusEl.style.borderColor = 'var(--green)';
    } catch (error) {
        statusEl.textContent = 'âœ• Candle Service Offline';
        statusEl.style.color = 'var(--red)';
        statusEl.style.borderColor = 'var(--red)';
        console.warn('[Candle Service] Health check failed:', error.message);
    }
}

async function copyDebugLog() {
    const tab = getActiveTab();
    const now = new Date().toISOString();
    
    // 1. Обща информация за приложението
    const appInfo = {
        timestamp: now,
        version: typeof VERSION !== 'undefined' ? VERSION : 'unknown',
        timezone_offset_sec: TIMEZONE_OFFSET_SECONDS,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        user_agent: navigator.userAgent.slice(0, 100),
        screen: `${window.innerWidth}x${window.innerHeight}`
    };
    
    // 2. WebSocket статус
    const wsStatus = {
        state: wsConn ? ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'][wsConn.readyState] || 'UNKNOWN' : 'NOT_CREATED',
        url: typeof CANDLE_SERVICE_WS_URL !== 'undefined' ? CANDLE_SERVICE_WS_URL : 'unknown'
    };
    
    // 3. Активен таб — пълни данни
    let activeTab = null;
    if (tab) {
        const candles = tab.rawCandles || [];
        const last5 = candles.slice(-5).map(c => ({
            time: new Date(c.time * 1000).toISOString(),
            o: c.open, h: c.high, l: c.low, c: c.close, v: c.volume
        }));
        
        // Gap check
        const tfSec = { '1m': 60, '5m': 300, '15m': 900, '30m': 1800, '1h': 3600, '4h': 14400, '1d': 86400, '1w': 604800 };
        const step = tfSec[tab.timeframe] || 60;
        const gaps = [];
        for (let i = 1; i < candles.length; i++) {
            const diff = candles[i].time - candles[i-1].time;
            if (diff > step) {
                gaps.push({
                    from: new Date(candles[i-1].time * 1000).toISOString(),
                    to: new Date(candles[i].time * 1000).toISOString(),
                    missing: (diff / step) - 1
                });
            }
        }
        
        activeTab = {
            id: tab.id,
            symbol: tab.symbol,
            timeframe: tab.timeframe,
            currentPrice: tab.currentPrice,
            loaded_candles: candles.length,
            oldest_time: candles[0] ? new Date(candles[0].time * 1000).toISOString() : null,
            newest_time: candles[candles.length - 1] ? new Date(candles[candles.length - 1].time * 1000).toISOString() : null,
            hasMore: tab.hasMore,
            loadingOlder: tab.loadingOlder,
            historyLoading: tab.historyLoading,
            historyRequestId: tab.historyRequestId,
            gaps_count: gaps.length,
            gaps: gaps.slice(0, 10),
            last_5_candles: last5,
            position: tab.position ? {
                side: tab.position.side,
                entry: tab.position.entry,
                tp: tab.position.tp,
                sl: tab.position.sl,
                sizeUSD: tab.position.sizeUSD
            } : null,
            history_trades: (tab.history || []).length
        };
    }
    
    // 4. Persisted данни от backend
    let backendStats = null;
    if (tab) {
        try {
            const res = await fetch(`${PYTHON_SERVICE_URL}/symbols/${encodeURIComponent(tab.symbol)}/stats`);
            if (res.ok) backendStats = await res.json();
        } catch (e) { backendStats = { error: e.message }; }
    }
    
    // 5. Всички табове
    const allTabs = appState.tabs.map(t => ({
        id: t.id,
        symbol: t.symbol,
        timeframe: t.timeframe,
        hasPosition: !!t.position,
        candles: (t.rawCandles || []).length
    }));
    
    // 6. Debug stats от панела
    const debugPanel = {
        dbgFetching: document.getElementById('dbgFetching')?.textContent || '',
        dbgPersisted: document.getElementById('dbgPersisted')?.textContent || '',
        dbgCandles: document.getElementById('dbgCandles')?.textContent || '',
        dbgLoadTime: document.getElementById('dbgLoadTime')?.textContent || ''
    };
    
    // 7. Пълен report
    const report = {
        app: appInfo,
        websocket: wsStatus,
        active_tab: activeTab,
        backend_stats: backendStats,
        debug_panel: debugPanel,
        all_tabs: allTabs,
        indicators: Object.keys(activeIndicators)
    };
    
    const str = JSON.stringify(report, null, 2);
    try {
        await navigator.clipboard.writeText(str);
        alert(`Debug логът е копиран! (${str.length} bytes)\n\nСъдържа: app info, WebSocket status, active tab с последни 5 свещи, gap check, backend stats, всички табове.`);
    } catch (e) {
        console.error('Clipboard write failed:', e);
        // Fallback: показваме в console
        console.log('=== DEBUG REPORT ===');
        console.log(report);
        alert('Clipboard недостъпен. Виж Console (F12) за пълния report.');
    }
}