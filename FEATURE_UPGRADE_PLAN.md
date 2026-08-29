# ScreenSync MCP — Advanced Features & UX Upgrade Plan

> **Status:** PLAN ONLY — nothing here is executed yet.
> **Date:** 2026-08-29
> **Golden rule for every item:** *never break mobile responsiveness.* Each new
> UI element must use `Flexible`/`Expanded`/`Wrap`/`LayoutBuilder`, be tested on
> a narrow (≤360dp) width, and must not introduce a single pixel of `RenderFlex`
> overflow. Full user experience stays first-class.

---

## 1. Deep-Dive: Current State (what exists today)

### Architecture
- **Flutter app** (Android) + **Node/TS MCP hub** (`mcp-server/`, HTTP :3000 + MCP stdio).
- **State:** single `ScreenCaptureBloc` (flutter_bloc) + `HubMaintenanceMixin`
  (20s health-ping timer, mDNS discovery, auto-sync).
- **Transport:** LAN (mDNS + bearer token) → Google Drive BYOS fallback → Hybrid.
- **Live:** SSE stream (`/api/events`) drives the ConnectionHero + AI activity feed.

### Screen / navigation map
```
HomeScreen (AppBar: logo · ScreenSync MCP · v2.5 · [Live/Connect toggle] · layers · moon)
 └─ body = DashboardTab (single scroll)
      • StatusDotPill (connected/offline)
      • WatchHeading ("Your AI, watching…")
      • ConnectionHero (phone⟷AI diagram, latency sparkline, SSE indicator, quick actions)
      • BubbleStatusCard (floating bubble on/off)
      • PermissionChecklist
      • Configuration (Preset / Sync cards → expandable details)
      • StoredFramesSection (lazy grid)
 └─ layers icon → HubScreen (menu of tiles)
      → Gallery · Diagnose · MCP · Telemetry · Settings   (each pushed full-screen)
Onboarding flow: persona → permissions → connect → done
```

### MCP surface (already rich — 25+ tools)
`get_latest_screenshot`, `list_recent_screens`, `get_device_status`,
`publish_inspection`, `publish_patch`, `get_mcp_catalog`, `get_skills`,
`get_recent_screenshots`, `control_status/screenshot/tap/long_press/swipe/scroll/
type/key/launch_app`, `get_ui_hierarchy`, `control_tap_text`, `control_swipe_until`,
`control_open_url`, `compare_frames`, `wait_for_frame`, `get_logcat`, `record_screen`.
Prompts: `inspect_latest_mobile_screen`, `autonomous_ui_test`, `reproduce_bug`,
`accessibility_audit`.

### Settings/feature flags today
theme mode, hub override, token, quality preset, shake trigger + threshold,
sync mode, auto-discover, auto-sync, simple mode, onboarding done.

---

## 2. UX / Responsiveness Findings (pain points to solve)

| # | Finding | Impact |
|---|---------|--------|
| U1 | Secondary screens are **2–3 taps deep** (layers → hub list → tile → screen). No persistent bottom nav. | Slow, easy to get lost |
| U2 | AppBar was overflow-prone (just fixed) — signals the header is **tight on small screens**. | Fragile on ≤360dp |
| U3 | Dashboard is **one long scroll**; no quick jump / no section anchors. | Hard to reach lower cards |
| U4 | No **landscape / tablet** layout (single-column only). | Poor on foldables/tablets |
| U5 | No **haptics/empty-state polish** consistency across secondary tabs. | Inconsistent feel |
| U6 | No in-app way to **see live stream** frames as they arrive (only latest count). | Misses the "watching" promise |
| U7 | No **accessibility pass** (dynamic text scale, semantics labels, contrast in dark). | a11y gaps |

---

## 3. Proposed Advanced Features (grouped, each responsive-safe)

### A. Navigation & Shell (fixes U1, U3, U4)
- **A1. Persistent bottom `NavigationBar`** (Material 3) with 4–5 primary
  destinations: Dashboard · Gallery · Diagnose · MCP · Settings. Keep the Hub
  menu as an "overflow / more" only for rarely-used items.
  - Responsive: use `NavigationBar` on phones, `NavigationRail` on width ≥600dp
    (tablets/landscape) via `LayoutBuilder`. Single source of truth for the
    selected index; body swapped with `IndexedStack` (preserves scroll state).
- **A2. Adaptive layout scaffold** — a `ResponsiveShell` widget that picks
  bottom-bar vs rail vs (≥900dp) two-pane master/detail. Zero overflow by design.
- **A3. Quick-jump FAB / section chips** on the dashboard to scroll to
  Configuration / Frames instantly.

### B. Live Experience (fixes U6 — delivers the core promise)
- **B1. Live Stream view** — a real-time thumbnail strip / mini-player that shows
  frames as SSE `frame` events fire (throttled), with a "● LIVE" pulse. Tap →
  fullscreen with pinch-zoom.
- **B2. Latency & health mini-HUD** — compact, collapsible; sparkline already
  exists, add p50/p95, jitter, dropped-frame counter.
- **B3. AI activity timeline** — richer feed: tool calls (`get_latest_screenshot`,
  `control_tap`…) shown as a live log with timestamps + status chips.

### C. Capture & Control power features
- **C1. Capture presets manager** — user-defined presets (resolution, format,
  redaction). Currently only Stream/Fast/Inspect hardcoded.
- **C2. Privacy redaction** — auto-blur of text fields / notifications before
  upload (opt-in). Big trust win.
- **C3. Region favorites** — save named crop regions for repeat inspection.
- **C4. Multi-device** — if >1 device paired, a device switcher chip.

### D. MCP / Agent surface
- **D1. In-app tool runner** — tap any catalog tool to invoke it (dev/debug),
  see the JSON result. Great for demos.
- **D2. Connection Kit QR** — generate a QR of the connect kit (not just copy).
- **D3. Session recorder** — record a control session (taps/swipes) and export
  as a reproducible MCP script.

### E. Polish, a11y, theming (fixes U5, U7)
- **E1. Dynamic type & semantics** — respect `MediaQuery.textScaler`, add
  `Semantics` labels to icon-only buttons (layers, moon, toggle).
- **E2. Motion-reduce** — honor `MediaQuery.disableAnimations` for the
  flutter_animate entrances.
- **E3. Theme presets** — accent color picker (violet default) + AMOLED-black
  dark variant.
- **E4. Skeleton loaders** — replace black/blank first-frame with shimmer.

### F. Reliability
- **F1. Offline queue UI** — surface unsynced frames + one-tap retry (data
  already exists in metrics).
- **F2. Reconnect backoff + toast** — clearer connect/disconnect feedback
  (builds on the new toggle + snackbar).

---

## 4. Suggested Phasing (safe increments)

**Phase 1 — Navigation & responsiveness backbone (highest UX ROI)**
- A1 bottom NavigationBar + A2 ResponsiveShell (rail on tablet).
- Migrate Gallery/Diagnose/MCP/Settings into the shell via `IndexedStack`.
- Add golden/widget tests at 320/360/411/600/900 dp to lock "no overflow".

**Phase 2 — Live experience**
- B1 live stream strip, B2 health HUD, B3 AI timeline.

**Phase 3 — Capture/control power features**
- C1 presets, C2 redaction (opt-in), C3 region favorites.

**Phase 4 — MCP power + polish**
- D1 tool runner, D2 QR, E1–E4 a11y/theming, F1/F2 reliability.

---

## 5. Responsiveness Guardrails (apply to EVERY change)
1. Wrap variable-width rows in `Flexible`/`Expanded`; use `Wrap` for chip groups.
2. Any AppBar/toolbar content → `actions:`, never a fixed `Row` in `title`.
3. Text that can grow → `overflow: ellipsis` + `maxLines`.
4. Use `LayoutBuilder`/`MediaQuery` breakpoints: 600dp (rail), 900dp (two-pane).
5. Test matrix widths: **320, 360, 411, 600, 768, 900** dp, portrait + landscape.
6. Respect `textScaler` up to 1.3× without clipping.
7. No hardcoded heights that can clip scaled text; prefer min-height + intrinsic.
8. Every new interactive icon gets a `Semantics`/`tooltip` label.

---

## 6. Effort / Risk (rough)

| Phase | Effort | Risk | Notes |
|-------|--------|------|-------|
| 1 | M | Low-Med | Touches navigation root; well-contained with IndexedStack |
| 2 | M | Low | Additive; SSE already wired |
| 3 | M-L | Med | Redaction needs native-side work |
| 4 | L | Low | Mostly additive UI + a11y |

---

## 7. Open Questions for You (before execution)
1. Bottom nav: which **4–5 destinations** should be primary? (my default:
   Dashboard · Gallery · Diagnose · MCP · Settings)
2. Live stream: real-time strip on the **dashboard**, or its own tab?
3. Redaction (C2): worth prioritizing, or later?
4. Tablet/landscape two-pane: needed now, or phones-first?
5. Any brand constraint (keep violet + serif) I must preserve? (assumed: yes)

> Tell me which phase / items to execute and I'll implement — responsively, tested
> at all breakpoints, with no overflow.
