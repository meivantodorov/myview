// client/js/state.js

const VERSION = "v7.4"; // Вдигаме версията, защото правим промяна по Frontend-а
const PYTHON_SERVICE_URL = "http://127.0.0.1:8080";
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

let CLIENT_HASH = "UNKNOWN";
let BACKEND_HASH = "UNKNOWN";

// ТУК Е ПРОМЯНАТА: Binance връща UTC. За да покажем локално време, трябва да ИЗВАДИМ offset-а.
// getTimezoneOffset() връща минутите, с които локалното време изостава от UTC (напр. за UTC+2 връща -120).
// За да обърнем времето от UTC към локално, трябва да умножим по -60.
let TIMEZONE_OFFSET_SECONDS = -new Date().getTimezoneOffset() * 60;

let chartObj = null;
let candleSeries = null;
let wsConn = null;
let isSwitchingTab = false;
let activeIndicators = {}; 

let labelTPEl = null;
let labelSLEl = null;
let addLineBtn = null;