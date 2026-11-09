from decimal import Decimal
from app.timeframes import TIMEFRAMES, interval_start_ms, interval_end_ms

AGGREGATED = TIMEFRAMES[1:]

def aggregate(symbol: str, timeframe: str, candles: list[dict]) -> dict | None:
    if not candles:
        return None
    candles = sorted(candles, key=lambda c: c["open_time"])
    start = interval_start_ms(candles[0]["open_time"], timeframe)
    # Do not create a candle from data spanning more than one target interval.
    if any(interval_start_ms(c["open_time"], timeframe) != start for c in candles):
        raise ValueError("Input candles span multiple target intervals")
    return {
        "symbol": symbol, "timeframe": timeframe, "open_time": start,
        "close_time": interval_end_ms(start, timeframe),
        "open": Decimal(candles[0]["open"]), "high": max(Decimal(c["high"]) for c in candles),
        "low": min(Decimal(c["low"]) for c in candles), "close": Decimal(candles[-1]["close"]),
        "volume": sum((Decimal(c["volume"]) for c in candles), Decimal(0)),
        "quote_volume": sum((Decimal(c.get("quote_volume", 0)) for c in candles), Decimal(0)),
        "trades": sum(int(c.get("trades", 0)) for c in candles),
        "is_closed": all(c.get("is_closed", False) for c in candles),
    }

def affected_intervals(open_time: int) -> list[tuple[str, int]]:
    return [(tf, interval_start_ms(open_time, tf)) for tf in AGGREGATED]
