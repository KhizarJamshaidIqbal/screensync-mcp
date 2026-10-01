# ScreenSync MCP

**See your mobile UI through your AI's eyes.** ScreenSync turns any Android
phone into a live, AI-inspectable display: a floating bubble captures the
screen silently, a zero-config LAN hub delivers pixels to your desktop, and a
full MCP server lets Claude (or any agent) look at your UI, publish annotated
findings back to the phone, and even drive it remotely.

No cloud. No OCR. Vision on real pixels — your data never leaves your network
unless you choose Google Drive BYOS as a fallback.

```
┌─────────────── Android app ───────────────┐         ┌──────────── Desktop ────────────────┐
│  Floating bubble (tap / long-press /      │   LAN   │  ScreenSync hub (Express :3000)     │
│  shake / notification Snap · MCP · Pause) │ ──────▶ │   • /api/screens/upload   (Bearer)  │
│  MediaProjection foreground service       │  HTTP   │   • /api/events           (SSE)     │
│  BLoC pipeline → SQLite cache → sync      │ ◀────── │   • /pair + terminal QR   (pairing) │
│  Drive BYOS fallback (hybrid mode)        │   SSE   │   • mDNS _screensync-hub._tcp       │
└───────────────────────────────────────────┘  push   │  MCP stdio server                   │
        ▲                                             │   226 tools · 17 prompts · 3 resources│
        │  inspections / patches / live events        └──────────────┬──────────────────────┘
        ────────────────────────────────────────────────────────────┘
                              Claude Desktop · Claude Code · any MCP agent
```

---

## Highlights

| | |
|---|---|
| **Zero-config pairing** | Hub prints a QR in the terminal and serves `/pair`; the app scans it (or paste-link fallback). mDNS browse + LAN-subnet scan auto-discovery as backup. |
| **Silent capture** | One tap on the floating bubble grabs the screen via a MediaProjection foreground service; long-press opens a full crop editor with aspect locks, pinch-zoom and a magnifier loupe. |
| **Live feedback loop** | SSE push (`/api/events`): when the agent publishes an inspection or patch, the phone reacts instantly — notification, auto-refreshed heatmap, activity timeline. |
| **Vision, not OCR** | `get_latest_screenshot` / `get_recent_screenshots` return inline image content so agents preview pixels directly in chat. |
| **Annotate & redact** | In-app markup editor (freehand / arrow / circle) plus blur redaction boxes baked at native resolution before anything leaves the device. |
| **Before / after proof** | Diff viewer with slider wipe to visually confirm an AI patch actually fixed the UI. |
| **Remote control plane** | ADB-backed MCP tools: tap, swipe, scroll, type, key, launch app, read UI hierarchy, tap-by-text, swipe-until, logcat, screen-record clips, frame compare, wait-for-frame. |
| **Enterprise hygiene** | BLoC layering, ≤500-line components, local-first SQLite cache, retention-as-privacy pruning, bearer auth, reduce-motion + text-scale accessibility, dark/light themes. |

---

## Repository layout

Four codebases share this repo, plus tooling and docs. The rules every contributor and agent follows
are in [`CLAUDE.md`](CLAUDE.md) and [`AGENTS.md`](AGENTS.md).

```
├── lib/                      Flutter app (96 Dart files, BLoC architecture)
│   ├── blocs/                ScreenCaptureBloc split into mixins (hub
│   │                         maintenance, live mirror, hub events, capture sync)
│   ├── screens/              Home, onboarding wizard, gallery, diagnose,
│   │                         MCP catalog, settings, QR scan, annotate, diff,
│   │                         region crop editor (+ dashboard/, settings/,
│   │                         mcp/, pair_scan/ parts)
│   ├── widgets/              Design system (violet tokens, glossy tiles,
│   │                         ConnectionHero live-bridge, health HUD,
│   │                         AI timeline, live strip, responsive shell)
│   ├── services/             Overlay lifecycle, cross-engine trigger bridge,
│   │                         SSE client, pairing parser, mDNS/LAN discovery,
│   │                         capture pipeline (crop/quality/redact), shake,
│   │                         connection metrics, session recorder,
│   │                         in-app update service
│   ├── repositories/         SQLite frame cache, hub HTTP client,
│   │                         Google Drive BYOS
│   └── overlay_bubble.dart   Separate overlay-engine entry (bubble UI)
├── test/                     Dart tests (27 files, 223 tests)
├── android/                  Kotlin native layer + Gradle flavors
│   ├── app/src/main/         MainActivity + helpers (installer, Play update,
│   │                         projection permission), ScreenCaptureService
│   │                         (foreground service, notification quick actions
│   │                         Snap / MCP / Pause), UpdateCheckWorker
│   └── app/src/sideload/     Manifest that adds REQUEST_INSTALL_PACKAGES for
│                             the hub OTA build (the `play` flavor has none)
├── mcp-server/               Desktop hub + MCP server (TypeScript)
│   ├── hub.ts + hub-*.ts     Express: upload, SSE, pairing, catalog,
│   │                         inspections, patches, control API, app update
│   ├── mcp.ts / catalog*.ts  MCP protocol + capability catalogue: catalog.ts
│   │                         composes 17 catalog files (226 tools / 17 prompts
│   │                         / 3 resources)
│   ├── control*.ts           ADB backend (input, UI tree, logcat, record);
│   │                         control-adb.ts is the one adb runner (no shell),
│   │                         control-ui.ts the UI tree and tap_text matcher,
│   │                         control-apps.ts the app list and launch by query,
│   │                         mcp-control.ts the control_* / os_* handlers
│   ├── storage.ts / config.ts  Retention, env, auth
│   └── test/                 Unit, guard and E2E suites (`npm test`)
├── extension/                MV3 browser extension: the `web_*` tools run
│                             in your real browser (no build step, own tests
│                             in extension/test, run by `npm run test:ext`)
├── website/                  Marketing site + changelog (static HTML; served
│                             from the `deploy` branch, not from `main`)
├── tools/                    Play release, release-notes, changelog and
│                             OTA-APK tooling (PowerShell + Python); see
│                             tools/README.md
├── docs/                     Release, Play API, release-notes, app-size and
│                             site-changelog guides
├── ci/                       One dormant GitHub Actions workflow (not active)
├── .agents/                  Canonical agent skills and rules
└── docs at root              CONNECT_KIT.md · RELEASE_NOTES.md (extension and
                              hub notes) · DEEP_DIVE_ANALYSIS.md ·
                              FEATURE_UPGRADE_PLAN.md · WEBSITE_PLAN.md
                              (the last three are historical)
```

---

## Quick start

### 1 · Desktop hub

```bash
cd mcp-server
npm install
npm run build
npm start            # HTTP hub on :3000 + MCP stdio server
# or: double-click start-hub.bat (Windows) / start-hub.command (macOS/Linux)
```

At startup the hub prints a **pairing QR** and the link
`screensync://pair?url=http://<LAN-IP>:3000&token=…`.

### 2 · Phone app

```bash
flutter pub get
flutter build apk --debug          # or --release (needs android/app/key.properties)
flutter install                    # or adb install -r
```

The app has two Android flavors, `sideload` (the default: hub OTA updates) and `play` (the Google Play
bundle, `flutter build appbundle --release --flavor play`). See `CLAUDE.md` section 8.

On first launch the onboarding wizard routes you (developer vs simple mode),
pairs via **Scan QR code** (or paste link), and walks you through the two
permissions (overlay + notifications). Then **Start Floating Bubble** —
tap it any time to capture.

### 3 · Connect your agent

**Fastest:** open the app's **MCP tab → Copy Connect Kit** and paste the whole
block into Claude (any client). The agent self-configures and discovers every
capability via `get_mcp_catalog` / `get_skills`.

**Manual config** (Claude Desktop `claude_desktop_config.json`, or Claude
Code `.mcp.json`):

```json
{
  "mcpServers": {
    "screensync": {
      "command": "node",
      "args": ["<ABSOLUTE-PATH-TO>/mcp-server/dist/index.js"],
      "env": { "SCREEN_SYNC_TOKEN": "screensync-local-dev" }
    }
  }
}
```

Then just ask:

> Look at my latest mobile screenshot and tell me why the submit button is
> clipped. Publish an inspection.

The agent calls `get_latest_screenshot`, inspects the raw image, and
`publish_inspection` pushes the finding back to the phone over SSE — the
Diagnose tab shows the heatmap without a manual refresh.

---

## MCP capability surface

Single source of truth: [`mcp-server/catalog.ts`](mcp-server/catalog.ts), which composes the 17
`mcp-server/catalog*.ts` files (the phone, ADB-control and `os_*` tools live in `catalog-control.ts`;
the `web_*` browser tools and the cognitive-memory tools are in the other sibling files). It is also served at `GET /api/mcp/catalog` and
`screensync://skills`. The published tool count is kept in step by `npm run sync:toolcount`.

**Capture & inspect** — `get_latest_screenshot`, `get_recent_screenshots`,
`list_recent_screens`, `compare_frames`, `wait_for_frame`, `record_screen`,
`get_logcat`, `get_ui_hierarchy`, `get_device_status`

**Publish back to the phone** — `publish_inspection` (normalized bug regions +
summary → heatmap), `publish_patch` (git patch → one-tap copy)

**Remote control (ADB)** — `control_status`, `control_screenshot`,
`control_tap`, `control_long_press`, `control_swipe`, `control_scroll`,
`control_type`, `control_key`, `control_launch_app`, `control_tap_text`,
`control_swipe_until`, `control_open_url`

**Self-service discovery** — `get_mcp_catalog`, `get_skills`

**Prompts** (17), for example `inspect_latest_mobile_screen`, `autonomous_ui_test`,
`reproduce_bug`, `accessibility_audit` · **Resources** —
`screensync://status`, `screensync://workflow`, `screensync://skills`

> Remote input injection on MIUI-class devices requires **USB debugging
> (Security settings)** to be enabled in Developer options; the app's
> Permission Doctor deep-links you there.

---

## HTTP API (hub)

| Route | Auth | Purpose |
| --- | --- | --- |
| `GET /health` | open | Liveness, hub version + latest frame timestamp |
| `GET /pair` · `GET /api/pair` | open (pairing window / loopback) | Pairing QR page / payload |
| `POST /api/screens/upload` | Bearer | Frame ingest (base64 data URL) |
| `GET /api/screens/latest` | Bearer | Latest frame + metadata |
| `GET /api/events` | Bearer | SSE stream (`frame` · `inspection` · `patch` · `tool`); the phone opens it as `?client=app`, which is how the hub knows the phone is online |
| `GET /api/events/recent` | Bearer | HTTP tail of the sequenced event ring (`since`, `types`, `limit`); the phone also uses it as a cheap "is my token accepted" probe |
| `GET /api/inspections/latest` · `/api/patches/latest` | Bearer | Agent findings for the phone |
| `GET /api/mcp/catalog` | Bearer | Capability catalogue |
| `GET /api/device/status` | Bearer | Connection state: `connected` (a frame in the last 60 s), `hasFrames`, `phoneOnline` (phone on the SSE stream), `state` (`streaming` · `linked_no_frames` · `no_phone`), plus the older `stale` / `lastFrameAgeMs` fields |
| `GET /api/app/latest` · `GET /apk` | Bearer (loopback allowed on `latest`; `/apk` also takes `?token=`) | In-app update channel: newest build manifest (`versionCode`, `sha256`, `apkPath`, `versionSource`) and the APK itself |
| `GET/POST /api/os-control` | Bearer | Host-level OS-control switch |
| `POST /api/control/:action` | Bearer | ADB control plane: every `control_*` tool, named without the prefix (`tap`, `tap_text`, `open_url`, `launch_app`, ...; `launch` still works), through the same handler as MCP. A missing required argument is `400 MISSING_ARG` |

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `SCREEN_SYNC_PORT` | `3000` | HTTP hub port (also mDNS-advertised) |
| `SCREEN_SYNC_HOST` | `0.0.0.0` | Bind address |
| `SCREEN_SYNC_TOKEN` | `screensync-local-dev` | Bearer token — must match the app's pairing token |
| `SCREEN_SYNC_DATA_DIR` | `./data` | Frame / inspection / patch storage |
| `SCREEN_SYNC_ADB_TARGET` | first device | ADB serial for the control plane |
| `SCREEN_SYNC_ADB_BIN` | SDK default | Path to the `adb` binary |

## Security & privacy

- **LAN-only by default** — nothing leaves your network unless you enable
  Drive mode. Bearer token guards every `/api` route; the control plane
  runs adb without a host shell, quotes typed text and URLs for the
  phone's shell, refuses what it cannot type (Unicode) instead of altering
  it, and allow-lists key codes.
- **Retention is a privacy feature** — hub keeps the newest 20 frames,
  archives overflow, and hard-prunes the archive at 100; the phone cache
  caps at 60 rows; Drive keeps the latest 20 in `ScreenSync_MCP/` using the
  restricted `drive.file` scope.
- **Redact before send** — blur boxes are baked into the exported PNG, and a
  global privacy redaction toggle pixelates configurable regions
  pre-upload.
- Use a non-default `SCREEN_SYNC_TOKEN` on shared networks (Settings → Hub).

## Observability & quality

- **On-phone**: live latency sparkline, Health HUD (p50/p95/jitter/dropped),
  AI activity timeline, telemetry tab, session stats.
- **Tests**: `flutter test` (223 tests: live mirror, hub connection and auth, update flow, capture
  trigger bridge, overlay bubble, pairing, layout at 320/360/393dp) and, from `mcp-server/`,
  `npm test` (unit and contract guards, MCP protocol E2E, the full upload→agent→readback aim-loop,
  then the browser-extension suite). The Kotlin layer has no tests: verify it on a device.
- **Design system**: violet tokens, serif display + micro-labels, glossy
  gradient tiles, reduce-motion aware entrances, responsive shell
  (bottom bar / rail / two-pane ≥900dp), text-scale clamping.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| "Hub offline" on a real phone | `127.0.0.1` only works on the emulator — scan the QR or enter `http://<PC-LAN-IP>:3000` in Settings → Hub. |
| Bubble tap does nothing | Check the notification shows "capture active"; tap the ⏸ Resume action if paused. |
| Dashboard says **NO CAPTURE** / the live strip says **WAITING** | The hub link is up but no screen-capture session is running, so no frames are pushed. Tap **Grant screen capture** (Dashboard, or the live-mirror row in Settings) and accept the Android prompt. |
| Hub shows **AUTH PROBLEM** / **Re-pair** | The hub is reachable but rejected the phone's pairing token (it changed on the hub, or it was cleared). Re-scan the QR from `/pair` or re-enter the token in Settings → Hub. |
| "Timed out waiting for a screen frame" | Retried automatically once; re-grant screen-capture consent if the OS revoked it. |
| Bubble won't show on MIUI | Permission Doctor → enable overlay + autostart + battery whitelist. |
| Control tools fail on MIUI | Enable **USB debugging (Security settings)** in Developer options. |

## Further reading

- [`CLAUDE.md`](CLAUDE.md) · [`AGENTS.md`](AGENTS.md) — the working rules for contributors and AI agents
- [`CONNECT_KIT.md`](CONNECT_KIT.md) — paste-ready agent connection kit
- [`RELEASE_NOTES.md`](RELEASE_NOTES.md) — extension and hub release notes (not the Google Play notes)
- [`docs/LOCAL_RELEASE.md`](docs/LOCAL_RELEASE.md) · [`docs/PLAY_API_GUIDE.md`](docs/PLAY_API_GUIDE.md) ·
  [`docs/RELEASE_NOTES_GUIDE.md`](docs/RELEASE_NOTES_GUIDE.md) · [`docs/APP_SIZE_GUIDE.md`](docs/APP_SIZE_GUIDE.md) ·
  [`tools/README.md`](tools/README.md) — building and releasing the Android app
- [`docs/SITE_CHANGELOG_HANDOFF.md`](docs/SITE_CHANGELOG_HANDOFF.md) — the website changelog and how to roll the site back
- Historical, not maintained: [`DEEP_DIVE_ANALYSIS.md`](DEEP_DIVE_ANALYSIS.md) (forensic walkthrough of the capture loop, written for app 2.5.0),
  [`FEATURE_UPGRADE_PLAN.md`](FEATURE_UPGRADE_PLAN.md) (the 2026-08-29 UX roadmap) and [`WEBSITE_PLAN.md`](WEBSITE_PLAN.md)

---

*App 2.5.4 (build 32) · Hub 1.14.3 · Extension 1.14.3 · MCP server identity 3.3.0 · Flutter 3.38 / Android API 36 · Node 22+ with TypeScript ESM · MIT-style local use.*
*The release step bumps the app version in `pubspec.yaml`; trust that file over this line.*
