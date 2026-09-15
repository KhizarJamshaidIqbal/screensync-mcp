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
- **MCP catalog browser** — 169 tools / 17 prompts / 3 resources from `/api/mcp/catalog`, with stdio-only tools flagged.
- **One-click Connect Kit** — copies the same agent config kit the phone app produces (Claude Code `.mcp.json`, Claude Desktop, HTTP-only).
- **Onboarding** — probes localhost, accepts pairing links (`screensync://pair…`, JSON, `http://ip:port#token`), and pulls the setup guide from `https://screensyncmcp.epsoldev.com/setup-guide.json` (bundled fallback offline).

## How the web bridge works

1. The hub pushes a `web_request` over SSE; the service worker executes it on
   your active tab (`lib/web-tools.js`) and POSTs the result to `/api/web/result`.
2. Everything is gated behind the **Web access for AI agents** toggle on the
   dashboard — it ships **ON by default** (owner decision, 2026-09-14); turn it OFF to stop all execution. Nothing runs while it is off, and writes still require a per-origin action grant.
3. The hub only relays while it has seen our heartbeat recently, so a closed
   browser cleanly reads as "not connected".
4. Restricted pages (`chrome://`, extension pages, the web store, PDFs) are
   refused with a clear error rather than attempted.

## Requirements

- Chrome / Edge 114+ (requires `sidePanel` and `offscreen` API support)
- The ScreenSync hub running on your computer (download from the site; needs Node 18+)
- The Android app on your phone for captures (control tools need ADB reachable by the hub)

## Source code

This repository is the complete extension source — no build step, no
dependencies. Load unpacked on the clone root and you're running the exact
code shipped in the site zip. The hub and Android app source live in a
private repo; the site zips always match this source.

## Permissions rationale

Every permission declared in `manifest.json` is mapped to active tool call sites and strictly audited:

| Permission | Backing Tools / Features | Call Sites | Justification |
|---|---|---|---|
| `storage` | Settings, pairing, approval queue, consent grants, rate limits | `lib/web-storage.js:10`, `lib/consent.js:15`, `lib/approval-gate.js:22` | Persists local configuration, site permissions, and pending approvals locally. |
| `alarms` | Service worker keepalive, SSE reconnect, flow scheduler | `background.js:122`, `lib/web-diag.js:28`, `lib/flow-scheduler.js:45` | Wakes the MV3 service worker to maintain the SSE stream and execute scheduled flows. |
| `tabs` | Tab resolution, navigation, lifecycle, multi-tab coordination | `background.js:130,137`, `lib/tab-resolve.js:22`, `lib/web-tab-mgmt.js:10` | Identifies agent-targeted tabs, coordinates tab creation, navigation, and cleanup. |
| `scripting` | DOM inspection, Playwright locators, in-page actions, eval | `lib/web-adv-core.js:8`, `lib/web-tools.js:164`, `lib/web-unit-*.js` | Injects self-contained execution units into tab context for clicking, typing, and scraping. |
| `activeTab` | Interactive toolbar/popup actions and fallback host access | `manifest.json:30`, `components/web-access.js:90` | Grants immediate tab access on user gesture even when broad host permissions are restricted. |
| `debugger` | CDP protocol: PDF, HAR, trace, emulation, network mocking | `lib/web-adv-core.js:15`, `lib/web-adv-capture.js:20`, `lib/web-adv-record.js:14` | Low-level DevTools control for full-page screenshots, network interception, and traces. |
| `sidePanel` | Embedded ScreenSync companion dashboard | `background.js:186,210,223`, `pages/dashboard.html` | Opens the extension dashboard in Chrome's side panel for side-by-side agent supervision. |
| `contextMenus` | Right-click shortcuts to inspect element or launch agent | `background.js:150-163` | Adds context menu entries to hand off specific DOM elements or pages to the agent. |
| `tabGroups` | Visual tab grouping for agent-controlled tabs (`web_tab_group`) | `lib/tab-resolve.js:131`, `lib/web-tab-groups.js:5` | Groups automated tabs into a distinct color-coded group to isolate them from user tabs. |
| `cookies` | Supervised cookie inspection and sync (`web_cookies`) | `lib/web-tools.js:216,314,356,361` | Allows agent session diagnosis under origin consent; sensitive values are automatically redacted. |
| `offscreen` | Tab audio/video capture (`web_video_record`), pixel diffs, clipboard | `background.js:109`, `lib/web-adv-record.js:105`, `lib/web-diff.js:5` | Provides DOM context for MediaRecorder, Canvas pixel diffing, and reliable clipboard I/O. |
| `history` | Browsing history search (`web_history`) | `lib/web-browser-data.js:12` | Allows read-only search of user navigation history under explicit origin consent. |
| `bookmarks` | Bookmark hierarchy search (`web_bookmarks`) | `lib/web-browser-data.js:32` | Allows read-only search of user bookmarks under explicit origin consent. |
| `webNavigation` | Frame discovery and navigation timeline (`web_in_frame`, ambient) | `lib/web-ambient.js:59`, `lib/web-frames.js:24,63` | Tracks iframe hierarchies and navigation commit events to reliably synchronize state. |
| `downloads` | Saving generated artifacts: HAR, MHTML, traces, recordings | `lib/web-adv-capture.js:165`, `lib/web-adv-record.js:57,116,294` | Saves test artifacts and diagnostic traces directly to user's disk without cloud hops. |
| `clipboardRead` | Supervised clipboard read (`web_clipboard {action: 'read'}`) | `lib/web-adv-input.js:394`, `pages/offscreen.js:216` | Allows the agent to read clipboard contents when requested by the workflow. |
| `clipboardWrite` | Clipboard writing (`web_clipboard {action: 'write'}`, dashboard copy) | `lib/web-adv-input.js:365`, `components/catalog-browser.js:50` | Copies connection kits, diagnostic bundles, and agent text payloads to the clipboard. |
| `host_permissions` | Local hub endpoints, pairing origins, and `<all_urls>` | `manifest.json:61-66` | Relays agent actions to open web tabs. Inert until paired and Web Access is enabled. |

> `<all_urls>` is broad by design: the extension's purpose is to let the
> user's own AI agent operate their live browser. It is inert until the user
> pairs with a hub (the Web access toggle now ships ON; turn it off to disable agent access). If you would rather
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

---

## Native dialogs and navigation (maintainer note)

`web_navigate` and `web_reload` attach a CDP session and accept a pending `beforeunload`
prompt before navigating, because that dialog is browser chrome: no DOM tool can click it
and the renderer is blocked while it is open, so the call would otherwise hang until the
hub's timeout. Pass `acceptBeforeUnload: false` to stay on the page.

`cdpDialogRule` answers an already-open dialog with a bare `chrome.debugger.attach` plus a
time-boxed `Page.handleJavaScriptDialog`, *before* `Target.setAutoAttach` / `Page.enable`.
Ordering matters: those two can wait on the renderer, which is exactly what a modal dialog
has frozen.

If a tab is wedged so badly that CDP calls keep timing out, close it with
`web_tab {action:"close", tabId}` - `chrome.tabs.remove` is browser-level and is not
blocked by the frozen page.