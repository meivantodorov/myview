import asyncio
import aiohttp
import argparse
from datetime import datetime

# Мапинг на интервалите към секунди за агрегация
TIMEFRAME_MAP = {
    "1m": 60,
    "5m": 300,
    "15m": 900,
    "30m": 1800,
    "1h": 3600,
    "4h": 14400,
    "1d": 86400
}

async def fetch_binance_klines(symbol, interval, limit):
    """Взима СУРОВИ 1-минутни свещи директно от Binance API"""
    url = f"https://api.binance.com/api/v3/klines?symbol={symbol}&interval=1m&limit={limit}"
    async with aiohttp.ClientSession() as session:
        async with session.get(url) as response:
            if response.status == 200:
                return await response.json()
            else:
                print(f"Грешка от Binance API: {response.status}")
                return []

def aggregate_candles(raw_klines, tf_seconds):
    """Събира 1-минутните свещи в по-голям таймфрейм"""
    aggregated = []
    current_bucket = None

    for k in raw_klines:
        # k[0] е отварящото време в милисекунди
        time_sec = k[0] // 1000
        bucket_time = (time_sec // tf_seconds) * tf_seconds
        
        open_p = float(k[1])
        high_p = float(k[2])
        low_p = float(k[3])
        close_p = float(k[4])
        volume = float(k[5])

        if not current_bucket or current_bucket["time"] != bucket_time:
            if current_bucket:
                aggregated.append(current_bucket)
            current_bucket = {
                "time": bucket_time,
                "open": open_p,
                "high": high_p,
                "low": low_p,
                "close": close_p,
                "volume": volume
            }
        else:
            current_bucket["high"] = max(current_bucket["high"], high_p)
            current_bucket["low"] = min(current_bucket["low"], low_p)
            current_bucket["close"] = close_p
            current_bucket["volume"] += volume

    if current_bucket:
        aggregated.append(current_bucket)

    return aggregated

async def main():
    parser = argparse.ArgumentParser(description="Debug Binance Candles Aggregation")
    parser.add_argument("--symbol", type=str, default="BTCUSDT", help="Двойка (напр. BTCUSDT)")
    parser.add_argument("--tf", type=str, default="30m", help="Таймфрейм (напр. 30m, 1h)")
    parser.add_argument("--periods", type=int, default=10, help="Брой периоди за показване")
    args = parser.parse_args()

    symbol = args.symbol.upper()
    tf = args.tf
    periods = args.periods

    if tf not in TIMEFRAME_MAP:
        print(f"Неподдържан таймфрейм: {tf}. Използвайте: {', '.join(TIMEFRAME_MAP.keys())}")
        return

    tf_seconds = TIMEFRAME_MAP[tf]
    
    # За да получим N на брой агрегирани свещи, ни трябват N * (tf_seconds / 60) на брой 1-минутни свещи
    # Добавяме малко буфер отгоре
    limit = (periods * (tf_seconds // 60)) + 5

    print(f"🔍 Изтегляне на {limit} x 1m свещи за {symbol} от Binance...")
    raw_klines = await fetch_binance_klines(symbol, "1m", limit)
    
    if not raw_klines:
        return

    aggregated = aggregate_candles(raw_klines, tf_seconds)

    # Взимаме само последните N на брой агрегирани свещи
    final_candles = aggregated[-periods:]

    print(f"\n📊 Резултати за {symbol} ({tf}) - Последни {len(final_candles)} свещи (UTC време):")
    print("-" * 95)
    print(f"{'Време (UTC)':<20} | {'Open':<10} | {'High':<10} | {'Low':<10} | {'Close':<10} | {'Volume':<10}")
    print("-" * 95)

    for c in final_candles:
        # Форматираме времето в четимо UTC
        dt = datetime.utcfromtimestamp(c["time"]).strftime('%Y-%m-%d %H:%M:%S')
        print(f"{dt:<20} | {c['open']:<10.2f} | {c['high']:<10.2f} | {c['low']:<10.2f} | {c['close']:<10.2f} | {c['volume']:<10.4f}")

    print("-" * 95)
    print("💡 Сравнете тези стойности с графиката на Binance (изберете UTC време там).")

if __name__ == "__main__":
    asyncio.run(main())