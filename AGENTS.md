# ScreenSync Project — Agent Architecture & Engineering Rules

These rules apply to **all** AI agents working on the ScreenSync codebase. They must be followed strictly without exception.

---

## 1. Architectural Integrity & Structure (MUST BE MAINTAINED)
ScreenSync is structured into distinct, decoupled subsystems. **New work MUST slot into this layout — never create top-level sprawl or parallel structures:**
1. **`extension/`** (Chrome Manifest V3 Extension):
   - `extension/lib/`: Core service worker business logic, SSE streaming, API client, page-side execution units (`web-unit-*.js`), and ambient collectors.
   - `extension/components/`: Reusable autonomous Web Components (Custom Elements) with Shadow DOM encapsulation.
   - `extension/pages/`: Standalone pages (`dashboard.html`, `popup.html`, `offscreen.html`).
   - `extension/styles/`: Theme tokens (`brand.css`) and component CSS.
2. **`mcp-server/`** (Node.js & TypeScript MCP Hub Daemon):
   - `catalog.ts` / `catalog-web.ts` / `catalog-web-agent.ts`: MCP tool definitions and JSON schemas (new tool defs go in the most specific existing catalog file — never grow a file past the line limit).
   - `hub.ts`: Express + SSE hub server relaying requests between MCP clients, the phone, and the browser extension.
   - `web.ts` / `web-frame.ts` / `events.ts`: web bridge, frame relay, and the sequenced SSE event stream.
   - `control.ts`: Mobile Android ADB control and OS automation.
   - `test/`: E2E suites (`npm test`).
3. **`lib/`** (Flutter Application):
   - Mobile and desktop companion UI built in Dart (BLoC architecture).
- **Preservation duty**: when adding a capability, first find the module that owns that concern and extend it (or create a sibling unit file); do not reshape unrelated modules.

---

## 2. File Size Constraint (500 to 600 Lines Maximum)
- **Mandatory Line Limit**: No single code file (`.js`, `.ts`, `.dart`) should exceed **500 to 600 lines**.
- **Decomposition**: If a file approaches 500 lines, it must be decomposed into modular, single-responsibility files (e.g., splitting locators, interactions, extractions, device emulation into their own units).
- **No Monoliths**: Avoid grouping unrelated tools into single monolithic script files. New capabilities go into NEW files, not into already-oversized ones.

---

## 3. Page Injection Safety (`chrome.scripting.executeScript`)
- Page-side units executed via `func` (`chrome.scripting.executeScript({ func, args })`) are serialized via `.toString()` and executed inside the tab's DOM context.
- Functions intended for `func` execution MUST be **completely self-contained**:
  - No outer-scope variables or external module imports within the function body.
  - All necessary sub-helpers (e.g. `findBy`, `collect`, `showActionRipple`) must be defined within the function body or passed as self-contained units.

---

## 4. Zero Regressions & 100% Feature Parity
Never remove, break, or degrade any existing capabilities:
- **Playwright Locators**: Must support `css=`, `>>>` (Shadow DOM piercing), `pierce/`, `:has-text()`, `xpath=`, `role=`, `placeholder=`, `label=`, `text=`, `testid=` — in EVERY unit that resolves selectors.
- **Playwright/Agent Parity Layer**: `web_expect`, `web_aria_snapshot`, `web_get_by`, `web_fill`, `web_check`, `web_focus`, `web_scroll_to`, `web_run_code`, `web_media_extract`, `web_device_emulate`, `web_resize`, `web_set_user_agent`.
- **Evidence & Clock Tools**: `web_har_record` (true CDP HAR 1.2, optional response bodies), `web_trace_record` (CDP Tracing), `web_video_record` (offscreen MediaRecorder WebM), `web_clock_set`/`web_clock_clear` (fake clock), `web_events` (sequenced SSE tail).
- **Set-of-Marks (Claude Computer Use)**: Visual numbered badges (`web_som_overlay`, `web_remove_overlay`).
- **Anti-Bot Human Emulation**: Gaussian typing cadence (`web_human_type`) and Bézier inertia scrolling (`web_human_scroll`).
- **Real-Browser Social Intelligence**: Multi-platform authenticated scraping (`web_social_matrix`, `web_social_sync`, `web_social_feed_cluster`, `web_social_dossier`, `web_social_search`, `web_keep_alive`).
- **Network & CDP Tools**: `web_wait_for_response`, `web_wait_for_request`, `web_screencast`, `web_websocket_traffic`.
- **Multi-Browser Targeting**: every `web_*` tool accepts `__browser` (browser name or install id from `web_status.browsers`); never remove the per-browser routing/filtering.

---

## 5. Dual Workspace Mirroring
The repository operates across dual workspace directories:
- Primary: `d:\Local SEO\Site\Khizar\screensync_flutter_mcp_project`
- Secondary: `c:\Users\epsol\Downloads\screensync_flutter_mcp_project`

After making modifications to any file in the primary workspace, always execute `robocopy` with `/MIR` (excluding `node_modules`, `.git`, `dist`, `.dart_tool`, `build`) to keep both directories 100% in sync.

---

## 6. Extension Health & Error-Free Operation
- Chrome extension dashboard (`chrome://extensions`) must show **0 errors** on the ScreenSync MCP card.
- Any syntax errors or uncaught exceptions must be resolved immediately.
- Note: the hub's dev hot-reload (`dev_hot_reload`) auto-reloads the extension on file changes — a transient error right after editing is normal; verify against the final state and press **Clear all** on stale entries.

---

## 7. MCP-First Testing & Verification + EXCLUSIVE TOOLING (MANDATORY)
**All testing and verification of browser/web features MUST run through the ScreenSync MCP tools — static checks alone are never sufficient.**

**EXCLUSIVE TOOLING — dogfooding rule (no exceptions):**
- When working in this project, agents MUST use **ScreenSync MCP tools and MCP skills for ALL browser and computer interaction** — including testing, live verification, page inspection, screenshots, and any browser/computer control.
- **NEVER** fall back to ZCode computer-use, other agents' browser plugins, chrome-devtools MCP, browser-use MCP, or Playwright/Puppeteer scripts. ScreenSync IS the browser-automation layer of this project.
- **Any gap, limitation, or missing capability discovered while using ScreenSync = upgrade ScreenSync itself** (fix the tool, extend it, or add the missing tool), then verify the upgrade through ScreenSync. Falling back to foreign tooling is a rule violation — it hides the gap instead of closing it.
- This is the self-improving loop: use ScreenSync → find a gap → upgrade ScreenSync → re-verify with ScreenSync.

**Verification ladder, in order:**
1. **Static**: `node --check` sweep of changed extension files + `npm run build` for the server.
2. **Suite**: `npm test` (protocol e2e + aim-loop flow + web-bridge round trip with simulated extension) — must pass twice consecutively after behavioral changes.
3. **Live MCP verification (required for "done")**: drive the REAL browser through the `web_*` tools on the live hub (`http://127.0.0.1:3000`) — e.g. `web_status` → `web_navigate` (newTab, then always pass `tabId`) → act → `web_expect` → `web_aria_snapshot`/`web_table_extract`/`web_har_record` → `web_tab` close. Every new/changed tool must be exercised once against a real page.
- Never test by modifying the user's existing tabs: always create a dedicated tab (`web_navigate {newTab: true}`) and close it afterwards (`web_tab {action:"close"}`).
- `flutter test` for Dart changes; ADB/phone verification through `control_*` tools when touching mobile.

---

## 8. Real-Time SSE Observability (USE IT — DO NOT POLL BLIND)
The hub runs a **sequenced SSE event stream** (`/api/events`): every event carries an `id: <seq>`, a 500-event ring buffer supports **`Last-Event-ID` replay** on reconnect, and `GET /api/events/recent?since=&types=&limit=` is the HTTP tail.
- **`web_events`** (`since` cursor + `types` filter) is the tool for live runtime verification: after driving the browser, call `web_events {since: <lastSeq>}` to confirm what actually happened (navigations, page loads, tab activations, tool activity, frame uploads) instead of assuming success.
- The extension's ambient collector (`web-ambient.js`) pushes `web_navigation` / `web_page_loaded` / `web_tab_activated` into the stream — use them as ground truth for "the page really navigated/loaded".
- When debugging flaky behavior, tail `web_events` first; SSE events are the source of truth for runtime activity.
- New hub-side features that emit state changes MUST flow through `broadcast()` (which sequences + buffers) so they are observable and replayable.

---

## 9. Screensync Operator Skill
`/screensync-operator` (in `.agents/skills`, `.zcode/skills`, and `.claude/commands/`) is the canonical playbook for agent-driven web operations: all web work goes through the user's real logged-in browser via ScreenSync `web_*` tools — never Playwright. When you change the tool surface, update that skill file in all three locations.
