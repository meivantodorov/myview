-- Изтриваме всички агрегирани timeframes за SOLUSDC (без 1m)
DELETE FROM candles WHERE symbol='SOLUSDC' AND timeframe IN ('5m','15m','30m','1h','4h','1d','1w');

-- Преизчисляваме 1d от 1m
INSERT INTO candles (symbol, timeframe, open_time, close_time, open, high, low, close, volume, quote_volume, trades, is_closed)
SELECT
    symbol, '1d',
    (open_time / 86400000) * 86400000,
    (open_time / 86400000) * 86400000 + 86400000 - 1,
    (array_agg(open ORDER BY open_time))[1],
    MAX(high), MIN(low),
    (array_agg(close ORDER BY open_time DESC))[1],
    SUM(volume), SUM(quote_volume), SUM(trades),
    BOOL_AND(is_closed)
FROM candles WHERE symbol='SOLUSDC' AND timeframe='1m'
GROUP BY symbol, (open_time / 86400000) * 86400000;

-- Преизчисляваме 1h от 1m
INSERT INTO candles (symbol, timeframe, open_time, close_time, open, high, low, close, volume, quote_volume, trades, is_closed)
SELECT
    symbol, '1h',
    (open_time / 3600000) * 3600000,
    (open_time / 3600000) * 3600000 + 3600000 - 1,
    (array_agg(open ORDER BY open_time))[1],
    MAX(high), MIN(low),
    (array_agg(close ORDER BY open_time DESC))[1],
    SUM(volume), SUM(quote_volume), SUM(trades),
    BOOL_AND(is_closed)
FROM candles WHERE symbol='SOLUSDC' AND timeframe='1m'
GROUP BY symbol, (open_time / 3600000) * 3600000;

-- Преизчисляваме 5m от 1m
INSERT INTO candles (symbol, timeframe, open_time, close_time, open, high, low, close, volume, quote_volume, trades, is_closed)
SELECT
    symbol, '5m',
    (open_time / 300000) * 300000,
    (open_time / 300000) * 300000 + 300000 - 1,
    (array_agg(open ORDER BY open_time))[1],
    MAX(high), MIN(low),
    (array_agg(close ORDER BY open_time DESC))[1],
    SUM(volume), SUM(quote_volume), SUM(trades),
    BOOL_AND(is_closed)
FROM candles WHERE symbol='SOLUSDC' AND timeframe='1m'
GROUP BY symbol, (open_time / 300000) * 300000;
