ScreenSync MCP — Agent Connect Kit (this machine)
==================================================
Paste the relevant block into your agent; it will configure and connect
automatically. Hub is live at http://192.168.1.2:3000 on this PC.

OPTION A — Claude Code: save as .mcp.json in your project root (or ~/.claude/.mcp.json for global):
{
  "mcpServers": {
    "screensync": {
      "command": "node",
      "args": ["C:\\Users\\epsol\\Downloads\\screensync_flutter_mcp_project\\mcp-server\\dist\\index.js"],
      "env": { "SCREEN_SYNC_TOKEN": "screensync-local-dev" }
    }
  }
}

OPTION B — Claude Desktop: merge into claude_desktop_config.json
(Win: %APPDATA%\Claude\claude_desktop_config.json), same "mcpServers" block
as above, then restart Claude Desktop.

OPTION C — Claude Code CLI one-liner:
claude mcp add screensync -- node "C:\Users\epsol\Downloads\screensync_flutter_mcp_project\mcp-server\dist\index.js"

OPTION D — HTTP-only agents (no MCP client needed):
Base URL:  http://192.168.1.2:3000
Header:    Authorization: Bearer screensync-local-dev
  GET  /api/mcp/catalog        full tool/skill/resource catalog
  GET  /api/screens/latest     latest phone screenshot (base64 image)
  GET  /api/device/status      connection + frame freshness
  POST /api/screens/upload     push a capture
  GET  /api/inspections/latest bug regions for the phone heatmap
  GET  /api/patches/latest     git patch for one-tap apply

AFTER CONNECTING (recommended order)
1. get_mcp_catalog        — discover every tool, prompt (skill), resource
2. get_device_status      — confirm a fresh phone frame exists
3. get_latest_screenshot  — inspect the raw 1080x2400 image (vision, no OCR)
4. publish_inspection     — send bug regions back to the phone Diagnose tab
5. publish_patch          — send a git fix for one-tap apply on the phone

Sample first prompt for the agent:
"Use get_latest_screenshot and tell me why the submit button is clipped at
the bottom of the screen. Publish your findings with publish_inspection."

NOTES
- Keep the desktop hub running:  cd mcp-server && npm start
- The agent's stdio instance shares the same mcp-server/data folder by
  default, so it sees exactly what the phone uploads in real time.
- Pairing token must match the phone (Settings -> Hub -> token).
