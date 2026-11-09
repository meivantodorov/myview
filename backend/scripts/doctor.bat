@echo off
cd /d "%~dp0.."
echo === Docker version ===
docker --version
echo === Compose version ===
docker compose version
echo === Containers ===
docker compose ps
echo === API readiness ===
powershell -NoProfile -Command "try { Invoke-RestMethod http://localhost:8000/health/ready | ConvertTo-Json -Depth 5 } catch { Write-Host $_; exit 1 }"
echo === Recent API logs ===
docker compose logs --tail=80 api
