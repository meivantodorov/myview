import asyncio
import json
import os
import time
import hashlib
from datetime import datetime
from typing import Dict, List, Set

import aiohttp
import uvicorn
import websockets
from fastapi import FastAPI, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware

CONFIG_FILE = "config.json"
BACKEND_HASH = "UNKNOWN"

# ==================== ИЗЧИСЛЯВАНЕ НА ХЕШ ====================
def calculate_hash():
    """Изчислява SHA-256 хеш на main.py и requirements.txt"""
    hash_sha256 = hashlib.sha256()
    files_to_hash = ["main.py", "requirements.txt"]

    for file_name in files_to_hash:
        try:
            # Нормализираме новите редове, за да не се разминава на Windows/Linux
            with open(file_name, "rb") as f:
                content = f.read().replace(b'\r\n', b'\n')
                hash_sha256.update(content)
        except FileNotFoundError:
            pass

    return hash_sha256.hexdigest()

# ==================== СЪСТОЯНИЕ ====================
state = {
    "config": {},
    "candles": {},
    "connections": {},
    "logs": [],
    "start_time": time.time(),
    "ws_reconnect_count": 0,
    "last_message_time": None,
    "clients": set()
}

def log_event(msg: str, level: str = "INFO"):
    timestamp = datetime.now().strftime("%H:%M:%S")
    log_line = f"[{timestamp}] [{level}] {msg}"
    state["logs"].insert(0, log_line)
    if len(state["logs"]) > 200:
        state["logs"] = state["logs"][:200]

    try:
        print(log_line)
    except UnicodeEncodeError:
        print(log_line.encode('ascii', 'ignore').decode('ascii'))

def load_config():
    if not os.path.exists(CONFIG_FILE):
        default_cfg = {"symbols": ["BTCUSDT", "ETHUSDT", "SOLUSDT"], "history_limit": 1000, "ws_retry_delay": 5}
        with open(CONFIG_FILE, "w", encoding="utf-8") as f:
            json.dump(default_cfg, f, indent=2)

    with open(CONFIG_FILE, "r", encoding="utf-8") as f:
        state["config"] = json.load(f)

    log_event(f"Конфигурация заредена: {len(state['config'].get('symbols', []))} двойки.")

# ==================== BINANCE DATA FETCHING ====================
async def fetch_history(session: aiohttp.ClientSession, symbol: str, limit: int = 1000):
    url = f"https://api.binance.com/api/v3/klines?symbol={symbol}&interval=1m&limit={limit}"
    try:
        async with session.get(url) as response:
            if response.status == 200:
                data = await response.json()
                candles = []
                for k in data:
                    candles.append({
                        "time": k[0] // 1000,
                        "open": float(k[1]),
                        "high": float(k[2]),
                        "low": float(k[3]),
                        "close": float(k[4]),
                        "volume": float(k[5])
                    })
                state["candles"][symbol] = candles
                log_event(f"Успешно изтеглени {len(candles)} свещи за {symbol}.")
                return True
            else:
                log_event(f"Грешка при дърпане на история за {symbol}: {response.status}", "ERROR")
    except Exception as e:
        log_event(f"Изключение при дърпане на история за {symbol}: {e}", "ERROR")
    return False

async def init_history():
    async with aiohttp.ClientSession() as session:
        tasks = []
        for sym in state["config"]["symbols"]:
            state["candles"][sym] = []
            tasks.append(fetch_history(session, sym, state["config"].get("history_limit", 1000)))
        if tasks:
            await asyncio.gather(*tasks)

# ==================== WEBSOCKET MANAGER ====================
class BinanceWSManager:
    def __init__(self):
        self.ws = None
        self.running = True

    async def start(self):
        while self.running:
            symbols = state["config"].get("symbols", [])
            if not symbols:
                await asyncio.sleep(2)
                continue

            stream_names = "/".join([f"{s.lower()}@kline_1m" for s in symbols])
            uri = f"wss://stream.binance.com:9443/stream?streams={stream_names}"

            try:
                log_event(f"Свързване към Binance WS за {len(symbols)} двойки...")
                async with websockets.connect(uri) as ws:
                    self.ws = ws
                    for s in symbols:
                        state["connections"][s] = True
                    log_event("WebSocket връзката е установена.", "SUCCESS")

                    async for message in ws:
                        state["last_message_time"] = time.time()
                        data = json.loads(message)
                        if "data" in data and "k" in data["data"]:
                            k = data["data"]["k"]
                            symbol = k["s"]
                            candle = {
                                "time": k["t"] // 1000,
                                "open": float(k["o"]),
                                "high": float(k["h"]),
                                "low": float(k["l"]),
                                "close": float(k["c"]),
                                "volume": float(k["v"])
                            }

                            if symbol in state["candles"]:
                                if state["candles"][symbol]:
                                    last = state["candles"][symbol][-1]
                                    if last["time"] == candle["time"]:
                                        state["candles"][symbol][-1] = candle
                                    else:
                                        state["candles"][symbol].append(candle)
                                        if len(state["candles"][symbol]) > state["config"].get("history_limit", 1000):
                                            state["candles"][symbol].pop(0)
                                else:
                                    state["candles"][symbol].append(candle)

                            msg_to_send = json.dumps({"symbol": symbol, "candle": candle})
                            for client in list(state["clients"]):
                                try:
                                    await client.send_text(msg_to_send)
                                except:
                                    state["clients"].discard(client)

            except Exception as e:
                log_event(f"WS връзката прекъсна: {e}", "WARN")
                state["ws_reconnect_count"] += 1
                for s in state["config"].get("symbols", []):
                    state["connections"][s] = False

            await asyncio.sleep(state["config"].get("ws_retry_delay", 5))

ws_manager = BinanceWSManager()

# ==================== FASTAPI SETUP ====================
app = FastAPI(title="Binance Data Service")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.on_event("startup")
async def startup_event():
    global BACKEND_HASH
    BACKEND_HASH = calculate_hash()
    log_event(f"Стартиране на сървиза. SHA-256: {BACKEND_HASH[:16]}...")
    load_config()
    await init_history()
    asyncio.create_task(ws_manager.start())

@app.on_event("shutdown")
async def shutdown_event():
    ws_manager.running = False
    log_event("Сървизът се изключва...")

# ==================== API ENDPOINTS ====================
@app.get("/api/history/{symbol}")
async def get_history(symbol: str):
    symbol = symbol.upper()
    if symbol not in state["candles"]:
        return JSONResponse(status_code=404, content={"error": "Symbol not found"})
    return state["candles"][symbol]

@app.get("/api/integrity")
async def get_integrity():
    return {"hash": BACKEND_HASH}

@app.websocket("/ws/stream")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    state["clients"].add(websocket)
    log_event(f"Нов клиент се свърза към WS стрийма. Общо: {len(state['clients'])}")

    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        state["clients"].discard(websocket)
        log_event(f"Клиент се разкачи. Останали: {len(state['clients'])}")
    except Exception as e:
        state["clients"].discard(websocket)
        log_event(f"Грешка с клиент: {e}", "ERROR")

# ==================== DIAGNOSTIC DASHBOARD ====================
@app.get("/", response_class=HTMLResponse)
async def dashboard():
    html_content = """
    <!DOCTYPE html>
    <html>
    <head>
        <title>Binance Service Diagnostics</title>
        <style>
            body { font-family: monospace; background: #0b0e11; color: #eaecef; padding: 20px; }
            h1, h2 { color: #f0b90b; }
            .card { background: #151a21; border: 1px solid #2a323d; padding: 15px; margin-bottom: 15px; border-radius: 8px; }
            .status-ok { color: #0ecb81; }
            .status-err { color: #f6465d; }
            .log-box { background: #1c232c; padding: 10px; height: 300px; overflow-y: auto; border-radius: 4px; white-space: pre-wrap; font-size: 12px; }
            button { background: #f0b90b; color: #000; border: none; padding: 8px 16px; cursor: pointer; font-weight: bold; border-radius: 4px; margin-bottom: 10px; }
            textarea { width: 100%; height: 150px; background: #1c232c; color: #eaecef; border: 1px solid #2a323d; border-radius: 4px; font-family: monospace; padding: 10px; margin-bottom: 10px; }
        </style>
    </head>
    <body>
        <h1>Binance Service Diagnostics</h1>

        <div class="card">
            <h2>Live Configuration</h2>
            <textarea id="configArea"></textarea>
            <button onclick="saveConfig()">Save Config</button>
            <span style="color:var(--muted);font-size:12px;margin-left:10px;">*За да се приложат нови двойки, рестартирайте сървиза.</span>
        </div>

        <div class="card">
            <h2>System Status</h2>
            <div id="statusDiv">Loading...</div>
        </div>

        <div class="card">
            <h2>Logs (Latest 200 lines)</h2>
            <button onclick="copyLogs()">📋 Copy Logs</button>
            <button onclick="refreshData()">🔄 Refresh</button>
            <div class="log-box" id="logBox">Loading...</div>
        </div>

        <script>
            async function refreshData() {
                try {
                    const res = await fetch('/api/diagnostics');
                    const data = await res.json();

                    if (document.activeElement !== document.getElementById('configArea')) {
                        document.getElementById('configArea').value = JSON.stringify(data.config, null, 2);
                    }

                    let statusHtml = `<div>Uptime: ${data.uptime}s</div>`;
                    statusHtml += `<div>Backend Hash: <span style="color:#f0b90b">${data.hash}</span></div>`;
                    statusHtml += `<div>Clients Connected: ${data.clients_count}</div>`;
                    statusHtml += `<div>Reconnects: ${data.ws_reconnect_count}</div>`;
                    statusHtml += `<div>Last WS Message: ${data.last_msg_ago}</div>`;
                    statusHtml += `<h3>Binance Connections:</h3>`;
                    for (const [sym, isConnected] of Object.entries(data.connections)) {
                        const cls = isConnected ? 'status-ok' : 'status-err';
                        statusHtml += `<div>${sym}: <span class="${cls}">${isConnected ? 'CONNECTED' : 'DISCONNECTED'}</span></div>`;
                    }
                    document.getElementById('statusDiv').innerHTML = statusHtml;
                    document.getElementById('logBox').textContent = data.logs.join('\\n');
                } catch (e) {
                    console.error(e);
                }
            }

            async function saveConfig() {
                const text = document.getElementById('configArea').value;
                try {
                    const json = JSON.parse(text);
                    const res = await fetch('/api/config', {
                        method: 'POST',
                        headers: {'Content-Type': 'application/json'},
                        body: JSON.stringify(json)
                    });
                    if (res.ok) alert('Config saved! Restart the service for major changes.');
                    else alert('Error saving config.');
                } catch (e) {
                    alert('Invalid JSON format: ' + e.message);
                }
            }

            function copyLogs() {
                const text = document.getElementById('logBox').textContent;
                navigator.clipboard.writeText(text).then(() => alert('Logs copied!'));
            }

            setInterval(refreshData, 2000);
            refreshData();
        </script>
    </body>
    </html>
    """
    return HTMLResponse(content=html_content)

@app.get("/api/diagnostics")
async def get_diagnostics():
    uptime = int(time.time() - state["start_time"])
    last_msg_ago = "N/A"
    if state["last_message_time"]:
        last_msg_ago = f"{int(time.time() - state['last_message_time'])}s ago"

    return {
        "config": state["config"],
        "connections": state["connections"],
        "logs": state["logs"],
        "uptime": uptime,
        "clients_count": len(state["clients"]),
        "ws_reconnect_count": state["ws_reconnect_count"],
        "last_msg_ago": last_msg_ago,
        "hash": BACKEND_HASH
    }

@app.post("/api/config")
async def update_config(new_config: dict):
    try:
        with open(CONFIG_FILE, "w", encoding="utf-8") as f:
            json.dump(new_config, f, indent=2)
        state["config"] = new_config
        log_event("Конфигурацията е обновена през Dashboard-а.", "WARN")
        return {"status": "ok"}
    except Exception as e:
        log_event(f"Грешка при запис на конфигурация: {e}", "ERROR")
        return JSONResponse(status_code=500, content={"error": str(e)})

# ==================== СТАРТИРАНЕ ====================
if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8080, http="h11")
