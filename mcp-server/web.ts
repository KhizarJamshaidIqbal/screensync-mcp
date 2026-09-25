import { randomUUID } from "node:crypto";
import type { Express, Request, Response } from "express";
import { isAuthorized, log } from "./config.js";
import { emitHubEvent, webEventsReply } from "./events.js";
import { createFrameStore } from "./web-frame.js";
import { createProfileRegistry, type BrowserInstance, type DispatchDecision, type SseView } from "./profile-registry.js";
import { trackToolExecution } from "./cognitive-auto-tracker.js";
import { sessionOf } from "./cognitive-spine-observer.js";
import { forRelay, gateBeforeRelay, refusedByGate, type GateDecision } from "./cognitive-policy.js";
import { mountExtensionRoutes } from "./web-ext-routes.js";
import { createStepDispatch } from "./web-multi-dispatch.js";
import { handleCognitiveTool } from "./web-cognitive-handlers.js";
import { createFlowEngine } from "./web-flows.js";
import { createRecorder } from "./web-recorder.js";
import { handleVisualBaseline } from "./web-visual-baseline.js";
import { createFanout } from "./web-fanout.js";
import { hubWaitMs, LONG_WAIT_TOOLS, stepWaitMs } from "./web-timeouts.js";
import type { SseRingEvent } from "./hub-sse.js";

// Web bridge: gives AI agents supervised access to the user's browser through
// the ScreenSync extension. The MCP tool handler (possibly a separate stdio
// process) POSTs /api/web/tool; the hub pushes a web_request over SSE to the
// extension, which executes it in the user's browser and POSTs the result to
// /api/web/result so the pending tool call resolves.

export type WebToolResult = { ok: boolean; data?: unknown; error?: string; code?: string; retryable?: boolean }; // code: APPROVAL_TIMEOUT, USER_DECLINED, ...

type Pending = {
  resolve: (r: WebToolResult) => void;
  timer: ReturnType<typeof setTimeout>;
  /** The web_request exactly as relayed (images intact), for replay to an extension that reconnects meanwhile. */
  payload: Record<string, unknown>;
  /** When the hub stops waiting; /api/web/awaiting moves it (web-ext-routes.ts). */
  deadlineAt: number;
  extended?: boolean;
  targetBrowser?: string | null;
  targetInstanceId?: string | null;
  targetEmail?: string | null;
  targetProfile?: string | null;
};

export type WebBridge = {
  registerRoutes: (app: Express) => void;
  status: () => Record<string, unknown>;
  armReloadRequested: () => void;
  startSchedules: () => void;
  stopSchedules: () => void;
  /** What a Last-Event-ID replay sends for a ring event (hub-sse.ts setReplayPayload), or null to skip it. */
  replayPayload: (e: SseRingEvent) => Record<string, unknown> | null;
  /**
   * The hub is stopping: every pending call is answered HUB_STOPPING (retryable) and its timer cleared, and new
   * calls are refused. Otherwise stop() waited for the longest pending call, up to ~10 minutes for web_takeover.
   */
  close: () => void;
};

export type WebBridgeOptions = {
  /**
   * Whether the browser `instanceId`'s own SSE stream is open (hub-sse.ts hasInstance); null = unknown. Asked only
   * for a browser that attributes its stream (sseAttribution); an older one is judged by "any stream is open".
   * Without it the bridge knows nothing about streams and relays as before (in-process tests).
   */
  presence?: (instanceId: string) => boolean | null;
  /** How long a call waits for a dropped stream to come back before it fails with BROWSER_STREAM_DOWN. */
  streamGraceMs?: number;
};

/** A service worker restart or a network blip reconnects within a few seconds; a dead stream does not. */
export const STREAM_GRACE_MS = 5_000;
const STREAM_POLL_MS = 50;

export function createWebBridge(
  broadcast: (payload: object, name?: string) => void,
  getSseClientCount?: () => number | SseView,
  opts: WebBridgeOptions = {},
): WebBridge {
  const pending = new Map<string, Pending>();
  const frameStore = createFrameStore(broadcast);

  // HTTP-channel reload: armed by the hub's POST /api/dev/reload, served on
  // the register heartbeat — reaches extensions whose SSE stream is dead.
  let reloadRequestedAtMs = 0;
  const armReloadRequested = () => { reloadRequestedAtMs = Date.now(); };

  // Multi-profile & multi-browser registry: every extension instance (Chrome profiles, Edge, Brave, ...)
  // heartbeats under its own instanceId with profile email, name, and windows.
  const registry = createProfileRegistry();

  const status = () => {
    const sseClients = getSseClientCount ? getSseClientCount() : 0;
    return registry.statusPayload(sseClients);
  };

  // ── S1: is the target browser's live event stream up? ──
  // Requests reach the extension ONLY over its SSE stream, while its heartbeat (HTTP) keeps it "online" for 90s
  // after that stream died: a call relayed then waited out its whole timeout (45-65s) for nothing.
  const streamGraceMs = Math.max(0, opts.streamGraceMs ?? STREAM_GRACE_MS);
  const sseClientCount = () => {
    const v = getSseClientCount?.();
    return typeof v === "number" ? v : v ? v.count() : 0;
  };
  const streamUp = (target: BrowserInstance): boolean => {
    if (!opts.presence) return true; // no stream information: relay as before
    if (target.sseAttribution) return opts.presence(target.instanceId) !== false;
    return getSseClientCount ? sseClientCount() > 0 : true;
  };
  /** null once the target's stream is up (waiting up to streamGraceMs for it to come back), else the refusal. */
  const streamRefusal = async (target: BrowserInstance): Promise<WebToolResult | null> => {
    if (streamUp(target)) return null;
    const startedAt = Date.now();
    const deadline = startedAt + streamGraceMs;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, Math.max(1, Math.min(STREAM_POLL_MS, deadline - Date.now()))));
      if (streamUp(target)) return null;
    }
    const who = target.profileEmail || target.profileName || target.instanceId;
    const waitedMs = Date.now() - startedAt;
    log("WARN", "Web call refused: the target browser's event stream is down", { instanceId: target.instanceId, waitedMs });
    return {
      ok: false, code: "BROWSER_STREAM_DOWN", retryable: true,
      error: `The browser's live event stream (SSE) to the hub is down, so ${who} (${target.name}) cannot receive this call; nothing was sent. ` +
        "The extension reconnects on its own: retry in a few seconds. If it keeps failing, open the ScreenSync extension dashboard (web_status shows sseConnected per browser).",
      data: { code: "BROWSER_STREAM_DOWN", instanceId: target.instanceId, waitedMs },
    };
  };

  let closed = false;
  const stopping = (): WebToolResult => ({
    ok: false, code: "HUB_STOPPING", retryable: true,
    error: "The ScreenSync hub is shutting down, so this browser call was abandoned. Retry once the hub is back.",
  });
  const close = () => {
    closed = true;
    for (const [id, entry] of [...pending]) {
      clearTimeout(entry.timer);
      pending.delete(id);
      entry.resolve(stopping());
    }
  };

  const request = async (tool: string, args: Record<string, unknown>, relayTimeoutMs: number, gate?: GateDecision, decided?: DispatchDecision): Promise<WebToolResult> => {
    if (closed) return stopping();
    // A long-wait step (web_takeover, ...) inside a flow, replay, fanout or test run waits its own budget, not the
    // relay's 5-60s step clamp (web-timeouts.ts); the tool route already passes exactly that, so it is unchanged.
    const timeoutMs = stepWaitMs(tool, args, relayTimeoutMs);
    // Every relay (tool route, flows, schedules, replay, fanout) passes through here, so this is where a call
    // that cannot be pinned to exactly one browser instance is stopped: the extension runs an untargeted
    // web_request in EVERY connected profile. Routing order (tabId/windowId owner, hint, selectedProfile,
    // heuristic) lives in profile-registry.ts resolveDispatch(); a caller that already acted on one passes `decided`.
    const route = decided ?? registry.resolveDispatch(args);
    if (!route.ok) return { ok: false, error: route.error, data: { code: route.code, onlineProfiles: route.onlineProfiles } };
    // ...and where a call to a browser that cannot hear it (its stream is down) fails fast instead of timing out.
    const down = await streamRefusal(route.target);
    if (down) return down;
    if (closed) return stopping(); // stopped during the stream grace wait
    return new Promise((resolve) => {
      const id = randomUUID();
      const timer = setTimeout(() => {
        pending.delete(id);
        resolve({ ok: false, code: "TIMEOUT", error: `Timed out after ${timeoutMs}ms waiting for the browser extension.` });
      }, timeoutMs);
      const { name: targetBrowser, instanceId: targetInstanceId, profileEmail: targetEmail, profileName: targetProfile } = route.target;
      const deadlineAt = Date.now() + timeoutMs;
      const payload = {
        type: "web_request",
        id,
        tool,
        // Internal flags are dropped HERE, the one place every relay passes through, and the gate's request for a
        // person is added only after. deadlineAt tells the extension how long the hub will wait; remainingMs says
        // the same relative to now, which the extension trusts over deadlineAt (the two clocks can differ).
        args: forRelay(args, gate), deadlineAt, remainingMs: timeoutMs,
        targetBrowser,
        targetInstanceId,
        targetEmail,
        targetProfile,
      };
      pending.set(id, { resolve, timer, payload, deadlineAt, targetBrowser, targetInstanceId, targetEmail, targetProfile });
      broadcast(payload);
    });
  };

  // A reconnecting extension replays what it missed (Last-Event-ID). A web_request goes out again only while the
  // hub still waits for it, with its full args (the ring keeps a copy with images truncated) and its CURRENT
  // deadline; an answered or expired one is skipped, so it never runs after the caller was answered.
  const replayPayload = (e: SseRingEvent): Record<string, unknown> | null => {
    if (e.payload?.type !== "web_request") return e.payload;
    const entry = typeof e.payload.id === "string" ? pending.get(e.payload.id) : undefined;
    return entry ? { ...entry.payload, deadlineAt: entry.deadlineAt, remainingMs: Math.max(0, entry.deadlineAt - Date.now()) } : null;
  };
  // A step of web_flow_run / web_replay / web_fanout / web_tab_fanout meets the approval gate like a direct call.
  const gatedStep = createStepDispatch(registry.resolveDispatch, request);

  // Flows library, test runner and schedules (web-flows.ts); the recorder (web-recorder.ts) saves through it.
  const flows = createFlowEngine({ broadcast, request, gatedStep });
  const recorder = createRecorder({ flows, gatedStep, broadcast });
  const fanouts = createFanout({ registry, request, gatedStep });

  const registerRoutes = (app: Express) => {
    // Heartbeat + capability registration from the extension SW.
    app.post("/api/web/register", (req: Request, res: Response) => {
      if (!isAuthorized(req.header("authorization"))) {
        res.status(401).json({ success: false, error: "Invalid ScreenSync pairing token." });
        return;
      }
      const b = (req.body ?? {}) as Record<string, unknown>;
      registry.register(b);
      res.json({
        success: true,
        status: status(),
        // HTTP-channel reload (armed by POST /api/dev/reload): reaches
        // extensions whose SSE stream is dead, unlike the SSE broadcast.
        // Consume immediately so the extension only reloads once, not repeatedly.
        ...(() => {
          if (Date.now() - reloadRequestedAtMs < 60_000) {
            reloadRequestedAtMs = 0;
            return { reloadRequested: true };
          }
          return {};
        })(),
      });
    });

    mountExtensionRoutes(app, { isAuthorized, broadcast, pending });

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
      // Which agent process is calling (the MCP relay sends its own id); competence needs distinct sessions.
      const session = sessionOf(req.header("x-session-id"));
      if (!/^web_[a-z0-9_]+$/.test(tool)) {
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
        res.json({ success: true, ok: true, data: webEventsReply(args) });
        return;
      }
      if (tool === "web_fanout") {
        await fanouts.fanout(args, res, session);
        return;
      }


// Cognitive & developmental tools (Architectures 1.0-11.0) live in their own module.
      // activeTabUrl: the same no-hint target resolution web_status's top-level `activeTab` uses (selected
      // profile -> focused window -> latest heartbeat), so a tool like web_recall can infer a domain from
      // whatever page is actually open right now instead of guessing across every browser online.
      if (handleCognitiveTool(tool, args, res, { session, activeTabUrl: registry.resolveTarget()?.tab?.url ?? null })) return;

      if (await flows.handleTool(tool, args, res, session)) return;

      // ── Account dashboard: which platform is live in which browser? ──────
      // ── Visual baselines: Playwright toHaveScreenshot parity ─────────────
      if (tool === "web_visual_baseline") {
        await handleVisualBaseline(args, res, { resolveDispatch: registry.resolveDispatch, request });
        return;
      }

      if (await recorder.handleTool(tool, args, res, session)) return;

      // ── Multi-tab orchestration (mirror of web_fanout) ───────────────────
      if (tool === "web_tab_fanout") {
        await fanouts.tabFanout(args, res, session);
        return;
      }

      if (tool === "web_profile") {
        const action = String(args.action || "list");
        if (action === "select" || action === "set") {
          const prof = typeof args.profile === "string" ? args.profile.trim() : null;
          registry.setSelectedProfile(prof);
          res.json({
            success: true,
            ok: true,
            data: {
              selectedProfile: registry.getSelectedProfile(),
              message: prof ? `Active profile set to '${prof}'` : "Active profile cleared.",
            },
          });
          return;
        }
        const online = registry.listOnline();
        res.json({
          success: true,
          ok: true,
          data: {
            selectedProfile: registry.getSelectedProfile(),
            activeCount: online.length,
            profiles: online.map((p) => ({
              instanceId: p.instanceId,
              browserName: p.name,
              profileEmail: p.profileEmail,
              profileName: p.profileName,
              profileDir: p.profileDir,
              activeTab: p.tab,
              windowCount: p.windows.length,
              windows: p.windows,
            })),
          },
        });
        return;
      }

      // Soft gate: a destructive-looking mutation on a domain that has not earned COMPETENT (cognitive-policy.ts).
      // In enforce mode it goes to a person (the extension asks); it is refused here only when nobody can be
      // asked. Before the connection checks: that refusal must not depend on whether a browser is attached.
      // `route` is decided ONCE: the browser judged able to ask IS the one request() dispatches to. A route refused
      // while browsers are online is left to the routing refusal below; either way nothing is relayed or asked.
      const route = registry.resolveDispatch(args);
      const gate = gateBeforeRelay(tool, args, session);
      if (gate && refusedByGate(gate, route)) {
        res.json({ success: false, ok: false, code: "USER_CONFIRMATION_REQUIRED", error: gate.message, data: { gate: gate.decision } });
        return;
      }
      const onlineBrowsers = registry.listOnline();
      if (onlineBrowsers.length === 0) {
        res.status(503).json({
          success: false, ok: false,
          error: "Browser extension is not connected to this hub. Open the ScreenSync extension dashboard so it can pair.",
        });
        return;
      }
      if (!onlineBrowsers.some((b) => b.webAccessEnabled)) {
        res.status(403).json({
          success: false, ok: false,
          error: "Web access is disabled in the extension. Enable the 'Web access for AI agents' toggle in the extension dashboard.",
        });
        return;
      }
      // Multi-profile & multi-browser targeting: refuse here what request() would refuse (unknown hint, offline
      // selectedProfile), so a routing refusal is not counted as a tool run by events, the recorder or tracking.
      if (!route.ok) {
        const { status: httpStatus, code, error, onlineProfiles } = route;
        res.status(httpStatus).json({ success: false, ok: false, error, code, onlineProfiles, data: { code, onlineProfiles } });
        return;
      }
      // S1: the target cannot hear a call while its event stream is down. Refused here, before the call is counted
      // as a tool run by events, the recorder or tracking (request() checks again for flows, replay and fanout).
      const down = await streamRefusal(route.target);
      if (down) {
        res.status(503).json({ success: false, ok: false, error: down.error, code: down.code, retryable: true, data: down.data });
        return;
      }
      // 5-65s (65, not 60: a 60s browser-side budget still gets the MCP side's 5s margin, hub-web-call.ts); a
      // long-wait tool (web-timeouts.ts) waits its own budget from args.timeoutMs, up to its catalog maximum.
      const timeoutMs = hubWaitMs(tool, LONG_WAIT_TOOLS[tool] ? args.timeoutMs : b.timeoutMs);
      const startedAt = Date.now();
      const result = await request(tool, args, timeoutMs, gate?.block ? gate.decision : undefined, route);
      emitHubEvent("tool", tool, result.ok);
      recorder.capture(tool, args);
      log("INFO", "Web tool round trip", { tool, ok: result.ok, durationMs: Date.now() - startedAt });
      trackToolExecution(tool, args, result, Date.now() - startedAt, session);
      res.json({ success: result.ok, ok: result.ok, data: result.data, error: result.error, ...(result.code ? { code: result.code } : {}), ...(result.retryable !== undefined ? { retryable: result.retryable } : {}), ...(gate ? { cognitiveGate: gate.block ? { ...gate.decision, verdict: "asked" } : gate.decision } : {}) });
    });

    app.post("/api/web/result", (req: Request, res: Response) => {
      if (!isAuthorized(req.header("authorization"))) {
        res.status(401).json({ success: false, error: "Invalid ScreenSync pairing token." });
        return;
      }
      const b = (req.body ?? {}) as {
        id?: string;
        ok?: boolean;
        data?: unknown;
        error?: string; code?: unknown; retryable?: unknown; // the extension's error code, e.g. APPROVAL_TIMEOUT / USER_DECLINED
        browserId?: string;
        browserName?: string;
        instanceId?: string;
        profileEmail?: string;
        profileName?: string;
      };
      const entry = b.id ? pending.get(b.id) : undefined;
      if (!entry) {
        res.status(404).json({ success: false, error: "Unknown or already-resolved request id." });
        return;
      }
      // Strict target matching on instanceId
      if (entry.targetInstanceId && b.instanceId) {
        if (b.instanceId.toLowerCase() !== entry.targetInstanceId.toLowerCase()) {
          log("WARN", "Ignored result from non-target instance", {
            id: b.id,
            targetInstanceId: entry.targetInstanceId,
            answeringInstanceId: b.instanceId,
          });
          res.status(200).json({ success: false, ignored: true, reason: "mismatched_target_instance" });
          return;
        }
      }
      // Strict target matching on browserName or browserId
      if (entry.targetBrowser) {
        const target = entry.targetBrowser.toLowerCase();
        const incomingId = (b.browserId || "").toLowerCase();
        const incomingName = (b.browserName || "").toLowerCase();
        const incomingInst = (b.instanceId || "").toLowerCase();
        if (target !== "any" && target !== "default") {
          if (incomingId !== target && incomingName !== target && incomingInst !== target) {
            log("WARN", "Ignored result from non-target browser", {
              id: b.id,
              targetBrowser: entry.targetBrowser,
              answeringId: b.browserId,
              answeringName: b.browserName,
              answeringInst: b.instanceId,
            });
            res.status(200).json({ success: false, ignored: true, reason: "mismatched_target_browser" });
            return;
          }
        }
      }
      clearTimeout(entry.timer);
      pending.delete(b.id as string);
      entry.resolve({ ok: b.ok === true, data: b.data, error: b.error, ...(typeof b.code === "string" && b.code ? { code: b.code.slice(0, 64) } : {}), ...(typeof b.retryable === "boolean" ? { retryable: b.retryable } : {}) });
      res.json({ success: true });
    });

    frameStore.registerRoutes(app);
  };

  return {
    registerRoutes,
    status,
    armReloadRequested,
    startSchedules: flows.startSchedules,
    stopSchedules: flows.stopSchedules,
    replayPayload,
    close,
  };
}
