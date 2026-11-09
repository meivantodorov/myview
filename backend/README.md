# Binance Candle Service

Самостоятелен Binance Spot candle data service за Windows + Docker. Синхронизира 1m OHLCV, пази историята в PostgreSQL и предоставя REST API и клиентски WebSocket.

## Стартиране под Windows

**Изисквания:** Windows 10/11, Docker Desktop с Linux containers и Docker Compose v2.

1. Разархивирайте проекта в папка без специални права.
2. Стартирайте Docker Desktop и изчакайте да е готов.
3. Стартирайте `scripts\start.bat` (или `scripts\start.ps1`).
4. Отворете:
   - Swagger: http://localhost:8000/docs
   - Readiness: http://localhost:8000/health/ready
   - Диагностика: http://localhost:8000/diagnostics

Скриптът създава `.env` от `.env.example` при първо стартиране и изпълнява `docker compose up --build -d`. Пазарните Binance Spot данни са публични; API ключ на Binance не е необходим.

**Преди да отворите API извън локалната машина:** променете `POSTGRES_PASSWORD` в `.env`. Задайте `API_KEY` за защита на административните операции. За production поставете API зад reverse proxy с TLS и ограничете CORS/origins.

## Бърз старт с двойка

Административните endpoints приемат `X-API-Key`, ако `API_KEY` е зададен в `.env`.

```powershell
$headers = @{ "X-API-Key" = "" }
Invoke-RestMethod -Method Post -Uri http://localhost:8000/symbols `
  -Headers $headers -ContentType "application/json" -Body '{"symbol":"BTCUSDT"}'
Invoke-RestMethod http://localhost:8000/symbols
Invoke-RestMethod "http://localhost:8000/candles/BTCUSDT/latest?timeframe=1m&limit=10"
```

При празен `API_KEY` локалните административни endpoints са без API-key проверка. Добавянето валидира символа през Binance Exchange Info.

## Какво прави системата

- Binance Spot REST `/api/v3/klines` за първоначален набор, възстановяване и backfill.
- Binance Spot WebSocket `@kline_1m` за текущи промени.
- Приоритетно зарежда най-новите до 1000 свещи; след това отделен worker зарежда по-стара история на страници.
- Периодично допълва пропуски чрез REST; повторното записване е UPSERT.
- Съхранява 1m и локално генерирани 5m, 15m, 30m, 1h, 4h, 1d, 1w.
- Седмицата започва понеделник 00:00 UTC.
- `WATERMARK_SECONDS` е конфигурируем; текущата 1m свещ се държи и в оперативната памет.
- Премахването спира worker-а, но запазва историята. Повторното добавяне продължава от наличните данни.
- Няма зависимост на синхронизацията от външни клиенти.

## REST API

| Метод | Endpoint | Предназначение |
|---|---|---|
| POST | `/symbols` | Добавяне на двойка (admin) |
| DELETE | `/symbols/{symbol}` | Спиране на синхронизацията (admin) |
| GET | `/symbols` | Регистър |
| GET | `/symbols/{symbol}` | Информация |
| GET | `/symbols/{symbol}/status` | Състояние |
| GET | `/candles/{symbol}` | История |
| GET | `/candles/{symbol}/latest` | Последни свещи |
| GET | `/candles/{symbol}/current` | Текуща свещ/агрегат |
| GET | `/timeframes` | Времеви рамки |
| GET | `/health/live` | Liveness |
| GET | `/health/ready` | Readiness |
| GET | `/diagnostics` | Диагностика |

История: `GET /candles/BTCUSDT?timeframe=5m&visible_from=2025-01-01T00:00:00Z&visible_to=2025-01-02T00:00:00Z&prefetch_before=50`. Ако няма диапазон, default е последните 500 интервала. `prefetch_before` е брой свещи. `limit` може да ограничи default burst.

## WebSocket протокол

Свързване: `ws://localhost:8000/ws`

1. Сървърът изпраща `CONNECTED`.
2. Клиентът изпраща `{"symbol":"BTCUSDT","timeframe":"1m"}`.
3. Сървърът изпраща `HISTORY_BURST` и `SUBSCRIBED`.

След началната история gateway-ят изпраща `CANDLE_UPDATE` за текущата 1m свещ и `CANDLE_UPDATED` за преизчислените агрегати. Абонаментите се филтрират по symbol и timeframe. При прекъсване клиентът се свързва отново и заявява нов `HISTORY_BURST`; доставката не е durable message queue.

## Docker команди

```powershell
docker compose ps
docker compose logs -f api
docker compose logs -f db
docker compose restart api
docker compose down                 # спира, пази volume
docker compose down -v              # ВНИМАНИЕ: изтрива базата
```

Скриптове: `start.bat`, `stop.bat`, `logs.bat`, `doctor.bat`, `test.bat`.

## Тестове

```powershell
scripts\test.bat
```

Тестовете покриват агрегация OHLCV, седмична UTC граница, времеви рамки и валидиране на символ. Интеграционните тестове с реална Binance връзка не са част от автоматичния suite.

## Логове и диагностика

- Docker stdout: `docker compose logs -f api`
- Файлов лог: `logs/service.log` (ротация до 5 архива по 10 MB)
- Филтриране: `docker compose logs --since=10m api`
- JSON полета: `timestamp`, `level`, `logger`, `message`, `component`, `symbol`, `event`, `exception`.
- `/health/live`: процесът отговаря.
- `/health/ready`: проверява връзката с PostgreSQL.
- `/diagnostics`: worker-и, sync статус, последна свещ, брой свещи, чакащи aggregation jobs.
- `scripts\doctor.bat`: проверка на Docker, Compose, readiness и последните логове.

## Архитектура

```text
app/
  api/                 REST, health, client WebSocket
  providers/            Binance REST client
  services/             symbol manager, sync worker, aggregation worker
  storage/              PostgreSQL candle repository
  config.py             env settings
  db.py                 pool + schema
  timeframes.py         UTC bucket calculations
tests/                  unit tests
scripts/                Windows helper scripts
```

Всеки компонент е отделен Python модул. Добавянето на нова логика не изисква редактиране на един монолитен файл.

## Важни технически бележки / граници

1. Binance е външна зависимост; при недостъпност worker-ите се reconnect-ват с backoff.
2. Минутите без сделки не се синтезират като празни свещи.
3. Историческият backfill продължава назад до празна страница от Binance REST.
4. В този MVP reconciliation попълва пропуснати 1m записи, но не реализира пълно сравнение на всеки локален агрегат с официалната Binance свещ от съответния timeframe. Това остава отделна стъпка за production hardening.
5. `aggregation_jobs` се записват транзакционно с 1m upsert и се обработват повторяемо. Агрегатите се преизчисляват от наличните 1m редове.
6. Целевият мащаб по първоначалната концепция е до 5 активни двойки и един клиент. `ACTIVE_SYMBOL_LIMIT` е конфигурируем.
7. Backfill историческата страница използва REST `/klines`. Алтернативата `data.binance.vision` остава отворена и не е включена.
8. Използвайте само публични пазарни данни; проектът не изпълнява поръчки и не е trading bot.

## Backup

```powershell
docker compose exec -T db pg_dump -U candles candles > backups\candles.sql
```

Restore (спрете API преди възстановяване):
```powershell
Get-Content .\backups\candles.sql | docker compose exec -T db psql -U candles -d candles
```

## Лиценз

Вътрешна употреба; добавете лиценз според нуждите на deployment-а.


## Batch aggregation update (v2)

This version replaces one-job-at-a-time aggregation with bounded batches of up to
5,000 pending minute jobs. Each batch aggregates the affected 1m ranges into the
configured higher timeframes using PostgreSQL GROUP BY / UPSERT operations.
Live Binance ingestion and the public REST/WebSocket contracts are unchanged.

Repeated inserts of the same 1m candle no longer reset an existing aggregation
job to PENDING. On startup, jobs left in PROCESSING by an interrupted run are
returned to PENDING. A partial index supports pending-job selection.

### Safe upgrade from the existing Windows deployment

1. Run `scripts\backup.bat` from the existing service folder and confirm the backup file exists.
2. Stop the stack with `scripts\stop.bat`.
3. Extract this version to a new folder; keep the existing `.env` file and its secrets.
4. Copy the old `.env` into the new service folder. Do not overwrite it with `.env.example`.
5. Start with `scripts\start.bat` (it rebuilds the API image).
6. Check `http://127.0.0.1:8000/health/ready` and then `/diagnostics`.

The existing `aggregation_jobs` rows and candle data are preserved. The worker
will drain pending jobs in batches; do not manually delete or truncate that table.
The first startup may spend time creating the pending partial index. Database
runtime performance must be measured on the user's machine; Docker execution
was not available in this build environment.
