@echo off
chcp 65001 >nul
setlocal
set "ROOT=%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js not found on PATH.
  echo Please install Node.js, or run refresh.mjs with a full node path.
  pause
  exit /b 1
)

echo [1/3] Refreshing data from the wiki ...
cd /d "%ROOT%tools\data-pipeline"
node refresh.mjs
set "CODE=%ERRORLEVEL%"
if not "%CODE%"=="0" (
  echo.
  echo [FAILED] Refresh failed with exit code %CODE%. Local data was left untouched.
  echo.
  pause
  exit /b %CODE%
)

echo.
echo [2/3] Rebuilding the catalog the app reads ^(src\data\catalog.gen.json^) ...
cd /d "%ROOT%"
call npm run trim:catalog
set "CODE=%ERRORLEVEL%"
echo.
if not "%CODE%"=="0" (
  echo [FAILED] Catalog rebuild failed with exit code %CODE%.
  echo The app keeps showing the previous catalog until this step succeeds.
  echo.
  pause
  exit /b %CODE%
)

echo.
echo [3/3] Syncing the decoder catalog ^(generated\catalog.json^) ...
cd /d "%ROOT%tools\data-pipeline"
node sync-decoder-catalog.mjs
set "CODE=%ERRORLEVEL%"
echo.
if not "%CODE%"=="0" (
  echo [FAILED] Decoder catalog sync failed with exit code %CODE%.
  echo The capture parser keeps naming new species "unidentified pet N" until this succeeds.
  echo.
  pause
  exit /b %CODE%
)

echo [OK] Wiki data refreshed, app catalog rebuilt and decoder catalog synced.
echo      Start the app with: npm run dev
echo.
pause
exit /b 0
