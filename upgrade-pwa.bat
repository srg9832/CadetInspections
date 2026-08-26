@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0upgrade-pwa.ps1"
if errorlevel 1 (
  echo.
  echo PWA upgrade did not complete successfully.
  pause
  exit /b 1
)
echo.
pause
