@echo off
setlocal
cd /d "%~dp0.."
if not exist backups mkdir backups
for /f %%i in ('powershell -NoProfile -Command "Get-Date -Format yyyyMMdd-HHmmss"') do set STAMP=%%i
docker compose exec -T db sh -c "pg_dump -U \"$POSTGRES_USER\" \"$POSTGRES_DB\"" > "backups\candles-%STAMP%.sql"
if errorlevel 1 (echo Backup failed.& exit /b 1)
echo Backup saved: backups\candles-%STAMP%.sql
