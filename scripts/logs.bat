@echo off
cd /d "%~dp0.."
if "%~1"=="" (docker compose logs -f --tail=200) else (docker compose logs -f --tail=200 %*)
