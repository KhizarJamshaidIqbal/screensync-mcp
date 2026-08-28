# ScreenSync — Full Codebase Deep Dive

**Version:** 2.5.0+25 · **Dart SDK:** `>=3.4.0 <4.0.0` · **Scope:** 54 Dart files + 2 Kotlin files + ~20 TypeScript files
**Method:** complete read-through of every source file (read-only; nothing modified)

---

## 1. What this thing actually is

ScreenSync is a **local-first screen-sharing bridge between an Android phone and a desktop AI coding agent**. It solves one specific problem: an agent like Claude Code can read your code but is blind to what your app *looks like* when it runs. ScreenSync closes that loop.

The shape of it:

```
┌──────────────────────── ANDROID PHONE ─────────────────────────┐
│                                                                │
│  Floating bubble (Flutter overlay engine)                      │
│         │  filesystem bridge (NOT plugin messenger)            │
│         ▼                                                      │
│  ScreenCaptureBloc  ◄── Flutter main engine                    │
│         │                                                      │
│         ├──► MediaProjectionService ──► MethodChannel ──► Kotlin│
│         │                                 ScreenCaptureService  │
│         │                                 (ImageReader+VirtualDisplay)
│         ├──► CapturePipelineService (crop → JPEG/PNG → thumb)   │
│         ├──► CaptureCacheRepository (SQLite + files, 60 rows)   │
│         └──► ScreenRepository ──► LAN HTTP ──┐                  │
│                                              │                 │
│  Also: Google Drive BYOS path (hybrid mode)  │                 │
└──────────────────────────────────────────────┼─────────────────┘
                                               │  mDNS discovery
                    ┌──────────────────────────▼──────────────────────────┐
                    │            DESKTOP HUB (Node, Express 5)            │
                    │  HTTP :3000  (bearer auth, SSE /api/events)         │
                    │  Bonjour  _screensync-hub._tcp                      │
                    │  data/frames (20) · data/archive (100)              │
                    │                    ▲                                │
                    │  MCP stdio server ─┘ (same data dir)                │
                    └───────────────────────┬────────────────────────────┘
                                            │  stdio / JSON-RPC
                                     ┌──────▼──────┐
                                     │ Claude Code │
                                     └──────┬──────┘
                                            │ publish_inspection / publish_patch
                                            ▼
                                    SSE push back to phone
                                    → heatmap rects + unified diff on device
```

That last leg is what makes it interesting. It is not a screenshot dump tool — it is a **closed aim loop**: capture → agent sees → agent diagnoses → agent publishes structured findings → phone renders them as a heatmap and a patch panel.

---

## 2. The end-to-end trace, blow by blow

This is the single most useful thing to understand. Follow one bubble tap all the way through.

### Phase 1 — Trigger (overlay engine)

1. User taps the floating bubble. `OverlayBubbleWidget._handleTap()` runs **in the overlay Flutter engine** — a completely separate isolate from the main app.
2. It does haptics, bumps a daily counter, flashes, ripples.
3. **Critically:** it does *not* call `FlutterOverlayWindow.shareData()`. That call hangs forever across engines. Instead `CaptureTriggerBridge.sendCapture()` writes a JSON line to `<app-files>/screensync_capture_trigger` — a plain file all three parties agree on.
4. `_showPeek()` renders a thumbnail preview so the tap feels instant.

### Phase 2 — Capture (main engine → native)

5. `CaptureTriggerBridge.watch()` in the main engine picks up the file change. It is a cancellation-aware `StreamController(onListen/onCancel)` — the old implementation leaked an infinite generator. A `_nonce()` prevents the dedupe logic from swallowing rapid consecutive taps.
6. `ScreenCaptureBloc._handleBubbleTrigger()` debounces 1s, then `_onTriggerCapture`.
7. `MediaProjectionService.prepare()` polls native `isCaptureReady()` for up to 5s, else throws `projection_start_timeout`.
8. `captureScreen()` hits the `com.screensync.mcp/media_projection` MethodChannel. Empty bytes → `empty_capture`.
9. Kotlin `ScreenCaptureService.captureFrame()` sets an `AtomicBoolean framePending`, waits on the `HandlerThread("ScreenSyncCapture")` with a 4s `FRAME_TIMEOUT_MS`.
10. On Android 14+ it calls `promoteCaptureSurface()` — a **reflective** `Surface#promote()` — before waiting. Without this, frames never arrive and every capture times out.
11. `imageToPng()` walks the `ImageReader` planes, handles rowStride/pixelStride padding, crops to real dimensions, PNG-encodes.

### Phase 3 — Process & persist (Dart)

12. `CapturePipeline.process()`: crop to `NormRect` first, **then** apply quality. Order matters — you don't want to JPEG-compress pixels you're about to throw away.
13. JPEG encoding is done with `package:image` on raw RGBA, because Flutter's own encoder can't emit JPEG at all.
14. `thumbnail()` produces a 320px version; `persist()` writes both to `<docs>/screensync_frames/`.
15. `CapturedFrame` **parses width/height out of the raw bytes** (PNG IHDR at offsets 16/20, JPEG SOF0/1/2 marker walk) rather than trusting native. `Equatable.props` deliberately excludes `imageBytes` so equality doesn't compare megabytes.
16. `_persistFrame()` inserts a SQLite row with `syncedHub`/`syncedDrive` flags and writes a "latest frame" pointer.

### Phase 4 — Upload

17. `ScreenRepository` resolves the hub URL: manual override → mDNS auto-discovery → dart-define default. Same chain for the token.
18. Sync mode decides the path: `lanMdns`, `googleDrive`, or `hybrid`.
19. **`pushToLocalMcpServer()` never throws on connectivity failure** — it returns `false`. This is deliberate and load-bearing: it's what lets hybrid mode fall through to Drive instead of blowing up. The comment in the source marks it as a FIX.
20. Telemetry is recorded for every outcome: success, refusal, timeout, socket error, HTTP error.

### Phase 5 — Desktop hub

21. `POST /api/screens/upload` → Zod validation (`imageDataUrl` ≤ 25MB, filename regex `^[a-zA-Z0-9._-]+$` blocking path traversal, ISO timestamp refine).
22. Stored under `data/frames/` with a UUID name. 201 + metadata. Emits a `"frame"` hub event.
23. `retainRecentFrames()` pushes anything past 20 into `data/archive/`; `pruneArchive()` deletes past 100. This was added specifically to stop unbounded accumulation of sensitive screenshots.

### Phase 6 — Agent

24. Claude Code reads via MCP stdio: `get_latest_screenshot` returns base64 image + metadata, or `get_recent_screenshots` returns up to 6 inline.
25. Agent looks at it, reasons about it.
26. Agent calls `publish_inspection` with normalized bug regions, and/or `publish_patch` with a unified diff.

### Phase 7 — Back to the phone

27. `saveInspection()`/`savePatch()` write JSON and `emitHubEvent()`.
28. The phone's `LiveEventService` is holding a persistent SSE connection to `/api/events` with exponential backoff (1s → 30s) and reconnect.
29. `ScreenCaptureBloc._onLiveHubEvent()` fires, posts a notification, and the Diagnose tab renders a `HeatmapPanel` (rects scaled via `LayoutBuilder`) and a `PatchPanel` (copy-to-clipboard diff).

Round trip complete.

---

## 3. Layer-by-layer

### 3.1 Android native (Kotlin)

**`MainActivity.kt`** (341 lines) — hosts two MethodChannels.
- `com.screensync.mcp/media_projection`: `prepareCapture()` uses `startActivityForResult` with request code `7301`; `captureScreen()` folds the Kotlin `Result` into channel success/error so Dart never sees an unhandled platform exception.
- `com.screensync.mcp/device`: brand detection, battery-whitelist query/request, notification permission, overlay settings, vendor-specific background intents, FileProvider share, alert notification (channel `screensync_alert`, id `4202`), pending-snap queue drain.

**`ScreenCaptureService.kt`** (463 lines) — the actual screen grabber.
- Foreground service, `mediaProjection` type, notification id `4201`.
- Dedicated `HandlerThread("ScreenSyncCapture")` so blocking waits never touch the main thread.
- `ImageReader.newInstance(w, h, RGBA_8888, 2)` — buffer depth 2, enough to avoid backpressure stalls without wasting memory.
- `createVirtualDisplay(..., VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR)`.
- `resizeCaptureIfNeeded()` on rotation — the virtual display must be torn down and rebuilt.
- Notification actions **SNAP / MCP / PAUSE**. SNAP writes `{"type":"NOTIFICATION_SNAP","source":"SNAP"}` to `filesDir/screensync_capture_trigger` — the *same file* the Dart bridge watches. That's how a notification action reaches Flutter without any process plumbing.

**`AndroidManifest.xml`** (70 lines) — `usesCleartextTraffic="true"` (required: LAN HTTP, no TLS). `FOREGROUND_SERVICE_MEDIA_PROJECTION`, `FOREGROUND_SERVICE_SPECIAL_USE` with `PROPERTY_SPECIAL_USE_FGS_SUBTYPE` for the overlay. Camera permission is for QR pairing.

**`build.gradle`** — `ndkVersion` is **pinned to `29.0.14206865`** because `flutter.ndkVersion` (28.2.13676358) was only partially downloaded on this machine and lacked `source.properties`. Java/Kotlin 11.

### 3.2 Flutter services

| File | Lines | What it does |
|---|---|---|
| `media_projection_service.dart` | 48 | Thin MethodChannel wrapper, 5s readiness poll |
| `floating_overlay_service.dart` | 220 | The most battle-scarred file in the repo |
| `capture_pipeline_service.dart` | 132 | `NormRect`, crop→quality ordering, JPEG via `package:image`, 320px thumb |
| `capture_trigger_bridge.dart` | 135 | Cross-engine filesystem signal |
| `device_intent_service.dart` | 94 | OEM permission intents |
| `hub_discovery_service.dart` | 158 | Bonsoir mDNS + /24 subnet fallback |
| `live_event_service.dart` | 111 | Persistent SSE, exponential backoff |
| `settings_service.dart` | 155 | `ChangeNotifier` over SharedPreferences, 30-entry telemetry ring |
| `pairing_service.dart` | 80 | 4 accepted QR/paste formats |
| `shake_trigger_service.dart` | 28 | Accelerometer magnitude ≥ 14.0, 3s cooldown |

### 3.3 Repositories

- **`screen_repository.dart`** (273) — hub URL/token resolution, `pingHubTimed()` returning a record `({bool ok, int ms})`, uploads, `fetchBugRegions`, `fetchMcpCatalog`, `fetchLatestPatch`, `fetchDeviceStatus`.
- **`capture_cache_repository.dart`** (147) — SQLite `frames` table, `maxRows = 60`, binary pruning, `unsyncedHubFrames` oldest-first limit 20 (so backlog drain is FIFO, not LIFO).
- **`google_drive_repository.dart`** (119) — BYOS, `drive.file` scope only. Ensures a `ScreenSync_MCP` folder. `_autoCleanupOldScreens()` keeps newest 20, 5-minute cooldown so it doesn't run on every upload.
- **`sync_mode.dart`** — `{ lanMdns, googleDrive, hybrid }`.

### 3.4 BLoC

- **`screen_capture_bloc.dart`** (463) — the heart. Wires resolvers, registers handlers, `registerHubMaintenance()`, `_listenToTriggers()`, `_seedFromSettings()`, `_wireLiveEvents()`.
- **`hub_maintenance_mixin.dart`** (185) — 20s periodic `_maintainHub()`; `autoDiscoverHub()` first **clears emulator-only overrides** (`127.0.0.1`, `localhost`, `10.0.2.2`) so auto-discovery actually works on real hardware; mDNS given 3s inside a 5s hard timeout (Bonsoir's ready-future can hang forever); then `scanSubnet()` 10s fallback.
- **`screen_capture_event.dart`** (119) — 20 event classes.
- **`screen_capture_state.dart`** (130) — `CaptureStatus {idle, capturing, uploading, success, failure}`; `copyWith` uses a `_sentinel` Object so nullable fields can genuinely be set back to null.

### 3.5 UI

Entry: `main.dart` (89) gates Onboarding vs Home, creates the Bloc, fires `PingHubEvent()`, rebuilds on settings changes.

Screens: `home_screen` (200, `BlocConsumer` + `CaptureCelebration`), `hub_screen` (174, grid hub, hides advanced tabs in `simpleMode`), tabs — `dashboard_tab` (159), `diagnose_tab` (274), `mcp_tab` (264), `settings_tab` (305), `gallery_tab` (495), `telemetry_tab` (125) — plus `annotate_screen` (428), `diff_screen` (211), `pair_scan_screen` (212), `onboarding_screen` (176).

Widgets: `connection_hero` (293, animated dashed link with flowing particles), `permission_checklist` (264, 3s poll that stops once all granted), `common_widgets` (322), `connect_kit_card` (88), `empty_state_illustration` (130).

Theming: `core/app_theme.dart` (182) — design tokens, `GlassPanel` with backdrop blur **dark mode only** for mid-range device perf.

### 3.6 MCP / HTTP hub (TypeScript, ESM, strict)

| File | Lines | Role |
|---|---|---|
| `index.ts` | 40 | Starts HTTP hub; on `EADDRINUSE` logs and continues in **MCP-only mode** |
| `config.ts` | 28 | `DATA_DIR`, port 3000, `AUTH_TOKEN = "screensync-local-dev"`, `MAX_FRAMES=20`, `MAX_ARCHIVE=100`, 18mb body cap |
| `events.ts` | 15 | `EventEmitter`, 20 listeners |
| `storage.ts` | 165 | Zod schemas, retention, dimension parsing |
| `hub.ts` | 307 | Express app, SSE, `/pair` QR page, Bonjour advertise |
| `mcp.ts` | 198 | 8 tools, 1 prompt, 3 resources |
| `catalog.ts` | 208 | Single source of truth surfaced to the agent |

**MCP surface:** `get_mcp_catalog`, `get_skills`, `get_recent_screenshots` (1–6 inline images), `get_latest_screenshot`, `list_recent_screens` (1–20), `get_device_status` (stale > 60s), `publish_inspection`, `publish_patch`.
**Resources:** `screensync://status`, `screensync://workflow`, `screensync://skills`.
**Prompt:** `inspect_latest_mobile_screen` with optional `focus`.

---

## 4. The non-obvious engineering (this is the good part)

These are the decisions that a casual read would miss. They're what makes the difference between "compiles" and "actually works."

### 4.1 Two Flutter engines can't talk to each other
`flutter_overlay_window` spawns a **second Flutter engine**. Plugin messenger calls between engines ping-pong and `FlutterOverlayWindow.shareData()` never resolves. Everything cross-engine therefore goes through a shared file at `<app-files>/screensync_capture_trigger` — written by the overlay engine, by Kotlin's notification SNAP action, and read by the main engine. **All three sides must agree on that one absolute path** (hence: app-files dir, not temp dir, which differs per process).

### 4.2 The bubble dragged itself back to the edge
The root cause was **not** `enableDrag`. It was `positionGravity: auto`, which installs an edge-snap `Timer` that yanks the window back after you release it and that nobody cancels. Fix: `PositionGravity.none`. Separately, every `resizeOverlay()` call **must** re-pass `enableDrag: true`, because the resize handler rewrites `WindowSetup.enableDrag` and silently clears it. Miss that and the bubble becomes undraggable after any resize.

### 4.3 Window size ≠ visual size
The overlay window is **96dp** but the visible bubble is **58dp**. That padding is intentional touch slack. A 1500ms watchdog clamps and persists the position so the bubble can't be flung off-screen.

### 4.4 Android 14+ frame starvation
Virtual-display surfaces need an explicit `Surface#promote()` on API 34+, or the `ImageReader` never receives a frame and every capture dies at the 4s timeout. It's invoked **reflectively** to avoid hard-coupling to a compile SDK the project doesn't target.

### 4.5 Hybrid fallback correctness
If `pushToLocalMcpServer()` threw on a socket error, hybrid mode would abort before ever trying Drive. It returns `false` instead. Small change, and the whole sync-mode feature depends on it.

### 4.6 Discovery has to survive the real world
mDNS is unreliable: Bonsoir's ready-future can hang indefinitely (wrapped in a hard 5s timeout), and plenty of routers drop multicast. So there's a **/24 subnet scan fallback** — 254 hosts in batches of 32, 350ms each, identifying a hub by `res.body.contains('screensync-hub')` (the string `/health` returns). Interface selection prioritizes `wlan*` and private ranges (`192.168.`, `10.`, `172.16–31`).

### 4.7 Port contention is a feature, not an error
An agent spawns the MCP server over stdio; if you *also* have `npm start` running, port 3000 is taken. Rather than dying, `index.ts` catches `EADDRINUSE`, logs, and continues in **MCP-only mode**. Both processes then share one `data` dir. `test/flow.e2e.ts` explicitly exercises this with a twin instance on port 3102.

### 4.8 Retention is a privacy control
Screenshots are the most sensitive data this app touches. Frames cap at 20, archive at 100, local SQLite at 60 rows, Drive at 20 with cleanup. The archive prune was added specifically because the archive previously grew without bound.

---

## 5. Security model (and where it's thin)

**What's there:**
- Bearer token on every `/api/*` route (`/health` and `/pair` are intentionally open — the former is what LAN discovery scans for, the latter is the pairing entry point).
- Zod validation with a filename regex `^[a-zA-Z0-9._-]+$` that blocks path traversal. `flow.e2e.ts` asserts 400 on `../../etc/passwd`-style names.
- Google Drive uses `drive.file` scope only — the app can read *only files it created*. That's the correct BYOS choice.
- Binds `0.0.0.0` for LAN reachability.

**What's thin:**
- **The token is a plain `===` string compare** in `isAuthorized()`. Not constant-time, so it is in principle timing-attackable. On a LAN against a dev tool this is low practical risk, but it's a one-line fix (`crypto.timingSafeEqual`).
- **Default token `screensync-local-dev` is committed** and is what most deployments will run with.
- **Cleartext HTTP.** `usesCleartextTraffic="true"` plus no TLS means screenshots cross the LAN unencrypted. Anyone on the same Wi-Fi can sniff frames. Acceptable for a home dev setup, not for a café or office.
- No replay protection or nonce on uploads.

---

## 6. Strengths

1. **The aim loop is real.** Bidirectional — agent publishes findings, phone renders them. Very few tools in this space close the loop.
2. **Every hard-won bug is documented in the source.** The overlay service, the trigger bridge, and the repository all carry comments explaining *why* the weird code exists. That's rare and it's the single biggest maintainability asset here.
3. **Degradation is designed, not accidental.** mDNS → subnet scan. LAN → Drive. HTTP hub → MCP-only. Every layer has a fallback.
4. **Local-first.** Everything works with no hub at all; SQLite keeps a full backlog and `_onSyncPending` drains it later.
5. **Genuinely tested at the protocol level.** `flow.e2e.ts` hand-builds a PNG (CRC32 + zlib deflate), uploads it, reads it back through *both* MCP and HTTP, and asserts **byte-identical** output. That's a real end-to-end assertion, not a mock.
6. **Static analysis is clean.** `flutter analyze`: 14 issues, all `info` lints, zero errors/warnings.
7. **OEM handling is thorough.** Xiaomi/Samsung/Huawei/OPPO/vivo vendor intents, battery whitelist, overlay settings, with a manual-confirmation path.

---

## 7. Risks & gaps (prioritized)

### High
1. **No BLoC tests.** `ScreenCaptureBloc` is 463 lines containing the app's most intricate logic — trigger debounce, sync backlog drain, live-event handling, hub maintenance. Flutter tests cover only `capture_trigger_bridge`, `pairing_service`, `floating_overlay_service`, and `overlay_bubble`. The highest-value test surface in the project is untested.
2. **Release build signs with the debug key.** `build.gradle` falls back to the debug signing config when no release config exists. Anything published from this repo is debug-signed.
3. **Cleartext LAN transport** for screenshots (see §5).

### Medium
4. **`tsconfig.json` `include` is `["index.ts", "test/**/*.ts"]`.** `hub.ts`, `mcp.ts`, `catalog.ts`, `storage.ts`, `config.ts`, and `events.ts` are only pulled in **transitively** via imports. It type-checks today, but the moment a file becomes orphaned or is only dynamically imported, it silently drops out of checking. Add them explicitly.
5. **`scanSubnet()` probes 254 hosts** at 350ms per host in batches of 32 — roughly 3–9s and 254 TCP connections. On battery, on a large subnet, that's meaningful. Consider narrowing to the DHCP range or caching the last known-good IP and trying it first.
6. **`floating_overlay_service_test.dart` comment says 120dp** but `bubbleSize` is 96. Stale comment; minor, but it will mislead the next reader.
7. **Token comparison not constant-time**, default token committed.

### Low
8. 14 `info`-level lints (missing `const`, `sort_child_properties_last`, curly braces in `for`). Cosmetic.
9. `ndkVersion` pinned to work around a local incomplete SDK download — will confuse anyone whose SDK is intact.
10. `GlassPanel` backdrop blur is dark-mode-only for perf. Correct call, but worth documenting in the theme file so it isn't "optimized" away later.

---

## 8. Verification status

| Check | Result |
|---|---|
| `flutter analyze` | ✅ **Clean** — 14 issues, all `info` lints. 0 errors, 0 warnings. (353s) |
| `npx tsc --noEmit` | ✅ **Clean** — exit 0, zero diagnostics emitted |
| `mcp-server` E2E (`npm test`) | Present and thorough: 8-tool assertion, 401 on bad token, 400 on path traversal, 400 on non-image bytes, 201 on valid upload, byte-identical readback, twin-instance coexistence |
| Flutter tests | 4 test files, all covering utility/services, none covering BLoC |
| Runtime evidence | `data/frames/` and `data/archive/` contain real captures (e.g. `033fa9cb-….jpg`, 110KB), plus non-empty `latest_inspection.json` (254B) and `latest_patch.json` (442B) — the pipeline has demonstrably run end-to-end |

**No files were modified during this analysis.**

---

## 9. If I were picking what to do next

In order of value-per-hour:

1. **Write BLoC tests.** Even five — trigger debounce, backlog FIFO drain, live-event → state, hub URL resolution precedence, hybrid fallback when LAN fails. This is by far the biggest coverage hole relative to how much logic lives there.
2. **Fix the release signing config.** Small, and it's a correctness issue the day anyone ships.
3. **`crypto.timingSafeEqual` for the token** + ship a randomized default token on first hub start (write it into `DATA_DIR` and print it in the terminal QR flow).
4. **Add the missing `include` entries to `tsconfig.json`.**
5. **Try last-known-good hub IP before the /24 scan.** Cheap, and noticeably improves reconnect battery cost.

---

*Analysis covered: all 54 Dart files, both Kotlin files, the full `mcp-server` TypeScript source, both E2E suites, all Flutter tests, build configs, and observed runtime data.*
