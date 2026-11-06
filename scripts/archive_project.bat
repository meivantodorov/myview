@echo off
setlocal

:: 1. Взимаме текущата директория (където се намира папка "scripts") и се качваме едно ниво нагоре (в главната папка на проекта)
cd /d "%~dp0.."

:: 2. Проверяваме дали папка "archive" съществува, ако не - я създаваме
if not exist "archive" (
    mkdir "archive"
)

:: 3. Изтриваме стария архив, ако съществува (за да не се дублира вътре в себе си)
if exist "archive\project.zip" (
    del /f /q "archive\project.zip"
)

echo Creating archive...
echo Please wait...

:: 4. Създаваме архива с PowerShell
:: Изключваме папките "archive" и "scripts", за да не се архивира самият скрипт и стария архив вътре в новия
powershell -NoProfile -Command "Get-ChildItem -Path . -Exclude 'archive','scripts' | Compress-Archive -DestinationPath 'archive\project.zip' -Force"

if %errorlevel% neq 0 (
    echo Error: Failed to create archive.
    pause
    exit /b %errorlevel%
)

echo.
echo Success! Archive created at: archive\project.zip
pause
