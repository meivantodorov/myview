"""
Integration тестове — изискват работеща candle-db.
Пускат се с: pytest -m integration
"""
import os
import pytest
import asyncpg

DB_URL = os.getenv("DATABASE_URL", "postgresql://candles:change_me@db:5432/candles")

async def get_pool():
    return await asyncpg.create_pool(DB_URL, min_size=1, max_size=2)

@pytest.mark.asyncio
@pytest.mark.integration
async def test_every_1d_has_1m_support():
    pool = await get_pool()
    try:
        async with pool.acquire() as conn:
            symbols = await conn.fetch("SELECT DISTINCT symbol FROM candles WHERE timeframe='1d'")
            assert len(symbols) > 0, "Няма 1d свещи в базата"
            for row in symbols:
                symbol = row["symbol"]
                orphan = await conn.fetchval("""
                    SELECT COUNT(*) FROM candles c1d
                    WHERE c1d.symbol = $1 AND c1d.timeframe = '1d'
                      AND NOT EXISTS (
                        SELECT 1 FROM candles c1m
                        WHERE c1m.symbol = $1 AND c1m.timeframe = '1m'
                          AND c1m.open_time >= c1d.open_time
                          AND c1m.open_time <= c1d.close_time
                      )
                """, symbol)
                assert orphan == 0, f"{symbol}: {orphan} × 1d свещи без 1m подкрепа"
    finally:
        await pool.close()

@pytest.mark.asyncio
@pytest.mark.integration
async def test_every_1m_day_has_1d():
    pool = await get_pool()
    try:
        async with pool.acquire() as conn:
            symbols = await conn.fetch("SELECT DISTINCT symbol FROM candles WHERE timeframe='1m'")
            for row in symbols:
                symbol = row["symbol"]
                orphan = await conn.fetchval("""
                    WITH days_with_1m AS (
                        SELECT DISTINCT (open_time / 86400000) * 86400000 AS day
                        FROM candles WHERE symbol = $1 AND timeframe = '1m'
                    ),
                    days_with_1d AS (
                        SELECT DISTINCT open_time AS day
                        FROM candles WHERE symbol = $1 AND timeframe = '1d'
                    )
                    SELECT COUNT(*) FROM days_with_1m
                    WHERE day NOT IN (SELECT day FROM days_with_1d)
                """, symbol)
                assert orphan == 0, f"{symbol}: {orphan} дни с 1m, но без 1d свещ"
    finally:
        await pool.close()

@pytest.mark.asyncio
@pytest.mark.integration
async def test_no_large_gaps_in_1m():
    import time
    cutoff = int((time.time() - 30 * 86400) * 1000)
    pool = await get_pool()
    try:
        async with pool.acquire() as conn:
            symbols = await conn.fetch("SELECT DISTINCT symbol FROM candles WHERE timeframe='1m'")
            for row in symbols:
                symbol = row["symbol"]
                gaps = await conn.fetch("""
                    WITH ordered AS (
                        SELECT open_time, LAG(open_time) OVER (ORDER BY open_time) AS prev
                        FROM candles WHERE symbol = $1 AND timeframe = '1m'
                    )
                    SELECT prev, open_time, (open_time - prev) / 60000 - 1 AS missing_minutes
                    FROM ordered WHERE open_time - prev > 60000 AND prev > $2
                """, symbol, cutoff)
                large_gaps = [g for g in gaps if g["missing_minutes"] >= 10]
                assert len(large_gaps) == 0, (
                    f"{symbol}: {len(large_gaps)} дупки >= 10 мин в последните 30 дни. "
                    f"Първа: {large_gaps[0]['prev'] if large_gaps else None}"
                )
    finally:
        await pool.close()

@pytest.mark.asyncio
@pytest.mark.integration
async def test_no_pending_jobs():
    pool = await get_pool()
    try:
        async with pool.acquire() as conn:
            pending = await conn.fetchval("SELECT COUNT(*) FROM aggregation_jobs WHERE status='PENDING'")
            assert pending == 0, f"Има {pending} PENDING jobs - агрегаторът не работи"
    finally:
        await pool.close()

@pytest.mark.asyncio
@pytest.mark.integration
async def test_1d_close_matches_1m():
    pool = await get_pool()
    try:
        async with pool.acquire() as conn:
            symbols = await conn.fetch("SELECT DISTINCT symbol FROM candles WHERE timeframe='1d'")
            for row in symbols:
                symbol = row["symbol"]
                days = await conn.fetch("""
                    SELECT open_time, open, close FROM candles
                    WHERE symbol = $1 AND timeframe = '1d'
                      AND open_time < (EXTRACT(EPOCH FROM NOW())::bigint / 86400000 - 1) * 86400000
                    ORDER BY open_time DESC LIMIT 10
                """, symbol)
                for d in days:
                    agg = await conn.fetchrow("""
                        SELECT 
                            (array_agg(open ORDER BY open_time))[1] AS open,
                            (array_agg(close ORDER BY open_time DESC))[1] AS close
                        FROM candles WHERE symbol = $1 AND timeframe = '1m'
                          AND open_time >= $2 AND open_time <= $2 + 86400000 - 1
                    """, symbol, d["open_time"])
                    if agg and agg["open"]:
                        assert abs(float(agg["open"]) - float(d["open"])) < 0.01, \
                            f"{symbol} {d['open_time']}: open mismatch"
                        assert abs(float(agg["close"]) - float(d["close"])) < 0.01, \
                            f"{symbol} {d['open_time']}: close mismatch"
    finally:
        await pool.close()