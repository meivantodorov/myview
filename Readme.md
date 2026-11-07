# Binance Micro-Terminal

A Dockerized Binance market-data service and browser-based chart/trading simulator.

## Architecture

- `services/fetcher/main.py` — FastAPI application, Binance REST/WebSocket orchestration, history API and diagnostics.
- `services/fetcher/data/candles.sqlite3` — durable 1m OHLCV store; unique `(symbol, time)` key and idempotent UPSERT writes.
- `client/js/state.js` — shared application state and configuration.
- `client/js/tabs.js` — symbol tabs, timeframe preferences, history paging and live candle projection.
- `client/js/chart.js` — chart creation, UTC bucket aggregation helpers and chart overlays.
- `client/js/websocket.js` — browser WebSocket handling and chart interactions.
- `client/indicators/` — indicator plugins (Volume and MA).

## Candle lifecycle

Binance REST is the source for historical closed 1m candles. On startup the service imports any legacy JSON cache, synchronizes the latest candles, backfills toward the earliest available Binance candle, repairs interior 1m gaps, then performs a final recent sync. Binance's 1m WebSocket updates the live candle in memory and writes it to SQLite only when the exchange marks it closed. SQLite UPSERT makes reconnects and overlapping REST pages safe.

All stored timestamps are UTC Unix seconds. Higher timeframes are aggregated on the backend from 1m rows using UTC epoch-aligned buckets. The history API returns chronological pages and an explicit `has_more` flag. The frontend fetches older pages as the user approaches the left edge and preserves the visible chart range when prepending data. Each symbol's selected timeframe is persisted separately in browser localStorage.

## Run

Requires Docker Desktop and Docker Compose:

- Build/start: `docker compose up -d --build`
- Stop: `docker compose down`
- Status: `docker compose ps`
- Backend logs: `docker compose logs -f backend`

Frontend: http://localhost:3000  
Backend diagnostics: http://localhost:8080

## Diagnostics and API

- `GET /api/diagnostics` — service, WebSocket, backfill and per-symbol storage state, including interior gap counts.
- `GET /api/integrity` — backend source hash.
- `GET /api/history/{symbol}?timeframe=1m&limit=1500` — newest history page.
- `GET /api/history/{symbol}?timeframe=1d&limit=1500&before={oldest_time}` — previous page.

See `tasks/time_frame.md` for the detailed history, recovery and pagination contract.
