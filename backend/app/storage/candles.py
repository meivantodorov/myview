from datetime import datetime, timezone
from app.db import get_pool

UPSERT = """
INSERT INTO candles(symbol,timeframe,open_time,close_time,open,high,low,close,volume,quote_volume,trades,is_closed)
VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
ON CONFLICT(symbol,timeframe,open_time) DO UPDATE SET
 close_time=EXCLUDED.close_time, open=EXCLUDED.open, high=EXCLUDED.high, low=EXCLUDED.low,
 close=EXCLUDED.close, volume=EXCLUDED.volume, quote_volume=EXCLUDED.quote_volume,
 trades=EXCLUDED.trades, is_closed=EXCLUDED.is_closed, updated_at=NOW()
"""
async def upsert_candle(c: dict):
    async with get_pool().acquire() as conn:
        await conn.execute(UPSERT, c["symbol"], c["timeframe"], c["open_time"], c["close_time"],
            c["open"], c["high"], c["low"], c["close"], c["volume"],
            c.get("quote_volume", "0"), c.get("trades", 0), c.get("is_closed", False))
        if c["timeframe"] == "1m":
            await conn.execute("""INSERT INTO aggregation_jobs(symbol,open_time) VALUES($1,$2)
                ON CONFLICT(symbol,open_time) DO NOTHING""",
                c["symbol"], c["open_time"])

async def upsert_many(candles: list[dict]):
    if not candles: return
    async with get_pool().acquire() as conn:
        async with conn.transaction():
            for c in candles:
                await conn.execute(UPSERT, c["symbol"], c["timeframe"], c["open_time"], c["close_time"],
                    c["open"], c["high"], c["low"], c["close"], c["volume"],
                    c.get("quote_volume", "0"), c.get("trades", 0), c.get("is_closed", False))
                if c["timeframe"] == "1m":
                    await conn.execute("""INSERT INTO aggregation_jobs(symbol,open_time) VALUES($1,$2)
                        ON CONFLICT(symbol,open_time) DO NOTHING""",
                        c["symbol"], c["open_time"])

async def get_candles(symbol: str, timeframe: str, start: int | None, end: int | None, limit: int):
    clauses = ["symbol=$1", "timeframe=$2"]
    args = [symbol, timeframe]
    if start is not None:
        args.append(start); clauses.append(f"open_time >= ${len(args)}")
    if end is not None:
        args.append(end); clauses.append(f"open_time <= ${len(args)}")
    args.append(limit)
    query = f"SELECT * FROM candles WHERE {' AND '.join(clauses)} ORDER BY open_time DESC LIMIT ${len(args)}"
    async with get_pool().acquire() as conn:
        rows = await conn.fetch(query, *args)
    return [dict(r) for r in reversed(rows)]

async def get_latest(symbol: str, timeframe: str, limit: int):
    return await get_candles(symbol, timeframe, None, None, limit)

async def latest_open_time(symbol: str):
    async with get_pool().acquire() as conn:
        return await conn.fetchval("SELECT MAX(open_time) FROM candles WHERE symbol=$1 AND timeframe='1m'", symbol)

async def update_sync(symbol: str, state: str, error: str | None = None, last_open_time: int | None = None):
    async with get_pool().acquire() as conn:
        await conn.execute("""INSERT INTO sync_status(symbol,state,last_sync_at,last_error,last_open_time,updated_at)
          VALUES($1,$2,NOW(),$3,$4,NOW()) ON CONFLICT(symbol) DO UPDATE SET state=EXCLUDED.state,
          last_sync_at=NOW(),last_error=EXCLUDED.last_error,last_open_time=COALESCE(EXCLUDED.last_open_time,sync_status.last_open_time),
          updated_at=NOW()""", symbol, state, error, last_open_time)

async def list_symbols(active_only: bool = False):
    sql = """SELECT s.symbol,s.active,s.added_at,ss.state AS status,ss.last_sync_at,ss.last_error
             FROM symbols s LEFT JOIN sync_status ss USING(symbol)"""
    if active_only: sql += " WHERE s.active=TRUE"
    sql += " ORDER BY s.symbol"
    async with get_pool().acquire() as conn:
        return [dict(r) for r in await conn.fetch(sql)]

async def get_symbol(symbol: str):
    async with get_pool().acquire() as conn:
        row = await conn.fetchrow("""SELECT s.symbol,s.active,s.added_at,ss.state AS status,ss.last_sync_at,ss.last_error
          FROM symbols s LEFT JOIN sync_status ss USING(symbol) WHERE s.symbol=$1""", symbol)
    return dict(row) if row else None

async def set_symbol(symbol: str, active: bool):
    async with get_pool().acquire() as conn:
        await conn.execute("""INSERT INTO symbols(symbol,active) VALUES($1,$2)
          ON CONFLICT(symbol) DO UPDATE SET active=EXCLUDED.active""", symbol, active)
        await conn.execute("""INSERT INTO sync_status(symbol,state) VALUES($1,$2)
          ON CONFLICT(symbol) DO NOTHING""", symbol, "PENDING" if active else "PAUSED")
