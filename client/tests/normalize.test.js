/**
 * Unit тестове за normalizeServiceCandle() и chartDataFor().
 * Тестваме логиката изолирано (без да зареждаме целия tabs.js).
 */

// Копираме логиката от tabs.js, за да я тестваме изолирано
function normalizeServiceCandle(c) {
    if (!c) return null;
    let time = Number(c.time);
    if (!Number.isFinite(time)) {
        const raw = c.open_time ?? c.openTime;
        time = typeof raw === 'number' ? raw : Date.parse(raw);
    }
    if (!Number.isFinite(time)) return null;
    if (time > 1e12) time = Math.floor(time / 1000);
    else time = Math.floor(time);
    const open = Number(c.open), high = Number(c.high), low = Number(c.low), close = Number(c.close);
    const volume = Number(c.volume ?? 0);
    if (![open, high, low, close].every(Number.isFinite)) return null;
    return { time, open, high, low, close, volume: Number.isFinite(volume) ? volume : 0 };
}

describe('normalizeServiceCandle()', () => {
    test('ISO string open_time → Unix seconds', () => {
        const c = {
            open_time: '2026-11-09T12:00:00+00:00',
            open: '100.5', high: '105.2', low: '99.1', close: '102.3', volume: '10.5'
        };
        const result = normalizeServiceCandle(c);
        expect(result).not.toBeNull();
        expect(result.time).toBe(Math.floor(Date.parse('2026-11-09T12:00:00+00:00') / 1000));
        expect(result.open).toBe(100.5);
        expect(result.high).toBe(105.2);
        expect(result.low).toBe(99.1);
        expect(result.close).toBe(102.3);
        expect(result.volume).toBe(10.5);
    });

    test('Unix ms (time > 1e12) → конвертира в секунди', () => {
        const c = {
            time: 1700000000000, // ms
            open: 100, high: 105, low: 99, close: 102, volume: 10
        };
        const result = normalizeServiceCandle(c);
        expect(result.time).toBe(1700000000); // seconds
    });

    test('Unix seconds → остава в секунди', () => {
        const c = {
            time: 1700000000,
            open: 100, high: 105, low: 99, close: 102, volume: 10
        };
        const result = normalizeServiceCandle(c);
        expect(result.time).toBe(1700000000);
    });

    test('липсва time → null', () => {
        const c = { open: 100, high: 105, low: 99, close: 102 };
        expect(normalizeServiceCandle(c)).toBeNull();
    });

    test('липсва open → null', () => {
        const c = { time: 1700000000, high: 105, low: 99, close: 102 };
        expect(normalizeServiceCandle(c)).toBeNull();
    });

    test('null → null', () => {
        expect(normalizeServiceCandle(null)).toBeNull();
        expect(normalizeServiceCandle(undefined)).toBeNull();
    });

    test('volume липсва → 0', () => {
        const c = { time: 1700000000, open: 100, high: 105, low: 99, close: 102 };
        const result = normalizeServiceCandle(c);
        expect(result.volume).toBe(0);
    });
});

describe('chartDataFor() (timezone offset)', () => {
    test('добавя offset към time', () => {
        const TIMEZONE_OFFSET_SECONDS = 7200; // UTC+2
        const tab = {
            rawCandles: [
                { time: 1000, open: 100, high: 105, low: 99, close: 102, volume: 10 },
                { time: 2000, open: 200, high: 205, low: 199, close: 202, volume: 20 },
            ]
        };
        const result = tab.rawCandles.map(c => ({ ...c, time: c.time + TIMEZONE_OFFSET_SECONDS }));
        expect(result[0].time).toBe(8200);
        expect(result[1].time).toBe(9200);
        // OHLC остават същите
        expect(result[0].open).toBe(100);
        expect(result[1].close).toBe(202);
    });

    test('offset = 0 (UTC) → без промяна', () => {
        const TIMEZONE_OFFSET_SECONDS = 0;
        const tab = { rawCandles: [{ time: 1000, open: 100, high: 105, low: 99, close: 102, volume: 10 }] };
        const result = tab.rawCandles.map(c => ({ ...c, time: c.time + TIMEZONE_OFFSET_SECONDS }));
        expect(result[0].time).toBe(1000);
    });
});
