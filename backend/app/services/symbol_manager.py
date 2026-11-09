import asyncio
import logging
from app.config import settings
from app.db import get_pool
from app.storage.candles import set_symbol
from app.services.sync_worker import SymbolWorker

log = logging.getLogger(__name__)

class SymbolManager:
    def __init__(self, binance):
        self.binance = binance
        self.workers: dict[str, SymbolWorker] = {}
        self.lock = asyncio.Lock()

    async def start(self):
        rows = await get_pool().fetch("SELECT symbol FROM symbols WHERE active=TRUE")
        for row in rows:
            await self.activate(row["symbol"])

    async def add(self, symbol: str):
        async with self.lock:
            if symbol not in self.workers and len(self.workers) >= settings.active_symbol_limit:
                raise ValueError(f"Active symbol limit reached ({settings.active_symbol_limit})")
            if not await self.binance.exchange_info(symbol):
                raise ValueError(f"{symbol} is not an active Binance Spot trading pair")
            await set_symbol(symbol, True)
            await self._activate_locked(symbol)
        return symbol

    async def activate(self, symbol: str):
        async with self.lock:
            await self._activate_locked(symbol)

    async def _activate_locked(self, symbol: str):
        if symbol not in self.workers:
            worker = SymbolWorker(symbol, self.binance)
            self.workers[symbol] = worker
            await worker.start()

    async def remove(self, symbol: str):
        async with self.lock:
            worker = self.workers.pop(symbol, None)
            if worker: await worker.stop()
            await set_symbol(symbol, False)

    async def stop(self):
        async with self.lock:
            workers = list(self.workers.values())
            self.workers.clear()
        await asyncio.gather(*(w.stop() for w in workers), return_exceptions=True)
