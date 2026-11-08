// client/js/websocket.js

let dragging = null;

let wsSubscriptions = new Set();
let wsReconnectDelay = 1000;
let wsReconnectTimer = null;

function sendTabSubscription(tab) {
    if (!tab || !tab.registered || !wsConn || wsConn.readyState !== WebSocket.OPEN) return;
    const key = `${tab.symbol}:${tab.timeframe}`;
    if (wsSubscriptions.has(key)) return;
    wsConn.send(JSON.stringify({ symbol: tab.symbol, timeframe: tab.timeframe }));
    wsSubscriptions.add(key);
}

function subscribeTabToService(tab) {
    if (wsConn && wsConn.readyState === WebSocket.OPEN) sendTabSubscription(tab);
}

function sendAllTabSubscriptions() {
    appState.tabs.forEach(sendTabSubscription);
}

function initWebSocket() {
    if (wsConn && (wsConn.readyState === WebSocket.OPEN || wsConn.readyState === WebSocket.CONNECTING)) return;
    if (wsReconnectTimer) { clearTimeout(wsReconnectTimer); wsReconnectTimer = null; }
    try {
        wsConn = new WebSocket(CANDLE_SERVICE_WS_URL);
    } catch (e) {
        console.error('[Candle Service] WebSocket initialization failed', e);
        scheduleWebSocketReconnect();
        return;
    }

    wsConn.onopen = () => {
        console.info('[Candle Service] Client WebSocket connected');
        wsReconnectDelay = 1000;
        wsSubscriptions = new Set();
        sendAllTabSubscriptions();
    };

    wsConn.onmessage = (ev) => {
        try {
            const msg = JSON.parse(ev.data);
            if (msg.type === 'CONNECTED') { sendAllTabSubscriptions(); return; }
            if (msg.type === 'SUBSCRIBED') {
                console.info(`[Candle Service] Subscribed ${msg.symbol} ${msg.timeframe}`);
                return;
            }
            if (msg.type === 'ERROR') {
                console.warn('[Candle Service] WebSocket error:', msg.message);
                return;
            }
            if (msg.type === 'HISTORY_BURST') return; // HTTP paging is authoritative; WS is used for live updates.
            if (!['CANDLE_UPDATE', 'CANDLE_UPDATED'].includes(msg.type) || !msg.symbol || !msg.candle) return;

            const tab = appState.tabs.find(t => t.symbol === msg.symbol && t.timeframe === msg.timeframe);
            if (!tab) return;
            const normalized = normalizeServiceCandle(msg.candle);
            if (!normalized) return;
            applyServerCandle(tab, normalized);
            checkTabTPSL(tab, normalized.close);
            if (appState.activeTabId === tab.id) updateActiveTabUI();
            updateGlobalStats();
        } catch (e) {
            console.error('[Candle Service] Invalid WebSocket message', e);
        }
    };

    wsConn.onerror = (e) => console.warn('[Candle Service] WebSocket connection error', e);
    wsConn.onclose = () => {
        wsSubscriptions = new Set();
        scheduleWebSocketReconnect();
    };
}

function scheduleWebSocketReconnect() {
    if (wsReconnectTimer) return;
    const wait = wsReconnectDelay;
    wsReconnectDelay = Math.min(wsReconnectDelay * 2, 15000);
    wsReconnectTimer = setTimeout(() => {
        wsReconnectTimer = null;
        initWebSocket();
    }, wait);
}

function initDragAndDrop() {
    const chartEl = document.getElementById('chart');
    const chartWrap = document.getElementById('chartCanvas');
    const addLineBtn = document.getElementById('addLineBtn');

    chartWrap.addEventListener('mousemove', (e) => {
        if (dragging) return;
        const rect = chartEl.getBoundingClientRect();
        const y = e.clientY - rect.top;
        const x = e.clientX - rect.left;

        if (x < 0 || x > chartEl.clientWidth || y < 0 || y > chartEl.clientHeight) { addLineBtn.style.display = 'none'; return; }
        if (x > chartEl.clientWidth - 60) { addLineBtn.style.display = 'none'; return; }

        const price = candleSeries.coordinateToPrice(y);
        if (price !== null) {
            addLineBtn.style.display = 'flex';
            addLineBtn.style.left = (chartEl.clientWidth - 60) + 'px'; 
            addLineBtn.style.top = y + 'px';
            addLineBtn.dataset.price = price;
        }
    });

    chartWrap.addEventListener('mouseleave', () => { if (!dragging) addLineBtn.style.display = 'none'; });

    addLineBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const price = parseFloat(addLineBtn.dataset.price);
        if (!isNaN(price)) {
            const ref = createLine('custom', price, true);
            const tab = getActiveTab();
            if(tab) {
                if(!tab.customLines) tab.customLines = [];
                tab.customLines.push({ price, ref });
            }
        }
        addLineBtn.style.display = 'none';
    });

    chartWrap.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;
        const rect = chartEl.getBoundingClientRect();
        const y = e.clientY - rect.top;
        if (y < 0 || y > chartEl.clientHeight) return;
        const threshold = 6;

        const tab = getActiveTab();
        if (!tab) return;

        if (tab.position && tab.position.lines) {
            for (let type of ['tp', 'sl']) {
                const lineRef = tab.position.lines[type];
                if (!lineRef) continue;
                const lineY = candleSeries.priceToCoordinate(lineRef.options().price);
                if (lineY !== null && Math.abs(y - lineY) <= threshold) {
                    dragging = { type: 'position', subType: type, ref: lineRef };
                    chartEl.style.cursor = 'grabbing';
                    addLineBtn.style.display = 'none';
                    chartObj.applyOptions({ handleScroll: false, handleScale: false });
                    e.preventDefault();
                    return;
                }
            }
        }

        if (tab.customLines) {
            for (let h of tab.customLines) {
                const lineY = candleSeries.priceToCoordinate(h.price);
                if (lineY !== null && Math.abs(y - lineY) <= threshold) {
                    dragging = { type: 'custom', ref: h };
                    chartEl.style.cursor = 'grabbing';
                    addLineBtn.style.display = 'none';
                    chartObj.applyOptions({ handleScroll: false, handleScale: false });
                    e.preventDefault();
                    return;
                }
            }
        }
    });

    chartWrap.addEventListener('mousemove', (e) => {
        if (!dragging) return;
        const rect = chartEl.getBoundingClientRect();
        const y = e.clientY - rect.top;
        let newPrice = candleSeries.coordinateToPrice(y);
        if (newPrice === null) return;

        const tab = getActiveTab();
        if (!tab) return;

        if (dragging.type === 'position' && tab.position) {
            const pos = tab.position;
            const sub = dragging.subType;
            
            if (pos.side === 'buy') {
                if (sub === 'tp' && newPrice <= pos.entry) newPrice = pos.entry + 0.01;
                if (sub === 'sl' && newPrice >= pos.entry) newPrice = pos.entry - 0.01;
            } else {
                if (sub === 'tp' && newPrice >= pos.entry) newPrice = pos.entry - 0.01;
                if (sub === 'sl' && newPrice <= pos.entry) newPrice = pos.entry + 0.01;
            }

            pos[sub] = newPrice;
            candleSeries.removePriceLine(dragging.ref);
            
            const tpPct = Math.abs((pos.tp - pos.entry) / pos.entry) * 100;
            const slPct = Math.abs((pos.sl - pos.entry) / pos.entry) * 100;
            const tpBps = Math.max(1, Math.round(tpPct * 100));
            const slBps = Math.max(1, Math.round(slPct * 100));

            const titleStr = sub === 'tp' ? `TP +${tpBps} bps` : `SL -${slBps} bps`;
            
            dragging.ref = candleSeries.createPriceLine({
                price: newPrice,
                color: COLORS[sub],
                lineWidth: 2,
                lineStyle: LightweightCharts.LineStyle.Solid,
                axisLabelVisible: true,
                title: titleStr,
            });

            pos.lines[sub] = dragging.ref;
            updateActiveTabUI();
            updateBpsOverlay();
        } else if (dragging.type === 'custom') {
            const h = dragging.ref;
            candleSeries.removePriceLine(h.ref);
            h.price = newPrice;
            h.ref = createLine('custom', newPrice, true);
        }
    });

    document.addEventListener('mouseup', () => {
        if (dragging) {
            dragging = null;
            chartEl.style.cursor = 'crosshair';
            chartObj.applyOptions({ handleScroll: true, handleScale: true });
        }
    });

    chartEl.addEventListener('contextmenu', e => e.preventDefault());
}