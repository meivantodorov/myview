window.Indicators = window.Indicators || {};

window.Indicators.Volume = {
    id: "volume",
    name: "Volume",
    config: {
        upColor: 'rgba(14, 203, 129, 0.6)',
        downColor: 'rgba(246, 70, 93, 0.6)',
        maColor: '#3b82f6',
        maPeriod: 20,
        showMA: true
    },
    _history: [],
    
    init: function(chartInstance, candleSeries, config) {
        this._history = [];
        
        const volumeSeries = chartInstance.addHistogramSeries({
            priceFormat: { type: 'volume' },
            priceScaleId: 'volume-scale',
            color: config.upColor
        });

        chartInstance.priceScale('volume-scale').applyOptions({
            scaleMargins: { top: 0.8, bottom: 0 },
            borderVisible: true,
            visible: true,
        });

        let volumeMaSeries = null;
        if (config.showMA) {
            volumeMaSeries = chartInstance.addLineSeries({
                color: config.maColor,
                lineWidth: 2,
                priceScaleId: 'volume-scale',
                priceLineVisible: false,
                lastValueVisible: false,
            });
        }

        return { volumeSeries, volumeMaSeries };
    },
    
    update: function(seriesRefs, candle, config) {
        if (!seriesRefs.volumeSeries) return;
        
        const color = candle.close >= candle.open ? config.upColor : config.downColor;
        seriesRefs.volumeSeries.update({
            time: candle.time,
            value: candle.volume,
            color: color
        });

        if (config.showMA && seriesRefs.volumeMaSeries) {
            this._history.push(candle.volume);
            if (this._history.length > config.maPeriod) {
                this._history.shift();
            }

            if (this._history.length === config.maPeriod) {
                const sum = this._history.reduce((a, b) => a + b, 0);
                const maValue = sum / config.maPeriod;
                seriesRefs.volumeMaSeries.update({
                    time: candle.time,
                    value: maValue
                });
            }
        }
    },
    
    onConfigChange: function(chartInstance, seriesRefs, newConfig) {
        this._history = [];
        if (seriesRefs.volumeMaSeries) {
            chartInstance.removeSeries(seriesRefs.volumeMaSeries);
            seriesRefs.volumeMaSeries = null;
        }
        
        if (newConfig.showMA) {
            seriesRefs.volumeMaSeries = chartInstance.addLineSeries({
                color: newConfig.maColor,
                lineWidth: 2,
                priceScaleId: 'volume-scale',
                priceLineVisible: false,
                lastValueVisible: false,
            });
        }
    },
    
    destroy: function(chartInstance, seriesRefs) {
        if (seriesRefs.volumeSeries) {
            chartInstance.removeSeries(seriesRefs.volumeSeries);
        }
        if (seriesRefs.volumeMaSeries) {
            chartInstance.removeSeries(seriesRefs.volumeMaSeries);
        }
    }
};