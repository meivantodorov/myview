from datetime import datetime, timedelta, timezone

TIMEFRAMES = ("1m", "5m", "15m", "30m", "1h", "4h", "1d", "1w")
DURATION_MS = {
    "1m": 60_000, "5m": 300_000, "15m": 900_000, "30m": 1_800_000,
    "1h": 3_600_000, "4h": 14_400_000, "1d": 86_400_000,
}
def interval_start_ms(timestamp_ms: int, timeframe: str) -> int:
    if timeframe == "1w":
        dt = datetime.fromtimestamp(timestamp_ms / 1000, tz=timezone.utc)
        monday = (dt - timedelta(days=dt.weekday())).replace(hour=0, minute=0, second=0, microsecond=0)
        return int(monday.timestamp() * 1000)
    duration = DURATION_MS[timeframe]
    return timestamp_ms // duration * duration

def interval_end_ms(open_time_ms: int, timeframe: str) -> int:
    if timeframe == "1w":
        return open_time_ms + 7 * 86_400_000 - 1
    return open_time_ms + DURATION_MS[timeframe] - 1

def timeframe_ms(timeframe: str) -> int:
    if timeframe == "1w":
        return 7 * 86_400_000
    return DURATION_MS[timeframe]
