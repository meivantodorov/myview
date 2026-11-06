@echo off
chcp 65001 >nul
title Status Binance Terminal
cd /d "%~dp0"
docker ps --filter "name=binance_"
echo.
echo (Ако виждаш 2 реда със статус "Up", всичко работи).
pause