import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Bonjour, type Service } from "bonjour-service";
import type { Express, Request } from "express";
import QRCode from "qrcode";
import { AUTH_TOKEN, HTTP_HOST, HTTP_PORT, PROJECT_DIR, isAuthorized, log } from "./config.js";

// Phone pairing, the agent connect kit, mDNS advertisement and the /wake page: everything that hands a new
// device or agent the hub's address and token. Mounted by hub.ts via mountPairingRoutes().

/** First non-internal IPv4 of this machine (LAN address the phone can reach). */
export function lanIPv4(): string {
  for (const iface of Object.values(os.networkInterfaces())) {
    for (const addr of iface ?? []) {
      if (addr.family === "IPv4" && !addr.internal) return addr.address;
    }
  }
  return "127.0.0.1";
}

export function primaryBaseUrl(): string {
  const host = HTTP_HOST === "0.0.0.0" ? lanIPv4() : HTTP_HOST;
  return `http://${host}:${HTTP_PORT}`;
}

/** Deep-link the phone parses (PairingService.parse) — QR-encodable too. */
/** Absolute path of the stdio entry an MCP client must launch. */
export function hubEntryPath(): string {
  // This package is ESM ("type": "module"), so __dirname does not exist and a
  // build-time-clean reference to it throws ReferenceError at runtime.
  const beside = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "index.js");
  return existsSync(beside) ? beside : path.resolve(PROJECT_DIR, "dist", "index.js");
}

export function buildPairingLink(): string {
  return `screensync://pair?url=${encodeURIComponent(primaryBaseUrl())}&token=${encodeURIComponent(AUTH_TOKEN)}`;
}
/** Copy-paste bundle for the AI agent of a new user. Live values only. */
export function connectKitText(): string {
  const base = primaryBaseUrl();
  const entry = hubEntryPath();
  return [
    "ScreenSync - Agent Connect Kit (generated live by the hub)",
    "=========================================================",
    `Hub:   ${base}`,
    `Token: ${AUTH_TOKEN}`,
    "",
    "Hand this whole block to your AI agent. Ask it to install the ScreenSync",
    "MCP server GLOBALLY, then pair the phone.",
    "",
    "1. INSTALL GLOBALLY (available in every project, not just one folder)",
    `   Claude Code (user scope):  claude mcp add --scope user screensync -- node "${entry}"`,
    "   Claude Desktop:  merge the JSON below into the global config, then restart it",
    '       Windows: %APPDATA%\\Claude\\claude_desktop_config.json',
    "       macOS:   ~/Library/Application Support/Claude/claude_desktop_config.json",
    '   Cursor:   ~/.cursor/mcp.json   (Windows: %USERPROFILE%\\.cursor\\mcp.json)',
    '   VS Code:  %APPDATA%\\Code\\User\\mcp.json',
    "   Cline / Roo Code / Windsurf / Antigravity: same block in the client settings",
    "",
    "   JSON to merge:",
    "   {",
    '     "mcpServers": {',
    '       "screensync": {',
    '         "command": "node",',
    `         "args": ["${entry}"],`,
    `         "env": { "SCREEN_SYNC_TOKEN": "${AUTH_TOKEN}" }`,
    "       }",
    "     }",
    "   }",
    "",
    "2. PAIR THE PHONE (after step 1)",
    `   Address to type in Settings > Hub: ${base}`,
    `   Pairing link to paste:            ${buildPairingLink()}`,
    `   Show the QR on this PC:           open ${base}/pair in a browser`,
    "",
    "3. FIRST CALLS",
    "   get_mcp_catalog -> get_device_status -> get_latest_screenshot",
    "",
  ].join("\n");
}


/** Builds the Bonjour instance; its error callback receives every asynchronous mDNS send/bind error. */
export type BonjourFactory = (onError: (err: unknown) => void) => Bonjour;

/**
 * Advertises the hub as `_screensync-hub._tcp` so the Flutter app's
 * Bonsoir scanner (HubDiscoveryService) can find it with zero manual
 * IP entry. Pure mDNS — no traffic leaves the LAN.
 *
 * mDNS is a convenience, so none of its errors may reach the process: without an error callback bonjour-service
 * rethrows a failed answer send (ENETUNREACH after a Wi-Fi drop or sleep/resume) inside a dgram callback, and
 * multicast-dns emits bind errors on an emitter nobody listened to. Either was an uncaught exception, on which
 * index.ts exits the hub.
 */
export function advertiseHub(make: BonjourFactory = (onError) => new Bonjour({}, onError)): () => void {
  let bonjour: Bonjour | null = null;
  const onError = (err: unknown) => {
    log("WARN", "mDNS error; the advertisement may be unavailable, the manual hub address still works", { error: String(err) });
  };
  try {
    bonjour = make(onError);
    (bonjour as unknown as { server?: { mdns?: { on?: (ev: string, fn: (err: unknown) => void) => void } } })
      .server?.mdns?.on?.("error", onError);
    const service: Service = bonjour.publish({
      name: `ScreenSync Hub (${os.hostname()})`,
      type: "screensync-hub",
      port: HTTP_PORT,
      txt: { service: "screensync-hub", transport: "local-http" },
    });
    log("INFO", "mDNS advertisement published", { type: "_screensync-hub._tcp", port: HTTP_PORT });
    const owned = bonjour;
    return () => {
      service.stop();
      owned.destroy();
    };
  } catch (error) {
    // new Bonjour() already opened its multicast sockets; a failed publish must not leave them open.
    try { bonjour?.destroy(); } catch { /* best effort */ }
    log("WARN", "mDNS advertisement unavailable; manual hub address still works", {
      error: String(error),
    });
    return () => undefined;
  }
}

export const isLoopbackReq = (req: Request) => {
  const ip = req.socket?.remoteAddress || req.ip || "";
  return ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1";
};

export type PairingDeps = {
  /** True while the unauthenticated pairing endpoints may still hand out the token. */
  pairingWindowOpen: () => boolean;
};

/** /pair, /api/pair, /api/connect-kit and /wake. */
export function mountPairingRoutes(app: Express, deps: PairingDeps): void {
  const { pairingWindowOpen } = deps;
  // ── Zero-friction pairing ──
  // GET /pair renders a human-friendly page with the pairing link the phone
  // can paste (or scan, when opened on another device) — kills manual IP+token
  const allowLanPair = process.env.SCREEN_SYNC_ALLOW_LAN_PAIR === "true";

  app.get("/pair", async (req, res) => {
    if (!allowLanPair && !isLoopbackReq(req)) {
      res.status(403).type("text/plain").send("Pairing is restricted to loopback (127.0.0.1). Set SCREEN_SYNC_ALLOW_LAN_PAIR=true to allow pairing over LAN.");
      return;
    }
    if (!pairingWindowOpen()) {
      res.type("html").send(`<!doctype html>
<html><head><meta name="viewport" content="width=device-width,initial-scale=1">
<title>ScreenSync — Pairing closed</title>
<style>
 body{font-family:system-ui,sans-serif;background:#090D16;color:#E2E8F0;display:flex;
      min-height:100vh;align-items:center;justify-content:center;margin:0}
 .card{max-width:520px;padding:36px;background:#111827;border:1px solid #1E293B;
       border-radius:18px;text-align:center}
 h1{font-size:22px;margin:0 0 6px}
 p{color:#94A3B8;font-size:14px;line-height:1.6}
 code{background:#030712;border:1px solid #1E293B;border-radius:8px;padding:2px 8px;color:#67E8F9}
</style></head><body><div class="card">
<h1>🔒 Pairing window closed</h1>
<p>A device already paired and the startup pairing window has passed, so the
pairing token is no longer served.</p>
<p>To pair a new device: <b>restart the hub</b>, or set<br>
<code>SCREEN_SYNC_PAIR_WINDOW_MINUTES=0</code> to keep pairing always open.</p>
<p>Your hub address (not a secret - safe for your own devices):</p>
<code id="addr">${primaryBaseUrl()}</code>
<p>An already-paired phone does not need a QR at all: type the address above
in Settings &gt; Hub and it will reconnect.</p>
</div></body></html>`);
      return;
    }
    const link = buildPairingLink();
    const qrDataUrl = await QRCode.toDataURL(link, { margin: 1, width: 260 });
    res.type("html").send(`<!doctype html>
<html><head><meta name="viewport" content="width=device-width,initial-scale=1">
<title>ScreenSync — Pair your phone</title>
<style>
 body{font-family:system-ui,sans-serif;background:#090D16;color:#E2E8F0;display:flex;
      min-height:100vh;align-items:center;justify-content:center;margin:0}
 .card{max-width:520px;padding:36px;background:#111827;border:1px solid #1E293B;
       border-radius:18px;text-align:center}
 h1{font-size:22px;margin:0 0 6px}
 p{color:#94A3B8;font-size:14px;line-height:1.5}
 img.qr{background:#fff;border-radius:14px;padding:10px;margin:18px auto 4px;display:block}
 code{display:block;background:#030712;border:1px solid #1E293B;border-radius:10px;
      padding:14px;margin:18px 0;font-size:13px;word-break:break-all;color:#67E8F9}
 button{background:#2563EB;color:#fff;border:0;border-radius:10px;padding:12px 22px;
        font-size:14px;font-weight:600;cursor:pointer}
</style></head><body><div class="card">
<h1>Pair your phone</h1>
<p>Scan with the ScreenSync app<br>(Onboarding → Connect → <b>Scan QR code</b>):</p>
<img class="qr" src="${qrDataUrl}" alt="Pairing QR code">
<p>Or paste this pairing link in Settings → Hub:</p>
<code id="link">${link}</code>
<p>Or type this hub address (Settings &gt; Hub):</p>
<code id="addr">${primaryBaseUrl()}</code>
<button onclick="navigator.clipboard.writeText(document.getElementById('link').textContent)">Copy link</button>
<script>
const EXT_IDS = ["nfdhhnbmboahhimbofhihckobhenkoij", "jemgpkfioegjjnidjbhmmpnnjdadapko"];
if (window.chrome && chrome.runtime && chrome.runtime.sendMessage) {
  for (const id of EXT_IDS) {
    try {
      chrome.runtime.sendMessage(id, { type: "wake" }, (res) => {
        if (!chrome.runtime.lastError && res && res.ok) {
          console.log("[ScreenSync] Extension awakened:", id);
        }
      });
    } catch {}
  }
}
</script>
</div></body></html>`);
  });

  // Machine-readable pairing payload (same info; used by tests/tools).
  app.get("/api/pair", (req, res) => {
    if (!allowLanPair && !isLoopbackReq(req)) {
      res.status(403).json({
        success: false,
        error: "Pairing endpoint is restricted to loopback (127.0.0.1). Set SCREEN_SYNC_ALLOW_LAN_PAIR=true to allow pairing over LAN.",
      });
      return;
    }
    if (!pairingWindowOpen()) {
      res.status(403).json({
        success: false,
        error: "Pairing window is closed (a device already paired and the startup window has passed). Restart the hub to pair a new device, or set SCREEN_SYNC_PAIR_WINDOW_MINUTES=0 to keep pairing always open.",
      });
      return;
    }
    res.json({
      url: primaryBaseUrl(),
      address: primaryBaseUrl(),
      token: AUTH_TOKEN,
      link: buildPairingLink(),
    });
  });

  // ---- Agent Connect Kit (live) ----
  // Values that cannot go stale: this hub's own LAN address, the absolute path
  // of its own stdio entry, and the current pairing token. The checked-in
  // CONNECT_KIT.md shipped someone else's IP and a Downloads path more than
  // once, so the hub is the single source of truth and that file is a pointer.
  app.get("/api/connect-kit", (req, res) => {
    if (!allowLanPair && !isLoopbackReq(req) && !isAuthorized(req.header("authorization"))) {
      res.status(403).json({
        success: false,
        error: "Connect kit is available to this machine (loopback) or with a valid pairing token.",
      });
      return;
    }
    res.json({
      hubUrl: primaryBaseUrl(),
      address: primaryBaseUrl(),
      token: AUTH_TOKEN,
      hubEntry: hubEntryPath(),
      pairingLink: buildPairingLink(),
      kit: connectKitText(),
    });
  });

  app.get("/wake", (_req, res) => {
    res.type("html").send(`<!doctype html>
<html><head><meta charset="utf-8"><title>ScreenSync Wake</title></head>
<body style="font-family:sans-serif;background:#111;color:#eee;display:flex;align-items:center;justify-content:center;height:100vh;margin:0">
<div style="text-align:center"><p>Waking ScreenSync extension...</p><p id="s"></p></div>
<script>
const extId = "nfdhhnbmboahhimbofhihckobhenkoij";
if (window.chrome && chrome.runtime && chrome.runtime.sendMessage) {
  chrome.runtime.sendMessage(extId, { type: "ping" }, (r) => {
    const s = document.getElementById("s");
    if (s) s.textContent = r ? "Connected: " + JSON.stringify(r) : "Pinged";
    setTimeout(() => window.close(), 1200);
  });
} else {
  const s = document.getElementById("s");
  if (s) s.textContent = "chrome.runtime unavailable";
}
</script></body></html>`);
  });
}
