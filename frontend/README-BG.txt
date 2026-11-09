BINANCE MICRO-TERMINAL — OPTIMIZED FRONTEND PATCH

Какво включва:
- Пълно премахване на SHA-256/client/backend hash и integrity проверките.
- Премахване на стария WebSocket адрес :8080/ws/stream.
- Връзка към Binance Candle Service: HTTP http://127.0.0.1:8000 и WS ws://127.0.0.1:8000/ws.
- При избор на символ: проверка и автоматична регистрация в Candle Service.
- IndexedDB кеш по символ и timeframe: при повторно отваряне историята се визуализира от локалния кеш, без да чака мрежовия отговор.
- След показване на кеша се прави фоново обновяване на последните 1500 свещи; новите/променените свещи се сливат с кешираната история, без да се изтрива по-старият локален диапазон.
- Кешът се записва след мрежово обновяване, зареждане на по-стари страници и live WebSocket промени. Използва IndexedDB, не localStorage.
- По-старите свещи се зареждат при скрол наляво; live updates идват през WebSocket.
- Запазена е отделна проверка за готовност на услугата (това НЕ е хеширане).
- Debug Log остава, но вече не съдържа hash/integrity полета.

ИНСТАЛАЦИЯ
1. Направи копие на текущата папка на проекта.
2. Разархивирай ZIP архива.
3. Замени index.html в корена на проекта.
4. Замени файловете в js/ със съдържанието на js/ от архива.
5. Остави останалите файлове (chart.js, indicators.js, trading.js и indicators/) непроменени.
6. Стартирай Candle Service на порт 8000 и презареди терминала с Ctrl+F5.

API KEY
Ако .env на Candle Service съдържа API_KEY, задай го в браузърната конзола:
localStorage.setItem('myview.candleServiceApiKey', 'ТВОЯТ_API_KEY')
Ако API_KEY е празен, не е нужна допълнителна настройка.

ВАЖНО
- Не е променяна търговската логика, формулите за позиции, индикаторите или chart.js.
- Не е променяна Docker услугата. Кешът е само в браузъра и е отделен за всеки символ/timeframe.
- Проверени са JavaScript синтаксисът и целостта на ZIP архива. Не е възможен реален runtime тест към твоя локален Docker/browser от тази среда.


FIX 2 (timeframe + history):
- Debug statistics are now positioned at the bottom-right.
- Changing timeframe resets the WebSocket connection because the current backend protocol
  supports adding subscriptions but has no unsubscribe command. Reconnect clears old
  server-side subscriptions; the active timeframe is then subscribed again.
- Cached history now also triggers two background older-page prefetches after the latest
  server refresh. This avoids the cache path skipping automatic older-history prefetch.
- This does not manufacture history: older timeframe candles must exist in the backend DB.
