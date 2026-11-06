@echo off
chcp 65001 >nul
title Start Binance Terminal
cd /d "%~dp0"
docker-compose up -d --build
echo.
echo ✅ Сървизът е стартиран!
echo 👉 Frontend: http://localhost:3000
echo 👉 Backend:  http://localhost:8080/
pause