#!/bin/bash
cd "$(dirname "$0")/mcp-server" || exit 1
if [ ! -d node_modules ]; then
  echo "Installing hub dependencies..."
  npm install || exit 1
fi
npm run dev
