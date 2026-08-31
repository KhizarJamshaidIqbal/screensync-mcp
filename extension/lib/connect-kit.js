import { MDNS_TYPE } from './constants.js';

// JS port of lib/models/mcp_catalog.dart buildConnectKitText() so the kit
// copied here matches the phone app's output.
export function buildConnectKit({ hubUrl, token, stdioNote = '', usage = [] }) {
  const stdioConfig = `{
  "mcpServers": {
    "screensync": {
      "command": "node",
      "args": ["<SCREENSYNC_MCP_DIR>/dist/index.js"],
      "env": { "SCREEN_SYNC_TOKEN": "${token}" }
    }
  }
}`;
  const usageBlock = usage.length
    ? usage.map((u) => `  ${u}`).join('\n')
    : 'Call get_mcp_catalog, then get_device_status and get_latest_screenshot.';
  return `ScreenSync MCP — Agent Connect Kit
=================================
Hand this to any AI agent (Claude Code, Claude Desktop, or any MCP client)
and it will configure and connect to this ScreenSync hub automatically.

OPTION A — Claude Code: save as .mcp.json in your project root
${stdioConfig}

OPTION B — Claude Desktop: merge into claude_desktop_config.json
${stdioConfig}
${stdioNote}

OPTION C — HTTP-only agents (no stdio needed)
Base URL: ${hubUrl}
Bearer token: ${token}
Key endpoints:
  GET  /api/mcp/catalog        full tool/skill/resource catalog
  GET  /api/screens/latest     latest screenshot as base64 image
  GET  /api/device/status      connection + frame freshness
  POST /api/screens/upload     push a capture
  POST /api/web/tool           run a web_* tool through the browser extension
  GET  /api/web/status         web-bridge presence + active browser tab
  GET  /api/inspections/latest bug regions published by the agent
  GET  /api/patches/latest     git patch for one-tap apply
mDNS discovery type: ${MDNS_TYPE} (same-LAN auto discovery)

BROWSER ACCESS (web_* tools)
This hub also bridges your real browser through the ScreenSync extension —
the same way the mobile app gives the agent your phone. With the extension
connected and "Web access for AI agents" enabled in its dashboard:
  web_status      is the browser bridge online + active tab
  web_screenshot  see the live active tab (inline image)
  web_hierarchy   page text + indexed interactive elements
  web_navigate    open a URL in the user's browser
  web_click       click by text / selector / index
  web_type        type into a field (optional submit)
  web_scroll      scroll the page

AFTER CONNECTING
${usageBlock}
`;
}
