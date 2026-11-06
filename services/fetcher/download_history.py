import asyncio
import aiohttp
import json
import time
import os

# ==================== НАСТРОЙКИ ====================
SYMBOL = "BTCUSDT"          
INTERVAL = "1m"             # Таймфрейм: 1m, 5m, 15m, 1h, 4h, 1d, 1w
TARGET_LIMIT = 500000       # Колко свещи искаш да изтеглиш общо (500k = ~1 година)
DELAY_BETWEEN_REQUESTS = 0.5 
OUTPUT_FILE = f"{SYMBOL}_{INTERVAL}.json"
# ====================================================

async def download_data():
    url = "https://api.binance.com/api/v3/klines"
    all_candles = []
    end_time = int(time.time() * 1000) 
    
    print(f"🚀 Стартиране на изтеглянето за {SYMBOL} ({INTERVAL})")
    print(f"🎯 Цел: {TARGET_LIMIT} свещи")
    print(f"⏱️ Пауза между заявките: {DELAY_BETWEEN_REQUESTS}s\n")

    async with aiohttp.ClientSession() as session:
        while len(all_candles) < TARGET_LIMIT:
            needed = TARGET_LIMIT - len(all_candles)
            limit = min(needed, 1000)
            
            params = {
                "symbol": SYMBOL,
                "interval": INTERVAL,
                "limit": limit,
                "endTime": end_time
            }

            try:
                async with session.get(url, params=params) as response:
                    if response.status == 200:
                        batch = await response.json()
                        
                        if not batch:
                            print("✅ Стигнахме до самото начало на историята на тази монета.")
                            break
                        
                        parsed_batch = [{
                            "time": k[0] // 1000,
                            "open": float(k[1]),
                            "high": float(k[2]),
                            "low": float(k[3]),
                            "close": float(k[4]),
                            "volume": float(k[5])
                        } for k in batch]
                        
                        all_candles = parsed_batch + all_candles
                        end_time = (parsed_batch[0]["time"] - 1) * 1000
                        
                        if len(all_candles) % 10000 == 0:
                            print(f"📥 Изтеглени: {len(all_candles)} / {TARGET_LIMIT} свещи...")
                        
                    elif response.status == 429:
                        print("⚠️ Warning: Rate limit достигнат! Изчакване от 10 секунди...")
                        await asyncio.sleep(10)
                        continue
                    else:
                        print(f"❌ Грешка от Binance: {response.status} - {await response.text()}")
                        break
            except Exception as e:
                print(f"❌ Мрежова грешка: {e}")
                break

            await asyncio.sleep(DELAY_BETWEEN_REQUESTS)

    if all_candles:
        if len(all_candles) > TARGET_LIMIT:
            all_candles = all_candles[-TARGET_LIMIT:]
            
        with open(OUTPUT_FILE, 'w', encoding='utf-8') as f:
            json.dump(all_candles, f)
        
        print(f"\n🎉 УСПЕХ! Изтеглени общо {len(all_candles)} свещи.")
        print(f"💾 Записани във файл: {os.path.abspath(OUTPUT_FILE)}")
        
        first_date = time.strftime('%Y-%m-%d %H:%M:%S', time.gmtime(all_candles[0]['time']))
        last_date = time.strftime('%Y-%m-%d %H:%M:%S', time.gmtime(all_candles[-1]['time']))
        print(f"📅 Период: от {first_date} UTC до {last_date} UTC")
    else:
        print("\n❌ Не бяха изтеглени никакви свещи.")

if __name__ == "__main__":
    asyncio.run(download_data())