@echo off
setlocal
cd /d "%~dp0..\client"
echo ============================================
echo  Frontend tests (Jest)
echo ============================================
echo.
call npm test
if errorlevel 1 (
    echo.
    echo FRONTEND TESTS FAILED
    pause
    exit /b 1
)
echo.
echo ============================================
echo  ALL FRONTEND TESTS PASSED
echo ============================================
pause
