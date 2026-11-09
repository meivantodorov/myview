# Troubleshooting

## Docker не стартира

- Стартирайте Docker Desktop и проверете Linux container mode.
- `docker compose version`
- `scripts\doctor.bat`
- Проверете дали порт 8000 или 5432 не е зает.

## API не е ready

```powershell
docker compose ps
docker compose logs --tail=200 db
docker compose logs --tail=200 api
Invoke-RestMethod http://localhost:8000/health/ready
```
Ако DB healthcheck е unhealthy, проверете `.env` credentials и Docker volume permissions.

## Symbol остава DEGRADED / RECONNECTING

Проверете:
- интернет/DNS и достъп до `api.binance.com`;
- дали символът е Spot и `TRADING`;
- Binance rate-limit / HTTP 429;
- API logs за `component=binance`, `live`, `recovery` или `backfill`.

Публичните Binance endpoints не изискват API key.

## Няма исторически данни

1. `GET /symbols/{symbol}/status`
2. `GET /diagnostics`
3. Проверете дали Binance връща klines за символа.
4. Проверете `aggregation_jobs` backlog и логовете.

## Възстановяване след грешна конфигурация

- Коригирайте `.env`.
- `docker compose up -d --force-recreate api`
- Данните остават в PostgreSQL volume.
- Не използвайте `docker compose down -v`, освен ако съзнателно искате да изтриете базата.

## Често използвани команди

```powershell
docker compose logs -f --tail=200 api
docker compose logs -f db
docker compose restart api
docker compose exec db psql -U candles -d candles
```
