@echo off
cd /d "%~dp0.."
docker compose ps
echo.
powershell -NoProfile -Command "try { Invoke-RestMethod http://127.0.0.1:8000/diagnostics | ConvertTo-Json -Depth 6 } catch { Write-Host 'API diagnostics not available yet.' -ForegroundColor Yellow }"
