from decimal import Decimal
from datetime import datetime, timezone
from app.services.aggregation import aggregate
from app.timeframes import interval_start_ms

def candle(open_time, o, h, l, c, volume, closed=True):
    return {"open_time":open_time,"open":Decimal(o),"high":Decimal(h),"low":Decimal(l),
        "close":Decimal(c),"volume":Decimal(volume),"quote_volume":Decimal(volume)*10,
        "trades":2,"is_closed":closed}

def test_5m_aggregation_ohlcv_and_volume():
    start = 1_700_000_000_000 // 300_000 * 300_000
    rows = [candle(start+i*60_000,str(10+i),str(12+i),str(9+i),str(11+i),"1") for i in range(5)]
    result = aggregate("BTCUSDT","5m",rows)
    assert result["open"] == Decimal("10")
    assert result["close"] == Decimal("15")
    assert result["high"] == Decimal("16")
    assert result["low"] == Decimal("9")
    assert result["volume"] == Decimal("5")
    assert result["trades"] == 10
    assert result["is_closed"] is True

def test_week_starts_monday_utc():
    # 2024-01-07 is Sunday; week starts 2024-01-01 00:00 UTC.
    sunday = int(datetime(2024,1,7,12,tzinfo=timezone.utc).timestamp()*1000)
    monday = int(datetime(2024,1,1,tzinfo=timezone.utc).timestamp()*1000)
    assert interval_start_ms(sunday,"1w") == monday

def test_open_input_keeps_aggregate_open():
    start = 1_700_000_000_000 // 300_000 * 300_000
    result = aggregate("ETHUSDT","5m",[candle(start,"1","2","1","2","3",False)])
    assert result["is_closed"] is False
