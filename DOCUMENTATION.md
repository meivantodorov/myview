# Binance Micro-Terminal — Пълна документация

## 1. Какво е това

**Binance Micro-Terminal** е локално хостван терминал за визуализация на крипто пазари и симулация на търговия. Той **не изпраща реални поръчки** към Binance — всичко е симулация в браузъра.

Системата се състои от три Docker контейнера:

| Контейнер | Роля | Порт |
|---|---|---|
| binance_frontend | HTML/JS терминал (nginx) | 3000 |
| binance-candle-service | FastAPI backend + sync/aggregation workers | 8000 |
| candle-db | PostgreSQL 16 | вътрешен 5432 |

## 2. Архитектура

Browser (localhost:3000) -> nginx -> FastAPI (localhost:8000) -> PostgreSQL (candle-db)

Binance Spot API -> FastAPI (REST + WebSocket)

**Ключов принцип:** Binance е единственият източник на 1m свещи. Всички останали timeframes (5m, 15m, 30m, 1h, 4h, 1d, 1w) се агрегират локално от 1m и се записват в PostgreSQL.

## 3. Структура на проекта

- docker-compose.yml — frontend compose
- backend/docker-compose.yml — db + api
- backend/app/ — FastAPI код
- backend/app/api/routes.py — REST endpoints
- backend/app/api/websocket.py — WebSocket
- backend/app/providers/binance.py — REST клиент
- backend/app/services/sync_worker.py — live + backfill + recovery
- backend/app/services/aggregation.py — OHLCV агрегация
- backend/app/services/aggregator_worker.py — batch jobs
- backend/app/storage/candles.py — UPSERT + queries
- client/index.html — HTML + CSS
- client/js/*.js — frontend логика
- client/indicators/*.js — MA + Volume

## 4. Data Model (PostgreSQL)

### 4.1. symbols
- symbol TEXT PK
- active BOOLEAN
- added_at TIMESTAMPTZ

### 4.2. candles
- symbol TEXT FK -> symbols
- timeframe TEXT (1m, 5m, 15m, 30m, 1h, 4h, 1d, 1w)
- open_time BIGINT (UTC Unix ms)
- close_time BIGINT (UTC Unix ms)
- open, high, low, close NUMERIC(30,12)
- volume NUMERIC(36,12)
- quote_volume NUMERIC(36,12)
- trades BIGINT
- is_closed BOOLEAN
- updated_at TIMESTAMPTZ

PK: (symbol, timeframe, open_time)
Index: ix_candles_lookup (symbol, timeframe, open_time DESC)

### 4.3. sync_status
- symbol TEXT PK/FK
- state TEXT (PENDING, STARTING, RUNNING, RECONNECTING, DEGRADED, PAUSED)
- last_sync_at TIMESTAMPTZ
- last_error TEXT
- last_open_time BIGINT
- updated_at TIMESTAMPTZ

### 4.4. aggregation_jobs
- id BIGSERIAL PK
- symbol TEXT
- open_time BIGINT
- status TEXT (PENDING, PROCESSING, DONE)
- attempts INTEGER
- created_at, processed_at TIMESTAMPTZ

Unique: (symbol, open_time)
Partial index: WHERE status = 'PENDING'

## 5. Data Flow

### 5.1. Добавяне на нов символ
Frontend -> POST /symbols -> SymbolManager.add -> validate -> set_symbol -> SymbolWorker.start -> load 1000x 1m -> start live/backfill/recovery loops

### 5.2. Live updates
Binance WS @kline_1m -> live_loop -> CANDLE_UPDATE (1m) -> publish -> aggregate -> CANDLE_UPDATE (tf) -> if closed: upsert + INSERT aggregation_jobs

### 5.3. Backfill
backfill_loop (на всеки 0.1s) -> oldest = MIN(open_time) -> fetch(limit=1000, endTime=oldest-1) -> upsert_many -> if < 1000: sleep 3600s

### 5.4. Агрегация
AggregatorWorker.process_batch (на всеки 1s) -> SELECT 5000 PENDING jobs FOR UPDATE SKIP LOCKED -> INSERT candles (bucket) ON CONFLICT UPDATE -> UPDATE jobs DONE

### 5.5. Четене
GET /candles/BTCUSDT?timeframe=5m&limit=1500 -> SELECT ORDER BY open_time DESC LIMIT N -> reverse -> serialize -> JSON

## 6. API Reference

Base URL: http://localhost:8000

### Health
- GET /health/live
- GET /health/ready
- GET /diagnostics

### Symbols
- GET /symbols
- GET /symbols/{symbol}
- GET /symbols/{symbol}/status
- POST /symbols {symbol} (admin)
- DELETE /symbols/{symbol} (admin)

### Candles
- GET /candles/{symbol}?timeframe=&limit=&visible_from=&visible_to=&prefetch_before=
- GET /candles/{symbol}/latest?timeframe=&limit=
- GET /candles/{symbol}/current?timeframe=

### WebSocket
ws://localhost:8000/ws
Handshake: Server CONNECTED, Client {symbol, timeframe}, Server HISTORY_BURST + SUBSCRIBED
Live: CANDLE_UPDATE (1m и агрегирани)

## 7. Configuration

### backend/.env
- API_KEY (празно = без auth)
- BINANCE_REST_URL=https://api.binance.com
- BINANCE_WS_URL=wss://stream.binance.com:9443/ws
- BINANCE_MAX_CONCURRENT_REQUESTS=3
- WATERMARK_SECONDS=120
- RECOVERY_INTERVAL_SECONDS=60
- BACKFILL_BATCH_SIZE=1000
- MAX_CANDLES_PER_REQUEST=5000
- ACTIVE_SYMBOL_LIMIT=5

## 8. Frontend

### Scripts (index.html)
- js/state.js — appState, URLs
- js/utils.js — health check
- js/chart.js — initChart, candleSeries
- js/indicators.js — registry
- js/trading.js — openPosition/closePosition
- js/tabs.js — switchTab, setTimeframe, paging
- js/websocket.js — WS reconnect
- js/main.js — bootstrap
- indicators/ma.js, indicators/volume.js

### Комуникация
- HTTP: /api/* -> nginx -> api:8000
- WS: ws://host/ws -> nginx -> api:8000/ws

## 9. Sync Workers

### SymbolWorker (по един на символ)
- live_loop — WebSocket Binance @kline_1m
- backfill_loop — 0.1s или 3600s, дърпа по 1000 1m назад
- recovery_loop — 60s, re-fetch последните 1000 1m

### AggregatorWorker (един за всички)
- На всеки 1s проверява PENDING jobs
- Batch 5000
- FOR UPDATE SKIP LOCKED
- UPSERT в 7 timeframes

### Timeframes
- 1m, 5m, 15m, 30m, 1h, 4h, 1d — epoch-aligned
- 1w — понеделник 00:00 UTC

## 10. Docker

### Стартиране
- docker compose -f backend\docker-compose.yml up -d --build
- docker compose up -d --build

### Спиране (запазва данни)
- docker compose -f backend\docker-compose.yml stop
- docker compose stop

### Персистентност
Dанните са в Docker volume backend_postgres_data.
Запазват се при restart, stop, down (без -v), рестарт на машината.
Изтриват се при down -v, volume rm, system prune --volumes.

### Backup
docker exec candle-db pg_dump -U candles candles > backups\candles-full-20261109.sql

## 11. Troubleshooting

| Симптом | Причина | Решение |
|---|---|---|
| port is already allocated | Друг контейнер | docker ps --filter publish=PORT -> спри |
| env file not found | Липсва backend/.env | Copy-Item backend\.env.example backend\.env |
| frontend не зарежда | nginx не вижда файлове | docker exec binance_frontend ls /usr/share/nginx/html |
| Candle Service Offline | Backend не работи | docker logs binance-candle-service |
| Candles: 9366/834 на 1d | Замърсен IndexedDB | F12 -> indexedDB.deleteDatabase('binance-micro-terminal-cache') |
| Symbol DEGRADED | Binance недостъпен | /diagnostics + логове |
| Липсват стари свещи | Backfill още работи | SELECT MIN(open_time) FROM candles |

## 12. Development

### Добавяне на нова двойка
През UI: + до табовете -> въведи SOLUSDC
През API:
Invoke-RestMethod -Method Post -Uri http://localhost:8000/symbols -ContentType application/json -Body '{"symbol":"SOLUSDC"}'

### Проверка на прогреса
- SELECT to_timestamp(MIN(open_time)/1000) FROM candles WHERE symbol='BTCUSDT' AND timeframe='1m';
- SELECT timeframe, COUNT(*) FROM candles WHERE symbol='BTCUSDT' GROUP BY timeframe;
- SELECT status, COUNT(*) FROM aggregation_jobs GROUP BY status;

## 13. Производителност

| Операция | Време |
|---|---|
| Backfill 4.8M 1m свещи | ~20-30 мин |
| Агрегация на цялата история | ~30-40 сек |
| SQL GROUP BY 4.8M 1m -> 5m | 6.5 сек |
| GET /candles?timeframe=5m&limit=500 | ~2 ms |
| JS агрегация 5000x 1m -> 5m | ~3 ms |

## 14. Ограничения (MVP)

1. Един API процес (без хоризонтално скалиране).
2. ACTIVE_SYMBOL_LIMIT=5 (може да се вдигне).
3. Няма reconciliation с Binance за агрегати.
4. Aggregation jobs не се чистят.
5. Няма authentication (API_KEY="'').
6. CORS е *.

## 15. Roadmap (production)

- Reverse proxy с TLS
- API key + per-client auth
- Prometheus metrics
- Retention за aggregation_jobs
- TimescaleDB / партициониране
- Reconciliation с Binance
- Backup cron
