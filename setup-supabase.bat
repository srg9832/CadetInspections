@echo off
setlocal
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup-supabase.ps1"
if errorlevel 1 (
  echo.
  echo Setup did not complete successfully.
  pause
  exit /b 1
)
echo.
echo Setup finished.
pause
