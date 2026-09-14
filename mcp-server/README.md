# ScreenSync MCP Hub

Local HTTP + SSE Hub daemon connecting AI coding agents (Claude Desktop, Claude Code, Cursor, Windsurf, Gemini) to your mobile phone and browser extension.

## Getting Started

1. **Prerequisites**: [Node.js](https://nodejs.org) (v18 or newer).
2. **Start the Hub**:
   - **Windows**: Double-click `start-hub.bat` (or run `npm start`).
   - **macOS / Linux**: Run `./start-hub.sh` (or `npm start`).
3. **Pair Phone or Extension**:
   - Open your browser to `http://127.0.0.1:3000/pair` to view pairing QR code and token.
   - Enter pairing link into ScreenSync mobile app or browser extension.

## AI Agent Integration

Add ScreenSync Hub to your MCP client settings (e.g. `claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "screensync": {
      "command": "node",
      "args": ["<path-to-hub>/dist/index.js"]
    }
  }
}
```
