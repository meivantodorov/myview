// client/js/state.js

const VERSION = "v9.1"; // Binance Candle Service adapter + paged history
const PYTHON_SERVICE_URL = "http://127.0.0.1:8000";
const CANDLE_SERVICE_WS_URL = "ws://127.0.0.1:8000/ws";
// Leave empty when API_KEY in the Candle Service .env is empty.
const CANDLE_SERVICE_API_KEY = "";
const FEE_RATE = 0.00075;

const COLORS = { 
    entry: '#3b82f6', 
    tp: '#0ecb81', 
    sl: '#f6465d', 
    custom: '#f0b90b' 
};

let appState = {
    capital: 500,
    posPct: 10,
    maxPos: 3,
    tabs: [],
    activeTabId: null,
    realizedPnl: 0,
};

let TIMEZONE_OFFSET_SECONDS = -new Date().getTimezoneOffset() * 60;

let chartObj = null;
let candleSeries = null;
let wsConn = null;
let isSwitchingTab = false;
let activeIndicators = {}; 

let labelTPEl = null;
let labelSLEl = null;
let addLineBtn = null;

// ÐÐžÐ’Ð˜ ÐŸÐ ÐžÐœÐ•ÐÐ›Ð˜Ð’Ð˜ Ð—Ð Ð”Ð•Ð‘ÐªÐ“ ÐŸÐÐÐ•Ð›Ð
let debugStats = {
    initialLoadTime: 0,
    lastGraphFixTime: 0,
    totalBatches: 0,
    currentBatches: 0,
    totalBackendCandles: 0,
    loadedCandles: 0
};
// ============================================================
// TAB PERSISTENCE
// ============================================================
const TABS_STORAGE_KEY = 'myview.tabs';
const ACTIVE_TAB_STORAGE_KEY = 'myview.activeTab';

function saveTabsToStorage() {
    try {
        const tabsToSave = appState.tabs.map(t => ({
            id: t.id,
            symbol: t.symbol,
            timeframe: t.timeframe,
            currentPrice: t.currentPrice,
            position: t.position ? { side: t.position.side, entry: t.position.entry, sl: t.position.sl, tp: t.position.tp, sizeUSD: t.position.sizeUSD } : null,
            history: t.history || []
        }));
        localStorage.setItem(TABS_STORAGE_KEY, JSON.stringify(tabsToSave));
        localStorage.setItem(ACTIVE_TAB_STORAGE_KEY, String(appState.activeTabId || ''));
    } catch (e) { console.warn('[Tabs] Failed to save', e); }
}

function loadTabsFromStorage() {
    try {
        const raw = localStorage.getItem(TABS_STORAGE_KEY);
        if (!raw) return null;
        const tabs = JSON.parse(raw);
        const activeId = localStorage.getItem(ACTIVE_TAB_STORAGE_KEY);
        return { tabs, activeId: activeId ? Number(activeId) : null };
    } catch (e) { console.warn('[Tabs] Failed to load', e); return null; }
}