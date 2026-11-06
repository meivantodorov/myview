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

powershell -NoProfile -Command "$c = Get-Clipboard -Raw; if ($null -eq $c) { exit 2 }; [System.IO.File]::WriteAllText('%~f1', $c, (New-Object System.Text.UTF8Encoding($false)))"

if errorlevel 2 (
    echo Error: Clipboard is empty.
    exit /b 1
)
if errorlevel 1 (
    echo Error: Failed to write file.
    exit /b 1
)

echo File overwritten from clipboard: %~1
endlocal
