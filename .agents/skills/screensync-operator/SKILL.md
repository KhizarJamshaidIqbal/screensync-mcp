---
name: screensync-operator
description: Use when the user asks to browse, search, scrape, verify, post, or sync real web data with their logged-in browser accounts — operate the user's REAL Chrome/Edge/Brave through the ScreenSync MCP web tools instead of Playwright or a fresh CDP profile. Covers multi-tab, multi-browser, social-account flows, and data sync back to the phone.
---

# ScreenSync Operator — real-browser web operations

You are operating the user's **actual browser** — the one with all their logged-in
sessions (social, work, shopping). Everything happens through the **ScreenSync MCP
server's `web_*` tools**. Never spin up Playwright, Puppeteer, or a fresh CDP
profile for a web task: those start with empty sessions and get bot-blocked.
The user's real browser is already authenticated, fingerprinted, and trusted.

## -1 · Cognitive Memory Architecture 3.0: Sovereign Cognitive Web Agent (SC-WA)

Human minds don't solve the same puzzle from scratch twice: once a motor skill or site quirk is mastered, it becomes an automated procedural routine executed in seconds. Architecture 3.0 fuses cognitive neuroscience, Medallion Lakehouse tiering, GQL property graphs (`bigquery_graph` pattern), and accidental data loss prevention (`accidental_data_loss_prevention` pattern):

1. **Speculative Pre-Flight Warming (`web_warm`)**:
   - Before executing actions, warm target state: `web_warm { domain: "x.com", intent: "post", profile: "epsoldev@gmail.com" }`.
   - Probes auth sessions, verifies circuit breaker health, evaluates environmental signals (is modal already open?), and pre-compiles fast-path branches (< 5s execution).

2. **Pre-Flight Memory Recall (`web_recall`)**:
   - Call `web_recall { domain: "x.com", intent: "post" }` before unfamiliar operations.
   - `domain`/`url` may be omitted: recall then scopes to whatever page the currently-routed browser tab is
     actually on (the same tab `web_status`'s `activeTab` reports), never to an unscoped ranking across every
     domain ever learned. With no browser online it returns `found: false` and a `note` instead of guessing —
     check `domainSource` (`"explicit" | "inferred" | "unresolved"`) and the echoed `domain` to see which.
   - Returns: `{ fastPathAvailable, playbookStatus, recommendedPlaybook, selectedBranch, guidance, alternatives, pitfalls, environmentalProbes }`.
   - **If `fastPathAvailable` is true the playbook is verified: EXECUTE IT DIRECTLY.** Do not guess, do not trial-and-error. Execution takes **< 15 seconds**.
   - If `playbookStatus` is `"candidate"` it is an unverified draft: run it deliberately, confirm each step with `web_expect`, then report the run with
     `web_learn { action: "outcome", domain, data: { playbook, success } }`. Two hub-confirmed runs in two sessions promote it to a fast path.
   - Avoid known traps (e.g. Draft.js requiring `execCommand('insertText')`, CSP blocking main-world eval, inactive window screenshot failures).

3. **Cognitive Associative Knowledge Graph & Skill Transfer (`web_graph_query`)**:
   - Traverses property graph topology (`Domain`, `Framework`, `Primitive`, `Auth`) connected by `RUNS_ON` and `SHARES_PRIMITIVE`.
   - When encountering an unmastered site (e.g. `threads.net`, `linkedin.com`), inherit the verified `execCommand` atomic input recipe from `x.com` automatically (`transferSkill: true`).

4. **Cognitive Data Safety Contracts & Accidental Form Loss Prevention (`web_contract_check`)**:
   - Evaluates active DOM before navigations or disruptive actions. Scans `<input>`, `<textarea>`, and `contenteditable="true"` for unsaved user text.
   - If uncommitted inputs exist and `allowDirtyNavigation !== true`, blocks destructive loss (`actionRecommended: "block_and_confirm"`) and auto-saves an Ephemeral Recovery Snapshot (`snap_*`).

5. **Playbook DAG Lineage & Cryptographic Mutation Provenance (`web_lineage`)**:
   - Maintains an immutable commit DAG tracking every selector evolution, healing event, or operator modification with diff summaries (`oldSelector` -> `newSelector`).

6. **Chaos Circuit Breaker & Anti-Bot Guard**:
   - Tracks consecutive failures and challenge screens (Cloudflare Turnstile, CAPTCHA, Arkose). Trips to `OPEN` immediately to summon human help (`web_request_help`).

7. **VOM Heuristic Self-Healing (DOM Drift Recovery)**:
   - When a known selector changes or drifts, the self-healing engine locates semantic candidates via ARIA roles (`role="textbox"`), `contenteditable`, and visual geometry, auto-patching the playbook in-flight.

8. **Hippocampal Memory Consolidation (`web_consolidate`)**:
   - Runs Medallion Lakehouse compaction: Bronze (raw traces) -> Silver (telemetry & duration deltas) -> Gold (master playbooks).
   - Applies Long-Term Potentiation (LTP) on proven paths, Long-Term Depression (LTD) on dead selectors, and purges obsolete traces.
   - Automatically sanitizes private credentials/emails before promoting wisdom to shared multi-profile knowledge.

9. **Canonical Playbook: X.com / Twitter Post (15 Seconds Fast-Path)**:
   - Step 1: `web_window { action: "focus", windowId }` (ensures OS/rendering active).
   - Step 2: `web_navigate { url: "https://x.com/compose/post", profile }`.
   - Step 3: `web_wait_for { selector: 'div[data-testid="tweetTextarea_0"]' }`.
   - Step 4: Inject via `web_eval`:
     `const el = document.querySelector('div[data-testid="tweetTextarea_0"]'); el.focus(); document.execCommand('selectAll', false, null); document.execCommand('delete', false, null); document.execCommand('insertText', false, text); el.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true, inputType: 'insertText', data: '' }));`
   - Step 5: `web_click` or click `button[data-testid="tweetButton"]` when not disabled.
   - Step 6: Verify on profile feed (`https://x.com/{user}`).

10. **Canonical Playbook: LinkedIn Post & Media (30 Seconds Fast-Path)**:
    - Step 1: `web_window { action: "focus", windowId }`.
    - Step 2: `web_navigate { url: "https://www.linkedin.com/feed/" }`.
    - Step 3: Open compose modal: `document.querySelector('button.share-box-feed-entry__trigger')?.click()`.
    - Step 4: **Pierce Open Shadow DOM**: Post creation modal lives inside host `div.theme--light`. Target editor via `host.shadowRoot.querySelector('div.ql-editor')`.
    - Step 5: **Media Injection**: Set files via `DataTransfer` on `#media-editor-file-selector__file-input` and dispatch synthetic `input` and `change` bubbling events. Click "Next".
    - Step 6: **Quill Input Sync**: Focus editor, inject text via `execCommand('insertText')`, and dispatch `new Event('input', { bubbles: true })` to enable the Post button.
    - Step 7: Click `button.share-actions__primary-action` to publish.

11. **Instant Inline Learning Protocol (NO DEFERRAL — User-Ordered 2026-09-19)**:
    - **Never wait for session end**: The moment an agent encounters or solves a DOM quirk, shadow DOM root, disabled button state, or timing trap, IMMEDIATELY call `web_learn` (`action: "fact"` or `"pitfall"`).
    - **Immediate Playbook Synthesis**: When a new multi-step flow succeeds, immediately call `web_learn` (`action: "playbook"`). It is stored as an unverified **candidate**.
    - **Verify what you stored**: re-run it, confirm the result with `web_expect`, and report `web_learn { action: "outcome", domain, data: { playbook, success: true } }`. The report counts only when the hub itself saw the passing assertion, so **act, then verify, then report**.
    - **Immediate Consolidation**: Call `web_consolidate` to lock memories into Gold tier before finishing the turn. Levels are earned from what the hub observes: `xpGain` is ignored, and `web_cognitive_stage({ action: "evaluate" })` reports what is still missing.

### -1b · Cognitive Architecture 8.0 → 11.0: Developmental Levels (child → adult memory system)

The agent's per-domain memory grows through developmental stages exactly like a child's mind — infant → child → adolescent → adult → sage. Use these tools at each phase of every real-browser operation:

| Phase of work | Tool | What it decides |
|---|---|---|
| **Before acting** (child checks the stove) | `web_recall` / `web_warm` | Fast-path playbook or fresh start; 2–7 chunk working-memory budget via `web_working_memory_span` |
| **Learning inside the right window** | `web_critical_period` | XP ×2 in infancy → ×1.25 in expert years; never skip a domain's sensitive window |
| **New page evidence** | `web_assimilation_accommodation` | Fit the schema (reinforce), heal it (rewrite step), or grow a new schema |
| **After a surprising result** | `web_reward_prediction_error` | Positive surprise → consolidate; negative surprise → write the pitfall NOW |
| **Before transferring skills** (x.com → threads.net) | `web_interference_check` + `web_metaphoric_transfer` | Measure proactive/retroactive interference first; HIGH → namespace + `web_synaptic_pruning` |
| **Every few hours of operation** | `web_forgetting_curve` | Review playbooks whose retention `R = e^(-t/S)` fell below 0.6 |
| **Before risky actions at immature stages** | `web_infant_error_signature` | Social referencing: ask the human to glance first (like a child checking a parent) |
| **Practice cadence** | `web_reinforcement_schedule` | CONTINUOUS → FIXED_INTERVAL → VARIABLE_INTERVAL; extinction-resistant mastery |
| **Before long plans** | `web_cognitive_load_budget` | intrinsic+extraneous+germane vs 7 chunks; OVERLOAD → chunk + `web_page_digest` |
| **Whenever facts are questioned** | `web_source_monitoring` | Catch misattribution; trust ledger per source |
| **Future contingencies** | `web_prospective_memory` | Register "WHEN login_wall THEN re-auth+retry" — fires automatically when observed |
| **Self-assessment** | `web_wisdom_calibration` / `web_executive_function` | Overconfidence (teen) vs imposter (child) states; inhibition/shifting/updating grade |

**Operating rules (iron):**
1. **Plan length ≤ digit span**: query `web_working_memory_span` before any multi-step macro; a plan longer than the domain's span must be chunked into named sub-routines.
2. **Surprise = write memory immediately**: any `PHASIC_DIP` outcome → `web_learn pitfall` in the same turn (this is the highest-value learning moment).
3. **Check interference before cross-domain transfer** — transferring an unverified playbook to a similar site is the #1 source of phantom failures.
4. **Rehearse on schedule**: run `web_forgetting_curve` at session start; re-verify every playbook below 0.6 retention before relying on it.

## 0 · Connect & discover

1. If the `screensync` MCP server is not attached, configure it (stdio):
   `node <mcp-server>/dist/index.js` with env `SCREEN_SYNC_TOKEN`.
   Global install already exists for this user — prefer it.
2. Always call **`web_status`** first. It returns `{online, webAccessEnabled,
   selectedProfile, targetInstanceId, targetProfile, activeTab, browsers: [{instanceId,
   name, profileEmail, online, activeTab}]}`. The top-level `targetProfile` / `activeTab`
   are the browser your next call goes to; check them before acting when several profiles
   are connected (null target = `selectedProfile` matches no connected browser).
   While that selected profile is offline the hub refuses web_* calls (`SELECTED_PROFILE_OFFLINE`,
   listing the online profiles) instead of sending them to another account: reconnect it, pass a
   `__profile` hint, or `web_profile {action:"select"}` an online profile (no profile clears it).
   Tab and window ids are only unique inside one browser: a `tabId`/`windowId` that two connected
   browsers both report is refused with `AMBIGUOUS_TAB_OWNER` (naming both) unless your profile hint,
   else the selected profile, is one of them. Retry with `__profile` (or `__instance`) set.
3. `get_mcp_catalog` re-reads the full capability surface anytime.

## 1 · See before acting (perception loop)

- **`web_page_observe`** — non-mutating VOM (Visual Object Model): joins CDP AXTree + DOMSnapshot layout geometry, computes occlusion, modal blocking layers, and token-bounded cursor pagination (`node:N`). Zero DOM mutations.
- **`web_aria_snapshot`** — the default way to READ a page: compact YAML ARIA
  tree with `[index=N]` refs. Feed refs straight into `web_click`/`web_type`.
- **`web_screenshot`** / **`web_full_screenshot`** (`longPage: true` for tiled scrolling of massive/infinite feeds; `web_screenshot_read` to read tile chunks) / **`web_element_screenshot`** (CDP clip capture of one element). `web_screenshot` auto-focuses a background tab's window first (Chrome's `captureVisibleTab` requires the foreground tab of a focused window) — no need to call `web_window` first. All three now wait for an actual painted frame before capturing, so a call right after a navigation or scroll will not come back blank/stale.
- **`web_hierarchy`** — interactive-element list with coordinates (Set-of-Marks
  alternative: `web_som_overlay`).
- `web_dom_diff` after actions to detect modals/toasts/route changes.

## 2 · Act (full Playwright input parity)

| Intent | Tool |
|---|---|
| Click / tap | `web_click` (locators or `[index=N]` ref) |
| Type text (fast) | `web_fill` |
| Type like a human (anti-bot) | `web_human_type` / `web_type` |
| Press keys / combos | `web_key`, `web_key_combo` |
| Select option | `web_select` |
| Check / uncheck | `web_check` {checked: true/false} |
| Focus / blur | `web_focus` |
| Hover | `web_hover` |
| Scroll | `web_scroll` (container), `web_scroll_to` (element/top/middle/bottom), `web_human_scroll` |
| Drag & drop | `web_drag_and_drop` |
| Upload files | `web_upload_file` |
| Paste rich content | `web_paste` |
| Navigate / back / reload | `web_navigate`, `web_go_back`, `web_reload` |
| Record real network HAR | `web_har_record` {action: start/get/stop} (true CDP HAR 1.2) |
| Record WebM video evidence | `web_video_record` {action: start/stop} |
| Record Chrome performance trace | `web_trace_record` {action: start/stop} (open in chrome://tracing) |
| Fake/shift the page clock | `web_clock_set` {offsetMs or iso} / `web_clock_clear` |
| Tail the live event stream | `web_events` {since, types, limit} — sequenced SSE ring: navigations, page loads, tab activations, tool activity |
| Sync a login between browsers | `web_session_transfer` {domain, from, to} — copies cookies+localStorage Edge↔Chrome↔Brave |
| Which browser is logged into X? | `web_route_for` {domain} — per-browser cookie evidence + recommended id |
| Run one tool on ALL browsers | `web_fanout` {tool, args, browsers} — each pass pinned to its browser; choose browsers with `browsers` (a profile hint inside args is refused); a tabId/windowId runs only in its owner, other browsers reported skipped |
| Act inside an iframe | `web_in_frame` {tool, args, frameId|frameUrl} (frames via `web_frame_tree`) |
| Auto-answer HTTP 401 auth dialogs | `web_network_auth` {username, password} then navigate |
| Teach-once-replay-anywhere | `web_record` {action:start/stop} → edit steps → `web_replay` {steps} — daily real-account flows in one call |
| Run one tool on ALL tabs | `web_tab_fanout` {tool, args, tabIds|urls|activeOnly, profile} — one browser's tabs: `profile`, else the selected profile; call once per profile for several |
| Jump the fake clock | `web_clock_fast_forward` {ms} after `web_clock_set` (+ `fixed:true` freeze) |
| Wait for a download | `web_wait_download` {url?, filename?} (call before the triggering action) |
| Restore a minimized window | `web_window` {state:'normal'|"maximized", focused:true} — needed before screenshots |
| Call logged-in APIs directly | `web_api_fetch` {url, method, body} — session cookies attach automatically (request-context parity) |
| Save a flow forever | `web_record` → edit → `web_flow_save` {name, steps} → daily: `web_flow_run` {name, vars} ({{var}} & `{{step.N.data.field}}` chaining) · `web_flow_list`/`web_flow_delete` |
| One-call account dashboard | `web_account_report` — kaunsa platform kis browser mein live |
| Operator context | `web_history` {text, hoursBack} · `web_bookmarks` {text} |
| **Automate a flow forever** | `web_flow_schedule` {flow, everyMinutes, vars} — hub khud chalata hai · `web_flow_schedules` (last-run status) · `web_flow_unschedule` |
| Call APIs with files | `web_api_fetch` {formData: {field: {filename, base64}}} — real multipart with session |
| Emulate CSS media & features | `web_emulate_media` {media: 'print'\|'screen', features: {prefers-reduced-motion, forced-colors, color-scheme}} (Playwright emulateMedia parity) |
| Save full page as MHTML | `web_mhtml` — captures full DOM + embedded resources as RFC 2557 archive (DevTools Save-as-MHTML parity) |
| Control & clear browser cache | `web_cache_control` {action: 'disable'\|'enable'\|'clear'} (CDP / Playwright cache control) |
| Visual regression baselines | `web_visual_baseline` {action: 'save'\|'compare'\|'list'\|'clear', name, threshold, updateBaseline} (Playwright toHaveScreenshot parity + heatmaps) |
| Full document HTML | `web_content` {selector?, clean: true/false} (Playwright page.content parity) |
| Precise bounding box | `web_bounding_box` {selector|ref} (Playwright locator.boundingBox parity: x, y, w, h, inViewport) |
| Computed CSS styles | `web_computed_style` {selector|ref, properties?} (DevTools computed styles) |
| Inject script tag | `web_add_script_tag` {url|content} (Playwright page.addScriptTag parity) |
| Inject style tag | `web_add_style_tag` {url|content} (Playwright page.addStyleTag parity) |
| Organize tabs in groups | `web_tab_group` {action: create/add/remove/update/list, title, color} |
| Modern SPA IndexedDB | `web_indexeddb` {action: databases/schema/dump/query, database, store} |
| CacheStorage API | `web_cache_storage` {action: list/keys/match} |
| **Real User Social Harvester** | `web_authenticated_harvest` {platform: 'x'\|'linkedin'\|'github'\|'reddit'\|'facebook'\|'instagram'\|'youtube'\|'threads', task: 'feed'\|'profile'\|'notifications'\|'search', scrollPages: N, useExistingTab: true} — actual user accounts scraping without bot flags |
| Multi-target parallel harvest | `web_parallel_harvest` {targets: [...], concurrency: 3} — multi-tab parallel scraping |
| Hub-side session vault & sync | `web_session_vault` {action: save/restore/list/delete/sync, domain} — cross-browser persistent session cloning |
| Live mutation stream sync | `web_live_stream_sync` {action: start/poll/stop, selector} — real-time feed update watcher |
| Clutter-free reader mode | `web_reader_mode` — clean markdown extraction of articles/pages |
| Smart form auto-fill | `web_smart_fill` {fields: {email, name, ...}} — human-cadence input dispatch |
| Token-bounded page digest | `web_page_digest` {maxTokens?, includeTabs?} — accessibility-first digest with stable refs for AI reasoning |
| Auto-wait actionability check | `web_actionable` {selector, timeoutMs?} — verifies visible, enabled, stable rect, and unoccluded before act |
| Audit ring & privacy trail | `web_audit_log` {action: 'get'|'clear'|'export'} — local privacy-safe activity log with redaction |
| Real session data sync | `web_real_data_sync` {url, platforms?, useActiveTab?} — real-browser multi-tab/browser data extraction without credential exfiltration |
| Trusted OS-level input | `web_cdp_click`, `web_cdp_type`, `web_mouse`, `web_touch` |
| **In-page Human Help Overlay** | `web_request_help` {prompt, targetSelector, timeoutMs, completionCriteria} — Shadow DOM overlay, glowing highlight, desktop OS notification, auto-resumes when criteria met |
| **Ask for site access** | `web_request_access` {reason, url?, tabId?, waitMs≤30000} — a person answers Deny / Allow once (15 min) / Always allow in a focused window; returns allowed_* / pending / USER_DECLINED |
| **Isolated Agent Window** | `web_agent_window` {action: 'create'\|'close'\|'status'\|'borrow'\|'return'} — amber breathing border, tab borrowing gate with in-page approval modal/toast |
| **Tiled Long Screenshot Read** | `web_screenshot_read` {captureId, tileIndex} — retrieves individual 256KB base64 tile chunks from long captures |

**Locator language everywhere:** `css=`, `>>>` (shadow piercing), `pierce/`,
`:has-text()`, `xpath=`, `role=[name="…"]`, `placeholder=`, `label=`, `text=`,
`testid=`. Also `get_by` (role/text/label/placeholder/testid/alt/title) and
`web_find`.

## 3 · Verify (never assume success)

After every meaningful action: **`web_expect`** (polling assertions — visible,
hidden, text, value, count, url, title, checked) and/or `web_screenshot` +
`web_dom_diff`. Sequence: act → `web_expect` → only then next step. For
visual flows use `web_watch` (live frame stream) or `web_screencast`.

## 4 · Extract & sync real data

- Tables → **`web_table_extract`** (json/markdown/csv in one call).
- Structured lists → `web_scrape_schema` {itemSelector, schema}.
- Articles → `web_markdown_extract`; assets → `web_media_extract`.
- Clutter-free articles & reader view → **`web_reader_mode`** (title, byline, markdown, reading time).
- Modern web apps & offline data → **`web_indexeddb`** / **`web_cache_storage`**.
- Multi-page → `web_batch_crawl` / `web_tab_pool` (concurrent, bounded).
- Sync results: `publish_inspection` (findings → phone heatmap),
  `publish_patch` (code fixes), or return the data inline. Session replay:
  `web_session_save` / `web_storage_state` **only when the user asks**.

## 4b · Authenticated Real-Web Data Sync (The User's Logged-in Operator Advantage)

The user's real browser already has active logins for Twitter/X, LinkedIn, GitHub, Reddit, Facebook, Instagram, YouTube, etc. **Never ask the user to log in again, and never use headless scrapers that trigger bot blocks.**

1. **One-Call Harvest (`web_authenticated_harvest`)**:
   - Call with `platform` (e.g. `'x'`, `'linkedin'`, `'github'`) and `task` (`'feed'`, `'profile'`, `'notifications'`, `'search'`).
   - By default `useExistingTab: true` reuses open tabs, eliminating popup noise and bot detection.
   - `scrollPages: 2` automatically triggers natural inertia scrolling to load lazy-loaded feeds.
2. **Parallel Multi-Platform Sweeps (`web_parallel_harvest`)**:
   - Provide `targets: [{ platform: 'x', task: 'feed' }, { platform: 'github', task: 'notifications' }]`.
   - Concurrently scrapes across tabs organized into a "ScreenSync Harvest" tab group, saves datasets to hub `data/harvest/`, and returns aggregated intelligence.
3. **Session Vault (`web_session_vault`)**:
   - `action: 'save'` saves full login state (cookies + localStorage + sessionStorage) to hub disk `data/vault/<domain>.json`.
   - `action: 'sync'` clones an active login from Chrome to Edge or secondary browser in one step.
   - `action: 'restore'` restores the saved vault session into any browser without re-entering credentials.
4. **Live Stream Watcher (`web_live_stream_sync`)**:
   - Starts a real-time mutation observer on a live page; poll with `action: 'poll'` to receive incoming tweets, chat messages, or alerts without reloading.
5. **Smart Form Filler (`web_smart_fill`)**:
   - Matches form inputs and types with human cadence, triggering native React/Vue/Angular events.

## 5 · Multi-tab & multi-browser

- **Multi-tab:** pass `tabId` (from `web_tabs`) to target background tabs;
  `web_navigate {newTab: true}` opens grouped agent tabs; `web_multi_tab_sync`
  mirrors state across tabs.
- **The full operator loop:** `web_account_report` → pick browser via `web_route_for` → `web_session_transfer` if needed → `web_api_fetch` for raw data or web tools for UI flows → `web_flow_save`/'web_flow_run' for daily reuse. Multi-tab via `web_tab_fanout`; multi-browser via `web_fanout`.
- **Multi-browser data sync:** the flagship loop — `web_route_for {domain}` finds which browser holds the login, `web_session_transfer` clones it to the browser you want to operate, then run the task there. Use `web_fanout` for parallel sweeps across every browser.
- **Multi-browser:** each connected browser (Chrome, Edge, Brave, …) registers
  separately. Check `web_status → browsers[]`, then pass `__browser: "edge"`
  (name or install id) in ANY web tool's arguments to route the call to that
  specific browser. Omit to let the first responder answer. Use case: user is
  logged into LinkedIn in Edge but GitHub in Chrome — route accordingly.
- Emulate devices per tab: `web_device_emulate` (iphone_15, pixel_8, …),
  `web_resize`, `web_set_user_agent`.

## 6 · Logged-in social intelligence (the real-account advantage)

`web_profile_sync` / `web_social_matrix` discover which accounts are live.
`web_social_scrape` / `web_social_feed_cluster` / `web_social_dossier` /
`web_social_search` read feeds with the user's auth. `web_social_post` composes
posts. Rules: (1) posting requires the user's explicit go-ahead for THAT post;
(2) never touch security settings, password fields, or payment flows; (3) on
captcha/2FA — stop and hand back to the user; (4) prefer human-emulation tools
(`web_human_type`/`web_human_mouse`/`web_stealth_cloak`) for posting flows.

## 7 · Debugging superpowers

`web_console`, `web_network`, `web_wait_for_response`, `web_websocket_traffic`,
`web_network_mock`/`web_route` (stub APIs), `web_perf` (Core Web Vitals), `web_har_record` (true HAR, bodies:true for response bodies), `web_trace_record` (perf tracing), `web_video_record` (run evidence), `web_clock_set` (expiry testing),
`web_a11y_tree`, `web_export_har`, `web_throttle_network`, `web_coverage`.

## 7b · Live observability (real-time SSE)
After driving the page, call **`web_events` {since: <lastSeq>}** to see what actually happened — `web_navigation`, `web_page_loaded`, `web_tab_activated`, tool activity — instead of assuming. Keep the cursor: each response returns `lastSeq`; pass it back as `since` next time. SSE reconnects replay missed events automatically (Last-Event-ID).

## 8 · Hard guardrails

- Respect the extension's "Web access for AI agents" toggle — a 403 means the
  user turned it off; ask, don't retry.
- Chrome-restricted pages (`chrome://`, Web Store) are refused — that's by design.
- Never exfiltrate cookies/sessions/tokens anywhere off-device.
- No posting/purchasing/sending without explicit user confirmation of THAT action.
- A destructive action on a site the owner has not trusted waits in the extension's approval queue for
  the human's click for up to 60s: they see a desktop notification (Approve / Decline), a card with a bell
  at the top right of that page, the badge on the toolbar icon and the popup list. The call's result carries
  a `code`: `USER_DECLINED` means they said no: do not retry, ask what they want. `APPROVAL_TIMEOUT` means
  nobody answered: tell them it is waiting, then retry once they can look. Your own `confirmed` / `force`
  arguments do nothing there. Never try to click the card or the notification yourself: while the card is
  up, `web_cdp_click` / `web_mouse` / `web_cdp_type` / `web_key_combo` on that tab return `APPROVAL_PENDING`.
- "Destructive" means a whole destructive word (delete, remove, pay, buy, drop, ...) in what you send, or code
  that changes things (`.submit()`, `.click()`, a POST/PUT/PATCH/DELETE fetch, storage or cookie writes,
  `location.href =`, `window.open`, ...). A read-only `web_eval` that mentions `dropdown`, `display` or
  `removeEventListener` is not gated.
- A risky step inside `web_flow_run`, `web_replay`, `web_fanout` or `web_tab_fanout` is put to a person (the
  extension's approval queue) exactly like the same direct call: one prompt per step, and per browser in a fanout.
  A scheduled flow (`web_flow_schedule`) runs with nobody watching and the hub asks no one, so never schedule a
  flow with a destructive step.
- A site you have no grant for answers "Read/Action access not granted for origin X". **Ask, do not send the
  user to the dashboard:** `web_request_access {url, reason}` opens a focused window on their screen (plus the
  badge and the popup queue) where they choose Deny / Allow once (read + act for 15 min) / Always allow. It
  waits up to 30s; `status: "pending"` means it is still on their screen, so call it again with the same url
  (it never opens a second request). `USER_DECLINED` = they said no, and the site cannot be asked for again
  for 10 minutes: ask in chat instead. Only a person can answer; nothing you send approves it, and you must
  never try to click it yourself (the window is an extension page the web_* tools refuse, by design).
- Hub tools time out at ~25–45s; for slow pages `web_navigate` first, then act. A call waiting for an approval
  is held longer (the approval window plus the run). `code: "TIMEOUT"` ("The browser didn't answer within
  Ns") means the hub is up and the browser has not answered: often an approval nobody has seen yet. Only
  `HUB_UNREACHABLE` ("hub is not reachable") means the hub is down.

## 9 · Recovery

| Symptom | Fix |
|---|---|
| 503 "extension not connected" | Open the ScreenSync dashboard (side panel) so the SW pairs, then `web_status`. |
| 403 "web access disabled" | Ask user to enable the toggle (Alt+Shift+S). |
| "Read/Action access not granted for origin X" | `web_request_access {url, reason}`; on `pending` call again with the same url; on `USER_DECLINED` ask in chat. |
| `TIMEOUT` "The browser didn't answer within Ns" | Not a hub outage. Ask the user to look for a ScreenSync approval (notification / card on the page / popup); check `web_events`, then retry. |
| `HUB_UNREACHABLE` "hub is not reachable" | The hub refused the connection: ask the user to start it (`npm start` / start-hub). |
| Weird/stale results | `web_extension_reload`, wait 5s, `web_status`. |
| Wrong browser answered | Pass `__browser` hint (see §5). |

---

## Native browser dialogs (beforeunload) - why a tab can look stuck

`alert` / `confirm` / `prompt` are shimmed by the extension and read back through
`web_dialog`. The **native `beforeunload` dialog** ("Leave site? Changes you may not be
saved.") is a different animal: it is browser chrome, not DOM.

- No DOM tool can see or click it. `web_click`, `web_eval`, `web_run_code` all execute in
  the page, and the page is frozen while the dialog is up.
- Chrome only raises it after a real user gesture, so it shows up on pages carrying
  unsaved state (a half-written post, a filled form) when something navigates away.
- While it is open the renderer is blocked, so renderer-bound CDP calls
  (`Target.setAutoAttach`, `Page.enable`, `Runtime.evaluate`, `Page.captureScreenshot`)
  hang. That is precisely the symptom `Timed out after 45000ms waiting for the browser
  extension`.

What to do:

| Situation | Action |
|---|---|
| Navigate a page that may hold unsaved state | Nothing extra - `web_navigate` and `web_reload` attach a CDP session and accept the prompt first. Pass `acceptBeforeUnload:false` to stay on the page instead. |
| A dialog is already open | `web_dialog_rule {action:"accept"}` answers it and sets the accept rule; `{action:"dismiss"}` answers it and keeps the page. The response reports `clearedOpenDialog`. |
| The tab is wedged and even `web_dialog_rule` keeps timing out | Close the tab: `web_tab {action:"close", tabId}`. `chrome.tabs.remove` is browser-level, so a frozen renderer cannot block it. Reopen the URL afterwards. |
| Stop accepting prompts later | `web_dialog_rule {action:"clear"}` |

Rule of thumb: **never leave a composer or form half-filled and then navigate away** - fill
it, post it, or close the tab. Otherwise the next navigation is the one that hangs.

Evidence for the fix (2026-09-16): a test page armed a real `beforeunload` via a trusted
click, then `web_navigate` moved the tab to example.com in **0.4s** with `status: complete`,
against a 45s timeout before the change.