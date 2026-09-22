import { randomUUID } from "node:crypto";
import { watch, existsSync, type FSWatcher } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { createServer, type Server as HttpServer } from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Bonjour, type Service } from "bonjour-service";
import express from "express";
import QRCode from "qrcode";
import { buildCatalog } from "./catalog.js";
import { osControlSource, setOsControlEnabled } from "./os-control.js";
import { appApkPath, appManifest, invalidateAppManifest } from "./app-update.js";
import { AUTH_TOKEN, FRAMES_DIR, HTTP_HOST, HTTP_PORT, MAX_BODY_BYTES, PAIR_WINDOW_MINUTES, PROJECT_DIR, agentName, isAuthorized, log } from "./config.js";
import { hubEvents, emitHubEvent, lastEventSeq, recentHubEvents, recordHubEvent, type HubEvent } from "./events.js";
import {
  ensureDataDirs,
  latestFrame,
  listFrames,
  loadInspection,
  loadPatch,
  parseImageDimensions,
  pruneArchive,
  retainRecentFrames,
  uploadSchema,
  type FrameMetadata,
} from "./storage.js";
import { createWebBridge } from "./web.js";
import { watchExtensionDir } from "./ext-watcher.js";
import { startCognitivePersistence, stopCognitivePersistence } from "./cognitive-engines.js";

export type HubHandle = {
  server: HttpServer;
  stop: () => Promise<void>;
};

/** First non-internal IPv4 of this machine (LAN address the phone can reach). */
function lanIPv4(): string {
  for (const iface of Object.values(os.networkInterfaces())) {
    for (const addr of iface ?? []) {
      if (addr.family === "IPv4" && !addr.internal) return addr.address;
    }
  }
  return "127.0.0.1";
}

function primaryBaseUrl(): string {
  const host = HTTP_HOST === "0.0.0.0" ? lanIPv4() : HTTP_HOST;
  return `http://${host}:${HTTP_PORT}`;
}

/** Deep-link the phone parses (PairingService.parse) — QR-encodable too. */
/** Absolute path of the stdio entry an MCP client must launch. */
function hubEntryPath(): string {
  // This package is ESM ("type": "module"), so __dirname does not exist and a
  // build-time-clean reference to it throws ReferenceError at runtime.
  const beside = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "index.js");
  return existsSync(beside) ? beside : path.resolve(PROJECT_DIR, "dist", "index.js");
}

function buildPairingLink(): string {
  return `screensync://pair?url=${encodeURIComponent(primaryBaseUrl())}&token=${encodeURIComponent(AUTH_TOKEN)}`;
}
/** Copy-paste bundle for the AI agent of a new user. Live values only. */
function connectKitText(): string {
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


/**
 * Advertises the hub as `_screensync-hub._tcp` so the Flutter app's
 * Bonsoir scanner (HubDiscoveryService) can find it with zero manual
 * IP entry. Pure mDNS — no traffic leaves the LAN.
 */
function advertiseHub(): () => void {
  try {
    const bonjour = new Bonjour();
    const service: Service = bonjour.publish({
      name: `ScreenSync Hub (${os.hostname()})`,
      type: "screensync-hub",
      port: HTTP_PORT,
      txt: { service: "screensync-hub", transport: "local-http" },
    });
    log("INFO", "mDNS advertisement published", { type: "_screensync-hub._tcp", port: HTTP_PORT });
    return () => {
      service.stop();
      bonjour.destroy();
    };
  } catch (error) {
    log("WARN", "mDNS advertisement unavailable; manual hub address still works", {
      error: String(error),
    });
    return () => undefined;
  }
}

export async function startHttpHub(): Promise<HubHandle> {
  await ensureDataDirs();
  // ── Pairing window: /pair + /api/pair hand out the token ONLY while no
  // device has paired yet or within the first PAIR_WINDOW_MINUTES minutes —
  // afterwards a LAN peer can no longer bootstrap full access in one request.
  const hubStartedAtMs = Date.now();
  let pairedOnce = false;
  const markPaired = () => { pairedOnce = true; };
  const pairingWindowOpen = () =>
    PAIR_WINDOW_MINUTES <= 0 || !pairedOnce || Date.now() - hubStartedAtMs < PAIR_WINDOW_MINUTES * 60_000;
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: MAX_BODY_BYTES }));
  app.use((req, res, next) => {
    const startedAt = Date.now();
    res.on("finish", () => {
      log("INFO", "HTTP request", {
        method: req.method,
        path: req.path,
        status: res.statusCode,
        durationMs: Date.now() - startedAt,
        // Client IP makes phone traffic distinguishable from extension
        // traffic. Without it every request looks identical in the log, so a
        // device that never reaches the hub is indistinguishable from a device
        // that reaches it and sends nothing.
        ip: (req.socket?.remoteAddress || req.ip || "").replace(/^::ffff:/, ""),
      });
    });
    next();
  });

  app.get("/health", async (_req, res) => {
    const latest = await latestFrame();
    res.json({
      ok: true,
      service: "screensync-hub",
      version: "1.12.0",
      port: HTTP_PORT,
      latestFrameAt: latest?.receivedAt ?? null,
    });
  });

  // ── Zero-friction pairing ──
  // GET /pair renders a human-friendly page with the pairing link the phone
  // can paste (or scan, when opened on another device) — kills manual IP+token
  const isLoopbackReq = (req: express.Request) => {
    const ip = req.socket?.remoteAddress || req.ip || "";
    return ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1";
  };
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

  // ---- In-app update channel ----
  app.get("/api/app/latest", async (req, res) => {
    if (!isAuthorized(req.header("authorization")) && !isLoopbackReq(req)) {
      res.status(401).json({ success: false, error: "Invalid ScreenSync pairing token." });
      return;
    }
    const manifest = await appManifest();
    if (!manifest) {
      res.status(404).json({ success: false, error: "No release APK built yet. Run: flutter build apk --release" });
      return;
    }
    const raw = Number(req.query.versionCode);
    const installed = Number.isFinite(raw) ? raw : null;
    res.json({
      success: true,
      ...manifest,
      installedVersionCode: installed,
      updateAvailable: installed === null ? null : manifest.versionCode > installed,
      url: `${primaryBaseUrl()}/apk?token=${encodeURIComponent(AUTH_TOKEN)}`,
    });
  });

  // Serves the APK itself so a phone can fetch the update over the LAN. The
  // token travels in the query string because a browser download carries no
  // headers; the path is fixed and no user input reaches it.
  app.get("/apk", async (req, res) => {
    const token = String(req.query.token ?? "");
    if (!isAuthorized(`Bearer ${token}`)) {
      res.status(403).type("text/plain").send("Invalid ScreenSync pairing token.");
      return;
    }
    if (!existsSync(appApkPath())) {
      res.status(404).type("text/plain").send("No APK built yet. Run: flutter build apk --release");
      return;
    }
    log("INFO", "APK download", { ip: req.socket?.remoteAddress || req.ip || "" });
    res.download(appApkPath(), "screensync.apk");
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

  // ── Live push (SSE) ──
  // The phone keeps one persistent connection; the hub pushes frame /
  // inspection / patch events so the app reacts instantly instead of polling.
  const sseClients = new Set<express.Response>();
  // Armed by POST /api/dev/reload — served to extensions on the HTTP heartbeat
  // so a dead-SSE extension can still be told to reload itself.
  let hubReloadRequestedAtMs = 0;
  const broadcast = (payload: object, name = "event") => {
    const seq = recordHubEvent(payload as Record<string, unknown>);
    log("INFO", "SSE broadcast", { name, seq, clientsCount: sseClients.size });
    const line = `id: ${seq}\ndata: ${JSON.stringify(payload)}\n\n`;
    for (const client of sseClients) {
      try {
        client.write(line);
        (client as any).flush?.();
      } catch (err) {
        log("WARN", "SSE write failed", { error: String(err) });
      }
    }
  };
  hubEvents.on("event", (event: HubEvent) => broadcast(event));
  const webBridge = createWebBridge(broadcast, () => sseClients.size);
  const keepalive = setInterval(() => {
    for (const client of sseClients) client.write(": keepalive\n\n");
  }, 30_000);

  // ── Zero-Click HMR: File watcher on extension/ directory ──
  let extWatcher: FSWatcher | null = null;
  let apkWatcher: FSWatcher | null = null;
  let apkBroadcastTimer: NodeJS.Timeout | null = null;
  let lastBroadcastSha = "";
  const extDir = path.resolve(PROJECT_DIR, "..", "extension");
  if (existsSync(extDir)) {
    try {
      // Only real edits reload: see ext-watcher.ts for why a raw fs.watch event is not enough on Windows.
      extWatcher = watchExtensionDir(extDir, (file) => {
        log("INFO", "Extension file changed, broadcasting dev_hot_reload", { file });
        broadcast({ type: "dev_hot_reload", file });
      });
      log("INFO", "Zero-Click HMR file watcher active", { dir: extDir });
    } catch (err) {
      log("WARN", "Zero-Click HMR file watcher failed to start", { error: String(err) });
    }
  }

  // ---- APK watch: a rebuilt app-release.apk IS the release event ----
  // The hook the whole update flow hangs off. Build (or CI) writes the APK, the
  // hub notices within a second, re-hashes it and pushes app_update to every
  // phone holding an SSE connection - the same trick the extension already used
  // for its zero-click reload.
  const apkDir = path.dirname(appApkPath());
  if (existsSync(apkDir)) {
    try {
      apkWatcher = watch(apkDir, (_event, filename) => {
        if (!filename || !String(filename).startsWith("app-release.apk")) return;
        // Gradle rewrites the APK several times per build, so debounce and then
        // compare the hash: one release must produce exactly one event.
        if (apkBroadcastTimer) clearTimeout(apkBroadcastTimer);
        apkBroadcastTimer = setTimeout(() => {
          invalidateAppManifest();
          void appManifest().then((manifest) => {
            if (!manifest || manifest.sha256 === lastBroadcastSha) return;
            lastBroadcastSha = manifest.sha256;
            log("INFO", "App release changed, broadcasting app_update", {
              versionName: manifest.versionName,
              versionCode: manifest.versionCode,
            });
            broadcast({ type: "app_update", ...manifest });
          });
        }, 1000);
      });
      log("INFO", "APK watcher active", { dir: apkDir });
    } catch (err) {
      log("WARN", "APK watcher failed to start", { error: String(err) });
    }
  }

  app.post("/api/dev/reload", (req, res) => {
    if (!isAuthorized(req.header("authorization"))) {
      res.status(401).json({ success: false, error: "Invalid ScreenSync pairing token." });
      return;
    }
    broadcast({ type: "dev_hot_reload", manual: true });
    // HTTP-channel reload for extensions whose SSE stream is dead (hub was
    // restarted while the SW was kept alive): the next /api/web/register
    // heartbeat carries reloadRequested and the extension reloads itself.
    webBridge.armReloadRequested();
    res.json({ success: true, message: "Dev hot reload broadcast sent + heartbeat reload armed." });
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

  // Host-level OS-plane switch. The gate itself lives in the MCP layer; this is how the
  // desktop app reads and changes it. Auth-gated like every other hub route.
  app.get("/api/os-control", (req, res) => {
    if (!isAuthorized(req.header("authorization"))) {
      res.status(401).json({ success: false, error: "Invalid ScreenSync pairing token." });
      return;
    }
    const source = osControlSource();
    res.json({ success: true, enabled: source !== "off", source });
  });

  app.post("/api/os-control", (req, res) => {
    if (!isAuthorized(req.header("authorization"))) {
      res.status(401).json({ success: false, error: "Invalid ScreenSync pairing token." });
      return;
    }
    const enabled = (req.body ?? {}).enabled === true;
    const state = setOsControlEnabled(enabled);
    log("INFO", "OS-level control setting changed", { enabled: state.enabled, source: state.source });
    res.json({ success: true, ...state });
  });

  app.get("/api/events", (req, res) => {
    if (!isAuthorized(req.header("authorization"))) {
      res.status(401).json({ success: false, error: "Invalid ScreenSync pairing token." });
      return;
    }
    markPaired();
    if (sseClients.size >= 50) {
      const oldest = sseClients.values().next().value;
      if (oldest) {
        try { oldest.end(); } catch {}
        sseClients.delete(oldest);
      }
    }
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    res.flushHeaders?.();
    res.socket?.setNoDelay(true);
    res.write(": connected\n\n");
    // Last-Event-ID replay: a reconnecting client tells us the last seq it saw
    // (SSE standard header or ?lastEventId=) and we replay everything after it.
    const lastId = Number(req.headers["last-event-id"] ?? (req.query.lastEventId as string | undefined) ?? 0) || 0;
    if (lastId > 0) {
      const replayed = recentHubEvents(lastId);
      for (const e of replayed) {
        res.write(`id: ${e.seq}\ndata: ${JSON.stringify(e.payload)}\n\n`);
      }
      log("INFO", "SSE replay", { fromSeq: lastId, events: replayed.length });
    }
    // Immediately replay agent identity so the phone always sees the name
    // even if it connects after the one-time startup event was emitted.
    const welcomeEvent = JSON.stringify({ type: "agent_connect", at: new Date().toISOString(), agentName });
    res.write(`data: ${welcomeEvent}\n\n`);
    sseClients.add(res);
    log("INFO", "SSE client connected", { totalClients: sseClients.size });
    req.on("close", () => {
      sseClients.delete(res);
      log("INFO", "SSE client disconnected", { totalClients: sseClients.size });
    });
  });

  // HTTP tail of the sequenced event ring — agents poll this via web_events.
  app.get("/api/events/recent", (req, res) => {
    if (!isAuthorized(req.header("authorization"))) {
      res.status(401).json({ success: false, error: "Invalid ScreenSync pairing token." });
      return;
    }
    const since = Number(req.query.since) || 0;
    const limit = Math.min(Number(req.query.limit) || 100, 500);
    const types = typeof req.query.types === "string"
      ? String(req.query.types).split(",").map((s) => s.trim()).filter(Boolean)
      : undefined;
    res.json({ success: true, lastSeq: lastEventSeq(), events: recentHubEvents(since, types, limit) });
  });

  app.post("/api/screens/upload", async (req, res) => {
    if (!isAuthorized(req.header("authorization"))) {
      res.status(401).json({ success: false, error: "Invalid ScreenSync pairing token." });
      return;
    }
    markPaired();
    const parsed = uploadSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: "Invalid frame payload.", issues: parsed.error.issues });
      return;
    }

    try {
      const base64 = parsed.data.imageDataUrl.includes(",")
        ? parsed.data.imageDataUrl.split(",", 2)[1]
        : parsed.data.imageDataUrl;
      const bytes = Buffer.from(base64, "base64");
      const { width, height, mimeType } = parseImageDimensions(bytes);
      const id = randomUUID();
      const ext = mimeType === "image/jpeg" ? "jpg" : "png";
      const framePath = path.join(FRAMES_DIR, `${id}.${ext}`);
      const metadata: FrameMetadata = {
        id,
        filename: parsed.data.filename,
        filePath: framePath,
        mimeType,
        timestamp: parsed.data.timestamp,
        receivedAt: new Date().toISOString(),
        deviceModel: parsed.data.deviceModel ?? "Android device",
        screenResolution: { width: width || 0, height: height || 0 },
        byteLength: bytes.length,
      };
      await writeFile(framePath, bytes);
      await writeFile(path.join(FRAMES_DIR, `${id}.json`), JSON.stringify(metadata, null, 2));
      await retainRecentFrames();
      // BUG FIX: prune the archive so sensitive screenshots don't accumulate indefinitely.
      pruneArchive().catch((err) => log("WARN", "Background archive prune failed", { error: String(err) }));
      log("INFO", "Frame received", { id, bytes: bytes.length, dimensions: { width, height } });
      emitHubEvent("frame");
      res.status(201).json({ success: true, frame: metadata });
    } catch (error) {
      res.status(400).json({ success: false, error: String(error) });
    }
  });

  app.get("/api/screens/latest", async (req, res) => {
    if (!isAuthorized(req.header("authorization"))) {
      res.status(401).json({ success: false, error: "Invalid ScreenSync pairing token." });
      return;
    }
    const frame = await latestFrame();
    if (!frame) {
      res.status(404).json({ success: false, error: "No screenshot has been received." });
      return;
    }
    const bytes = await readFile(frame.filePath);
    res.json({ ...frame, imageDataUrl: `data:${frame.mimeType};base64,${bytes.toString("base64")}` });
  });

  app.get("/api/device/status", async (req, res) => {
    if (!isAuthorized(req.header("authorization"))) {
      res.status(401).json({ success: false, error: "Invalid ScreenSync pairing token." });
      return;
    }
    const frame = await latestFrame();
    res.json({
      connected: Boolean(frame),
      transport: "local-http",
      lastFrameAt: frame?.receivedAt ?? null,
      deviceModel: frame?.deviceModel ?? null,
      retainedFrames: (await listFrames()).length,
    });
  });

  // Full MCP capability catalog for the Flutter "MCP" page and any HTTP-only
  // agent that wants to discover tools/skills without a stdio connection.
  app.get("/api/mcp/catalog", async (req, res) => {
    if (!isAuthorized(req.header("authorization"))) {
      res.status(401).json({ success: false, error: "Invalid ScreenSync pairing token." });
      return;
    }
    res.json(buildCatalog());
  });

  // ── Inspection endpoint (written by Claude via MCP tool, read by Flutter) ──
  app.get("/api/inspections/latest", async (req, res) => {
    if (!isAuthorized(req.header("authorization"))) {
      res.status(401).json({ success: false, error: "Invalid ScreenSync pairing token." });
      return;
    }
    const inspection = await loadInspection();
    if (!inspection) { res.status(404).json({ success: false, error: "No inspection yet." }); return; }
    res.json(inspection);
  });

  // ── Patch endpoint (written by Claude via MCP tool, read by Flutter) ──
  app.get("/api/patches/latest", async (req, res) => {
    if (!isAuthorized(req.header("authorization"))) {
      res.status(401).json({ success: false, error: "Invalid ScreenSync pairing token." });
      return;
    }
    const patch = await loadPatch();
    if (!patch) { res.status(404).json({ success: false, error: "No patch yet." }); return; }
    res.json(patch);
  });

  // ── Remote control (gesture / input) over HTTP ──
  // Same bearer auth as every other /api route. Lets HTTP-only agents (and
  // this project's own tests) drive the phone via ADB input injection.
  app.post("/api/control/:action", async (req, res) => {
    if (!isAuthorized(req.header("authorization"))) {
      res.status(401).json({ success: false, error: "Invalid ScreenSync pairing token." });
      return;
    }
    const { action } = req.params;
    const b = (req.body ?? {}) as Record<string, unknown>;
    // B3: control actions also show on the phone's AI activity timeline.
    emitHubEvent("tool", `control_${action}`, true);
    try {
      const control = await import("./control.js");
      switch (action) {
        case "status":
          res.json({ success: true, device: await control.controlDeviceInfo() });
          return;
        case "screenshot": {
          const shot = await control.screenshotNow();
          res.json({ success: true, imageDataUrl: `data:${shot.mimeType};base64,${shot.base64}` });
          return;
        }
        case "tap":
          res.json({ success: true, detail: await control.tap(Number(b.x), Number(b.y)) });
          return;
        case "long_press":
          res.json({ success: true, detail: await control.longPress(Number(b.x), Number(b.y), b.durationMs as number | undefined) });
          return;
        case "swipe":
          res.json({ success: true, detail: await control.swipe(Number(b.x1), Number(b.y1), Number(b.x2), Number(b.y2), b.durationMs as number | undefined) });
          return;
        case "scroll":
          res.json({ success: true, detail: await control.scroll(b.direction as "up" | "down" | "left" | "right", b.amount as number | undefined) });
          return;
        case "type":
          res.json({ success: true, detail: await control.typeText(String(b.text ?? "")) });
          return;
        case "key":
          res.json({ success: true, detail: await control.pressKey(String(b.key ?? "")) });
          return;
        case "launch":
          res.json({ success: true, detail: await control.launchApp(String(b.package ?? "")) });
          return;
        default:
          res.status(404).json({ success: false, error: `Unknown control action: ${action}` });
      }
    } catch (error) {
      res.status(400).json({ success: false, error: String(error) });
    }
  });

  // ── Web bridge (browser access for AI agents) ──
  // The ScreenSync extension connects over SSE; these routes let agents see
  // and drive the user's browser tabs through it (web_* MCP tools).
  webBridge.registerRoutes(app);

  const server = createServer(app);
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(HTTP_PORT, HTTP_HOST, () => resolve());
    });
    // Cognitive state is restored and persisted only by the process that owns the port, and only
    // now that it does: a hub that lost the port race must not read or quarantine the owner's files.
    startCognitivePersistence();
    // H6 fix: Start schedule timers only after successful server.listen().
    webBridge.startSchedules();
  } catch (listenErr) {
    clearInterval(keepalive);
    webBridge.stopSchedules();
    stopCognitivePersistence(); // no-op unless persistence had already started
    if (extWatcher) extWatcher.close();
    hubEvents.off("event", broadcast);
    for (const client of sseClients) client.end();
    sseClients.clear();
    throw listenErr;
  }
  log("INFO", "ScreenSync HTTP hub started", { host: HTTP_HOST, port: HTTP_PORT });
  log("INFO", "Phone pairing", {
    pairingLink: buildPairingLink(),
    pairPage: `${primaryBaseUrl()}/pair`,
    hint: "Scan the QR below (or paste the link in Onboarding → Connect / Settings → Hub).",
  });
  try {
    const terminalQr = await QRCode.toString(buildPairingLink(), {
      type: "terminal",
      small: true,
    });
    process.stderr.write(`\n  Scan to pair your phone:\n${terminalQr}\n`);
  } catch {
    // Terminal QR is a convenience; pairing link + /pair page remain.
  }

  const stopAdvertising = advertiseHub();
  return {
    server,
    stop: async () => {
      clearInterval(keepalive);
      webBridge.stopSchedules();
      if (extWatcher) extWatcher.close();
      hubEvents.off("event", broadcast);
      for (const client of sseClients) client.end();
      sseClients.clear();
      stopAdvertising();
      stopCognitivePersistence();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
