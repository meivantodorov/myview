# Timeframe, candle history and pagination

## Data contract
- Binance timestamps are UTC Unix seconds. SQLite stores only closed 1m candles.
- The primary key is `(symbol, time)`; writes use UPSERT so reconnects and repeated backfills are idempotent.
- The backend derives 5m, 15m, 30m, 1h, 4h, 1d and 1w bars from stored 1m candles. Bucket boundaries are UTC epoch boundaries.
- API pages are ordered oldest-to-newest. `before` is an exclusive upper boundary; `has_more` indicates whether data exists before the returned page.

## Startup/recovery sequence
1. Import legacy JSON cache rows without overwriting existing SQLite rows.
2. Synchronize the newest closed 1m candles from Binance.
3. Backfill older pages until Binance returns no more data.
4. Detect interior gaps using adjacent stored timestamps and request missing ranges in bounded 1000-candle pages.
5. Synchronize the newest range once more after backfill.
6. Keep the 1m WebSocket running; persist a candle only after Binance marks it closed.

## Frontend behavior
- Timeframe preference is stored independently for each symbol in localStorage.
- Every history request is associated with a request generation and timeframe. Responses from a previous tab/timeframe are ignored.
- Older pages are requested only when `has_more` is true; an empty page or a page with no older timestamps terminates pagination.
- Appending history preserves the visible logical range by shifting it by the number of prepended bars.
- The frontend keeps UTC candle values for bucketing and applies the local display offset only when preparing chart points.

## Operational checks
- `GET /api/diagnostics` reports per-symbol oldest/newest timestamps, row count and detected internal gap count.
- `GET /api/history/{symbol}?timeframe=1d&limit=1500` returns the newest page.
- `GET /api/history/{symbol}?timeframe=1d&limit=1500&before={oldest_time}` returns the preceding page.
- After the final page, `has_more` must be false and the client must not issue further older-page requests.
