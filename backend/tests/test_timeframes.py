from datetime import datetime, timezone
from app.timeframes import TIMEFRAMES, interval_start_ms, interval_end_ms, timeframe_ms

def test_supported_timeframes():
    assert TIMEFRAMES == ("1m","5m","15m","30m","1h","4h","1d","1w")

def test_5m_bucket_alignment():
    ts = int(datetime(2025,1,1,12,4,tzinfo=timezone.utc).timestamp()*1000)
    start = int(datetime(2025,1,1,12,0,tzinfo=timezone.utc).timestamp()*1000)
    assert interval_start_ms(ts,"5m") == start
    assert interval_end_ms(start,"5m") == start + 300_000 - 1

def test_week_duration():
    assert timeframe_ms("1w") == 604_800_000
