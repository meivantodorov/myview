// client/js/main.js

window.addEventListener('DOMContentLoaded', () => {
    labelTPEl = document.getElementById('labelTP');
    labelSLEl = document.getElementById('labelSL');
    addLineBtn = document.getElementById('addLineBtn');

    loadVolumeSettings();

    document.addEventListener('click', () => {
        const menu = document.getElementById('volumeSettingsMenu');
        if(menu) menu.classList.remove('open');
    });

    initChart();
    initDragAndDrop();

    const saved = typeof loadTabsFromStorage === 'function' ? loadTabsFromStorage() : null;
    if (saved && saved.tabs && saved.tabs.length) {
        appState.tabs = saved.tabs.map(t => ({
            ...t,
            rawCandles: [],
            position: t.position || null,
            history: t.history || []
        }));
        appState.activeTabId = saved.activeId && appState.tabs.find(t => t.id === saved.activeId)
            ? saved.activeId
            : appState.tabs[0].id;
        renderTabs();
        switchTab(appState.activeTabId);
    } else {
        createTab('BTCUSDT');
    }

    initWebSocket();
    startVisibilityPolling();
    checkServiceHealth();
});