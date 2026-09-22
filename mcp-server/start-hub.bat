@echo off
setlocal
cd /d "%~dp0"

echo ===================================================
echo   ScreenSync MCP Hub Daemon
echo ===================================================

where node >nul 2>nul
if %errorlevel% neq 0 (
  echo [ERROR] Node.js is not found in PATH!
  echo Please download and install Node.js (v18+) from https://nodejs.org
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo [INFO] First-run detected: installing dependencies...
  call npm install --omit=dev
  if %errorlevel% neq 0 (
    echo [ERROR] npm install failed.
    pause
    exit /b 1
  )
)

if not "%~1"=="" (
  set "SCREEN_SYNC_PORT=%~1"
)
if "%SCREEN_SYNC_PORT%"=="" (
  set "SCREEN_SYNC_PORT=3000"
)

echo [INFO] Starting ScreenSync Hub on http://127.0.0.1:%SCREEN_SYNC_PORT% ...
node dist/index.js
pause
