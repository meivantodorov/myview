import asyncpg
from app.config import settings

pool: asyncpg.Pool | None = None

SCHEMA = """
CREATE TABLE IF NOT EXISTS symbols (
  symbol TEXT PRIMARY KEY, active BOOLEAN NOT NULL DEFAULT TRUE,
  added_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS candles (
  symbol TEXT NOT NULL REFERENCES symbols(symbol) ON DELETE CASCADE,
  timeframe TEXT NOT NULL, open_time BIGINT NOT NULL, close_time BIGINT NOT NULL,
  open NUMERIC(30,12) NOT NULL, high NUMERIC(30,12) NOT NULL,
  low NUMERIC(30,12) NOT NULL, close NUMERIC(30,12) NOT NULL,
  volume NUMERIC(36,12) NOT NULL, quote_volume NUMERIC(36,12) NOT NULL DEFAULT 0,
  trades BIGINT NOT NULL DEFAULT 0, is_closed BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY(symbol, timeframe, open_time)
);
CREATE INDEX IF NOT EXISTS ix_candles_lookup ON candles(symbol, timeframe, open_time DESC);
CREATE TABLE IF NOT EXISTS sync_status (
  symbol TEXT PRIMARY KEY REFERENCES symbols(symbol) ON DELETE CASCADE,
  state TEXT NOT NULL DEFAULT 'PENDING', last_sync_at TIMESTAMPTZ,
  last_error TEXT, last_open_time BIGINT, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS aggregation_jobs (
  id BIGSERIAL PRIMARY KEY, symbol TEXT NOT NULL, open_time BIGINT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING', attempts INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), processed_at TIMESTAMPTZ,
  UNIQUE(symbol, open_time)
);
CREATE INDEX IF NOT EXISTS ix_aggregation_jobs_pending ON aggregation_jobs(symbol, open_time) WHERE status = 'PENDING';
"""
async def connect():
    global pool
    pool = await asyncpg.create_pool(settings.database_url, min_size=1, max_size=10, command_timeout=30)
    async with pool.acquire() as conn:
        await conn.execute(SCHEMA)
        await conn.execute("UPDATE aggregation_jobs SET status='PENDING' WHERE status='PROCESSING'")

async def close():
    global pool
    if pool:
        await pool.close()
        pool = None

def get_pool() -> asyncpg.Pool:
    if pool is None:
        raise RuntimeError("Database pool is not initialized")
    return pool
