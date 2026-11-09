// client/js/state.js

const VERSION = "v9.2-docker"; // Binance Candle Service adapter + paged history
const PYTHON_SERVICE_URL = "/api";
const CANDLE_SERVICE_WS_URL = `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/ws`;
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

// НОВИ ПРОМЕНЛИВИ ЗА ДЕБЪГ ПАНЕЛА
let debugStats = {
    initialLoadTime: 0,
    lastGraphFixTime: 0,
    totalBatches: 0,
    currentBatches: 0,
    totalBackendCandles: 0,
    loadedCandles: 0
};