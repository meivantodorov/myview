@echo off
cd /d "%~dp0.."
docker compose stop
docker compose -f backend\docker-compose.yml stop
echo.
echo Stopped. PostgreSQL data preserved.
pause
