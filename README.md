# ScreenSync MCP

Capture your Android screen with one tap on a floating bubble and hand the
screenshot straight to Claude on your desktop — no WhatsApp roundtrip, no
manual file transfer.

```
┌ Android ─────────────┐        LAN (mDNS + HTTP)        ┌ Desktop ─────────────┐
│ Floating bubble tap  │ ──  /api/screens/upload  ─────▶ │ ScreenSync hub       │
│ MediaProjection grab │ ◀──  /api/inspections/latest ── │ + MCP stdio server   │
│ Google Drive (BYOS)  │        (fallback sync)          │ Claude Code/Desktop  │
└──────────────────────┘                                  └──────────────────────┘
```

## How it works

1. **Floating bubble** — after install, start the service from the Dashboard.
   A draggable bubble floats over every app (`flutter_overlay_window`).
   Drag it anywhere; it remembers its position across restarts.
2. **Tap = capture** — a background `MediaProjection` foreground service grabs
   the current screen silently. Long-press the bubble to crop-select a single
   widget region instead.
3. **Sync** — the frame is pushed over LAN to the desktop hub. If the hub is
   unreachable, the app falls back to your own Google Drive (BYOS — your data
   never touches a third-party server). Sync modes: LAN / Drive / Hybrid.
4. **Zero-config discovery** — the desktop hub advertises itself as
   `_screensync-hub._tcp` via mDNS; the app's Settings → Hub scanner finds it
   automatically on the same network.
5. **Claude sees pixels, not OCR** — the MCP tool `get_latest_screenshot`
   returns the raw image so Claude Vision can inspect layout, overflow,
   padding and color bugs directly.

## Build & run the Android app

```bash
flutter pub get
flutter run                      # on a connected phone (USB debugging on)
flutter build apk --release      # installable APK → build/app/outputs/flutter-apk/
```

Required permissions (requested in-app): display over other apps, screen
capture consent, notifications.

## Desktop hub + MCP server

```bash
cd mcp-server
npm install
npm run build
npm start                        # HTTP hub :3000 + MCP stdio server
```

Environment variables:

| Variable | Default | Purpose |
| --- | --- | --- |
| `SCREEN_SYNC_PORT` | `3000` | HTTP hub port (also advertised via mDNS) |
| `SCREEN_SYNC_HOST` | `0.0.0.0` | Bind address |
| `SCREEN_SYNC_TOKEN` | `screensync-local-dev` | Bearer token; must match the app's pairing token |
| `SCREEN_SYNC_DATA_DIR` | `./data` | Frame/inspection/patch storage |

Tests: `npm test` (MCP protocol E2E + full upload→MCP→readback aim-loop E2E).

## Connect Claude Desktop

`claude_desktop_config.json` (Claude Desktop → Settings → Developer):

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

## Connect Claude Code

In the project root, create `.mcp.json`:

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

Or once, via CLI:

```bash
claude mcp add screensync node "<ABSOLUTE-PATH-TO>/mcp-server/dist/index.js"
```

Then just ask:

> Look at my latest mobile screenshot and tell me why the submit button is
> clipped at the bottom.

Claude calls `get_device_status` → `get_latest_screenshot`, inspects the raw
image, and can publish findings back to the phone with `publish_inspection`
(heatmap overlay in the Diagnose tab) and `publish_patch` (one-click patch).

### Available MCP surface

- **Tools**: `get_latest_screenshot`, `list_recent_screens`,
  `get_device_status`, `publish_inspection`, `publish_patch`,
  `get_mcp_catalog` (full capability discovery for auto-connecting agents)
- **Resources**: `screensync://status`, `screensync://workflow`
- **Prompts**: `inspect_latest_mobile_screen`

## In-app MCP page

The app's **MCP tab** lists the live tool/skill/resource catalog fetched from
`GET /api/mcp/catalog` and has a **Copy Connect Kit** button — paste that kit
into Claude Code / Claude Desktop / any MCP client and the agent configures
and connects itself automatically.

## Storage & privacy

- Hub keeps the latest 20 frames; older ones are archived, and the archive is
  pruned at 100 entries. Everything stays in `SCREEN_SYNC_DATA_DIR`.
- Google Drive mode keeps only the latest 20 uploads in
  `ScreenSyncCaptures/` and uses the restricted `drive.file` scope.
- LAN transport is bearer-token protected; use a non-default token on shared
  networks (`SCREEN_SYNC_TOKEN` + Settings → Hub token in the app).
