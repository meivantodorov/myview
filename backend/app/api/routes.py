from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, Query
from app.api.dependencies import require_api_key
from app.config import settings
from app.db import get_pool
from app.schemas import SymbolCreate
from app.storage.candles import get_candles, get_latest, get_symbol, list_symbols
from app.timeframes import TIMEFRAMES, timeframe_ms

router = APIRouter()
admin = APIRouter(dependencies=[Depends(require_api_key)])

@router.get("/timeframes")
async def timeframes():
    return {"timeframes": list(TIMEFRAMES)}

@router.get("/symbols")
async def symbols():
    return await list_symbols()

@router.get("/symbols/{symbol}")
async def symbol_info(symbol: str):
    row = await get_symbol(symbol.upper())
    if not row: raise HTTPException(404, "Symbol not found")
    return row

@router.get("/symbols/{symbol}/status")
async def symbol_status(symbol: str):
    row = await get_symbol(symbol.upper())
    if not row: raise HTTPException(404, "Symbol not found")
    return row

@admin.post("/symbols", status_code=202)
async def add_symbol(payload: SymbolCreate):
    from app.main import symbol_manager
    try:
        await symbol_manager.add(payload.symbol)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    return {"symbol": payload.symbol, "active": True, "message": "Synchronization started"}

@admin.delete("/symbols/{symbol}", status_code=200)
async def remove_symbol(symbol: str):
    from app.main import symbol_manager
    symbol = symbol.upper()
    if not await get_symbol(symbol): raise HTTPException(404, "Symbol not found")
    await symbol_manager.remove(symbol)
    return {"symbol": symbol, "active": False, "history_preserved": True}

@router.get("/candles/{symbol}")
async def candles(symbol: str, timeframe: str = "1m",
    visible_from: datetime | None = None, visible_to: datetime | None = None,
    prefetch_before: int = Query(0, ge=0, le=5000),
    limit: int | None = Query(None, ge=1, le=5000)):
    symbol = symbol.upper()
    if timeframe not in TIMEFRAMES: raise HTTPException(400, f"Unsupported timeframe. Use {TIMEFRAMES}")
    if not await get_symbol(symbol): raise HTTPException(404, "Symbol not registered")
    now = datetime.now(timezone.utc)
    burst = min(limit or settings.history_burst_default, settings.max_candles_per_request)
    end = visible_to or now
    end_ms = int(end.timestamp()*1000)
    start = visible_from or datetime.fromtimestamp((end_ms - burst*timeframe_ms(timeframe))/1000, tz=timezone.utc)
    start_ms = int(start.timestamp()*1000) - prefetch_before*timeframe_ms(timeframe)
    rows = await get_candles(symbol, timeframe, start_ms, end_ms, settings.max_candles_per_request)
    return {"symbol":symbol,"timeframe":timeframe,"count":len(rows),"candles":[serialize(r) for r in rows]}

@router.get("/candles/{symbol}/latest")
async def latest(symbol: str, timeframe: str = "1m", limit: int = Query(500, ge=1, le=5000)):
    symbol = symbol.upper()
    if timeframe not in TIMEFRAMES: raise HTTPException(400, "Unsupported timeframe")
    if not await get_symbol(symbol): raise HTTPException(404, "Symbol not registered")
    rows = await get_latest(symbol, timeframe, limit)
    return {"symbol":symbol,"timeframe":timeframe,"count":len(rows),"candles":[serialize(r) for r in rows]}

@router.get("/candles/{symbol}/current")
async def current(symbol: str, timeframe: str = "1m"):
    from app.main import symbol_manager
    symbol = symbol.upper()
    worker = symbol_manager.workers.get(symbol)
    if not worker: raise HTTPException(404, "No active live worker for symbol")
    if timeframe == "1m":
        return {"symbol":symbol,"timeframe":timeframe,"candle":serialize(worker.current) if worker.current else None}
    if timeframe not in TIMEFRAMES: raise HTTPException(400, "Unsupported timeframe")
    from app.services.aggregation import aggregate
    from app.timeframes import interval_start_ms, interval_end_ms
    from app.db import get_pool
    from datetime import datetime, timezone
    now_ms = int(datetime.now(timezone.utc).timestamp()*1000)
    bucket = interval_start_ms(now_ms, timeframe)
    async with get_pool().acquire() as conn:
        rows = await conn.fetch("""SELECT * FROM candles WHERE symbol=$1 AND timeframe='1m'
            AND open_time >= $2 AND open_time <= $3 ORDER BY open_time""",
            symbol, bucket, interval_end_ms(bucket,timeframe))
    current_minute = worker.current
    all_rows = [dict(r) for r in rows]
    if current_minute:
        all_rows = [r for r in all_rows if r["open_time"] != current_minute["open_time"]]
        all_rows.append(current_minute)
    result = aggregate(symbol,timeframe,all_rows) if all_rows else None
    return {"symbol":symbol,"timeframe":timeframe,"candle":serialize(result) if result else None}

def serialize(row):
    if row is None: return None
    def iso(ms): return datetime.fromtimestamp(ms/1000,tz=timezone.utc).isoformat()
    return {"symbol":row["symbol"],"timeframe":row["timeframe"],"open_time":iso(row["open_time"]),
        "close_time":iso(row["close_time"]),"open":str(row["open"]),"high":str(row["high"]),
        "low":str(row["low"]),"close":str(row["close"]),"volume":str(row["volume"]),
        "quote_volume":str(row.get("quote_volume",0)),"trades":int(row.get("trades",0)),
        "is_closed":bool(row.get("is_closed",False))}

@router.get("/symbols/{symbol}/stats")
async def symbol_stats(symbol: str):
    symbol = symbol.upper()
    async with get_pool().acquire() as conn:
        count = await conn.fetchval("SELECT COUNT(*) FROM candles WHERE symbol=$1 AND timeframe='1m'", symbol)
        oldest = await conn.fetchval("SELECT MIN(open_time) FROM candles WHERE symbol=$1 AND timeframe='1m'", symbol)
        newest = await conn.fetchval("SELECT MAX(open_time) FROM candles WHERE symbol=$1 AND timeframe='1m'", symbol)
        pending = await conn.fetchval("SELECT COUNT(*) FROM aggregation_jobs WHERE symbol=$1 AND status='PENDING'", symbol)
        fetching = pending > 0
    return {
        "symbol": symbol,
        "count_1m": count or 0,
        "oldest_1m": datetime.fromtimestamp(oldest / 1000, tz=timezone.utc).isoformat() if oldest else None,
        "newest_1m": datetime.fromtimestamp(newest / 1000, tz=timezone.utc).isoformat() if newest else None,
        "fetching": fetching,
        "pending_jobs": pending or 0
    }