import asyncio
import logging
import time

from app.db import get_pool
from app.timeframes import TIMEFRAMES, DURATION_MS
from app.config import settings

log = logging.getLogger(__name__)
AGGREGATED = TIMEFRAMES[1:]
BATCH_SIZE = 5000

class AggregatorWorker:
    """Batch historical aggregation; live 1m ingestion remains independent."""
    def __init__(self):
        self.task = None
        self.stopping = asyncio.Event()

    async def start(self):
        self.task = asyncio.create_task(self.run(), name="aggregation-batch-worker")

    async def stop(self):
        self.stopping.set()
        if self.task:
            self.task.cancel()
            try:
                await self.task
            except asyncio.CancelledError:
                pass

    async def run(self):
        last_cleanup = 0
        while not self.stopping.is_set():
            try:
                if not await self.process_batch():
                    await asyncio.sleep(1)
                # Retention: изтрива DONE jobs по-стари от 7 дни (веднъж на час)
                now = time.time()
                if now - last_cleanup > 3600:
                    last_cleanup = now
                    try:
                        async with get_pool().acquire() as conn:
                            result = await conn.execute(
                                "DELETE FROM aggregation_jobs WHERE status='DONE' AND processed_at < NOW() - INTERVAL '7 days'"
                            )
                            if result and result != "DELETE 0":
                                log.info(f"Retention cleanup: {result}", extra={"component": "aggregation"})
                    except Exception:
                        log.exception("Retention cleanup failed", extra={"component": "aggregation"})
            except asyncio.CancelledError:
                raise
            except Exception:
                log.exception("Batch aggregation failed", extra={"component": "aggregation"})
                await asyncio.sleep(3)

    @staticmethod
    def _bucket_expr(timeframe: str) -> str:
        if timeframe == "1w":
            return "(EXTRACT(EPOCH FROM date_trunc('week', to_timestamp(open_time / 1000.0) AT TIME ZONE 'UTC') AT TIME ZONE 'UTC') * 1000)::bigint"
        duration = DURATION_MS[timeframe]
        return f"(open_time / {duration}) * {duration}"

    async def process_batch(self) -> bool:
        pool = get_pool()
        async with pool.acquire() as conn:
            async with conn.transaction():
                jobs = await conn.fetch("""SELECT id, symbol, open_time FROM aggregation_jobs
                    WHERE status='PENDING' ORDER BY id LIMIT $1 FOR UPDATE SKIP LOCKED""", BATCH_SIZE)
                if not jobs:
                    return False
                by_symbol = {}
                for job in jobs:
                    item = by_symbol.setdefault(job["symbol"], {"ids": [], "times": []})
                    item["ids"].append(job["id"])
                    item["times"].append(job["open_time"])

                for symbol, item in by_symbol.items():
                    low, high = min(item["times"]), max(item["times"])
                    for tf in AGGREGATED:
                        expr = self._bucket_expr(tf)
                        if tf == "1w":
                            # Expand to UTC Monday week boundaries.
                            bounds = await conn.fetchrow("""SELECT
                                (EXTRACT(EPOCH FROM date_trunc('week', to_timestamp($1/1000.0) AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')*1000)::bigint AS lo,
                                (EXTRACT(EPOCH FROM (date_trunc('week', to_timestamp($2/1000.0) AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' + INTERVAL '7 days'))*1000)::bigint AS hi""", low, high)
                            start_ms, end_ms = bounds["lo"], bounds["hi"]
                            close_expr = f"{expr} + 604800000 - 1"
                        else:
                            duration = DURATION_MS[tf]
                            start_ms = (low // duration) * duration
                            end_ms = ((high // duration) + 1) * duration - 1
                            close_expr = f"{expr} + {duration} - 1"
                        await conn.execute(f"""INSERT INTO candles
                            (symbol,timeframe,open_time,close_time,open,high,low,close,volume,quote_volume,trades,is_closed)
                            SELECT $1, $4, bucket, {close_expr.replace('open_time', 'bucket')},
                                (array_agg(open ORDER BY open_time))[1], MAX(high), MIN(low),
                                (array_agg(close ORDER BY open_time DESC))[1], SUM(volume),
                                SUM(quote_volume), SUM(trades), BOOL_AND(is_closed)
                            FROM (SELECT {expr} AS bucket, open_time, open, high, low, close, volume,
                                         quote_volume, trades, is_closed
                                  FROM candles WHERE symbol=$1 AND timeframe='1m'
                                    AND open_time BETWEEN $2 AND $3) src
                            GROUP BY bucket
                            ON CONFLICT(symbol,timeframe,open_time) DO UPDATE SET
                                close_time=EXCLUDED.close_time, open=EXCLUDED.open, high=EXCLUDED.high,
                                low=EXCLUDED.low, close=EXCLUDED.close, volume=EXCLUDED.volume,
                                quote_volume=EXCLUDED.quote_volume, trades=EXCLUDED.trades,
                                is_closed=EXCLUDED.is_closed, updated_at=NOW()""",
                            symbol, start_ms, end_ms, tf)
                await conn.execute("UPDATE aggregation_jobs SET status='DONE', processed_at=NOW() WHERE id = ANY($1::bigint[])", [j["id"] for j in jobs])
        log.info("Aggregation batch completed", extra={"component":"aggregation", "jobs":len(jobs), "symbols":len(by_symbol)})
        return True
