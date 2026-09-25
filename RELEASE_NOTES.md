# ScreenSync MCP — Release Notes

## Version 1.14.2 (back within seconds) — 2026-09-26

- **The live stream comes back within seconds after a hub restart.** When the hub on your computer restarted, the extension's retry wait had grown to 30 seconds, so the live link took 20–30 seconds to return. A hub on this computer is now retried at least every 5 seconds, and whenever the extension notices during a longer wait that the hub answers again, it reconnects straight away. A hub that stays down is still retried calmly, never in a burst.
- **The hub reports its real version.** `/health` said `1.12.0` whatever hub you ran. It now reports the hub's actual release number, so you can see at a glance which hub is running.

Both the extension and the hub changed: update both.

---

## Version 1.14.1 (live connection you can trust) — 2026-09-26

The side panel's Diagnostics tab said **SSE Stream: Offline**, **Uptime: N/A** and **0 grants** while the header said **SSE Live** and the connection was fine. The tab was reading fields the extension never sent. This release makes every status the extension shows come from the real connection, and fixes the reasons the live link could quietly stop working.

- **Diagnostics shows the truth.** The live stream state (`Live · data 4s ago`, `Reconnecting in 8s`, `Unauthorized — check token`, `Stopped`), real uptime, open tabs, storage, grants and waiting approvals, refreshed on its own while the tab is open. `web_extension_diagnostics` returns the same data, and no longer hands agents your full list of granted sites, only a count.
- **The live stream recovers on its own.** A wrong pairing token no longer stops it for good: fixing the token (or waiting five minutes) brings it back. Stopping it is shown as stopped, not "SSE Live". A hub that is down is retried with a growing delay instead of a burst on every page load, and a stream the hub closes is reported and reopened.
- **Nothing is lost or run twice across a reconnect.** The extension resumes from the last event it saw, so a command sent during a short gap still arrives, and a command that has expired or already ran is never run again.
- **A dead stream fails fast.** If a browser's live stream is down, a tool call to it now answers within seconds with `BROWSER_STREAM_DOWN` instead of waiting 45–65 seconds. `web_status` reports each browser's own stream, and a closed browser drops out after 90 seconds instead of 10 minutes.
- **Long waits get their full time.** `web_takeover`, `web_request_help` and `web_wait_download` wait as long as they advertise, including inside flows, replays and fanouts. `web_test_run` and scheduled flows now go through the approval gate.
- **Memory keeps what it learns.** `https://www.x.com/`, `x.com:443` and `x.com` are one site; clicks, typing and checks are remembered, not only navigations; `web_episodic_query` answers from real history; one busy site no longer pushes every other site's memory out.
- **The hub is harder to crash.** Broken connections, slow readers and network-discovery errors are handled instead of taking the hub down, and stopping the hub cleans up after itself.

Most fixes are in the hub as well as the extension: update both.

---

## Version 1.14.0 (background tabs) — 2026-09-23

An agent working in its own window reads tabs you are not looking at. Several tools behaved as if those tabs were in front; this release makes them work in the background, and adds four options.

- **`web_screenshot` can capture a tab without taking your focus.** By default a tab that is not in front is still brought to the front and its window focused for the capture, as before. While you are using the browser, an agent can pass `background: true` instead. Chrome's "capture the visible tab" returns whatever the window shows on screen, so for a tab in a window behind yours it would return your own page: in background mode it is used only for the active tab of the focused window, and any other tab is captured through Chrome's DevTools protocol, which reads the tab itself. Nothing is brought to the front and your focus stays where it is. If that is not possible, the call fails within seconds with `CAPTURE_UNAVAILABLE` and no image, never a picture of another page.
- **Screenshots of a hidden tab no longer hang.** Before a capture the extension waits for the page to draw a frame, and a hidden tab never draws one, so the wait lasted until the hub gave up after 45 seconds. It now skips hidden pages and never waits longer than a second, so `web_full_screenshot` and `web_element_screenshot` of a background tab answer.
- **`web_expect` works on a background tab.** Chrome does not draw hidden tabs, so an element that fades in there stays frozen at the start of its fade, and the page's own timers are slowed to one tick a second or even a minute. The check said "hidden" and then waited far past its timeout. It now judges visibility from layout and style alone and, in a hidden tab, lets the extension do the waiting, so you get the real answer within the time you asked for.
- **`web_table_extract` reads tables inside a closed `<details>`.** They used to come back with every cell empty. Each table now also lists which columns a person can see (`columnVisible`), and `openDetails: true` opens the section for the read and closes it again.
- **`web_aria_snapshot` can read a long page in parts.** When a snapshot is cut short it says so (`truncated`, `nextOffset`); pass `offset` to get the next part. The `[index=N]` refs stay the same on every part, and the default output is unchanged.
- **`web_events` takes `newest`.** The default is still the most recent events. `newest: false` returns the first events after `since`, to page through a burst without gaps, and every reply says how many it left out (`skipped`).

The fixes are in the extension. `background`, `newest`, `offset` and `openDetails` are declared by the hub, and `web_events` runs there: update the hub too.

---

## Version 1.13.1 (agent window navigation fixes) — 2026-09-23

Three things went wrong while an agent worked in its own agent window and you kept browsing in yours. This release fixes them; nothing new to learn.

- **Opening a new tab could hang for 45 seconds and open nothing.** `web_navigate` with `newTab` first attached its "accept the leave-this-page dialog" guard to the tab you were using, although a new tab leaves no page. When that attach got stuck, the whole call waited for the hub's timeout. A new tab now gets no guard at all, and the guard on a same-tab navigation gives up after 4 seconds, so the navigation goes ahead instead of stalling.
- **New tabs opened in your window, not the agent's.** The agent window says "New tabs will open here", but tabs opened wherever Chrome chose. They now open in the agent window whenever one is open. If you closed it, they open the normal way.
- **The agent window was forgotten after the extension went idle.** Chrome stops the extension's background worker after about 30 seconds of quiet, and it lost track of the agent window that was still open: new tabs went back to your window and "close" said no agent window was active. The window is now remembered for the browser session, and a window you closed yourself is forgotten.
- **`web_expect` and `web_wait_for` now report their own answer when they run out of time.** With a `timeoutMs`, the hub used to give up at exactly that moment, so you got a generic "waiting for the browser extension" timeout instead of "expected X, got Y". The hub now waits 5 seconds longer than the tool's own budget (up to 65 seconds), so the real verdict arrives. This part is in the hub: update it too.

---

## Version 1.12.0 (access requests) — 2026-09-22

Before this release an agent that hit "Action access not granted for origin X" was stuck until you found the dashboard's Web Access tab and added a grant by hand, usually after it had asked you in chat to do so. Now it can ask you directly.

- **New tool `web_request_access`** (226 tools; in consolidated mode `web_assist` action `request_access`). The agent names the site and says in one sentence why it needs it. A small ScreenSync window opens in the middle of your screen, the toolbar badge counts it, and it is listed in the popup and the dashboard queue.
- **You choose: Deny, Allow once (15 minutes) or Always allow this site.** Allow once and Always allow both give *read + act*: the agent can read the site's pages, click and type on them, and send requests to it signed in as you (for example submit a form). Neither gives the cookie tools that read or copy your login. Always allow is the same saved grant the dashboard's Add Grant makes; an Allow once is listed in the Web Access tab with its end time, and revoking the site ends it at once. It is never written to storage.
- **The agent cannot answer its own request.** The decision is applied only from the extension's own pages; there is no hub route or tool argument that grants anything, and every `web_*` tool refuses to read, click or script extension pages. On the window and in the queue the Allow buttons wake up a moment after they appear (and again if the row moves under your pointer), never take keyboard focus and ignore keyboard presses, so only a pointer click counts.
- **It cannot wear you down.** One window at a time (the next opens when you answer), at most 3 requests waiting, and one request per site however often the agent asks. Declining, or closing the window (that counts as Deny), blocks the site from asking again for 10 minutes; an unanswered request blocks it for 5.
- The agent's reason is shown as "its own words - not checked": it is what the agent claims, not something ScreenSync verified.
- While the access window has focus, tools called without a tab now keep targeting the tab you were using, not the first website tab found anywhere.

---

## Version 1.11.0 (the approval queue, for real) — 2026-09-21

The 1.8.0 notes below describe an interactive Approval Queue. It existed as a component and had **no caller**: a destructive-looking action returned `USER_CONFIRMATION_REQUIRED` and the agent simply called again with `confirmed:true`, an argument it supplies itself, so nothing ever asked a person. This release wires it in.

- **A person approves what looks destructive.** On a site you have not trusted, the request waits up to 60 seconds in the queue (a badge on the toolbar icon, the popup, and the dashboard's Web Access tab) and runs only if you approve. Declining, or not answering, refuses it (`USER_DECLINED` / `APPROVAL_TIMEOUT`).
- **An agent's own `confirmed` / `force` no longer count**, and it cannot forge the internal flags (`__humanApproved`, `__actGranted`): the hub and the extension both strip them, at any depth. On your trusted hosts (x.com, epsoldev.com, ...) nothing changes.
- **The hub's cognitive gate now asks you** instead of refusing. It is `enforce` by default: a destructive-looking action on a domain that has not earned trust is handed to the extension to put in front of you. If no connected extension can ask (older than 1.11.0) the call is refused and says why. Update the extension first, or set `SCREEN_SYNC_COGNITIVE_GATE=warn` until you have.
- Each request shows what is being done (target, typed text, the reason) and how long is left, and the hub keeps waiting while you decide.
- **Nothing running in a tab can approve a request.** The extension now answers only its own pages, closes ports opened from a tab, limits its storage to its own contexts, and the offscreen page (which can read the clipboard) refuses messages that come from a tab. This is hardening, not the fix for a live hole: `web_run_code` and `web_eval` run in the page's own world, which has no extension APIs, and the extension's isolated world did not evaluate a string when checked in Chrome, so no agent code runs where it could send those messages today.
- It is a check on what the extension and the hub can recognise as destructive (a keyword, a method, a target), not a sandbox: an `act` grant on a site still lets an agent act there, and code it runs with `web_eval` or `web_run_code` is judged by what it says, not by what it does.
- An approval covers the page you were shown. If the target changed while you were deciding (another tab came forward, the page navigated) or you revoked the site's grant, nothing runs and the agent is told to ask again.

---

## Version 1.8.0 (Rev 4 Release Readiness) — 2026-09-14

ScreenSync v1.8.0 represents a major milestone: transitioning ScreenSync from an experimental AI automation bridge into a hardened, production-grade supervised browser engineering platform. It pairs the mobile Android screen sync engine with a 171-tool browser automation surface offering 100% Playwright parity, strict user supervision, and an offline-first architecture.

---

### 🛡️ Security & Privacy (The Headline)

The headline improvements in this release put the user firmly in control of what AI agents can see and do on their live browser:

1. **Risk-Classified Approval Gate**:
   - Destructive and mutating actions (such as non-GET HTTP requests via `web_api_fetch`, cookie modifications, file downloads, and navigation to untrusted origins) are automatically routed into an interactive visual Approval Queue.
   - Pending actions show complete request metadata (origin, method, payload summary) and require explicit user approval before execution.

2. **Per-Origin Consent Engine**:
   - Web access is governed by fine-grained, persistent per-origin grants (`grants[origin].read` and `grants[origin].act`).
   - The agent cannot extract data or perform actions on a domain until the user grants access. All grants can be viewed, modified, or revoked instantly in the dashboard.

3. **Safe JavaScript Dialog Handling**:
   - JavaScript dialogs (`alert`, `confirm`, `prompt`, `beforeunload`) now default to **dismiss / cancel** rather than auto-accepting, preventing agents from accidentally submitting irreversible prompts or triggering unintended file downloads.

4. **Sensitive Data & Cookie Redaction**:
   - Built-in data hygiene automatically redacts sensitive session cookies, authentication tokens, and password fields from inspection payloads.
   - Pure local execution: no tokens, credentials, or session cookies are ever written to disk or sent to external clouds.

5. **Hardened Extension Sandbox & CSP**:
   - Bundled local Plus Jakarta Sans WOFF2 font directly inside the extension package, completely eliminating remote font requests to Google Fonts.
   - Content Security Policy tightened to remove remote `style-src` and `font-src` domains (`fonts.googleapis.com` and `fonts.gstatic.com`), allowing 100% offline operation with zero remote-code dependencies.
   - Enforced minimum browser version: Chrome/Edge 114+ (for full `sidePanel` and `offscreen` API support).

---

### 🎭 Full Playwright Parity Layer (P1–P12)

ScreenSync now provides 100% functional parity with modern browser automation frameworks:

- **P1: Popup & Multi-Window Handling (`web_popup_wait`)**: Tracks new tabs, target creations, and auxiliary windows spawned by button clicks or OAuth logins.
- **P2: Stability & Auto-Waiting Actionability (`web_actionable`)**: Automatically verifies that elements are attached, visible, stable, enabled, and non-obscured before interaction.
- **P3: Locator Chaining & Strict Mode**: Supports full Playwright locator syntax (`css=`, `>>>` Shadow DOM piercing, `xpath=`, `text=`, `role=`, `placeholder=`, `label=`, `testid=`) and throws clear `STRICT_MODE_VIOLATION` errors when multiple elements match.
- **P4: Polling Assertions (`web_expect`)**: Asynchronous expectation polling with configurable timeout, interval, and negation (`not`) support.
- **P5: File Chooser Injection (`web_upload_file`)**: Direct multipart file injection for form upload inputs.
- **P6: HAR Capture & Replay (`web_har_record`)**: Standard CDP HAR 1.2 recording with optional response body inclusion.
- **P7: Offline Trace Viewer**: Self-contained HTML trace viewer with embedded SVG timeline charts and filterable event logs for debugging complex agent runs (`web_trace_record { action: 'viewer' }`).
- **P8: Test Runner with JUnit XML (`web_test_run`)**: Multi-step automated test suite runner featuring retry mechanisms and industry-standard JUnit XML reporting.
- **P9: Session Codegen (`web_record { action: 'codegen' }`)**: Exports recorded user sessions into reusable ScreenSync Flows (with variable parameterization) and clean Playwright test scripts.
- **P10: JS Handles & exposeFunction (`web_handle`)**: Exposes host extension functions directly to page scripts and manages persistent in-page JS handles.
- **P11: Viewport Semantics Alignment (`web_scroll_to`, `web_highlight`)**: Playwright-compatible `scrollIntoViewIfNeeded` logic and non-intrusive bounding-box visual highlights.
- **P12: Service Worker Inspection (`web_service_worker`)**: Full lifecycle management, status reporting, and CDP attachment for background Service Workers.

---

### 🤖 AI-Browser Loop (D1–D9)

- **Job Runner with Real-Time SSE Feedback (`web_events`)**: Sequenced event streaming buffer (`Last-Event-ID` replayable) to observe navigations, tab changes, and tool calls in real time.
- **Operator Hand-Off (`web_takeover`)**: Enables smooth hand-off between automated agent actions and human user control.
- **Site Profiles & Domain Memory (`web_site_memory`)**: Remembers domain-specific selectors, bypass patterns, and interaction preferences.
- **Token-Bounded Page Digests (`web_page_digest`)**: Compact, LLM-optimized summaries of page structure and actionable targets without context-window exhaustion.
- **Automated Flow Scheduling**: Hub-native cron-style runner for recurring browser automation flows.

---

### 📱 Android Screen Sync Engine

- **MediaProjection Capture**: High-fps silent capture with native crop loupe, aspect locking, and freehand markup / blur redaction.
- **ADB Control Plane**: Native tap, long-press, swipe, scroll, type, key events, and logcat retrieval.
- **Dual-Sync Storage**: SQLite local cache with retention pruning and optional Google Drive BYOS hybrid fallback.
