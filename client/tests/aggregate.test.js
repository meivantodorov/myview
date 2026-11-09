/**
 * Unit тестове за aggregateCandles() от client/js/chart.js
 */
const fs = require('fs');
const path = require('path');

// Зареждаме chart.js в тестова среда
const chartPath = path.resolve(__dirname, '../js/chart.js');
const chartCode = fs.readFileSync(chartPath, 'utf8');

// Мокираме LightweightCharts (не ни трябва за агрегацията)
global.LightweightCharts = {
    createChart: jest.fn(() => ({
        addCandlestickSeries: jest.fn(),
        timeScale: jest.fn(() => ({ subscribeVisibleLogicalRangeChange: jest.fn() })),
    })),
    CrosshairMode: { Normal: 0 },
    LineStyle: { Solid: 0 },
};

// Мокираме функции, които chart.js очаква
global.getActiveTab = jest.fn();
global.updateBpsOverlay = jest.fn();
global.TIMEZONE_OFFSET_SECONDS = 0;
global.COLORS = { tp: '#0ecb81', sl: '#f6465d', custom: '#f0b90b', entry: '#3b82f6' };
global.setInterval = jest.fn();

// Изпълняваме chart.js кода
eval(chartCode);

describe('aggregateCandles()', () => {
    test('1m → връща същите свещи', () => {
        const candles = [
            { time: 1000, open: 100, high: 105, low: 99, close: 102, volume: 10 },
            { time: 1060, open: 102, high: 108, low: 101, close: 107, volume: 20 },
        ];
        const result = aggregateCandles(candles, '1m');
        expect(result).toHaveLength(2);
        expect(result[0].open).toBe(100);
        expect(result[1].close).toBe(107);
    });

    test('5m: 5 × 1m → 1 × 5m с правилен OHLCV', () => {
        const base = 0; // кратно на 300
        const candles = [
            { time: base + 0,   open: 100, high: 105, low: 99,  close: 102, volume: 10 },
            { time: base + 60,  open: 102, high: 108, low: 101, close: 107, volume: 20 },
            { time: base + 120, open: 107, high: 110, low: 106, close: 109, volume: 30 },
            { time: base + 180, open: 109, high: 112, low: 108, close: 111, volume: 40 },
            { time: base + 240, open: 111, high: 115, low: 110, close: 114, volume: 50 },
        ];
        const result = aggregateCandles(candles, '5m');
        expect(result).toHaveLength(1);
        expect(result[0].open).toBe(100);
        expect(result[0].high).toBe(115);
        expect(result[0].low).toBe(99);
        expect(result[0].close).toBe(114);
        expect(result[0].volume).toBe(150);
    });

    test('5m: непълен bucket (3 × 1m)', () => {
        const candles = [
            { time: 0,   open: 100, high: 105, low: 99,  close: 102, volume: 10 },
            { time: 60,  open: 102, high: 108, low: 101, close: 107, volume: 20 },
            { time: 120, open: 107, high: 110, low: 106, close: 109, volume: 30 },
        ];
        const result = aggregateCandles(candles, '5m');
        expect(result).toHaveLength(1);
        expect(result[0].volume).toBe(60);
    });

    test('1h: 60 × 1m → 1 × 1h', () => {
        const candles = [];
        for (let i = 0; i < 60; i++) {
            candles.push({ time: i * 60, open: 100 + i, high: 105 + i, low: 99 + i, close: 102 + i, volume: 1 });
        }
        const result = aggregateCandles(candles, '1h');
        expect(result).toHaveLength(1);
        expect(result[0].open).toBe(100);
        expect(result[0].close).toBe(161);
        expect(result[0].volume).toBe(60);
    });

    test('празен масив → празен резултат', () => {
        expect(aggregateCandles([], '5m')).toEqual([]);
        expect(aggregateCandles(null, '5m')).toEqual([]);
    });

    test('два отделни 5m bucket-а', () => {
        const candles = [
            { time: 0,   open: 100, high: 105, low: 99,  close: 102, volume: 10 },
            { time: 300, open: 200, high: 205, low: 199, close: 202, volume: 20 },
        ];
        const result = aggregateCandles(candles, '5m');
        expect(result).toHaveLength(2);
        expect(result[0].open).toBe(100);
        expect(result[1].open).toBe(200);
    });
});
