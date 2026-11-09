BINANCE TRADING STACK — ОБЕДИНЕН ПРОЕКТ

Съдържа:
- frontend: Binance Micro-Terminal, обслужван от Nginx
- backend: Binance Candle Service Batch v2 (FastAPI)
- db: PostgreSQL 16
- docker-compose.yml: управлява трите услуги заедно

СТАРТИРАНЕ (Windows 10/11)
1. Стартирай Docker Desktop.
2. Разархивирай проекта.
3. Провери .env — при първо стартиране scripts\start.bat създава файла от .env.example.
4. ВАЖНО ЗА СТАРАТА БАЗА: провери името на стария Docker volume преди първото стартиране (виж „ЗАПАЗВАНЕ НА СТАРИТЕ ДАННИ“).
5. Стартирай scripts\start.bat.
6. Отвори http://localhost:8080

АДРЕСИ
- Терминал: http://localhost:8080
- API документация: http://localhost:8000/docs
- Диагностика: http://localhost:8000/diagnostics
- WebSocket: ws://localhost:8080/ws (автоматично през Nginx)
- Frontend изпраща HTTP заявките през /api към backend.

СКРИПТОВЕ
- scripts\start.bat   — build + start на целия проект
- scripts\stop.bat    — спира контейнерите, без да изтрива данните
- scripts\restart.bat — рестарт на услугите
- scripts\status.bat  — статус + диагностика
- scripts\logs.bat    — логове на всички; например scripts\logs.bat api
- scripts\backup.bat  — SQL backup на PostgreSQL
- scripts\down.bat    — премахва контейнерите/мрежата, но пази volume

НЕ ИЗПОЛЗВАЙ docker compose down -v — това изтрива PostgreSQL volume.
Не изтривай ръчно aggregation_jobs или таблиците с candles.

ЗАПАЗВАНЕ НА СТАРИТЕ ДАННИ — ЗАДЪЛЖИТЕЛНО ПРЕДИ ПЪРВО ПУСКАНЕ
Старият compose създава volume с име <име-на-стария-compose-проект>_postgres_data.
Пътят ти преди беше папка „service“, затова .env.example задава service_postgres_data.
Потвърди действителното име с:
  docker volume ls
  docker inspect service_postgres_data
Ако старият volume е с друго име, промени POSTGRES_VOLUME_NAME в .env на ТОЧНОТО име.
Ако не си сигурен, НЕ стартирай още новия stack — изпрати изхода от docker volume ls.

Ако старият контейнер candle-db още работи, първо направи backup (стария проект: scripts\backup.bat), после го спри. Не изтривай volume.

ПРОМЯНА НА ПОРТОВЕ
В .env: FRONTEND_PORT=8080, API_PORT=8000.
Ако 8000 е зает, смени API_PORT; ако 8080 е зает, смени FRONTEND_PORT.
