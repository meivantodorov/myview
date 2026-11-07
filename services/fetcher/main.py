import asyncio
import json
import os
import time
import hashlib
import sqlite3
from contextlib import contextmanager
from datetime import datetime
from typing import Dict, List

import aiohttp
import uvicorn
import websockets
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Query
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware

CONFIG_FILE = "config.json"
BACKEND_HASH = "UNKNOWN"
DATA_DIR = "data"
DB_PATH = os.path.join(DATA_DIR, "candles.sqlite3")
TIMEFRAMES = {"1m": 60, "5m": 300, "15m": 900, "30m": 1800, "1h": 3600, "4h": 14400, "1d": 86400, "1w": 604800}
# Binance седмиците започват в понеделник, а Unix епохата започва в четвъртък (разлика 4 дни).
WEEK_OFFSET = 345600


def bucket_offset(sec: int) -> int:
    return WEEK_OFFSET if sec == 604800 else 0


def bucket_of(ts: int, sec: int) -> int:
    off = bucket_offset(sec)
    return ((int(ts) - off) // sec) * sec + off


def calculate_hash():
    digest = hashlib.sha256()
    for name in ("main.py", "requirements.txt"):
        try:
            with open(name, "rb") as f:
                digest.update(f.read().replace(b"\r\n", b"\n"))
        except FileNotFoundError:
            pass
    return digest.hexdigest()


state = {
    "config": {}, "candles": {}, "connections": {}, "logs": [],
    "start_time": time.time(), "ws_reconnect_count": 0,
    "last_message_time": None, "clients": set(), "backfill": {}, "history_gaps": {}
}


def log_event(msg: str, level: str = "INFO"):
    line = f"[{datetime.now().strftime('%H:%M:%S')}] [{level}] {msg}"
    state["logs"].insert(0, line)
    state["logs"] = state["logs"][:200]
    try:
        print(line)
    except UnicodeEncodeError:
        print(line.encode("ascii", "ignore").decode("ascii"))


@contextmanager
def db_connect():
    os.makedirs(DATA_DIR, exist_ok=True)
    conn = sqlite3.connect(DB_PATH, timeout=30)
    try:
        conn.execute("PRAGMA synchronous=NORMAL")
        conn.execute("PRAGMA busy_timeout=30000")
        yield conn
        conn.commit()
    finally:
        conn.close()


def init_db():
    with db_connect() as conn:
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("CREATE TABLE IF NOT EXISTS candles (symbol TEXT NOT NULL, time INTEGER NOT NULL, open REAL NOT NULL, high REAL NOT NULL, low REAL NOT NULL, close REAL NOT NULL, volume REAL NOT NULL, PRIMARY KEY(symbol,time))")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_candles_symbol_time ON candles(symbol,time)")
        conn.execute("CREATE TABLE IF NOT EXISTS legacy_imports (symbol TEXT PRIMARY KEY, file_mtime_ns INTEGER NOT NULL, file_size INTEGER NOT NULL, imported_at INTEGER NOT NULL)")


def upsert_candles(symbol: str, candles: list):
    if not candles:
        return
    rows = [(symbol, int(c["time"]), float(c["open"]), float(c["high"]), float(c["low"]), float(c["close"]), float(c["volume"])) for c in candles]
    with db_connect() as conn:
        conn.executemany("INSERT INTO candles(symbol,time,open,high,low,close,volume) VALUES(?,?,?,?,?,?,?) ON CONFLICT(symbol,time) DO UPDATE SET open=excluded.open,high=excluded.high,low=excluded.low,close=excluded.close,volume=excluded.volume", rows)


def db_bounds(symbol: str):
    with db_connect() as conn:
        return conn.execute("SELECT MIN(time), MAX(time), COUNT(*) FROM candles WHERE symbol=?", (symbol,)).fetchone()


def find_history_gaps(symbol: str, limit: int = 10000):
    """Return missing 1m intervals between stored candles (timestamps are seconds)."""
    with db_connect() as conn:
        rows = conn.execute("""
            SELECT candle_time, next_time
            FROM (
                SELECT time AS candle_time,
                       LEAD(time) OVER (ORDER BY time) AS next_time
                FROM candles WHERE symbol=?
            )
            WHERE next_time IS NOT NULL AND next_time > candle_time + 60
            ORDER BY candle_time LIMIT ?
        """, (symbol, limit)).fetchall()
    return [(int(left), int(right)) for left, right in rows]


def count_history_gaps(symbol: str):
    with db_connect() as conn:
        row = conn.execute("""
            SELECT COUNT(*) FROM (
                SELECT time, LEAD(time) OVER (ORDER BY time) AS next_time
                FROM candles WHERE symbol=?
            ) WHERE next_time IS NOT NULL AND next_time > time + 60
        """, (symbol,)).fetchone()
    return int(row[0] or 0)


def read_latest(symbol: str, limit: int = 2500):
    with db_connect() as conn:
        rows = conn.execute("SELECT time,open,high,low,close,volume FROM candles WHERE symbol=? ORDER BY time DESC LIMIT ?", (symbol, limit)).fetchall()
    return [dict(zip(("time", "open", "high", "low", "close", "volume"), row)) for row in reversed(rows)]


def import_legacy_json(symbol: str):
    """Import the legacy JSON cache once, even when SQLite already has live rows.

    Older cache files use an object envelope: {"symbol": ..., "candles": [...]}.
    Some early versions also wrote a plain list. INSERT OR IGNORE preserves
    any newer rows already written by the live WebSocket.
    """
    path = os.path.join(DATA_DIR, f"{symbol}.json")
    if not os.path.isfile(path):
        return 0

    try:
        stat = os.stat(path)
        with db_connect() as conn:
            marker = conn.execute(
                "SELECT file_mtime_ns, file_size FROM legacy_imports WHERE symbol=?",
                (symbol,)
            ).fetchone()
            if marker == (stat.st_mtime_ns, stat.st_size):
                return 0

        with open(path, "r", encoding="utf-8") as f:
            payload = json.load(f)
        data = payload.get("candles", []) if isinstance(payload, dict) else payload
        if not isinstance(data, list):
            raise ValueError("Невалиден формат на legacy JSON: липсва списък candles")

        inserted = 0
        with db_connect() as conn:
            for i in range(0, len(data), 5000):
                batch = data[i:i + 5000]
                rows = [
                    (symbol, int(c["time"]), float(c["open"]), float(c["high"]),
                     float(c["low"]), float(c["close"]), float(c["volume"]))
                    for c in batch
                ]
                before = conn.total_changes
                conn.executemany(
                    "INSERT OR IGNORE INTO candles(symbol,time,open,high,low,close,volume) VALUES(?,?,?,?,?,?,?)",
                    rows
                )
                inserted += conn.total_changes - before
            conn.execute(
                "INSERT INTO legacy_imports(symbol,file_mtime_ns,file_size,imported_at) VALUES(?,?,?,?) "
                "ON CONFLICT(symbol) DO UPDATE SET file_mtime_ns=excluded.file_mtime_ns, "
                "file_size=excluded.file_size, imported_at=excluded.imported_at",
                (symbol, stat.st_mtime_ns, stat.st_size, int(time.time()))
            )
        return inserted
    except Exception as exc:
        log_event(f"Неуспешен импорт на стария кеш за {symbol}: {exc}", "ERROR")
        return 0


def load_config():
    if not os.path.exists(CONFIG_FILE):
        with open(CONFIG_FILE, "w", encoding="utf-8") as f:
            json.dump({"symbols": ["BTCUSDT", "ETHUSDT", "SOLUSDT"], "history_limit": 20000, "ws_retry_delay": 5}, f, indent=2)
    with open(CONFIG_FILE, "r", encoding="utf-8") as f:
        state["config"] = json.load(f)
    log_event(f"Конфигурация заредена: {len(state['config'].get('symbols', []))} двойки.")


async def fetch_binance_klines(session, symbol, interval="1m", start_time=None, end_time=None, limit=1000):
    params = {"symbol": symbol, "interval": interval, "limit": min(1000, limit)}
    if start_time is not None:
        params["startTime"] = int(start_time)
    if end_time is not None:
        params["endTime"] = int(end_time)
    url = "https://api.binance.com/api/v3/klines"
    for attempt in range(4):
        try:
            async with session.get(url, params=params, timeout=aiohttp.ClientTimeout(total=20)) as response:
                if response.status == 200:
                    data = await response.json()
                    return [{"time": k[0] // 1000, "open": float(k[1]), "high": float(k[2]), "low": float(k[3]), "close": float(k[4]), "volume": float(k[5])} for k in data], data
                if response.status == 429 or response.status >= 500:
                    await asyncio.sleep(min(2 ** attempt, 15))
                    continue
                log_event(f"Binance {symbol}: HTTP {response.status} - {await response.text()}", "WARN")
                return [], []
        except Exception as exc:
            if attempt == 3:
                log_event(f"Грешка при изтегляне на {symbol}: {exc}", "ERROR")
            await asyncio.sleep(min(2 ** attempt, 8))
    return [], []


async def sync_recent_history(session, symbol):
    _, latest, _ = db_bounds(symbol)
    if latest is None:
        # Празна база: НЕ тръгваме от 0 (2017 г.), а от последните 2 дни.
        # По-старата история се дърпа назад от backfill_symbol.
        cursor_ms = int((time.time() - 2 * 86400) * 1000)
    else:
        cursor_ms = int(latest) * 1000
    total = 0
    while True:
        candles, raw = await fetch_binance_klines(session, symbol, start_time=cursor_ms, limit=1000)
        if not raw:
            break
        now_ms = int(time.time() * 1000)
        closed = [c for c, k in zip(candles, raw) if int(k[6]) < now_ms]
        upsert_candles(symbol, closed)
        total += len(closed)
        last_open_ms = int(raw[-1][0])
        # The current minute is still open; stop here and let WebSocket update it.
        if int(raw[-1][6]) >= now_ms or len(raw) < 1000:
            break
        next_cursor = last_open_ms + 60000
        if next_cursor <= cursor_ms:
            break
        cursor_ms = next_cursor
        await asyncio.sleep(0.1)
    state["candles"][symbol] = read_latest(symbol)
    log_event(f"{symbol}: синхронизирани {total} липсващи затворени свещи; локално общо {db_bounds(symbol)[2]}.")


async def backfill_symbol(symbol):
    """Fetch candles older than the oldest locally stored candle."""
    state["backfill"][symbol] = "backfill_oldest"
    async with aiohttp.ClientSession() as session:
        while True:
            oldest, _, _ = db_bounds(symbol)
            end_ms = int(time.time() * 1000) if oldest is None else int(oldest) * 1000 - 1
            if end_ms <= 0:
                break
            _, raw = await fetch_binance_klines(session, symbol, end_time=end_ms, limit=1000)
            if not raw:
                break
            now_ms = int(time.time() * 1000)
            batch = [{"time": k[0] // 1000, "open": float(k[1]), "high": float(k[2]), "low": float(k[3]), "close": float(k[4]), "volume": float(k[5])} for k in raw if int(k[6]) < now_ms]
            if not batch:
                break
            before_oldest = oldest
            upsert_candles(symbol, batch)
            new_oldest = db_bounds(symbol)[0]
            state["candles"][symbol] = read_latest(symbol)
            if new_oldest is None or (before_oldest is not None and new_oldest >= before_oldest):
                log_event(f"{symbol}: backfill stopped because oldest timestamp did not move.", "WARN")
                break
            if len(raw) < 1000:
                break
            await asyncio.sleep(0.15)


async def fill_internal_history_gaps(symbol):
    """Fill missing 1m intervals between stored rows; repeat until no progress remains."""
    oldest, latest, count = db_bounds(symbol)
    if not count:
        state["history_gaps"][symbol] = None
        state["backfill"][symbol] = "partial"
        log_event(f"{symbol}: няма налични локални свещи; синхронизацията не може да се маркира complete.", "WARN")
        return

    state["backfill"][symbol] = "filling_gaps"
    previous_remaining = None
    async with aiohttp.ClientSession() as session:
        while True:
            gaps = find_history_gaps(symbol, limit=10000)
            if not gaps:
                state["history_gaps"][symbol] = 0
                state["backfill"][symbol] = "complete"
                log_event(f"{symbol}: историческата 1m база е непрекъсната. Общо {db_bounds(symbol)[2]} свещи.", "SUCCESS")
                return

            state["history_gaps"][symbol] = len(gaps)
            log_event(f"{symbol}: открити поне {len(gaps)} вътрешни исторически пропуска; започва попълване.", "INFO")
            # Най-новите пропуски първо, и в рамките на пропуск - отзад напред.
            # Така последната история става непрекъсната веднага, а старите "острови" остават най-накрая.
            for left_time, right_time in reversed(gaps):
                lower_ms = (left_time + 60) * 1000
                cursor_end_ms = right_time * 1000 - 1
                while cursor_end_ms >= lower_ms:
                    _, raw = await fetch_binance_klines(session, symbol, end_time=cursor_end_ms, limit=1000)
                    if not raw:
                        # Binance няма свещи в този интервал; финалният одит ще запази пропуска.
                        break

                    now_ms = int(time.time() * 1000)
                    batch = [
                        {"time": k[0] // 1000, "open": float(k[1]), "high": float(k[2]),
                         "low": float(k[3]), "close": float(k[4]), "volume": float(k[5])}
                        for k in raw
                        if lower_ms <= int(k[0]) <= cursor_end_ms and int(k[6]) < now_ms
                    ]
                    if batch:
                        upsert_candles(symbol, batch)

                    first_open_ms = int(raw[0][0])
                    if first_open_ms <= lower_ms or first_open_ms > cursor_end_ms:
                        break
                    cursor_end_ms = first_open_ms - 1
                    if len(raw) < 1000:
                        break
                    await asyncio.sleep(0.12)

                state["candles"][symbol] = read_latest(symbol)

            remaining = count_history_gaps(symbol)
            state["history_gaps"][symbol] = remaining
            if remaining == 0:
                state["backfill"][symbol] = "complete"
                log_event(f"{symbol}: историческата 1m база е непрекъсната. Общо {db_bounds(symbol)[2]} свещи.", "SUCCESS")
                return
            if previous_remaining is not None and remaining >= previous_remaining:
                state["backfill"][symbol] = "partial"
                log_event(f"{symbol}: остават {remaining} пропуска, без допълнителен прогрес от Binance.", "WARN")
                return
            previous_remaining = remaining


async def synchronize_symbol(symbol):
    try:
        async with aiohttp.ClientSession() as session:
            await sync_recent_history(session, symbol)
        await backfill_symbol(symbol)
        await fill_internal_history_gaps(symbol)
    except Exception as exc:
        state["backfill"][symbol] = "error"
        log_event(f"{symbol}: историческата синхронизация се провали: {exc}", "ERROR")


async def init_history():
    init_db()
    for symbol in state["config"].get("symbols", []):
        imported = import_legacy_json(symbol)
        if imported:
            log_event(f"{symbol}: импортирани {imported} стари свещи в SQLite.", "SUCCESS")
        state["candles"][symbol] = read_latest(symbol)
        state["backfill"][symbol] = "syncing"
        state["history_gaps"][symbol] = None


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
            streams = "/".join(f"{s.lower()}@kline_1m" for s in symbols)
            uri = f"wss://stream.binance.com:9443/stream?streams={streams}"
            try:
                log_event(f"Свързване към Binance WS за {len(symbols)} двойки...")
                async with websockets.connect(uri, ping_interval=20, ping_timeout=20) as ws:
                    self.ws = ws
                    for symbol in symbols:
                        state["connections"][symbol] = True
                    log_event("WebSocket връзката е установена.", "SUCCESS")
                    async for message in ws:
                        state["last_message_time"] = time.time()
                        payload = json.loads(message)
                        k = payload.get("data", {}).get("k")
                        if not k:
                            continue
                        symbol = k["s"]
                        candle = {"time": k["t"] // 1000, "open": float(k["o"]), "high": float(k["h"]), "low": float(k["l"]), "close": float(k["c"]), "volume": float(k["v"])}
                        if symbol not in state["candles"]:
                            state["candles"][symbol] = []
                        cache = state["candles"][symbol]
                        if cache and cache[-1]["time"] == candle["time"]:
                            cache[-1] = candle
                        elif not cache or cache[-1]["time"] < candle["time"]:
                            cache.append(candle)
                            if len(cache) > 3000:
                                del cache[:-3000]
                        # Store only final 1m bars. Re-upsert is safe after reconnect/restart.
                        if k.get("x"):
                            upsert_candles(symbol, [candle])
                        msg = json.dumps({"symbol": symbol, "candle": candle, "closed": bool(k.get("x"))})
                        for client in list(state["clients"]):
                            try:
                                await client.send_text(msg)
                            except Exception:
                                state["clients"].discard(client)
            except Exception as exc:
                log_event(f"WS връзката прекъсна: {exc}", "WARN")
                state["ws_reconnect_count"] += 1
                for symbol in symbols:
                    state["connections"][symbol] = False
            await asyncio.sleep(state["config"].get("ws_retry_delay", 5))


ws_manager = BinanceWSManager()
app = FastAPI(title="Binance Data Service")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=True, allow_methods=["*"], allow_headers=["*"])


@app.on_event("startup")
async def startup_event():
    global BACKEND_HASH
    BACKEND_HASH = calculate_hash()
    log_event(f"Стартиране на сървиза. SHA-256: {BACKEND_HASH[:16]}...")
    load_config()
    await init_history()
    for symbol in state["config"].get("symbols", []):
        asyncio.create_task(synchronize_symbol(symbol))
    asyncio.create_task(ws_manager.start())


@app.on_event("shutdown")
async def shutdown_event():
    ws_manager.running = False
    log_event("Сървизът се изключва...")


@app.get("/api/history/{symbol}")
async def get_history(symbol: str, timeframe: str = Query("1m"), limit: int = Query(1500, ge=1, le=5000), before: int | None = Query(None)):
    symbol = symbol.upper()
    if timeframe not in TIMEFRAMES:
        return JSONResponse(status_code=400, content={"error": "Unsupported timeframe"})
    if symbol not in state["config"].get("symbols", []):
        return JSONResponse(status_code=404, content={"error": "Symbol not found"})

    sec = TIMEFRAMES[timeframe]
    oldest, latest, _ = db_bounds(symbol)
    if oldest is None:
        return {"candles": [], "has_more": False, "oldest_time": None, "total_candles": 0}

    off = bucket_offset(sec)
    end_bucket = bucket_of(int(before) - 1, sec) if before is not None else bucket_of(latest, sec)
    start_bucket = end_bucket - (limit - 1) * sec
    end_exclusive = end_bucket + sec

    with db_connect() as conn:
        rows = conn.execute("""
            WITH grouped AS (
                SELECT ((time - ?) / ?) * ? + ? AS bucket,
                       MIN(time) AS first_time, MAX(time) AS last_time,
                       MAX(high) AS high, MIN(low) AS low, SUM(volume) AS volume
                FROM candles
                WHERE symbol=? AND time>=? AND time<?
                GROUP BY bucket
            )
            SELECT g.bucket, first.open, g.high, g.low, last.close, g.volume
            FROM grouped g
            JOIN candles first ON first.symbol=? AND first.time=g.first_time
            JOIN candles last ON last.symbol=? AND last.time=g.last_time
            ORDER BY g.bucket ASC
        """, (off, sec, sec, off, symbol, start_bucket, end_exclusive, symbol, symbol)).fetchall()

        # During gap repair a whole time window can temporarily contain no rows.
        # Fall back to the nearest older available buckets instead of returning an empty page.
        if not rows and before is not None:
            rows = conn.execute("""
                WITH grouped AS (
                    SELECT ((time - ?) / ?) * ? + ? AS bucket,
                           MIN(time) AS first_time, MAX(time) AS last_time,
                           MAX(high) AS high, MIN(low) AS low, SUM(volume) AS volume
                    FROM candles
                    WHERE symbol=? AND time<?
                    GROUP BY bucket ORDER BY bucket DESC LIMIT ?
                )
                SELECT g.bucket, first.open, g.high, g.low, last.close, g.volume
                FROM grouped g
                JOIN candles first ON first.symbol=? AND first.time=g.first_time
                JOIN candles last ON last.symbol=? AND last.time=g.last_time
                ORDER BY g.bucket ASC
            """, (off, sec, sec, off, symbol, start_bucket, limit, symbol, symbol)).fetchall()

        total_candles = ((bucket_of(latest, sec) - bucket_of(oldest, sec)) // sec) + 1

    candles = [{"time": int(r[0]), "open": r[1], "high": r[2], "low": r[3], "close": r[4], "volume": r[5]} for r in rows]
    page_oldest = candles[0]["time"] if candles else start_bucket
    with db_connect() as conn:
        has_more = conn.execute(
            "SELECT 1 FROM candles WHERE symbol=? AND time<? LIMIT 1", (symbol, page_oldest)
        ).fetchone() is not None
    return {
        "candles": candles,
        "has_more": has_more,
        "oldest_time": candles[0]["time"] if candles else None,
        "total_candles": int(total_candles or 0),
        "backfill": state["backfill"].get(symbol, "pending"),
    }


@app.get("/api/integrity")
async def get_integrity():
    return {"hash": BACKEND_HASH}


@app.websocket("/ws/stream")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    state["clients"].add(websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        state["clients"].discard(websocket)
    except Exception as exc:
        state["clients"].discard(websocket)
        log_event(f"Грешка с клиент: {exc}", "ERROR")


@app.get("/", response_class=HTMLResponse)
async def dashboard():
    html_content = """<!DOCTYPE html><html><head><title>Binance Service Diagnostics</title><style>body{font-family:monospace;background:#0b0e11;color:#eaecef;padding:20px}h1,h2{color:#f0b90b}.card{background:#151a21;border:1px solid #2a323d;padding:15px;margin-bottom:15px;border-radius:8px}.status-ok{color:#0ecb81}.status-err{color:#f6465d}.log-box{background:#1c232c;padding:10px;height:300px;overflow-y:auto;white-space:pre-wrap;font-size:12px}button{background:#f0b90b;color:#000;border:0;padding:8px 16px;cursor:pointer;font-weight:bold;border-radius:4px;margin-bottom:10px}textarea{width:100%;height:120px;background:#1c232c;color:#eaecef;border:1px solid #2a323d;padding:10px}</style></head><body><h1>Binance Service Diagnostics</h1><div class="card"><h2>Live Configuration</h2><textarea id="cfg"></textarea><button onclick="saveConfig()">Save Config</button></div><div class="card"><h2>System Status</h2><div id="status">Loading...</div></div><div class="card"><h2>Logs</h2><button onclick="refresh()">Refresh</button><div class="log-box" id="logs"></div></div><script>async function refresh(){try{let d=await(await fetch('/api/diagnostics')).json();if(document.activeElement!==document.getElementById('cfg'))cfg.value=JSON.stringify(d.config,null,2);status.innerHTML='Uptime: '+d.uptime+'s<br>Clients: '+d.clients_count+'<br>WS reconnects: '+d.ws_reconnect_count+'<br>'+Object.entries(d.connections).map(([s,v])=>s+': '+(v?'CONNECTED':'DISCONNECTED')+' | Backfill: '+(d.backfill[s]||'pending')).join('<br>');logs.textContent=d.logs.join('\\n')}catch(e){console.error(e)}}async function saveConfig(){try{let r=await fetch('/api/config',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(JSON.parse(cfg.value))});alert(r.ok?'Saved':'Error')}catch(e){alert(e.message)}}setInterval(refresh,3000);refresh();</script></body></html>"""
    return HTMLResponse(content=html_content)


@app.get("/api/diagnostics")
async def get_diagnostics():
    age = f"{int(time.time() - state['last_message_time'])}s ago" if state["last_message_time"] else "N/A"
    return {"config": state["config"], "connections": state["connections"], "logs": state["logs"], "uptime": int(time.time() - state["start_time"]), "clients_count": len(state["clients"]), "ws_reconnect_count": state["ws_reconnect_count"], "last_msg_ago": age, "hash": BACKEND_HASH, "backfill": state["backfill"], "storage": {s: {"oldest": db_bounds(s)[0], "latest": db_bounds(s)[1], "count": db_bounds(s)[2], "gaps": state["history_gaps"].get(s)} for s in state["config"].get("symbols", [])}}


@app.post("/api/config")
async def update_config(new_config: dict):
    try:
        with open(CONFIG_FILE, "w", encoding="utf-8") as f:
            json.dump(new_config, f, indent=2)
        state["config"] = new_config
        return {"status": "ok"}
    except Exception as exc:
        return JSONResponse(status_code=500, content={"error": str(exc)})


if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8080, http="h11")
