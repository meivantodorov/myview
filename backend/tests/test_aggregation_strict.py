import pytest
from decimal import Decimal
from app.services.aggregation import aggregate
from app.timeframes import interval_start_ms

def make_1m(open_time, o, h, l, c, v):
    return {
        "open_time": open_time,
        "open": Decimal(str(o)),
        "high": Decimal(str(h)),
        "low": Decimal(str(l)),
        "close": Decimal(str(c)),
        "volume": Decimal(str(v)),
        "quote_volume": Decimal("0"),
        "trades": 1,
        "is_closed": True,
    }

def test_5m_aggregation_exact():
    base = interval_start_ms(1700000000000, "5m")
    candles = [
        make_1m(base + 0,     100, 105, 99,  102, 10),
        make_1m(base + 60000, 102, 108, 101, 107, 20),
        make_1m(base + 120000,107, 110, 106, 109, 30),
        make_1m(base + 180000,109, 112, 108, 111, 40),
        make_1m(base + 240000,111, 115, 110, 114, 50),
    ]
    result = aggregate("BTCUSDT", "5m", candles)
    assert result is not None
    assert result["open"] == Decimal("100")
    assert result["high"] == Decimal("115")
    assert result["low"] == Decimal("99")
    assert result["close"] == Decimal("114")
    assert result["volume"] == Decimal("150")

def test_5m_incomplete_bucket():
    base = interval_start_ms(1700000000000, "5m")
    candles = [
        make_1m(base + 0,     100, 105, 99,  102, 10),
        make_1m(base + 60000, 102, 108, 101, 107, 20),
        make_1m(base + 120000,107, 110, 106, 109, 30),
    ]
    result = aggregate("BTCUSDT", "5m", candles)
    assert result is not None
    assert result["open"] == Decimal("100")
    assert result["high"] == Decimal("110")
    assert result["low"] == Decimal("99")
    assert result["close"] == Decimal("109")
    assert result["volume"] == Decimal("60")

def test_1d_aggregation_exact():
    base = interval_start_ms(1700000000000, "1d")
    candles = []
    for i in range(1440):
        candles.append(make_1m(base + i * 60000, 100 + i, 105 + i, 99 + i, 102 + i, 1))
    result = aggregate("BTCUSDT", "1d", candles)
    assert result is not None
    assert result["open"] == Decimal("100")
    assert result["close"] == Decimal("1541")
    assert result["volume"] == Decimal("1440")

def test_aggregation_rejects_multi_bucket():
    base = interval_start_ms(1700000000000, "5m")
    candles = [
        make_1m(base + 0,      100, 105, 99, 102, 10),
        make_1m(base + 300000, 102, 108, 101, 107, 20),
    ]
    with pytest.raises(ValueError, match="span multiple"):
        aggregate("BTCUSDT", "5m", candles)

def test_empty_aggregation():
    assert aggregate("BTCUSDT", "5m", []) is None

def test_1w_aggregation_starts_monday():
    from datetime import datetime, timezone
    ts = 1700000000000
    start = interval_start_ms(ts, "1w")
    dt = datetime.fromtimestamp(start / 1000, tz=timezone.utc)
    assert dt.weekday() == 0
    assert dt.hour == 0
    assert dt.minute == 0
