/**
 * Unit тестове за saveTabsToStorage() и loadTabsFromStorage().
 * Тестваме localStorage запазване/възстановяване изолирано.
 */

// Mock localStorage
const localStorageMock = (() => {
    let store = {};
    return {
        getItem: jest.fn(key => store[key] || null),
        setItem: jest.fn((key, value) => { store[key] = String(value); }),
        removeItem: jest.fn(key => { delete store[key]; }),
        clear: jest.fn(() => { store = {}; }),
    };
})();
global.localStorage = localStorageMock;

// Копираме логиката от state.js
const TABS_STORAGE_KEY = 'myview.tabs';
const ACTIVE_TAB_STORAGE_KEY = 'myview.activeTab';

function saveTabsToStorage(appState) {
    try {
        const tabsToSave = appState.tabs.map(t => ({
            id: t.id,
            symbol: t.symbol,
            timeframe: t.timeframe,
            currentPrice: t.currentPrice,
            position: t.position ? { side: t.position.side, entry: t.position.entry, sl: t.position.sl, tp: t.position.tp, sizeUSD: t.position.sizeUSD } : null,
            history: t.history || []
        }));
        localStorage.setItem(TABS_STORAGE_KEY, JSON.stringify(tabsToSave));
        localStorage.setItem(ACTIVE_TAB_STORAGE_KEY, String(appState.activeTabId || ''));
    } catch (e) { console.warn('[Tabs] Failed to save', e); }
}

function loadTabsFromStorage() {
    try {
        const raw = localStorage.getItem(TABS_STORAGE_KEY);
        if (!raw) return null;
        const tabs = JSON.parse(raw);
        const activeId = localStorage.getItem(ACTIVE_TAB_STORAGE_KEY);
        return { tabs, activeId: activeId ? Number(activeId) : null };
    } catch (e) { console.warn('[Tabs] Failed to load', e); return null; }
}

describe('Tab persistence', () => {
    beforeEach(() => {
        localStorage.clear();
        jest.clearAllMocks();
    });

    test('saveTabsToStorage записва табовете в localStorage', () => {
        const appState = {
            tabs: [
                { id: 1, symbol: 'BTCUSDT', timeframe: '1m', currentPrice: 74000, position: null, history: [] },
                { id: 2, symbol: 'SOLUSDC', timeframe: '15m', currentPrice: 87.5, position: null, history: [] },
            ],
            activeTabId: 2
        };
        saveTabsToStorage(appState);

        const saved = JSON.parse(localStorage.getItem(TABS_STORAGE_KEY));
        expect(saved).toHaveLength(2);
        expect(saved[0].symbol).toBe('BTCUSDT');
        expect(saved[1].symbol).toBe('SOLUSDC');
        expect(saved[1].timeframe).toBe('15m');
        expect(localStorage.getItem(ACTIVE_TAB_STORAGE_KEY)).toBe('2');
    });

    test('loadTabsFromStorage връща запазените табове', () => {
        const appState = {
            tabs: [{ id: 1, symbol: 'BTCUSDT', timeframe: '1m', currentPrice: 74000, position: null, history: [] }],
            activeTabId: 1
        };
        saveTabsToStorage(appState);

        const result = loadTabsFromStorage();
        expect(result).not.toBeNull();
        expect(result.tabs).toHaveLength(1);
        expect(result.tabs[0].symbol).toBe('BTCUSDT');
        expect(result.activeId).toBe(1);
    });

    test('loadTabsFromStorage при празен localStorage → null', () => {
        expect(loadTabsFromStorage()).toBeNull();
    });

    test('loadTabsFromStorage при повреден JSON → null', () => {
        localStorage.setItem(TABS_STORAGE_KEY, 'not valid json {');
        expect(loadTabsFromStorage()).toBeNull();
    });

    test('запазва position ако има', () => {
        const appState = {
            tabs: [{
                id: 1, symbol: 'BTCUSDT', timeframe: '1m', currentPrice: 74000,
                position: { side: 'buy', entry: 74000, sl: 73000, tp: 76000, sizeUSD: 100 },
                history: []
            }],
            activeTabId: 1
        };
        saveTabsToStorage(appState);

        const result = loadTabsFromStorage();
        expect(result.tabs[0].position).toEqual({
            side: 'buy', entry: 74000, sl: 73000, tp: 76000, sizeUSD: 100
        });
    });

    test('не запазва rawCandles (не са нужни при reload)', () => {
        const appState = {
            tabs: [{ id: 1, symbol: 'BTCUSDT', timeframe: '1m', currentPrice: 74000, position: null, history: [], rawCandles: [1,2,3] }],
            activeTabId: 1
        };
        saveTabsToStorage(appState);

        const saved = JSON.parse(localStorage.getItem(TABS_STORAGE_KEY));
        expect(saved[0].rawCandles).toBeUndefined();
    });

    test('запазва history (trade log)', () => {
        const appState = {
            tabs: [{
                id: 1, symbol: 'BTCUSDT', timeframe: '1m', currentPrice: 74000,
                position: null,
                history: [{ side: 'buy', pnl: 50, reason: 'TP' }]
            }],
            activeTabId: 1
        };
        saveTabsToStorage(appState);

        const result = loadTabsFromStorage();
        expect(result.tabs[0].history).toHaveLength(1);
        expect(result.tabs[0].history[0].pnl).toBe(50);
    });
});
