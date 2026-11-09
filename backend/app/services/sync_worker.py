import asyncio
import json
import logging
import time
from datetime import datetime, timezone
import websockets
from app.config import settings
from app.db import get_pool
from app.storage.candles import upsert_many, upsert_candle, latest_open_time, update_sync
from app.timeframes import interval_start_ms

log = logging.getLogger(__name__)

class SymbolWorker:
    def __init__(self, symbol: str, binance):
        self.symbol, self.binance = symbol, binance
        self.tasks: list[asyncio.Task] = []
        self.stopping = asyncio.Event()
        self.current: dict | None = None

    async def start(self):
        await update_sync(self.symbol, "STARTING")
        # Recent history is loaded before the live stream; subsequent recovery closes the handoff gap.
        try:
            recent = await self.binance.klines(self.symbol, limit=1000)
            await upsert_many(recent)
            if recent: self.current = recent[-1]
            await update_sync(self.symbol, "RUNNING", last_open_time=recent[-1]["open_time"] if recent else None)
        except Exception as exc:
            log.exception("Initial Binance fetch failed", extra={"symbol":self.symbol,"component":"sync"})
            await update_sync(self.symbol, "DEGRADED", str(exc)[:1000])
        self.tasks = [
            asyncio.create_task(self.live_loop(), name=f"live-{self.symbol}"),
            asyncio.create_task(self.backfill_loop(), name=f"backfill-{self.symbol}"),
            asyncio.create_task(self.recovery_loop(), name=f"recovery-{self.symbol}"),
        ]

    async def stop(self):
        self.stopping.set()
        for task in self.tasks: task.cancel()
        await asyncio.gather(*self.tasks, return_exceptions=True)
        await update_sync(self.symbol, "PAUSED")

    async def live_loop(self):
        delay = 1
        while not self.stopping.is_set():
            try:
                url = await self.binance.websocket_url(self.symbol)
                async with websockets.connect(url, ping_interval=20, ping_timeout=20, close_timeout=5) as ws:
                    log.info("Binance stream connected", extra={"symbol":self.symbol,"component":"live"})
                    await update_sync(self.symbol, "RUNNING")
                    delay = 1
                    async for raw in ws:
                        event = json.loads(raw)
                        k = event.get("k", {})
                        candle = {
                            "symbol":self.symbol, "timeframe":"1m", "open_time":int(k["t"]),
                            "close_time":int(k["T"]), "open":k["o"], "high":k["h"],
                            "low":k["l"], "close":k["c"], "volume":k["v"],
                            "quote_volume":k.get("q","0"), "trades":int(k.get("n",0)),
                            "is_closed":bool(k.get("x",False)),
                        }
                        if int(time.time() * 1000) > candle["close_time"] + settings.watermark_seconds * 1000:
                            candle["is_closed"] = True
                        self.current = candle
                        try:
                            from app.api.websocket import hub
                            await hub.publish({"type":"CANDLE_UPDATE","symbol":self.symbol,
                                "timeframe":"1m","candle":{
                                    "symbol":self.symbol,"timeframe":"1m",
                                    "open_time":candle["open_time"],"close_time":candle["close_time"],
                                    "open":str(candle["open"]),"high":str(candle["high"]),
                                    "low":str(candle["low"]),"close":str(candle["close"]),
                                    "volume":str(candle["volume"]),"quote_volume":str(candle["quote_volume"]),
                                    "trades":candle["trades"],"is_closed":candle["is_closed"]}})
                            # Build live higher-timeframe snapshots from local 1m data.
                            from app.services.aggregation import AGGREGATED, aggregate
                            from app.timeframes import interval_start_ms, interval_end_ms
                            from app.db import get_pool
                            async with get_pool().acquire() as conn:
                                for tf in AGGREGATED:
                                    bucket = interval_start_ms(candle["open_time"], tf)
                                    base = await conn.fetch("""SELECT * FROM candles WHERE symbol=$1
                                        AND timeframe='1m' AND open_time >= $2 AND open_time <= $3
                                        ORDER BY open_time""", self.symbol, bucket, interval_end_ms(bucket, tf))
                                    items = [dict(r) for r in base if r["open_time"] != candle["open_time"]]
                                    items.append(candle)
                                    snapshot = aggregate(self.symbol, tf, items) if items else None
                                    if snapshot:
                                        await hub.publish({"type":"CANDLE_UPDATE","symbol":self.symbol,
                                            "timeframe":tf,"candle":{k:str(v) if k in {"open","high","low","close","volume","quote_volume"} else v
                                            for k,v in snapshot.items()}})
                        except Exception:
                            log.exception("Live client broadcast failed", extra={"symbol":self.symbol,"component":"client-ws"})
                        if candle["is_closed"] or int(time.time()*1000) > candle["close_time"] + settings.watermark_seconds*1000:
                            await upsert_candle(candle)
                            await update_sync(self.symbol, "RUNNING", last_open_time=candle["open_time"])
            except asyncio.CancelledError: raise
            except Exception as exc:
                log.warning("Binance stream disconnected: %s", exc, extra={"symbol":self.symbol,"component":"live"})
                await update_sync(self.symbol, "RECONNECTING", str(exc)[:1000])
                await asyncio.sleep(min(delay, settings.binance_backoff_max_seconds))
                delay = min(delay*2, settings.binance_backoff_max_seconds)

    async def backfill_loop(self):
        # Continue backwards in bounded pages. Older history is deliberately lower priority than live data.
        await asyncio.sleep(3)
        while not self.stopping.is_set():
            try:
                latest = await latest_open_time(self.symbol)
                if latest is None:
                    await asyncio.sleep(10); continue
                oldest = await get_oldest(self.symbol)
                if oldest is None: await asyncio.sleep(10); continue
                page = await self.binance.klines(self.symbol, limit=settings.backfill_batch_size,
                    end_time=oldest-1)
                if not page:
                    await asyncio.sleep(3600); continue
                await upsert_many(page)
                log.info("Historical page stored", extra={"symbol":self.symbol,"component":"backfill"})
                if len(page) < settings.backfill_batch_size: await asyncio.sleep(3600)
                else: await asyncio.sleep(1)
            except asyncio.CancelledError: raise
            except Exception:
                log.exception("Backfill failed", extra={"symbol":self.symbol,"component":"backfill"})
                await asyncio.sleep(30)

    async def recovery_loop(self):
        while not self.stopping.is_set():
            try:
                latest = await latest_open_time(self.symbol)
                # Re-fetch a rolling recent window to reconcile late updates and short-lived disconnect gaps.
                start = max(0, latest - 999 * 60_000) if latest is not None else None
                rows = await self.binance.klines(self.symbol, limit=1000, start_time=start) if start is not None else []
                if rows: await upsert_many(rows)
                # Refresh current 1m candle after startup/reconnect; keep in RAM for current endpoint.
                current = await self.binance.klines(self.symbol, limit=2)
                if current: self.current = current[-1]
                await update_sync(self.symbol, "RUNNING", last_open_time=rows[-1]["open_time"] if rows else latest)
            except asyncio.CancelledError: raise
            except Exception as exc:
                log.exception("Recovery/reconciliation failed", extra={"symbol":self.symbol,"component":"recovery"})
                await update_sync(self.symbol, "DEGRADED", str(exc)[:1000])
            await asyncio.sleep(settings.recovery_interval_seconds)

async def get_oldest(symbol: str):
    async with get_pool().acquire() as conn:
        return await conn.fetchval("SELECT MIN(open_time) FROM candles WHERE symbol=$1 AND timeframe='1m'", symbol)
