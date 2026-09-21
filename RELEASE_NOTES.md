# ScreenSync MCP — Release Notes

## Version 1.11.0 (the approval queue, for real) — 2026-09-21

The 1.8.0 notes below describe an interactive Approval Queue. It existed as a component and had **no caller**: a destructive-looking action returned `USER_CONFIRMATION_REQUIRED` and the agent simply called again with `confirmed:true`, an argument it supplies itself, so nothing ever asked a person. This release wires it in.

- **A person approves what looks destructive.** On a site you have not trusted, the request waits up to 60 seconds in the queue (a badge on the toolbar icon, the popup, and the dashboard's Web Access tab) and runs only if you approve. Declining, or not answering, refuses it (`USER_DECLINED` / `APPROVAL_TIMEOUT`).
- **An agent's own `confirmed` / `force` no longer count**, and it cannot forge the internal flags (`__humanApproved`, `__actGranted`): the hub and the extension both strip them, at any depth. On your trusted hosts (x.com, epsoldev.com, ...) nothing changes.
- **The hub's cognitive gate now asks you** instead of refusing. It is `enforce` by default: a destructive-looking action on a domain that has not earned trust is handed to the extension to put in front of you. If no connected extension can ask (older than 1.11.0) the call is refused and says why. Update the extension first, or set `SCREEN_SYNC_COGNITIVE_GATE=warn` until you have.
- Each request shows what is being done (target, typed text, the reason) and how long is left, and the hub keeps waiting while you decide.
- **An agent cannot approve its own request.** Code run through `web_run_code` and its siblings executes inside the extension's own scripting world, where it could message the extension directly (approve a request, grant itself access to any site, change settings) and read or write its storage. The extension now answers only its own pages, closes ports opened from a tab, and limits storage to its own contexts. This also closes a way to read the clipboard through the offscreen page without the clipboard permission check.
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
