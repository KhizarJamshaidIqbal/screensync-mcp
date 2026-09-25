import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { createServer, type Server as HttpServer } from "node:http";
import path from "node:path";
import express from "express";
import QRCode from "qrcode";
import { buildCatalog } from "./catalog.js";
import { osControlSource, setOsControlEnabled } from "./os-control.js";
import { appApkPath, appManifest } from "./app-update.js";
import { AUTH_TOKEN, FRAMES_DIR, HTTP_HOST, HTTP_PORT, MAX_BODY_BYTES, PAIR_WINDOW_MINUTES, SSE_KEEPALIVE_MS, agentName, isAuthorized, log } from "./config.js";
import { advertiseHub, buildPairingLink, isLoopbackReq, mountPairingRoutes, primaryBaseUrl } from "./hub-pairing.js";
import { hubEvents, emitHubEvent, lastEventSeq, recentHubEvents, type HubEvent } from "./events.js";
import { createSseHub } from "./hub-sse.js";
import { startHubWatchers } from "./hub-watchers.js";
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
import { startCognitivePersistence, stopCognitivePersistence } from "./cognitive-engines.js";

export type HubHandle = {
  server: HttpServer;
  stop: () => Promise<void>;
};

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

  // ── Zero-friction pairing: /pair, /api/pair, /api/connect-kit, /wake (hub-pairing.ts) ──
  mountPairingRoutes(app, { pairingWindowOpen });

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

  // ── Live push (SSE, hub-sse.ts) ──
  // The phone and every extension keep one persistent stream; the hub pushes frame / inspection / patch /
  // web_* events so each client reacts instantly instead of polling.
  const sse = createSseHub({
    keepaliveMs: SSE_KEEPALIVE_MS,
    isAuthorized,
    onConnect: markPaired,
    welcome: () => ({ type: "agent_connect", at: new Date().toISOString(), agentName }),
  });
  const broadcast = sse.broadcast;
  // One named listener, so teardown removes exactly what start added (an inline arrow could never be removed).
  const onHubEvent = (event: HubEvent) => { sse.broadcast(event); };
  hubEvents.on("event", onHubEvent);
  const webBridge = createWebBridge(broadcast, () => sse.count());
  // Zero-Click HMR on extension/ and the release-APK watcher (hub-watchers.ts); closed on stop.
  const watchers = startHubWatchers(broadcast);

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

  sse.mount(app);

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
  /** Everything start set up besides the server and mDNS; shared by a failed listen and stop(). */
  const teardown = () => {
    webBridge.stopSchedules();
    stopCognitivePersistence(); // no-op unless persistence had already started
    watchers.close();
    hubEvents.off("event", onHubEvent);
    sse.close();
  };
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
    teardown();
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
      teardown();
      stopAdvertising();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
