@echo off
setlocal
cd /d "%~dp0.."
echo Running unit tests in a temporary container...
docker compose run --rm --no-deps --entrypoint sh api -c "pip install --no-cache-dir pytest pytest-asyncio && pytest -q"
if errorlevel 1 (
  echo Tests failed. Review the output above.
  exit /b 1
)
echo All tests passed.
