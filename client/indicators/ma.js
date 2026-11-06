window.Indicators = window.Indicators || {};

window.Indicators.MA = {
    id: "ma",
    name: "Moving Average",
    config: {
        period: 20,
        color: '#f0b90b'
    },
    _history: [],
    
    init: function(chartInstance, candleSeries, config) {
        this._history = [];
        const maSeries = chartInstance.addLineSeries({
            color: config.color,
            lineWidth: 2,
            priceLineVisible: false,
            lastValueVisible: false,
        });
        return { maSeries };
    },
    
    update: function(seriesRefs, candle, config) {
        if (!seriesRefs.maSeries) return;
        
        this._history.push(candle.close);
        if (this._history.length > config.period) {
            this._history.shift();
        }

        if (this._history.length === config.period) {
            const sum = this._history.reduce((a, b) => a + b, 0);
            const maValue = sum / config.period;
            seriesRefs.maSeries.update({
                time: candle.time,
                value: maValue
            });
        }
    },
    
    onConfigChange: function(seriesRefs, newConfig) {
        this._history = [];
        seriesRefs.maSeries.applyOptions({ color: newConfig.color });
    },
    
    destroy: function(chartInstance, seriesRefs) {
        if (seriesRefs.maSeries) {
            chartInstance.removeSeries(seriesRefs.maSeries);
        }
    }
};