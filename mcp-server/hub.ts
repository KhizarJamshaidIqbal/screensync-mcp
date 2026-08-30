import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { createServer, type Server as HttpServer } from "node:http";
import os from "node:os";
import path from "node:path";
import { Bonjour, type Service } from "bonjour-service";
import express from "express";
import QRCode from "qrcode";
import { buildCatalog } from "./catalog.js";
import { AUTH_TOKEN, FRAMES_DIR, HTTP_HOST, HTTP_PORT, MAX_BODY_BYTES, agentName, isAuthorized, log } from "./config.js";
import { hubEvents, emitHubEvent, type HubEvent } from "./events.js";
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
function buildPairingLink(): string {
  return `screensync://pair?url=${encodeURIComponent(primaryBaseUrl())}&token=${encodeURIComponent(AUTH_TOKEN)}`;
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
      });
    });
    next();
  });

  app.get("/health", async (_req, res) => {
    const latest = await latestFrame();
    res.json({ ok: true, service: "screensync-hub", latestFrameAt: latest?.receivedAt ?? null });
  });

  // ── Zero-friction pairing ──
  // GET /pair renders a human-friendly page with the pairing link the phone
  // can paste (or scan, when opened on another device) — kills manual IP+token
  // entry. The link itself is also printed to the terminal at startup.
  app.get("/pair", async (_req, res) => {
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
<button onclick="navigator.clipboard.writeText(document.getElementById('link').textContent)">Copy link</button>
</div></body></html>`);
  });

  // Machine-readable pairing payload (same info; used by tests/tools).
  app.get("/api/pair", (_req, res) => {
    res.json({ url: primaryBaseUrl(), token: AUTH_TOKEN, link: buildPairingLink() });
  });

  // ── Live push (SSE) ──
  // The phone keeps one persistent connection; the hub pushes frame /
  // inspection / patch events so the app reacts instantly instead of polling.
  const sseClients = new Set<express.Response>();
  const broadcast = (event: HubEvent) => {
    const line = `data: ${JSON.stringify(event)}\n\n`;
    for (const client of sseClients) client.write(line);
  };
  hubEvents.on("event", broadcast);
  const keepalive = setInterval(() => {
    for (const client of sseClients) client.write(": keepalive\n\n");
  }, 30_000);

  app.get("/api/events", (req, res) => {
    if (!isAuthorized(req.header("authorization"))) {
      res.status(401).json({ success: false, error: "Invalid ScreenSync pairing token." });
      return;
    }
    if (sseClients.size >= 10) {
      res.status(429).json({ success: false, error: "Too many live connections." });
      return;
    }
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    res.write(": connected\n\n");
    // Immediately replay agent identity so the phone always sees the name
    // even if it connects after the one-time startup event was emitted.
    const welcomeEvent = JSON.stringify({ type: "agent_connect", at: new Date().toISOString(), agentName });
    res.write(`data: ${welcomeEvent}\n\n`);
    sseClients.add(res);
    req.on("close", () => sseClients.delete(res));
  });

  app.post("/api/screens/upload", async (req, res) => {
    if (!isAuthorized(req.header("authorization"))) {
      res.status(401).json({ success: false, error: "Invalid ScreenSync pairing token." });
      return;
    }
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

  const server = createServer(app);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(HTTP_PORT, HTTP_HOST, () => resolve());
  });
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
      hubEvents.off("event", broadcast);
      for (const client of sseClients) client.end();
      sseClients.clear();
      stopAdvertising();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
