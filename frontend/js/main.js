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
    createTab('BTCUSDT');
    initWebSocket();
    checkServiceHealth();
});