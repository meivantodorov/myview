@echo off
chcp 65001 >nul
title Restart Binance Terminal
cd /d "%~dp0"
docker-compose restart
echo.
echo 🔄 Сървизът е рестартиран (без да се строи наново).
pause