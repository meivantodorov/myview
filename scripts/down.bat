@echo off
cd /d "%~dp0.."
echo This removes containers and network only. The database volume is retained.
docker compose down
