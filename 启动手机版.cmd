@echo off
chcp 65001 >nul
setlocal
set "ROOT=%~dp0"
cd /d "%ROOT%"

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js not found on PATH.
  echo Please install Node.js, or ask Codex to fix the environment.
  pause
  exit /b 1
)

echo [1/2] Building the app ...
call npm run build
if errorlevel 1 (
  echo.
  echo [FAILED] Build failed. Nothing was started.
  pause
  exit /b 1
)

echo.
echo [2/2] Serving for your phone. On the phone (same Wi-Fi), open one of:
for /f "usebackq delims=" %%a in (`powershell -NoProfile -Command "(Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' }).IPAddress"`) do echo    http://%%a:4173
echo.
echo   * Pick the address whose segment matches your Wi-Fi (usually 192.168.x.x).
echo   * First run: Windows Firewall may ask - allow Node.js on private networks.
echo   * Keep this window open while you use the phone; press Ctrl+C to stop.
echo.
call npm run preview -- --host 0.0.0.0 --port 4173 --strictPort
pause
exit /b 0
