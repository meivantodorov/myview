# Backend Specification (Python FastAPI Service)

## 1. Основна цел
Сървизът работи като "прокси" между Binance и нашия Frontend. Той решава проблема с Rate Limits, като поддържа само **една** WebSocket връзка към Binance за всички двойки едновременно, кешира ги в паметта и ги раздава на всички свързани фронтенд клиенти.

## 2. Структура на проекта
- `main.py` - Целият сървиз (FastAPI app, WS Manager, Diagnostics).
- `config.json` - Конфигурационен файл, който се чете при стартиране.
- `requirements.txt` - Зависимости.

## 3. Ключови компоненти в `main.py`

### 3.1. Глобално състояние (`state`)
Всичко се пази в един голям речник в паметта (In-Memory). Това прави сървиза изключително бърз, но означава, че при рестарт историята се губи и се дърпа наново.
- `config`: Текуща конфигурация.
- `candles`: Речник с 1m свещи. Формат: `{ "BTCUSDT": [ {time, open, high, low, close, volume}, ... ] }`.
- `connections`: Статус на връзката с Binance (`True`/`False` за всяка двойка).
- `clients`: `set()` от всички активни WebSocket клиенти (браузъри).
- `logs`: Последните 200 лог съобщения (за Dashboard-а).

### 3.2. `BinanceWSManager` (Асинхронен клас)
- Стартира се като background task при стартиране на FastAPI.
- Свързва се към `wss://stream.binance.com:9443/stream?streams=btcusdt@kline_1m/ethusdt@kline_1m...`.
- При всяко получено съобщение:
  1. Обновява кеша в `state["candles"]` (ако свещта е нова, я добавя; ако е същата, обновява close/high/low).
  2. Изпраща съобщението до **всички** клиенти в `state["clients"]` под формата: `{"symbol": "BTCUSDT", "candle": {...}}`.
- При прекъсване на връзката, изчаква `ws_retry_delay` секунди и се свързва отново.

### 3.3. REST API Endpoints
- `GET /api/history/{symbol}`: Връща масив от 1m свещи за дадена двойка. Ако двойката не е в кеша, връща 404.
- `GET /api/diagnostics`: Връща JSON с uptime, брой клиенти, логове и статус на връзките.
- `POST /api/config`: Позволява обновяване на `config.json` през Dashboard-а.

### 3.4. WebSocket Endpoint
- `WS /ws/stream`: Единствен вход за всички клиенти. 
- Сървърът не изпраща нищо директно от този endpoint. Вместо това, той добавя клиента в `state["clients"]` и чака. Данните идват от `BinanceWSManager`.

### 3.5. Diagnostics Dashboard
- Намира се на адрес `/` (корена на сървиза).
- Написан е на чист HTML/JS вътре в Python файла.
- Показва:
  - Текуща конфигурация (може да се редактира).
  - Статус на връзките с Binance (зелено = CONNECTED, червено = DISCONNECTED).
  - Брой свързани клиенти.
  - Логове (с бутон за копиране).

## 4. Важни особености (Gotchas за LLM агенти)

### 4.1. Windows 11 Бъг (WinError 10013)
Windows 11 има бъг с HTTP/2 протокола за локални адреси. Ако сървизът се стартира с `host="0.0.0.0"` или без `http="h11"`, Windows ще блокира порта с грешка `WinError 10013`.
**Задължително** е стартирането да изглежда така:
```python
uvicorn.run("main:app", host="127.0.0.1", port=8080, reload=True, http="h11")
```

### 4.2. CORS (Cross-Origin Resource Sharing)
Тъй като Frontend-ът се отваря като локален файл (`file://`), браузърът блокира заявките към `localhost:8080`. 
**Задължително** е наличието на:
```python
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
```

### 4.3. Управление на логовете
Всички действия (успешни или грешки) трябва да минават през `log_event(msg, level)`. Това е единственият начин да се дебъгва сървизът през Dashboard-а.