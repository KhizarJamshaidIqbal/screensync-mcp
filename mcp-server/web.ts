import { randomUUID } from "node:crypto";
import type { Express, Request, Response } from "express";
import { isAuthorized, log } from "./config.js";
import { emitHubEvent } from "./events.js";
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

const PRESENCE_TTL_MS = 90_000;
const EXTENSION_RE_REGISTER_MS = 30_000; // matches the SW health alarm

export function createWebBridge(broadcast: (payload: object, name?: string) => void): WebBridge {
  const pending = new Map<string, Pending>();
  const frameStore = createFrameStore(broadcast);

  const presence = {
    webAccessEnabled: false,
    lastSeenAt: null as string | null,
    tab: null as { url?: string; title?: string } | null,
    userAgent: null as string | null,
  };

  const online = () =>
    presence.lastSeenAt !== null && Date.now() - Date.parse(presence.lastSeenAt) < PRESENCE_TTL_MS;

  const status = () => ({
    online: online(),
    webAccessEnabled: presence.webAccessEnabled,
    lastSeenAt: presence.lastSeenAt,
    activeTab: presence.tab,
    heartbeatMs: EXTENSION_RE_REGISTER_MS,
  });

  const request = (tool: string, args: Record<string, unknown>, timeoutMs: number): Promise<WebToolResult> =>
    new Promise((resolve) => {
      const id = randomUUID();
      const timer = setTimeout(() => {
        pending.delete(id);
        resolve({ ok: false, error: `Timed out after ${timeoutMs}ms waiting for the browser extension.` });
      }, timeoutMs);
      pending.set(id, { resolve, timer });
      broadcast({ type: "web_request", id, tool, args }, "web_request");
    });

  const registerRoutes = (app: Express) => {
    // Heartbeat + capability registration from the extension SW.
    app.post("/api/web/register", (req: Request, res: Response) => {
      if (!isAuthorized(req.header("authorization"))) {
        res.status(401).json({ success: false, error: "Invalid ScreenSync pairing token." });
        return;
      }
      const b = (req.body ?? {}) as Record<string, unknown>;
      presence.lastSeenAt = new Date().toISOString();
      if (typeof b.webAccessEnabled === "boolean") presence.webAccessEnabled = b.webAccessEnabled;
      if (b.tab && typeof b.tab === "object") presence.tab = b.tab as { url?: string; title?: string };
      if (typeof b.userAgent === "string") presence.userAgent = b.userAgent;
      res.json({ success: true, status: status() });
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
      if (!online()) {
        res.status(503).json({
          success: false, ok: false,
          error: "Browser extension is not connected to this hub. Open the ScreenSync extension dashboard so it can pair.",
        });
        return;
      }
      if (!presence.webAccessEnabled) {
        res.status(403).json({
          success: false, ok: false,
          error: "Web access is disabled in the extension. Enable the 'Web access for AI agents' toggle in the extension dashboard.",
        });
        return;
      }
      const timeoutMs = Math.min(Math.max(Number(b.timeoutMs) || 25_000, 5_000), 60_000);
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
      presence.lastSeenAt = new Date().toISOString();
      entry.resolve({ ok: b.ok === true, data: b.data, error: b.error });
      res.json({ success: true });
    });

    frameStore.registerRoutes(app);
  };

  return { registerRoutes, status };
}
