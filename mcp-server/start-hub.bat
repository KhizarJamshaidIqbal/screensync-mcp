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

echo [INFO] Starting ScreenSync Hub on http://127.0.0.1:3000 ...
node dist/index.js
pause
