@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js not found on PATH.
  pause
  exit /b 1
)

echo Building the deployable version ...
call npm run build
if errorlevel 1 (
  echo.
  echo [FAILED] Build failed.
  pause
  exit /b 1
)

echo.
echo Done. Upload everything INSIDE this folder to your host:
echo   %~dp0dist
echo.
echo (Opening it in File Explorer ...)
start "" "%~dp0dist"
pause
exit /b 0
