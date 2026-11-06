@echo off
setlocal
cd /d "%~dp0"

powershell -NoProfile -ExecutionPolicy Bypass -Command "$outFile = 'base64.md'; $excludeDirs = @('.git', 'archive', '__pycache__', 'node_modules', 'venv', 'env', 'tasks'); $excludeExts = @('.zip', '.pyc', '.png', '.jpg', '.jpeg', '.gif', '.ico', '.pdf', '.exe', '.dll', '.so', '.dylib', '.woff', '.woff2', '.ttf', '.eot'); if (Test-Path $outFile) { Remove-Item $outFile }; '# Project Base64 Dump' | Out-File -FilePath $outFile -Encoding utf8; $files = Get-ChildItem -Recurse -File | Where-Object { $skip = $false; $ext = $_.Extension.ToLower(); foreach ($d in $excludeDirs) { if ($_.FullName -match ('\\' + $d + '\\')) { $skip = $true; break } }; if ($ext -in $excludeExts -or $_.Name -eq $outFile) { $skip = $true }; -not $skip }; Write-Host ('Found ' + $files.Count + ' files. Encoding...'); foreach ($file in $files) { $rel = $file.FullName.Replace((Get-Location).Path + '\', ''); Write-Host ('Encoding: ' + $rel); $base64 = [Convert]::ToBase64String([IO.File]::ReadAllBytes($file.FullName)); Add-Content -Path $outFile -Value ('## File: ' + $rel); Add-Content -Path $outFile -Value '```text'; Add-Content -Path $outFile -Value $base64; Add-Content -Path $outFile -Value '```'; Add-Content -Path $outFile -Value '' }; Write-Host 'Done! Created base64.md' -ForegroundColor Green"

pause
