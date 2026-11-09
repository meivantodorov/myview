import asyncio
import logging
import random
import time
from decimal import Decimal
import httpx
from app.config import settings

log = logging.getLogger(__name__)

class BinanceClient:
    def __init__(self):
        self.http = httpx.AsyncClient(base_url=settings.binance_rest_url,
            timeout=settings.binance_request_timeout, headers={"User-Agent": "BinanceCandleService/1.0"})
        self.semaphore = asyncio.Semaphore(settings.binance_max_concurrent_requests)

    async def close(self):
        await self.http.aclose()

    async def _get(self, path: str, params: dict):
        delay = 1.0
        async with self.semaphore:
            for attempt in range(8):
                try:
                    response = await self.http.get(path, params=params)
                    if response.status_code == 429:
                        retry = float(response.headers.get("Retry-After", delay))
                        log.warning("Binance rate limit; waiting", extra={"component":"binance","event":"rate_limit"})
                        await asyncio.sleep(max(retry, 0.5))
                        continue
                    if response.status_code in (418, 403):
                        raise RuntimeError(f"Binance blocked request: HTTP {response.status_code}")
                    response.raise_for_status()
                    return response.json()
                except (httpx.TimeoutException, httpx.TransportError, httpx.HTTPStatusError) as exc:
                    if isinstance(exc, httpx.HTTPStatusError) and exc.response.status_code < 500:
                        raise
                    if attempt == 7: raise
                    await asyncio.sleep(min(delay, settings.binance_backoff_max_seconds) + random.random())
                    delay *= 2
        raise RuntimeError("Binance request retries exhausted")

    async def exchange_info(self, symbol: str) -> bool:
        data = await self._get("/api/v3/exchangeInfo", {"symbol": symbol})
        return bool(data.get("symbols") and data["symbols"][0].get("status") == "TRADING"
                    and data["symbols"][0].get("isSpotTradingAllowed", True))

    async def klines(self, symbol: str, interval: str = "1m", limit: int = 1000,
                     start_time: int | None = None, end_time: int | None = None):
        params = {"symbol": symbol, "interval": interval, "limit": min(limit, 1000)}
        if start_time is not None: params["startTime"] = start_time
        if end_time is not None: params["endTime"] = end_time
        rows = await self._get("/api/v3/klines", params)
        result = []
        for row in rows:
            result.append({
                "symbol": symbol, "timeframe": interval, "open_time": int(row[0]),
                "close_time": int(row[6]), "open": Decimal(row[1]), "high": Decimal(row[2]),
                "low": Decimal(row[3]), "close": Decimal(row[4]), "volume": Decimal(row[5]),
                 "quote_volume": Decimal(row[7]), "trades": int(row[8]),
                "is_closed": int(row[6]) < int(time.time() * 1000) - settings.watermark_seconds * 1000,
            })
        return result

    async def websocket_url(self, symbol: str) -> str:
        return f"{settings.binance_ws_url}/{symbol.lower()}@kline_1m"
