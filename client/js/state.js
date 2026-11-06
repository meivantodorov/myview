// client/js/state.js

const VERSION = "v7.3";
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

// ТУК Е ПРОМЯНАТА: Взимаме отместването на локалната зона спрямо UTC
let TIMEZONE_OFFSET_SECONDS = new Date().getTimezoneOffset() * 60;

let chartObj = null;
let candleSeries = null;
let wsConn = null;
let isSwitchingTab = false;
let activeIndicators = {}; 

let labelTPEl = null;
let labelSLEl = null;
let addLineBtn = null;