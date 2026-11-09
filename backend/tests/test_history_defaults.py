from datetime import datetime, timezone
from app.timeframes import timeframe_ms

def test_default_burst_window_is_500_intervals():
    end = datetime(2025, 1, 1, tzinfo=timezone.utc)
    end_ms = int(end.timestamp() * 1000)
    start_ms = end_ms - 500 * timeframe_ms("1m")
    assert end_ms - start_ms == 500 * 60_000

def test_prefetch_is_a_count_of_candles():
    assert 25 * timeframe_ms("5m") == 7_500_000
