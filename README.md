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
        ▲                                             │   28 tools · 4 prompts · 3 resources│
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

```
├── lib/                      Flutter app (74 files, BLoC architecture)
│   ├── blocs/                ScreenCaptureBloc + hub-maintenance mixin
│   ├── screens/              Home, onboarding wizard, gallery, diagnose,
│   │                         MCP catalog, settings, QR scan, annotate, diff,
│   │                         region crop editor
│   ├── widgets/              Design system (violet tokens, glossy tiles,
│   │                         ConnectionHero live-bridge, health HUD,
│   │                         AI timeline, live strip, responsive shell)
│   ├── services/             Overlay lifecycle, cross-engine trigger bridge,
│   │                         SSE client, pairing parser, mDNS/LAN discovery,
│   │                         capture pipeline (crop/quality/redact), shake,
│   │                         connection metrics, session recorder
│   ├── repositories/         SQLite frame cache, hub HTTP client,
│   │                         Google Drive BYOS
│   └── overlay_bubble.dart   Separate overlay-engine entry (bubble UI)
├── android/                  Kotlin native layer
│   ├── MainActivity.kt       Method channels (projection + device)
│   └── ScreenCaptureService.kt  Foreground service, notification quick
│                                 actions (Snap / MCP / Pause), Android 14
│                                 surface-promote fix, timeout retry
├── mcp-server/               Desktop hub + MCP server (TypeScript)
│   ├── hub.ts                Express: upload, SSE, pairing, catalog,
│   │                         inspections, patches, control API
│   ├── mcp.ts / catalog.ts   MCP protocol + single-source capability
│   │                         catalog (28 tools / 4 prompts / 3 resources)
│   ├── control.ts            ADB backend (input, UI tree, logcat, record)
│   ├── storage.ts / config.ts  Retention, env, auth
│   └── test/                 E2E suites (protocol + full aim-loop)
└── docs at root              CONNECT_KIT.md · DEEP_DIVE_ANALYSIS.md
                              FEATURE_UPGRADE_PLAN.md
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
flutter build apk --debug          # or --release
flutter install                    # or adb install -r
```

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

Single source of truth: [`mcp-server/catalog.ts`](mcp-server/catalog.ts)
(also served at `GET /api/mcp/catalog` and `screensync://skills`).

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

**Prompts** — `inspect_latest_mobile_screen`, `autonomous_ui_test`,
`reproduce_bug`, `accessibility_audit` · **Resources** —
`screensync://status`, `screensync://workflow`, `screensync://skills`

> Remote input injection on MIUI-class devices requires **USB debugging
> (Security settings)** to be enabled in Developer options; the app's
> Permission Doctor deep-links you there.

---

## HTTP API (hub)

| Route | Auth | Purpose |
| --- | --- | --- |
| `GET /health` | open | Liveness + latest frame timestamp |
| `GET /pair` · `GET /api/pair` | open | Pairing QR page / payload |
| `POST /api/screens/upload` | Bearer | Frame ingest (base64 data URL) |
| `GET /api/screens/latest` | Bearer | Latest frame + metadata |
| `GET /api/events` | Bearer | SSE stream (`frame` · `inspection` · `patch` · `tool`) |
| `GET /api/inspections/latest` · `/api/patches/latest` | Bearer | Agent findings for the phone |
| `GET /api/mcp/catalog` · `/api/device/status` | Bearer | Capability + connection state |
| `POST /api/control/:action` | Bearer | ADB control plane |

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
  strips shell metacharacters and allow-lists key codes.
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
- **Tests**: `flutter test` (bridge, metrics, overlay, pairing) and
  `npm test` (MCP protocol E2E + full upload→agent→readback aim-loop).
- **Design system**: violet tokens, serif display + micro-labels, glossy
  gradient tiles, reduce-motion aware entrances, responsive shell
  (bottom bar / rail / two-pane ≥900dp), text-scale clamping.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| "Hub offline" on a real phone | `127.0.0.1` only works on the emulator — scan the QR or enter `http://<PC-LAN-IP>:3000` in Settings → Hub. |
| Bubble tap does nothing | Check the notification shows "capture active"; tap the ⏸ Resume action if paused. |
| "Timed out waiting for a screen frame" | Retried automatically once; re-grant screen-capture consent if the OS revoked it. |
| Bubble won't show on MIUI | Permission Doctor → enable overlay + autostart + battery whitelist. |
| Control tools fail on MIUI | Enable **USB debugging (Security settings)** in Developer options. |

## Further reading

- [`CONNECT_KIT.md`](CONNECT_KIT.md) — paste-ready agent connection kit
- [`DEEP_DIVE_ANALYSIS.md`](DEEP_DIVE_ANALYSIS.md) — forensic walkthrough of the capture loop and non-obvious engineering
- [`FEATURE_UPGRADE_PLAN.md`](FEATURE_UPGRADE_PLAN.md) — the UX/feature roadmap and its status

---

*App 2.5.0 · MCP server 2.6.0 · Flutter 3.38 / Android API 36 · Node 24 + TypeScript ESM · MIT-style local use.*
