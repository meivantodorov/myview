@echo off
cd /d "%~dp0.."
REM Stop containers but preserve PostgreSQL volume and all data.
docker compose stop
