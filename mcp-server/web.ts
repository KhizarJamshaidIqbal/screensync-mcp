import { randomUUID } from "node:crypto";
import type { Express, Request, Response } from "express";
import { isAuthorized, log } from "./config.js";
import { emitHubEvent, lastEventSeq, recentHubEvents } from "./events.js";
import { createFrameStore } from "./web-frame.js";

// Web bridge: gives AI agents supervised access to the user's browser through
// the ScreenSync extension. The MCP tool handler (possibly a separate stdio
// process) POSTs /api/web/tool; the hub pushes a web_request over SSE to the
// extension, which executes it in the user's browser and POSTs the result to
// /api/web/result so the pending tool call resolves.

export type WebToolResult = { ok: boolean; data?: unknown; error?: string };

type Pending = {
  resolve: (r: WebToolResult) => void;
  timer: ReturnType<typeof setTimeout>;
};

export type WebBridge = {
  registerRoutes: (app: Express) => void;
  status: () => Record<string, unknown>;
};

const PRESENCE_TTL_MS = 600_000;
const EXTENSION_RE_REGISTER_MS = 30_000; // matches the SW health alarm

type BrowserEntry = {
  name: string;
  webAccessEnabled: boolean;
  lastSeenAt: string;
  tab: { url?: string; title?: string } | null;
  userAgent: string | null;
};

export function createWebBridge(broadcast: (payload: object, name?: string) => void): WebBridge {
  const pending = new Map<string, Pending>();
  const frameStore = createFrameStore(broadcast);

  // Multi-browser registry: every extension install (Chrome, Edge, Brave, ...)
  // heartbeats under its own browserId, so agents can list and target browsers
  // individually while the legacy single-browser status fields stay compatible.
  const browsers = new Map<string, BrowserEntry>();

  const isOnline = (b: BrowserEntry) => Date.now() - Date.parse(b.lastSeenAt) < PRESENCE_TTL_MS;

  const onlineEntries = () =>
    [...browsers.values()].filter(isOnline).sort((a, b) => Date.parse(b.lastSeenAt) - Date.parse(a.lastSeenAt));

  const online = () => onlineEntries().length > 0;

  const status = () => {
    const entries = onlineEntries();
    const latest =
      entries[0] ??
      [...browsers.values()].sort((a, b) => Date.parse(b.lastSeenAt) - Date.parse(a.lastSeenAt))[0] ??
      null;
    return {
      online: online(),
      webAccessEnabled: [...browsers.values()].some((b) => b.webAccessEnabled),
      lastSeenAt: latest ? latest.lastSeenAt : null,
      activeTab: latest ? latest.tab : null,
      heartbeatMs: EXTENSION_RE_REGISTER_MS,
      browserCount: browsers.size,
      browsers: [...browsers.entries()].map(([id, b]) => ({
        id,
        name: b.name,
        online: isOnline(b),
        webAccessEnabled: b.webAccessEnabled,
        lastSeenAt: b.lastSeenAt,
        activeTab: b.tab,
        userAgent: b.userAgent,
      })),
    };
  };

  const request = (tool: string, args: Record<string, unknown>, timeoutMs: number): Promise<WebToolResult> =>
    new Promise((resolve) => {
      const id = randomUUID();
      const timer = setTimeout(() => {
        pending.delete(id);
        resolve({ ok: false, error: `Timed out after ${timeoutMs}ms waiting for the browser extension.` });
      }, timeoutMs);
      pending.set(id, { resolve, timer });
      broadcast({ type: "web_request", id, tool, args });
    });

  const registerRoutes = (app: Express) => {
    // Heartbeat + capability registration from the extension SW.
    app.post("/api/web/register", (req: Request, res: Response) => {
      if (!isAuthorized(req.header("authorization"))) {
        res.status(401).json({ success: false, error: "Invalid ScreenSync pairing token." });
        return;
      }
      const b = (req.body ?? {}) as Record<string, unknown>;
      const id =
        typeof b.browserId === "string" && b.browserId.trim()
          ? b.browserId.trim()
          : typeof b.userAgent === "string" && b.userAgent
            ? b.userAgent
            : "default";
      const entry: BrowserEntry = {
        name: typeof b.browserName === "string" && b.browserName.trim() ? b.browserName.trim().toLowerCase() : "chrome",
        webAccessEnabled: b.webAccessEnabled === true,
        lastSeenAt: new Date().toISOString(),
        tab: b.tab && typeof b.tab === "object" ? (b.tab as { url?: string; title?: string }) : null,
        userAgent: typeof b.userAgent === "string" ? b.userAgent : null,
      };
      if (typeof b.webAccessEnabled !== "boolean" && browsers.has(id)) {
        entry.webAccessEnabled = browsers.get(id)!.webAccessEnabled;
      }
      browsers.set(id, entry);
      res.json({ success: true, status: status() });
    });

    // Ambient browser events from the extension (navigations, tab switches,
    // page loads) — recorded into the sequenced SSE ring and fanned out live.
    app.post("/api/web/event", (req: Request, res: Response) => {
      if (!isAuthorized(req.header("authorization"))) {
        res.status(401).json({ success: false, error: "Invalid ScreenSync pairing token." });
        return;
      }
      const b = (req.body ?? {}) as Record<string, unknown>;
      const type = typeof b.type === "string" && /^web_[a-z_]+$/.test(b.type) ? b.type : "web_event";
      broadcast({
        type,
        at: new Date().toISOString(),
        source: typeof b.source === "string" ? b.source : "browser",
        data: b.data && typeof b.data === "object" ? b.data : {},
      });
      res.json({ success: true });
    });

    app.get("/api/web/status", (req: Request, res: Response) => {
      if (!isAuthorized(req.header("authorization"))) {
        res.status(401).json({ success: false, error: "Invalid ScreenSync pairing token." });
        return;
      }
      res.json({ success: true, status: status() });
    });

    // Full agent-facing round trip: SSE out, HTTP result back.
    app.post("/api/web/tool", async (req: Request, res: Response) => {
      if (!isAuthorized(req.header("authorization"))) {
        res.status(401).json({ success: false, error: "Invalid ScreenSync pairing token." });
        return;
      }
      const b = (req.body ?? {}) as { tool?: string; args?: Record<string, unknown>; timeoutMs?: number };
      const tool = String(b.tool ?? "");
      const args = b.args && typeof b.args === "object" ? b.args : {};
      if (!/^web_[a-z_]+$/.test(tool)) {
        res.status(400).json({ success: false, error: `Invalid web tool name: ${tool}` });
        return;
      }
      if (tool === "web_status") {
        res.json({ success: true, ok: true, data: status() });
        return;
      }
      // web_events: hub-side real-time tail of the sequenced SSE ring — no
      // extension round trip, answered instantly from the buffered stream.
      if (tool === "web_events") {
        const since = Number(args.since) || 0;
        const limit = Math.min(Number(args.limit) || 100, 500);
        const types = Array.isArray(args.types)
          ? args.types.map(String)
          : typeof args.types === "string"
            ? String(args.types).split(",").map((s) => s.trim()).filter(Boolean)
            : undefined;
        const events = recentHubEvents(since, types, limit);
        res.json({
          success: true, ok: true,
          data: {
            lastSeq: lastEventSeq(),
            count: events.length,
            since,
            types: types ?? null,
            events: events.map((e) => ({ seq: e.seq, at: e.at, ...e.payload })),
          },
        });
        return;
      }
      if (browsers.size === 0) {
        res.status(503).json({
          success: false, ok: false,
          error: "Browser extension is not connected to this hub. Open the ScreenSync extension dashboard so it can pair.",
        });
        return;
      }
      if (!onlineEntries().some((b) => b.webAccessEnabled)) {
        res.status(403).json({
          success: false, ok: false,
          error: "Web access is disabled in the extension. Enable the 'Web access for AI agents' toggle in the extension dashboard.",
        });
        return;
      }
      // Multi-browser targeting: args.__browser routes the call to a specific
      // connected browser (name like 'edge'/'brave', or the install id from
      // web_status.browsers). 'any'/omitted lets the first responder answer.
      const hint = typeof args.__browser === "string" ? args.__browser.toLowerCase() : null;
      if (hint && hint !== "any" && hint !== "default") {
        const matched = onlineEntries().some(
          (b) => b.name === hint || [...browsers.entries()].some(([id, e]) => e === b && id.toLowerCase() === hint),
        );
        if (!matched) {
          res.status(400).json({
            success: false, ok: false,
            error: `No connected browser matches '${args.__browser}'. Connected: ${onlineEntries().map((b) => b.name).join(", ") || "none"}. Call web_status to list browsers.`,
          });
          return;
        }
      }
      const timeoutMs = Math.min(Math.max(Number(b.timeoutMs) || 45_000, 5_000), 60_000);
      const startedAt = Date.now();
      const result = await request(tool, args, timeoutMs);
      emitHubEvent("tool", tool, result.ok);
      log("INFO", "Web tool round trip", { tool, ok: result.ok, durationMs: Date.now() - startedAt });
      res.json({ success: result.ok, ok: result.ok, data: result.data, error: result.error });
    });

    app.post("/api/web/result", (req: Request, res: Response) => {
      if (!isAuthorized(req.header("authorization"))) {
        res.status(401).json({ success: false, error: "Invalid ScreenSync pairing token." });
        return;
      }
      const b = (req.body ?? {}) as { id?: string; ok?: boolean; data?: unknown; error?: string };
      const entry = b.id ? pending.get(b.id) : undefined;
      if (!entry) {
        res.status(404).json({ success: false, error: "Unknown or already-resolved request id." });
        return;
      }
      clearTimeout(entry.timer);
      pending.delete(b.id as string);
      entry.resolve({ ok: b.ok === true, data: b.data, error: b.error });
      res.json({ success: true });
    });

    frameStore.registerRoutes(app);
  };

  return { registerRoutes, status };
}
