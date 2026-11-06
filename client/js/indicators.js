// client/js/indicators.js

const VOL_SETTINGS_KEY = 'volume_indicator_settings';

// Зареждане на настройките на Volume от localStorage
function loadVolumeSettings() {
    const saved = localStorage.getItem(VOL_SETTINGS_KEY);
    if (saved) {
        try {
            const parsed = JSON.parse(saved);
            if (window.Indicators.Volume) {
                window.Indicators.Volume.config = { ...window.Indicators.Volume.config, ...parsed };
            }
        } catch (e) {}
    }
    const cfg = window.Indicators.Volume.config;
    document.getElementById('volShowMA').checked = cfg.showMA;
    document.getElementById('volMAPeriod').value = cfg.maPeriod;
}

// Запазване на настройките на Volume
function saveVolumeSettings() {
    const showMA = document.getElementById('volShowMA').checked;
    const maPeriod = parseInt(document.getElementById('volMAPeriod').value) || 20;

    if (window.Indicators.Volume) {
        window.Indicators.Volume.config.showMA = showMA;
        window.Indicators.Volume.config.maPeriod = maPeriod;

        localStorage.setItem(VOL_SETTINGS_KEY, JSON.stringify({ showMA: showMA, maPeriod: maPeriod }));

        if (activeIndicators['Volume']) {
            const ind = window.Indicators.Volume;
            const refs = activeIndicators['Volume'].refs;
            ind.onConfigChange(chartObj, refs, ind.config);

            const tab = getActiveTab();
            if (tab) fetchHistoryAndRender(tab);
        }
    }
}

// Отваряне/затваряне на менюто с настройки
function toggleVolumeSettings(event) {
    event.stopPropagation();
    document.getElementById('volumeSettingsMenu').classList.toggle('open');
}

// Включване/изключване на индикатор
function toggleIndicator(indicatorId) {
    const ind = window.Indicators[indicatorId];
    if (!ind) return;

    const btn = document.getElementById(`btnToggle${indicatorId}`);

    if (activeIndicators[indicatorId]) {
        ind.destroy(chartObj, activeIndicators[indicatorId].refs);
        delete activeIndicators[indicatorId];
        btn.classList.remove('active');

        if (indicatorId === 'Volume') {
            candleSeries.priceScale().applyOptions({ scaleMargins: { top: 0, bottom: 0 } });
        }
    } else {
        if (indicatorId === 'Volume') {
            candleSeries.priceScale().applyOptions({ scaleMargins: { top: 0.2, bottom: 0 } });
        }
        const config = { ...ind.config };
        const refs = ind.init(chartObj, candleSeries, config);
        activeIndicators[indicatorId] = { refs, config };
        btn.classList.add('active');

        const tab = getActiveTab();
        if (tab && candleSeries) {
            fetchHistoryAndRender(tab);
        }
    }
}
