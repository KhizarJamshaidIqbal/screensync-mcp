# ScreenSync MCP — Browser Extension

The browser half of the ScreenSync bridge, as a Manifest V3 extension for
Chrome / Edge. Just like the mobile app hands an AI agent your **phone**,
this extension hands the agent your **web** — it can see, read, click and
type on your live browser tabs through the ScreenSync hub. It also doubles as
the live Android-screen dashboard + remote control for your phone.

Product site, downloads and guide: https://screensyncmcp.epsoldev.com

## Quick start (sideload)

1. Grab the latest zip from https://screensyncmcp.epsoldev.com/extension.html
   (or clone this repo — the repo root **is** the extension folder).
2. Unzip it anywhere.
3. Open `chrome://extensions` (or `edge://extensions`) → enable **Developer mode**.
4. **Load unpacked** → select the unzipped folder (or this clone's root).
5. The onboarding tab opens automatically; connect to your hub.

The hub is a separate small local server — download it from the same page,
unzip, double-click `start-hub.bat` (or `sh start-hub.sh`). It prints a
pairing link + QR that the extension and the Android app both accept.

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
- The ScreenSync hub running on your computer (download from the site; needs Node 18+)
- The Android app on your phone for captures (control tools need ADB reachable by the hub)

## Source code

This repository is the complete extension source — no build step, no
dependencies. Load unpacked on the clone root and you're running the exact
code shipped in the site zip. The hub and Android app source live in a
private repo; the site zips always match this source.

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
