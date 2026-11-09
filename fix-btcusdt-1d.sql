DELETE FROM candles WHERE symbol='BTCUSDT' AND timeframe='1d';
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
FROM candles WHERE symbol='BTCUSDT' AND timeframe='1m'
GROUP BY symbol, (open_time / 86400000) * 86400000;
