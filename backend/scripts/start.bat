@echo off
setlocal
cd /d "%~dp0.."
if not exist .env (
  copy .env.example .env >nul
  echo Created .env from .env.example. Review POSTGRES_PASSWORD before exposing this service.
)
docker compose up --build -d
if errorlevel 1 (
  echo Docker Compose failed. Check Docker Desktop and run scripts\doctor.bat
  exit /b 1
)
echo Service starting. API: http://localhost:8000  Docs: http://localhost:8000/docs
echo Logs: docker compose logs -f api
