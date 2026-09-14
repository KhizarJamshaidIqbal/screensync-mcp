#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"

echo "==================================================="
echo "  ScreenSync MCP Hub Daemon"
echo "==================================================="

if ! command -v node &> /dev/null; then
  echo "[ERROR] Node.js is not found in PATH!"
  echo "Please download and install Node.js (v18+) from https://nodejs.org"
  exit 1
fi

if [ ! -d "node_modules" ]; then
  echo "[INFO] First-run detected: installing dependencies..."
  npm install --omit=dev
fi

echo "[INFO] Starting ScreenSync Hub on http://127.0.0.1:3000 ..."
node dist/index.js
