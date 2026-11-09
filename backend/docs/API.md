# API quick reference

Base URL: `http://localhost:8000`

## Add / remove

`POST /symbols` body `{"symbol":"BTCUSDT"}`

`DELETE /symbols/BTCUSDT`

If `API_KEY` is non-empty, send header `X-API-Key`.

## Read candles

`GET /candles/BTCUSDT?timeframe=1m&limit=500`

`GET /candles/BTCUSDT?timeframe=5m&visible_from=2025-01-01T00:00:00Z&visible_to=2025-01-02T00:00:00Z&prefetch_before=20`

`GET /candles/BTCUSDT/latest?timeframe=1h&limit=100`

`GET /candles/BTCUSDT/current?timeframe=15m`

All timestamps in JSON are UTC ISO-8601. Numeric OHLCV values are strings to avoid floating-point precision loss.

## WebSocket

Connect `ws://localhost:8000/ws`, then send:
`{"symbol":"BTCUSDT","timeframe":"1m"}`

Initial response is `HISTORY_BURST`.
