@echo off
cd /d "%~dp0.."
if not exist backend\.env copy backend\.env.example backend\.env >nul
docker compose -f backend\docker-compose.yml up -d --build
if errorlevel 1 goto :err
docker compose up -d --build
if errorlevel 1 goto :err
echo.
echo Started!
echo Frontend: http://localhost:3000
echo Backend:  http://localhost:8000/
pause
exit /b 0

:err
echo Error while starting. Check Docker Desktop.
pause
exit /b 1
