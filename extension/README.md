# ScreenSync MCP — Browser Extension

Live Android-screen dashboard + remote control for your ScreenSync hub, as a
Manifest V3 extension for Chrome / Edge. It talks **only** to your hub's
existing HTTP + SSE API — the Android app and the hub are untouched.

## Features

- **Live streaming** — frames refresh the moment the hub receives them (SSE `frame` events).
- **Click-to-tap** — click the live frame to tap the phone; plus type / key / scroll / swipe / launch controls via the hub's ADB plane.
- **AI activity feed** — `tool`, `agent_connect`, `inspection`, `patch` events in real time.
- **Latency telemetry** — health pings (P50 latency) + SSE liveness chip.
- **MCP catalog browser** — tools / prompts / resources from `/api/mcp/catalog`, with stdio-only tools flagged.
- **One-click Connect Kit** — copies the same agent config kit the phone app produces (Claude Code `.mcp.json`, Claude Desktop, HTTP-only).
- **Onboarding** — probes localhost, accepts pairing links (`screensync://pair…`, JSON, `http://ip:port#token`), and pulls the setup guide from `https://screensyncmcp.epsoldev.com/setup-guide.json` (bundled fallback offline).

## Requirements

- Chrome / Edge 110+
- A computer running the hub: `cd mcp-server && npm install && npm run build && npm start`
- The Android app on your phone for captures (control tools need ADB reachable by the hub)

## Load unpacked (sideload)

1. Open `chrome://extensions` → enable **Developer mode**.
2. **Load unpacked** → select this `extension/` folder.
3. The onboarding tab opens automatically; connect to your hub.
4. Toolbar icon → popup status; **Open Dashboard** for the full view.

## Package for store / sharing

```powershell
pwsh -File scripts/package.ps1
```

Produces `extension.zip` (excludes README/scripts) ready for sideload
distribution or Chrome Web Store upload.

## Chrome Web Store submission (manual)

1. Zip via `scripts/package.ps1`.
2. https://chrome.google.com/webstore/devconsole → New item → upload zip.
3. Store listing: category Developer Tools; describe LAN-only operation.
   The LAN origin is requested at runtime via `optional_host_permissions`
   (`http://*/*`) — justify it in the permission-justification notes:
   "Connects to the user's own ScreenSync hub on their local network."
4. Privacy practices: no remote data collection; settings stay in local
   extension storage; the only required host is the product website for the
   setup guide.

## Permissions rationale

| Permission | Why |
|---|---|
| `storage` | Hub URL / token / onboarding state |
| `alarms` | Keep the service worker + SSE alive (30s health tick) |
| `host_permissions` (required) | `https://screensyncmcp.epsoldev.com/*` (setup guide), `http://localhost:*`, `http://127.0.0.1:*` |
| `optional_host_permissions` | `http://*/*` — requested at runtime, only for the hub origin you enter |

## Architecture notes

- MV3 service workers have no `EventSource`; SSE is parsed from
  `fetch(...).body` streams in `lib/sse-client.js` with backoff + 60s liveness abort.
- Pages talk to the worker over `chrome.runtime` ports (SSE push) and
  one-shot messages (`get-latest-frame`, `send-control`, `get-catalog`, …).
- Hub endpoints used: `/health`, `/api/events`, `/api/screens/latest`,
  `/api/device/status`, `/api/mcp/catalog`, `/api/inspections/latest`,
  `/api/patches/latest`, `/api/control/:action`, `/pair`.

## v1 deferrals (stdio-only MCP tools, not exposed over HTTP)

`get_ui_hierarchy`, `control_tap_text`, `control_swipe_until`,
`control_open_url`, `compare_frames`, `get_logcat`, `record_screen`,
`wait_for_frame` — shown in the catalog as "via MCP stdio"; configure an AI
agent with the Connect Kit to use them.
