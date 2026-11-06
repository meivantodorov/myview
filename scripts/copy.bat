@echo off
setlocal

if "%~1"=="" (
    echo Usage: %~nx0 ^<file^>
    echo Example: %~nx0 client\indicators\ma.js
    exit /b 1
)

if not exist "%~1" (
    echo Error: File not found: %~1
    exit /b 1
)

powershell -NoProfile -Command "Get-Content -Raw -LiteralPath '%~f1' | Set-Clipboard"

if errorlevel 1 (
    echo Error: Failed to copy file to clipboard.
    exit /b 1
)

echo Copied to clipboard: %~1
endlocal
