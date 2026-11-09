$ErrorActionPreference = "Stop"
Set-Location (Join-Path $PSScriptRoot "..")
if (!(Test-Path ".env")) { Copy-Item ".env.example" ".env"; Write-Host "Created .env; review its credentials." }
docker compose up --build -d
if ($LASTEXITCODE -ne 0) { throw "Docker Compose failed. Check Docker Desktop." }
Write-Host "API: http://localhost:8000 | Swagger: http://localhost:8000/docs"
