@echo off
title ScreenSync Hub
cd /d "%~dp0mcp-server"
if not exist node_modules (
  echo Installing hub dependencies...
  call npm install
  if errorlevel 1 exit /b 1
)
call npm run dev
