// client/js/chart.js

function initChart() {
    const chartEl = document.getElementById('chart');
    chartObj = LightweightCharts.createChart(chartEl, {
        layout: { background: { color: '#151a21' }, textColor: '#848e9c' },
        grid: { vertLines: { color: '#1c232c' }, horzLines: { color: '#1c232c' } },
        crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
        timeScale: { borderColor: '#2a323d', timeVisible: true, secondsVisible: true },
        rightPriceScale: { borderColor: '#2a323d' },
    });

    new ResizeObserver(() => {
        if (chartObj) {
            chartObj.applyOptions({ width: chartEl.clientWidth, height: chartEl.clientHeight });
            updateBpsOverlay();
        }
    }).observe(chartEl);

    setInterval(updateBpsOverlay, 100);
    chartObj.timeScale().subscribeVisibleLogicalRangeChange((range) => {
        if (!range) return;
        const tab = getActiveTab();
        if (tab && range.from < 300) loadOlderCandles(tab);
    });
}

function aggregateCandles(candles, timeframe) {
    if (!candles || candles.length === 0) return [];
    
    let aggregated = [];
    if (timeframe === '1m') {
        aggregated = candles.map(c => ({ ...c }));
    } else {
        const tfSeconds = { '5m': 300, '15m': 900, '30m': 1800, '1h': 3600, '4h': 14400, '1d': 86400, '1w': 604800 };
        const sec = tfSeconds[timeframe];
        if (!sec) return candles;

        let currentBucket = null;

        for (const c of candles) {
            const bucketTime = Math.floor(c.time / sec) * sec;
            
            if (!currentBucket || currentBucket.time !== bucketTime) {
                if (currentBucket) aggregated.push(currentBucket);
                currentBucket = { time: bucketTime, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume };
            } else {
                currentBucket.high = Math.max(currentBucket.high, c.high);
                currentBucket.low = Math.min(currentBucket.low, c.low);
                currentBucket.close = c.close;
                currentBucket.volume += c.volume;
            }
        }
        if (currentBucket) aggregated.push(currentBucket);
    }

    return aggregated.map(c => ({
        ...c,
        time: c.time + TIMEZONE_OFFSET_SECONDS
    }));
}

function updateBpsOverlay() {
    if (!labelTPEl || !labelSLEl) return;

    const tab = getActiveTab();
    if (!tab || !tab.position) {
        labelTPEl.style.display = 'none';
        labelSLEl.style.display = 'none';
        return;
    }

    const p = tab.position;
    const entryY = candleSeries.priceToCoordinate(p.entry);
    const tpY = candleSeries.priceToCoordinate(p.tp);
    const slY = candleSeries.priceToCoordinate(p.sl);

    if (entryY === null || tpY === null || slY === null) return;

    const midTPY = (entryY + tpY) / 2;
    const midSLY = (entryY + slY) / 2;

    const tpPct = Math.abs((p.tp - p.entry) / p.entry) * 100;
    const slPct = Math.abs((p.sl - p.entry) / p.entry) * 100;

    labelTPEl.textContent = `${Math.max(1, Math.round(tpPct * 100))} bps`;
    labelSLEl.textContent = `${Math.max(1, Math.round(slPct * 100))} bps`;

    labelTPEl.style.top = midTPY + 'px';
    labelSLEl.style.top = midSLY + 'px';

    labelTPEl.style.display = 'block';
    labelSLEl.style.display = 'block';
}

function createLine(type, price, isCustom = false) {
    return candleSeries.createPriceLine({
        price: price,
        color: isCustom ? COLORS.custom : COLORS[type],
        lineWidth: 2,
        lineStyle: LightweightCharts.LineStyle.Solid,
        axisLabelVisible: true,
        title: isCustom ? price.toFixed(2) : type.toUpperCase(),
    });
}
// ---------------------------------------------------------------------------
// Scroll-based pagination: when the user scrolls near the left edge, fetch
// older candles from the backend. Added automatically to fix missing pages.
// ---------------------------------------------------------------------------
(function () {
    if (typeof maybeLoadOlderHistory === 'function') return;

    let scrollLoadInFlight = false;

    window.maybeLoadOlderHistory = function maybeLoadOlderHistory() {
        if (scrollLoadInFlight) return;
        const tab = typeof getActiveTab === 'function' ? getActiveTab() : null;
        if (!tab || !tab.rawCandles || !tab.rawCandles.length) return;
        if (tab.hasMore === false || tab.loadingOlder) return;
        if (typeof chartObj === 'undefined' || !chartObj) return;

        const range = chartObj.timeScale().getVisibleLogicalRange();
        if (!range) return;

        // Trigger when fewer than 200 bars remain to the left of the viewport.
        const leftEdge = range.from;
        if (leftEdge > 200) return;

        scrollLoadInFlight = true;
        Promise.resolve(typeof loadOlderCandles === 'function' ? loadOlderCandles(tab, { prefetch: true }) : null)
            .catch(err => console.warn('[Scroll] loadOlderCandles failed', err))
            .finally(() => { scrollLoadInFlight = false; });
    };

    // Attach to chart if it already exists (initChart runs on DOMContentLoaded).
    function attach() {
        if (typeof chartObj === 'undefined' || !chartObj) { setTimeout(attach, 300); return; }
        try {
            chartObj.timeScale().subscribeVisibleLogicalRangeChange(() => {
                if (typeof window.maybeLoadOlderHistory === 'function') window.maybeLoadOlderHistory();
            });
            console.info('[Scroll] Pagination handler attached to chart');
        } catch (e) {
            console.warn('[Scroll] Failed to attach pagination handler', e);
        }
    }
    attach();
})();
