# Binance Micro-Terminal

## 1. Визуализация на проблема и решението
**Проблем:** Традиционните крипто борси (като Binance) имат сложни интерфейси, които не позволяват бързо управление на множество малки позиции с прецизен контрол върху риска (R:R). Освен това, директното дърпане на WebSocket данни от Binance за много табове натоварва браузъра и бързо удря rate limits.
**Решение:** "Micro-Terminal" архитектура. Клиент-сървър модел, който работи изолирано в Docker контейнери. Python микросървиз агрегира, кешира и стриймва данни от Binance, а Frontend-ът (Single Page App), сервиран от Nginx, се грижи за визуализацията и локалната симулация на портфейла.

## 2. Технологичен стек (Dependencies)
- **Backend:** Python 3.11, FastAPI, Uvicorn, `websockets`, `aiohttp`.
- **Frontend:** Vanilla JavaScript (ES6+), HTML5, CSS3, `lightweight-charts` (v4.1.1).
- **Инфраструктура:** Docker, Docker Compose, Nginx.

## 🚀 3. Управление на проекта през Docker
За да стартирате целия проект (Backend + Frontend) е нужно да имате инсталиран **Docker Desktop** и той да работи във фонов режим.

Има готови предифинирани скриптове в директорията /scripts. Те позволяват стартиране, спиране, рестартиране и проверка на статус.

Project tree:

myview> tree /F
Folder PATH listing
Volume serial number is 381B-7FAA
C:.
│   .gitignore
│   agents.md
│   debug_service.bat
│   docker-compose.yml
│   project.zip
│   Readme.md
│
├───archive
│       project.zip
│
├───client
│   │   Dockerfile
│   │   Frontend Spec.md
│   │   index.html
│   │
│   ├───indicators
│   │       ma.js
│   │       volume.js
│   │
│   └───js
│           chart.js
│           indicators.js
│           main.js
│           state.js
│           tabs.js
│           trading.js
│           utils.js
│           websocket.js
│
├───scripts
│       archive_project.bat
│       base64.md
│       copy.bat
│       generate_base64.bat
│       paste.bat
│       restart_service.bat
│       start_service.bat
│       status_service.bat
│       stop_service.bat
│       update.bat
│
├───services
│   └───fetcher
│       │   Backend Spec.md
│       │   config.json
│       │   debug_candles.py
│       │   Dockerfile
│       │   main.py
│       │   readme.txt
│       │   requirements.txt
│       │
│       └───__pycache__
│               main.cpython-313.pyc
│
└───tasks
        indicators_plugin_system.md
        new_tab_button_fix.md
        time_frame.md
