@echo off
chcp 65001 >nul
title Stop Binance Terminal
cd /d "%~dp0"
docker-compose down
echo.
echo 🛑 Сървизът е спрян и контейнерите са изтрити.
pause