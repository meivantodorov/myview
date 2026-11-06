// client/js/websocket.js

let dragging = null;

function initWebSocket() {
    if (wsConn) wsConn.close();
    wsConn = new WebSocket(`ws://127.0.0.1:8080/ws/stream`);
    
    wsConn.onopen = () => console.log("Свързан към Python WS Stream");
    
    wsConn.onmessage = (ev) => {
        try {
            if (isSwitchingTab) return;
            const msg = JSON.parse(ev.data);
            if (!msg.symbol || !msg.candle) return;
            
            const tab = appState.tabs.find(t => t.symbol === msg.symbol);
            if (!tab) return;

            // ТУК Е ПРОМЯНАТА: Добавяме отместването и към новите свещи в реално време
            const adjustedCandle = { ...msg.candle, time: msg.candle.time + TIMEZONE_OFFSET_SECONDS };
            tab.currentPrice = adjustedCandle.close;
            
            if (appState.activeTabId === tab.id && candleSeries) {
                if (tab.timeframe === '1m') {
                    candleSeries.update(adjustedCandle);
                    Object.keys(activeIndicators).forEach(indId => {
                        window.Indicators[indId].update(activeIndicators[indId].refs, adjustedCandle, activeIndicators[indId].config);
                    });
                } else {
                    fetchHistoryAndRender(tab); 
                }
                document.getElementById('chartLivePrice').textContent = adjustedCandle.close.toFixed(2) + ' USDT';
                updateBpsOverlay();
            }
            
            checkTabTPSL(tab, adjustedCandle.close);
            if (appState.activeTabId === tab.id) updateActiveTabUI();
            updateGlobalStats();
        } catch (e) { console.error(e); }
    };
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