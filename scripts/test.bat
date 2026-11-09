@echo off
setlocal
cd /d "%~dp0.."

echo ============================================
echo  Тестове на backend
echo ============================================
echo.

echo [1/3] Rebuild backend...
docker compose -f backend\docker-compose.yml up -d --build
if errorlevel 1 (
    echo ГРЕШКА: Rebuild failed
    exit /b 1
)

echo.
echo [2/3] Инсталиране на pytest...
docker exec binance-candle-service pip install --quiet pytest pytest-asyncio
if errorlevel 1 (
    echo ГРЕШКА: pytest install failed
    exit /b 1
)

echo.
echo [3/3] Пускане на тестове...
echo.
echo --- Unit тестове ---
docker exec binance-candle-service python -m pytest tests/test_aggregation_strict.py -v
if errorlevel 1 (
    echo.
    echo UNIT TESTS FAILED
    pause
    exit /b 1
)

echo.
echo --- Integration тестове ---
docker exec binance-candle-service python -m pytest tests/test_data_consistency.py -v -m integration
if errorlevel 1 (
    echo.
    echo INTEGRATION TESTS FAILED
    pause
    exit /b 1
)

echo.
echo ============================================
echo  ВСИЧКИ ТЕСТОВЕ МИНАХА
echo ============================================
pause
