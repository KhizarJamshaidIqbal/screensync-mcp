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

## 0 · Connect & discover

1. If the `screensync` MCP server is not attached, configure it (stdio):
   `node <mcp-server>/dist/index.js` with env `SCREEN_SYNC_TOKEN`.
   Global install already exists for this user — prefer it.
2. Always call **`web_status`** first. It returns `{online, webAccessEnabled,
   browsers: [{id, name, online, activeTab}]}`.
3. `get_mcp_catalog` re-reads the full capability surface anytime.

## 1 · See before acting (perception loop)

- **`web_aria_snapshot`** — the default way to READ a page: compact YAML ARIA
  tree with `[index=N]` refs. Feed refs straight into `web_click`/`web_type`.
- **`web_screenshot`** — vision pass for layout/visual questions.
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
| Run one tool on ALL browsers | `web_fanout` {tool, args, browsers} |
| Act inside an iframe | `web_in_frame` {tool, args, frameId|frameUrl} (frames via `web_frame_tree`) |
| Auto-answer HTTP 401 auth dialogs | `web_network_auth` {username, password} then navigate |
| Teach-once-replay-anywhere | `web_record` {action:start/stop} → edit steps → `web_replay` {steps} — daily real-account flows in one call |
| Run one tool on ALL tabs | `web_tab_fanout` {tool, args, tabIds|urls|activeOnly} |
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
- Hub tools time out at ~25–45s; for slow pages `web_navigate` first, then act.

## 9 · Recovery

| Symptom | Fix |
|---|---|
| 503 "extension not connected" | Open the ScreenSync dashboard (side panel) so the SW pairs, then `web_status`. |
| 403 "web access disabled" | Ask user to enable the toggle (Alt+Shift+S). |
| Weird/stale results | `web_extension_reload`, wait 5s, `web_status`. |
| Wrong browser answered | Pass `__browser` hint (see §5). |
