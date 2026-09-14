# ScreenSync - Agent Connect Kit

> **Do not hand-edit this file with a machine-specific IP or path.** Earlier
> revisions shipped a stale LAN address (`192.168.1.2`) and a `Downloads\...`
> path, and every new user who copied them hit exactly the same failure. The
> hub is now the single source of truth.

## Get the live kit

The running hub generates the kit from values that cannot go stale - its own LAN
address, the absolute path of its stdio entry, and the current pairing token:

```
GET http://<hub-ip>:3000/api/connect-kit
```

Returns JSON: `hubUrl`, `address`, `token`, `hubEntry`, `pairingLink`, `kit`.

In the app: **MCP tab -> Copy Connect Kit**. The same text, with the address
shown next to the QR so the user can scan *or* type.

## What the kit tells the agent to do

1. **Install globally**, not into one project folder:
   - Claude Code: `claude mcp add --scope user screensync -- node "<hub>/dist/index.js"`
   - Claude Desktop: merge into `%APPDATA%\Claude\claude_desktop_config.json`
   - Cursor: `~/.cursor/mcp.json` - VS Code: `%APPDATA%\Code\User\mcp.json`
   - Cline / Roo Code / Windsurf / Antigravity: the same `mcpServers` block
2. **Pair the phone** afterwards - scan the QR from `<hub>/pair`, or type the
   hub address in Settings -> Hub.
3. First calls: `get_mcp_catalog`, `get_device_status`, `get_latest_screenshot`.

## Manual configuration template

Replace `<HUB_DIR>` and `<TOKEN>`. Every client wants the same block:

```json
{
  "mcpServers": {
    "screensync": {
      "command": "node",
      "args": ["<HUB_DIR>/dist/index.js"],
      "env": { "SCREEN_SYNC_TOKEN": "<TOKEN>" }
    }
  }
}
```

## Notes

- Keep the desktop hub running: `cd mcp-server && node dist/index.js`.
- The agent's stdio instance shares `mcp-server/data`, so it sees what the phone
  uploads in real time.
- The pairing token must match the phone (Settings -> Hub -> token).
- The hub logs the client IP of every request, so phone traffic is always
  distinguishable from extension traffic.
