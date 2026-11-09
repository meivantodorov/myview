# Архитектура

## Runtime

Един Docker Compose проект с два контейнера: FastAPI модулен монолит и PostgreSQL. Worker-ите са asyncio tasks в API процеса; не се изисква брокер на съобщения.

## Поток на данните

1. Symbol Manager валидира Spot symbol чрез `exchangeInfo`.
2. Sync Worker зарежда последните 1000 1m klines.
3. Live Worker получава текущия kline stream.
4. Recovery Worker периодично заявява следващите klines след локалния watermark.
5. Backfill Worker чете по-стари страници.
6. 1m UPSERT и aggregation job insert са в една DB транзакция.
7. Aggregator Worker взема job със `FOR UPDATE SKIP LOCKED`, преизчислява засегнатите bucket-и и маркира job DONE в същата транзакция.

## Инварианти

- Ключ на candle: `(symbol, timeframe, open_time)`.
- Повторно получена свещ се UPSERT-ва.
- Няма синтетични свещи за периоди без сделки.
- 1w bucket = понеделник 00:00 UTC.
- Източникът на истината за 1m е Binance Spot.
- Изходните timeframe-и са локални агрегации.

## Модули

- `providers/binance.py`: REST, retry/backoff, concurrency limit.
- `services/sync_worker.py`: live, backfill, recovery.
- `services/aggregation.py`: чисти функции за bucket и OHLCV.
- `services/aggregator_worker.py`: durable aggregation queue.
- `storage/candles.py`: SQL persistence и queries.
- `api/routes.py`: REST contract.
- `api/websocket.py`: client handshake/history.
- `db.py`: PostgreSQL schema.

## Съображения за production

Преди high-volume production: външен reverse proxy/TLS, API authentication, per-client authorization, live WS fanout, Binance reconciliation по агрегат, metrics endpoint/Prometheus, schema migrations (Alembic), load tests, retention/partitioning и distributed worker lease ако се пускат няколко API реплики.
