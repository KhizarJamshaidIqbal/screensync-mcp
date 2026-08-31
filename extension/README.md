# ScreenSync MCP — Browser Extension

The browser half of the ScreenSync bridge, as a Manifest V3 extension for
Chrome / Edge. Just like the mobile app hands an AI agent your **phone**,
this extension hands the agent your **web** — it can see, read, click and
type on your live browser tabs through the ScreenSync hub. It also doubles as
the live Android-screen dashboard + remote control for your phone.

## Features

- **Web access for AI agents** — with one toggle, the hub relays `web_*` tool
  calls to this extension, which runs them on your active tab and returns the
  result. `web_screenshot` / `web_hierarchy` to see and read a page,
  `web_click` / `web_type` / `web_navigate` / `web_scroll` to act on it.
- **Live streaming** — frames refresh the moment the hub receives them (SSE `frame` events).
- **Click-to-tap** — click the live frame to tap the phone; plus type / key / scroll / swipe / launch controls via the hub's ADB plane.
- **AI activity feed** — `tool`, `agent_connect`, `inspection`, `patch` events in real time.
- **Latency telemetry** — health pings (P50 latency) + SSE liveness chip.
- **MCP catalog browser** — tools / prompts / resources from `/api/mcp/catalog`, with stdio-only tools flagged.
- **One-click Connect Kit** — copies the same agent config kit the phone app produces (Claude Code `.mcp.json`, Claude Desktop, HTTP-only).
- **Onboarding** — probes localhost, accepts pairing links (`screensync://pair…`, JSON, `http://ip:port#token`), and pulls the setup guide from `https://screensyncmcp.epsoldev.com/setup-guide.json` (bundled fallback offline).

## How the web bridge works

1. The hub pushes a `web_request` over SSE; the service worker executes it on
   your active tab (`lib/web-tools.js`) and POSTs the result to `/api/web/result`.
2. Everything is gated behind the **Web access for AI agents** toggle on the
   dashboard — it defaults to **OFF** and nothing runs while it is off.
3. The hub only relays while it has seen our heartbeat recently, so a closed
   browser cleanly reads as "not connected".
4. Restricted pages (`chrome://`, extension pages, the web store, PDFs) are
   refused with a clear error rather than attempted.

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
3. Store listing: category Developer Tools; describe LAN-only operation and
   the opt-in web bridge. `<all_urls>` + `scripting` are requested so the
   agent can act on the user's own open tabs — justify it in the
   permission-justification notes: "Lets the user's own AI agent see and
   operate their live browser tabs through their local ScreenSync hub; the
   capability is off by default and gated by an explicit dashboard toggle."
4. Privacy practices: no remote data collection; settings stay in local
   extension storage; the only required host is the product website for the
   setup guide.

## Permissions rationale

| Permission | Why |
|---|---|
| `storage` | Hub URL / token / onboarding state / web-access toggle |
| `alarms` | Keep the service worker + SSE alive (30s health tick) |
| `tabs` | Find the active tab so web tools know where to act |
| `scripting` + `activeTab` | Run the `web_*` actions on the active tab and capture it |
| `host_permissions` (required) | The hub origins, the setup-guide site, and `<all_urls>` so web tools can act on whichever page the user has open |

> `<all_urls>` is broad by design: the extension's purpose is to let the
> user's own AI agent operate their live browser. It is inert until the user
> pairs with a hub AND flips the Web access toggle on. If you would rather
> scope it, narrow `<all_urls>` to the sites you want the agent to touch.

## Architecture notes

- MV3 service workers have no `EventSource`; SSE is parsed from
  `fetch(...).body` streams in `lib/sse-client.js` with backoff + 60s liveness abort.
- Pages talk to the worker over `chrome.runtime` ports (SSE push) and
  one-shot messages (`get-latest-frame`, `send-control`, `get-catalog`,
  `get-web-status`, `set-web-access`, …).
- Hub endpoints used: `/health`, `/api/events`, `/api/screens/latest`,
  `/api/device/status`, `/api/mcp/catalog`, `/api/inspections/latest`,
  `/api/patches/latest`, `/api/control/:action`, `/api/web/register`,
  `/api/web/result`, `/api/web/status`, `/api/web/tool`, `/pair`.

## v1 deferrals (stdio-only MCP tools, not exposed over HTTP)

`get_ui_hierarchy`, `control_tap_text`, `control_swipe_until`,
`control_open_url`, `compare_frames`, `get_logcat`, `record_screen`,
`wait_for_frame` — shown in the catalog as "via MCP stdio"; configure an AI
agent with the Connect Kit to use them.
