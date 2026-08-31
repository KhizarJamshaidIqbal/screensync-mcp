import { MDNS_TYPE } from './constants.js';

// JS port of lib/models/mcp_catalog.dart buildConnectKitText() so the kit
// copied here matches the phone app's output.
export function buildConnectKit({ hubUrl, token, stdioNote = '', usage = [] }) {
  const stdioConfig = `{
  "mcpServers": {
    "screensync": {
      "command": "node",
      "args": ["<HUB_DIR>/screensync-hub.js"],
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
  ADVANCED (Playwright-grade):
  web_eval        run JavaScript in the page and return the result
  web_console     console + page-error buffer (sinceCursor / clear)
  web_network     fetch/XHR buffer with status + duration
  web_dialog      intercepted alert/confirm/prompt (auto-handled, logged)
  web_storage     localStorage / sessionStorage / cookies read-set-clear
  web_perf        Core Web Vitals (FCP/LCP/CLS) + slowest resources
  web_tabs        list tabs          web_tab  open / switch / close
  web_wait_for    wait for selector or text
  web_key         press a key (Enter submits forms)
  web_hover       hover an element   web_select  pick a dropdown option
  web_watch       REALTIME: 500ms frames with change detection, returned as images

AFTER CONNECTING
${usageBlock}
`;
}

// One-paste autonomous setup: hand it to any MCP-capable agent (Claude Code,
// Antigravity, Qoder, …) and it downloads + starts the hub and wires itself
// up — no repo, no manual config. Same text for every user; only the paired
// hub URL + token are embedded.
export function buildAgentSetupPrompt({ hubUrl, token }) {
  return `Set up ScreenSync MCP on this computer so you can use my Android phone and my browser as tools. Work autonomously; only stop and ask me if a step fails twice.

1. DOWNLOAD THE HUB (no source repo needed)
   Fetch https://screensyncmcp.epsoldev.com/downloads/screensync-hub.zip and unzip it into a folder you choose (e.g. ~/screensync-hub). It contains screensync-hub.js (a single-file server) plus start-hub.bat / start-hub.sh.

2. START THE HUB in the background
   Windows: run start-hub.bat · macOS/Linux: ./start-hub.sh · or: node screensync-hub.js
   It listens on port 3000. Verify: GET http://localhost:3000/health must return {"ok":true}.

3. REGISTER YOURSELF as an MCP client named "screensync" using whatever mechanism your environment provides (Claude Code: .mcp.json or \`claude mcp add\`; Antigravity / Qoder / Cursor / others: their MCP settings):
   command: node
   args: ["<unzipped folder>/screensync-hub.js"]
   env: SCREEN_SYNC_TOKEN = ${token}

4. MY DEVICES ARE ALREADY PAIRED to this hub:
   Hub URL: ${hubUrl} (on this same machine, http://localhost:3000 also works)
   Pairing token: ${token}
   After connecting, call get_device_status and web_status to confirm the phone and browser bridges are live, then get_mcp_catalog for the full tool list.

If port 3000 is busy or the health check fails, check my firewall and report the exact error.`;
}
