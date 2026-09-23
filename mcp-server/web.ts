import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Express, Request, Response } from "express";
import { DATA_DIR, isAuthorized, log } from "./config.js";
import { emitHubEvent, lastEventSeq, recentHubEvents } from "./events.js";
import { createFrameStore } from "./web-frame.js";
import { generateFlow, generatePlaywright } from "./codegen.js";
import { createProfileRegistry, BrowserInstance, BrowserWindowInfo, type DispatchDecision } from "./profile-registry.js";
import { trackToolExecution } from "./cognitive-auto-tracker.js";
import { sessionOf } from "./cognitive-spine-observer.js";
import { forRelay, gateBeforeRelay, humanCanBeAsked, type GateDecision } from "./cognitive-policy.js";
import { mountExtensionRoutes } from "./web-ext-routes.js";
import { handleCognitiveTool } from "./web-cognitive-handlers.js";

// Web bridge: gives AI agents supervised access to the user's browser through
// the ScreenSync extension. The MCP tool handler (possibly a separate stdio
// process) POSTs /api/web/tool; the hub pushes a web_request over SSE to the
// extension, which executes it in the user's browser and POSTs the result to
// /api/web/result so the pending tool call resolves.

export type WebToolResult = { ok: boolean; data?: unknown; error?: string };

type Pending = {
  resolve: (r: WebToolResult) => void;
  timer: ReturnType<typeof setTimeout>;
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

export function createWebBridge(broadcast: (payload: object, name?: string) => void, getSseClientCount?: () => number): WebBridge {
  const pending = new Map<string, Pending>();
  const frameStore = createFrameStore(broadcast);

  // HTTP-channel reload: armed by the hub's POST /api/dev/reload, served on
  // the register heartbeat — reaches extensions whose SSE stream is dead.
  let reloadRequestedAtMs = 0;
  const armReloadRequested = () => { reloadRequestedAtMs = Date.now(); };

  // Teach-once-replay-anywhere recorder: while active, every default-path
  // tool call is captured {tool, args} so web_replay can re-execute the flow.
  const recorder = {
    active: false,
    startedAt: null as string | null,
    steps: [] as Array<{ step: number; tool: string; args: Record<string, unknown> }>,
  };
  const RECORD_SKIP = new Set([
    "web_record", "web_replay", "web_status", "web_events", "web_extension_diagnostics",
    "web_fanout", "web_tab_fanout",
  ]);

  // Multi-profile & multi-browser registry: every extension instance (Chrome profiles, Edge, Brave, ...)
  // heartbeats under its own instanceId with profile email, name, and windows.
  const registry = createProfileRegistry();

  const online = () => {
    const sseCount = getSseClientCount ? getSseClientCount() : 1;
    return sseCount > 0 && registry.listOnline().length > 0;
  };

  const status = () => {
    const sseClients = getSseClientCount ? getSseClientCount() : 0;
    return registry.statusPayload(sseClients);
  };

  const request = (tool: string, args: Record<string, unknown>, timeoutMs: number, gate?: GateDecision, decided?: DispatchDecision): Promise<WebToolResult> =>
    new Promise((resolve) => {
      // Every relay (tool route, flows, schedules, replay, fanout) passes through here, so this is where a call
      // that cannot be pinned to exactly one browser instance is stopped: the extension runs an untargeted
      // web_request in EVERY connected profile. Routing order (tabId/windowId owner, hint, selectedProfile,
      // heuristic) lives in profile-registry.ts resolveDispatch(). A caller that already decided (the gate judged
      // that browser, or a fanout pinned one) passes `decided`, so the call cannot land anywhere else.
      const route = decided ?? registry.resolveDispatch(args);
      if (!route.ok) {
        resolve({ ok: false, error: route.error, data: { code: route.code, onlineProfiles: route.onlineProfiles } });
        return;
      }
      const id = randomUUID();
      const timer = setTimeout(() => {
        pending.delete(id);
        resolve({ ok: false, error: `Timed out after ${timeoutMs}ms waiting for the browser extension.` });
      }, timeoutMs);
      const { name: targetBrowser, instanceId: targetInstanceId, profileEmail: targetEmail, profileName: targetProfile } = route.target;

      pending.set(id, { resolve, timer, targetBrowser, targetInstanceId, targetEmail, targetProfile });
      broadcast({
        type: "web_request",
        id,
        tool,
        // Internal flags are dropped HERE, the one place every relay passes through, and the gate's request for a
        // person is added only after. deadlineAt tells the extension how long the hub will wait.
        args: forRelay(args, gate), deadlineAt: Date.now() + timeoutMs,
        targetBrowser,
        targetInstanceId,
        targetEmail,
        targetProfile,
      });
    });

    // ── Persisted Flows Library: save / list / run / delete ──────────────
    // Recorded steps can be saved under a name (with editable steps and
    // {{var}} placeholders) and re-run any time — the durable half of
    // teach-once-replay-anywhere. Flows live in DATA_DIR/flows/*.json.
    const FLOWS_DIR = path.join(DATA_DIR, "flows");
    const flowPath = (name: string) => path.join(FLOWS_DIR, name.replace(/[^a-z0-9_-]+/gi, "_") + ".json");
    const loadFlow = (name: string): { name: string; steps: Array<{ tool?: string; args?: Record<string, unknown> }> } | null => {
      const p = flowPath(name);
      if (!existsSync(p)) return null;
      try { return JSON.parse(readFileSync(p, "utf8")); } catch { return null; }
    };
    const substituteVars = (value: unknown, vars: Record<string, string>): unknown => {
      if (typeof value === "string") {
        let out = value;
        for (const [k, v] of Object.entries(vars)) out = out.replaceAll(`{{${k}}}`, v);
        return out;
      }
      if (Array.isArray(value)) return value.map((v) => substituteVars(v, vars));
      if (value && typeof value === "object") {
        const out: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(value)) out[k] = substituteVars(v, vars);
        return out;
      }
      return value;
    };

    // Flow step-output chaining: {{step.N}} → step N's result data (JSON),
    // {{step.N.path.to.field}} → dotted-path traversal into that data.
    const getPath = (obj: unknown, dotted: string): unknown => {
      let cur: unknown = obj;
      for (const part of dotted.split(".")) {
        if (cur === null || cur === undefined) return undefined;
        cur = (cur as Record<string, unknown>)[part];
      }
      return cur;
    };
    const substituteTokens = (
      value: unknown,
      vars: Record<string, string>,
      stepResults: Array<Record<string, unknown>>,
    ): unknown => {
      const resolve = (token: string): unknown => {
        if (token.startsWith("step.")) {
          const rest = token.slice(5);
          const dot = rest.indexOf(".");
          const n = dot === -1 ? rest : rest.slice(0, dot);
          const idx = Number(n);
          const entry = stepResults[idx - 1];
          if (!entry) return undefined;
          if (dot === -1) return entry.data;
          const pathStr = rest.slice(dot + 1);
          const fromEntry = getPath(entry, pathStr);
          if (fromEntry !== undefined) return fromEntry;
          return getPath(entry.data, pathStr);
        }
        return vars[token];
      };
      const walk = (v: unknown): unknown => {
        if (typeof v === "string") {
          // whole-string token returns the raw value (preserves objects/numbers)
          const m = v.match(/^\{\{([^}]+)\}\}$/);
          if (m) {
            const resolved = resolve(m[1].trim());
            return resolved !== undefined ? resolved : v;
          }
          let out = v;
          for (const [k, val] of Object.entries(vars)) out = out.replaceAll(`{{${k}}}`, val);
          out = out.replace(/\{\{(step\.[^}]+)\}\}/g, (_s, token: string) => {
            const resolved = resolve(token.trim());
            return resolved === undefined ? `{{${token}}}` : String(resolved);
          });
          return out;
        }
        if (Array.isArray(v)) return v.map(walk);
        if (v && typeof v === "object") {
          const out: Record<string, unknown> = {};
          for (const [k, val] of Object.entries(v)) out[k] = walk(val);
          return out;
        }
        return v;
      };
      return walk(value);
    };

    type FlowStep = { tool?: string; args?: Record<string, unknown> };
    type SavedFlow = { name: string; steps: FlowStep[] };
    const executeFlow = async (
      flow: SavedFlow,
      vars: Record<string, string>,
      stopOnError: boolean,
      stepTimeoutMs: number,
    ): Promise<{ results: Array<Record<string, unknown>>; okAll: boolean; executed: number }> => {
      const results: Array<Record<string, unknown>> = [];
      let okAll = true;
      let executed = 0;
      for (let i = 0; i < flow.steps.length; i++) {
        const step = flow.steps[i];
        const stepTool = String(step.tool || "");
        if (!/^web_[a-z0-9_]+$/.test(stepTool)) {
          results.push({ step: i + 1, tool: stepTool, ok: false, error: "invalid tool name" });
          okAll = false;
          executed++;
          if (stopOnError) break;
          continue;
        }
          const stepArgs = substituteTokens(step.args ?? {}, vars, results) as Record<string, unknown>;
        broadcast({ type: "web_replay_step", at: new Date().toISOString(), flow: flow.name, step: i + 1, of: flow.steps.length, tool: stepTool });
        const r = await request(stepTool, stepArgs, stepTimeoutMs);
        results.push({ step: i + 1, tool: stepTool, ok: r.ok, data: r.data, error: r.error });
        executed++;
        if (!r.ok) {
          okAll = false;
          if (stopOnError) break;
        }
      }
      return { results, okAll, executed };
    };

    // ── Schedules: hub-side timers that run saved flows automatically ────
    const SCHEDULES_DIR = path.join(DATA_DIR, "schedules");
    const scheduleTimers = new Map<string, ReturnType<typeof setInterval>>();
    const schedulePath = (id: string) => path.join(SCHEDULES_DIR, id.replace(/[^a-z0-9_-]+/gi, "_") + ".json");
    const loadSchedules = (): Array<Record<string, unknown>> => {
      if (!existsSync(SCHEDULES_DIR)) return [];
      return readdirSync(SCHEDULES_DIR).filter((f) => f.endsWith(".json")).map((f) => {
        try { return JSON.parse(readFileSync(path.join(SCHEDULES_DIR, f), "utf8")); } catch { return null; }
      }).filter(Boolean);
    };
    const runScheduled = async (id: string) => {
      const schedules = loadSchedules();
      const sched = schedules.find((s) => (s as { id?: string }).id === id) as
        | { id: string; flow: string; vars: Record<string, string>; stopOnError: boolean; everyMinutes: number }
        | undefined;
      if (!sched) {
        const timer = scheduleTimers.get(id);
        if (timer) { clearInterval(timer); scheduleTimers.delete(id); }
        return;
      }
      const flow = loadFlow(sched.flow);
      if (!flow) return;
      const startedAt = Date.now();
      const run = await executeFlow(flow, sched.vars || {}, sched.stopOnError !== false, 45_000);
      // persist last-run status back into the schedule file
      try {
        writeFileSync(schedulePath(id), JSON.stringify({ ...sched, lastRunAt: new Date().toISOString(), lastRunOk: run.okAll, lastRunExecuted: run.executed, lastRunMs: Date.now() - startedAt }, null, 2));
      } catch { /* best effort */ }
      broadcast({ type: "web_flow_scheduled_run", at: new Date().toISOString(), schedule: id, flow: sched.flow, okAll: run.okAll, executed: run.executed, ms: Date.now() - startedAt });
      log("INFO", "Scheduled flow run", { schedule: id, flow: sched.flow, okAll: run.okAll, executed: run.executed });
    };
    const startScheduleTimer = (sched: { id: string; everyMinutes: number }) => {
      const ms = Math.max(Math.round(sched.everyMinutes * 60_000), 3_000);
      const timer = setInterval(() => { runScheduled(sched.id).catch(() => {}); }, ms);
      scheduleTimers.set(sched.id, timer);
    };
    const stopSchedules = () => {
      for (const timer of scheduleTimers.values()) clearInterval(timer);
      scheduleTimers.clear();
    };
    const startSchedules = () => {
      stopSchedules();
      for (const s of loadSchedules()) {
        const sched = s as { id?: string; everyMinutes?: number };
        if (sched.id && Number.isFinite(sched.everyMinutes)) startScheduleTimer(sched as { id: string; everyMinutes: number });
      }
    };

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
      // ── Hub-side multi-browser orchestration ─────────────────────────────
      // These run ONE tool on N browsers by issuing sequential per-browser
      // requests (each extension self-filters via args.__browser) and merging.
      const resolveTargets = (): Array<{ id: string; name: string }> => {
        const online = registry.listOnline().map((e) => ({
          id: e.instanceId,
          name: e.name,
          email: e.profileEmail,
        }));
        const want = args.browsers;
        if (!want || want === "all") return online;
        const list = Array.isArray(want) ? want.map(String) : String(want).split(",").map((s) => s.trim());
        return online.filter((t) => list.includes(t.name) || list.includes(t.id) || (t.email && list.includes(t.email)));
      };
      const callOn = (target: { id: string; name: string }, innerTool: string, innerArgs: Record<string, unknown>, timeoutMs: number): Promise<WebToolResult> =>
        request(innerTool, { ...innerArgs, __browser: target.id }, timeoutMs);

      if (tool === "web_fanout") {
        const innerTool = String(args.tool || "");
        if (!/^web_[a-z0-9_]+$/.test(innerTool)) {
          res.status(400).json({ success: false, ok: false, error: "web_fanout requires tool (a web_* tool to run on each browser)." });
          return;
        }
        const targets = resolveTargets();
        if (!targets.length) {
          res.json({ success: true, ok: false, data: { results: [], matched: 0, error: "No connected browser matches the requested set." } });
          return;
        }
        const timeoutMs = Math.min(Math.max(Number(args.timeoutMs) || 45_000, 5_000), 60_000);
        const { browsers: _omit, tool: _t, args: innerA, ...rest } = args;
        // The agent passes tool args nested under `args`; forward them as the
        // actual tool arguments (falling back to top-level extras).
        const innerArgs = { ...rest, ...(innerA && typeof innerA === "object" ? (innerA as Record<string, unknown>) : {}) };
        const results: Array<Record<string, unknown>> = [];
        for (const target of targets) {
          const r = await callOn(target, innerTool, innerArgs as Record<string, unknown>, timeoutMs);
          results.push({ browser: target.name, browserId: target.id, ok: r.ok, data: r.data, error: r.error });
        }
        res.json({ success: true, ok: results.every((r) => r.ok), data: { tool: innerTool, matched: targets.length, results } });
        return;
      }


// Cognitive & developmental tools (Architectures 1.0-11.0) live in their own module.
      if (handleCognitiveTool(tool, args, res, { session })) return;

      if (tool === "web_flow_save") {
        const name = String(args.name || "").trim();
        const steps = Array.isArray(args.steps) ? (args.steps as Array<{ tool?: string; args?: Record<string, unknown> }>) : [];
        if (!name || !steps.length) {
          res.status(400).json({ success: false, ok: false, error: "web_flow_save requires name and steps (from web_record {action:'stop'} — edit freely, use {{var}} placeholders)." });
          return;
        }
        mkdirSync(FLOWS_DIR, { recursive: true });
        const flow = { name, savedAt: new Date().toISOString(), stepCount: steps.length, steps };
        writeFileSync(flowPath(name), JSON.stringify(flow, null, 2));
        log("INFO", "Flow saved", { name, stepCount: steps.length });
        res.json({ success: true, ok: true, data: { saved: true, name, stepCount: steps.length, file: flowPath(name) } });
        return;
      }

      if (tool === "web_flow_list") {
        if (!existsSync(FLOWS_DIR)) {
          res.json({ success: true, ok: true, data: { flows: [], note: "No flows saved yet — record with web_record, then web_flow_save." } });
          return;
        }
        const files = readdirSync(FLOWS_DIR).filter((f) => f.endsWith(".json"));
        const flows = files.map((f) => {
          try {
            const parsed = JSON.parse(readFileSync(path.join(FLOWS_DIR, f), "utf8"));
            return { name: parsed.name ?? f.replace(/\.json$/, ""), savedAt: parsed.savedAt, stepCount: parsed.stepCount, tools: (parsed.steps || []).map((s: { tool?: string }) => s.tool) };
          } catch { return { name: f, corrupted: true }; }
        });
        res.json({ success: true, ok: true, data: { flows } });
        return;
      }

      if (tool === "web_flow_run") {
        const name = String(args.name || "").trim();
        const flow = loadFlow(name);
        if (!flow || !Array.isArray(flow.steps)) {
          res.json({ success: true, ok: false, data: { error: `Flow '${name}' not found. web_flow_list shows saved flows.` } });
          return;
        }
        const vars = (args.vars && typeof args.vars === "object" ? args.vars : {}) as Record<string, string>;
        const stopOnError = args.stopOnError !== false;
        const stepTimeoutMs = Math.min(Math.max(Number(args.stepTimeoutMs) || 45_000, 5_000), 60_000);
        const run = await executeFlow(flow, vars, stopOnError, stepTimeoutMs);
        res.json({ success: true, ok: run.okAll, data: { flow: flow.name, vars: Object.keys(vars), total: flow.steps.length, executed: run.executed, okAll: run.okAll, results: run.results } });
        return;
      }

      if (tool === "web_flow_delete") {
        const name = String(args.name || "").trim();
        const p = flowPath(name);
        if (!existsSync(p)) {
          res.json({ success: true, ok: false, data: { error: `Flow '${name}' not found.` } });
          return;
        }
        unlinkSync(p);
        res.json({ success: true, ok: true, data: { deleted: name } });
        return;
      }

      // ── Test Runner: suites, retries, JUnit XML & JSON reports (P8) ───────
      if (tool === "web_test_run") {
        let suiteDef: any = args.suite;
        if (!suiteDef && Array.isArray(args.tests)) {
          suiteDef = { name: String(args.name || "ScreenSync Test Suite"), tests: args.tests, format: args.format };
        } else if (!suiteDef && (args.flow || args.steps)) {
          const flowName = String(args.flow || args.name || "flow_test");
          const flowSteps = args.steps || (args.flow ? loadFlow(String(args.flow))?.steps : []);
          suiteDef = {
            name: flowName,
            format: args.format || "both",
            tests: [{ name: flowName, steps: flowSteps, retries: Number(args.retries) || 0 }],
          };
        }
        if (!suiteDef || !Array.isArray(suiteDef.tests)) {
          res.status(400).json({ success: false, ok: false, error: "web_test_run requires suite with tests, or flow/steps." });
          return;
        }

        for (const tc of suiteDef.tests) {
          if (!tc.steps && tc.flow) {
            const f = loadFlow(tc.flow);
            if (f && Array.isArray(f.steps)) tc.steps = f.steps;
          }
        }

        const runnerCallback = async (stepTool: string, stepArgs: Record<string, unknown>) => {
          return await request(stepTool, stepArgs, 45_000);
        };

        const { runTestSuite } = await import("./test-runner.js");
        const result = await runTestSuite(suiteDef, runnerCallback);
        res.json({ success: true, ok: result.failed === 0, data: result });
        return;
      }

      // ── Flow Schedules: the hub itself runs saved flows on an interval ────
      if (tool === "web_flow_schedule") {
        const flowName = String(args.flow || args.name || "").trim();
        const flow = loadFlow(flowName);
        if (!flow || !Array.isArray(flow.steps)) {
          res.json({ success: true, ok: false, data: { error: `Flow '${flowName}' not found. Save it first with web_flow_save.` } });
          return;
        }
        const everyMinutes = Number(args.everyMinutes);
        if (!Number.isFinite(everyMinutes) || everyMinutes < 0.05) {
          res.status(400).json({ success: false, ok: false, error: "web_flow_schedule requires everyMinutes (minimum 0.05 = every 3 seconds; use ≥1440 for daily)." });
          return;
        }
        const vars = (args.vars && typeof args.vars === "object" ? args.vars : {}) as Record<string, string>;
        const id = flowName.replace(/[^a-z0-9_-]+/gi, "_").slice(0, 40) + "-" + randomUUID().slice(0, 8);
        const schedule = {
          id,
          flow: flowName,
          everyMinutes,
          vars,
          stopOnError: args.stopOnError !== false,
          createdAt: new Date().toISOString(),
        };
        mkdirSync(SCHEDULES_DIR, { recursive: true });
        writeFileSync(schedulePath(id), JSON.stringify(schedule, null, 2));
        startScheduleTimer(schedule);
        res.json({ success: true, ok: true, data: { scheduled: true, id, flow: flowName, everyMinutes, nextRunAt: new Date(Date.now() + Math.max(everyMinutes, 0.05) * 60_000).toISOString(), note: "The hub will run this flow automatically. web_flow_schedules lists all; web_flow_unschedule stops it." } });
        return;
      }

      if (tool === "web_flow_schedules") {
        const all = loadSchedules().map((s) => ({
          id: s.id, flow: s.flow, everyMinutes: s.everyMinutes, vars: Object.keys(s.vars || {}),
          createdAt: s.createdAt, lastRunAt: s.lastRunAt ?? null, lastRunOk: s.lastRunOk ?? null, lastRunExecuted: s.lastRunExecuted ?? null,
        }));
        res.json({ success: true, ok: true, data: { schedules: all, count: all.length } });
        return;
      }

      if (tool === "web_flow_unschedule") {
        const id = String(args.id || "").trim();
        const p = schedulePath(id);
        if (!existsSync(p)) {
          res.json({ success: true, ok: false, data: { error: `Schedule '${id}' not found. web_flow_schedules lists all.` } });
          return;
        }
        unlinkSync(p);
        const timer = scheduleTimers.get(id);
        if (timer) { clearInterval(timer); scheduleTimers.delete(id); }
        res.json({ success: true, ok: true, data: { unscheduled: id } });
        return;
      }

      // ── Account dashboard: which platform is live in which browser? ──────
      // ── Visual baselines: Playwright toHaveScreenshot parity ─────────────
      if (tool === "web_visual_baseline") {
        const action = String(args.action || "save");
        const BASELINES_DIR = path.join(DATA_DIR, "baselines");

        if (action === "list") {
          const files = existsSync(BASELINES_DIR) ? readdirSync(BASELINES_DIR).filter((f) => f.endsWith(".json")) : [];
          const items = files.map((f) => {
            try { return JSON.parse(readFileSync(path.join(BASELINES_DIR, f), "utf8")); } catch { return { name: f, corrupted: true }; }
          });
          res.json({ success: true, ok: true, data: { baselines: items, count: items.length } });
          return;
        }

        const name = String(args.name || "").trim().replace(/[^a-z0-9_-]+/gi, "_");
        if (!name) {
          res.status(400).json({ success: false, ok: false, error: "web_visual_baseline requires name for " + action + "." });
          return;
        }
        const basePng = path.join(BASELINES_DIR, name + ".png");
        const baseMeta = path.join(BASELINES_DIR, name + ".json");
        if (action === "clear") {
          if (existsSync(basePng)) unlinkSync(basePng);
          if (existsSync(baseMeta)) unlinkSync(baseMeta);
          res.json({ success: true, ok: true, data: { cleared: name } });
          return;
        }
        if (action !== "save" && action !== "compare") {
          res.status(400).json({ success: false, ok: false, error: "Unknown web_visual_baseline action: " + action + ". Supported: save, compare, list, clear." });
          return;
        }

        // Capture the CURRENT viewport as PNG via the extension.
        const targets = registry.listOnline().map((e) => ({ id: e.instanceId, name: e.name }));
        const target = args.__browser
          ? targets.find((t) => t.name === String(args.__browser) || t.id === String(args.__browser)) ?? targets[0]
          : targets[0];
        if (!target) {
          res.status(503).json({ success: false, ok: false, error: "No browser is online." });
          return;
        }
        const timeoutMs = Math.min(Math.max(Number(args.timeoutMs) || 45_000, 5_000), 60_000);
        const shot = await request("web_screenshot", { format: "png", ...(args.tabId ? { tabId: args.tabId } : {}), __browser: target.id }, timeoutMs);
        const shotData = shot.data as { imageDataUrl?: string; url?: string; title?: string } | undefined;
        const dataUrl = shotData?.imageDataUrl ?? "";
        if (!shot.ok || !dataUrl.startsWith("data:image/")) {
          res.json({ success: true, ok: false, data: { error: "Could not capture a PNG screenshot: " + (shot.error ?? "no image") } });
          return;
        }
        const b64png = dataUrl.split(",", 2)[1];

        if (action === "save") {
          mkdirSync(BASELINES_DIR, { recursive: true });
          writeFileSync(basePng, Buffer.from(b64png, "base64"));
          const meta = { name, savedAt: new Date().toISOString(), url: shotData?.url ?? null, title: shotData?.title ?? null, bytes: b64png.length };
          writeFileSync(baseMeta, JSON.stringify(meta, null, 2));
          res.json({ success: true, ok: true, data: { saved: true, name, file: basePng, url: meta.url } });
          return;
        }

        // compare
        const rawThreshold = Number(args.threshold);
        const threshold = Number.isFinite(rawThreshold) ? Math.min(Math.max(rawThreshold, 0), 1) : 0.05;
        if (!existsSync(basePng)) {
          // toHaveScreenshot parity: first run creates the baseline.
          mkdirSync(BASELINES_DIR, { recursive: true });
          writeFileSync(basePng, Buffer.from(b64png, "base64"));
          writeFileSync(baseMeta, JSON.stringify({ name, savedAt: new Date().toISOString(), url: shotData?.url ?? null, title: shotData?.title ?? null, bytes: b64png.length, autoCreated: true }, null, 2));
          res.json({ success: true, ok: true, data: { compared: false, created: true, name, message: "No baseline existed — the current screenshot was saved as the new baseline. Run compare again." } });
          return;
        }
        const baselineDataUrl = "data:image/png;base64," + readFileSync(basePng).toString("base64");
        const diff = await request("web_pixel_diff", { imageA: baselineDataUrl, imageB: dataUrl, threshold, __browser: target.id }, timeoutMs);
        const dd = diff.data as { identical?: boolean; diffPercent?: number; diffImageDataUrl?: string } | undefined;
        if (!diff.ok || !dd) {
          res.json({ success: true, ok: false, data: { error: "pixel diff failed: " + (diff.error ?? "no data") } });
          return;
        }
        const passed = (dd.diffPercent ?? 100) <= threshold * 100;
        let updatedBaseline = false;
        if (args.updateBaseline === true && !passed) {
          writeFileSync(basePng, Buffer.from(b64png, "base64"));
          writeFileSync(baseMeta, JSON.stringify({ name, savedAt: new Date().toISOString(), url: shotData?.url ?? null, title: shotData?.title ?? null, bytes: b64png.length, autoUpdated: true }, null, 2));
          updatedBaseline = true;
        }
        const { diffImageDataUrl: heat, ...diffSummary } = dd;
        res.json({
          success: true, ok: true,
          data: { compared: true, name, passed, threshold, ...diffSummary, heatmap: heat, updatedBaseline },
        });
        return;
      }

      // ── Teach-once-replay: record / replay ──────────────────────────────
      if (tool === "web_record") {
        const action = String(args.action || "start");
        if (action === "start") {
          recorder.active = true;
          recorder.startedAt = new Date().toISOString();
          recorder.steps = [];
          res.json({ success: true, ok: true, data: { recording: true, startedAt: recorder.startedAt, note: "Every web tool call is now captured. web_record {action:'stop'} returns the steps." } });
          return;
        }
        if (action === "stop") {
          recorder.active = false;
          const out: Record<string, unknown> = { recording: false, stepCount: recorder.steps.length, startedAt: recorder.startedAt, steps: recorder.steps };
          if (args.codegen === true || args.format === "flow" || args.format === "playwright") {
            const flow = generateFlow(recorder.steps, String(args.name || "recorded_flow"));
            out.flow = flow;
            out.playwright = generatePlaywright(recorder.steps, String(args.name || "recorded_flow"));
            if (args.saveFlow === true && flow.steps.length) {
              mkdirSync(FLOWS_DIR, { recursive: true });
              writeFileSync(flowPath(flow.name), JSON.stringify(flow, null, 2));
              out.saved = true;
            }
          }
          res.json({ success: true, ok: true, data: out });
          return;
        }
        if (action === "status") {
          res.json({ success: true, ok: true, data: { recording: recorder.active, stepCount: recorder.steps.length, startedAt: recorder.startedAt } });
          return;
        }
        if (action === "codegen") {
          const rawSteps = Array.isArray(args.steps) ? (args.steps as any) : recorder.steps;
          const name = String(args.name || "recorded_flow");
          const flow = generateFlow(rawSteps, name);
          const playwright = generatePlaywright(rawSteps, name);
          let saved = false;
          if (args.saveFlow === true && flow.steps.length) {
            mkdirSync(FLOWS_DIR, { recursive: true });
            writeFileSync(flowPath(flow.name), JSON.stringify(flow, null, 2));
            saved = true;
          }
          res.json({ success: true, ok: true, data: { name: flow.name, stepCount: flow.stepCount, flow, playwright, saved } });
          return;
        }
        res.status(400).json({ success: false, ok: false, error: "Unknown web_record action: " + action + ". Supported: start, stop, status, codegen." });
        return;
      }

      if (tool === "web_replay") {
        const steps = Array.isArray(args.steps) ? (args.steps as Array<{ tool?: string; args?: Record<string, unknown> }>) : [];
        if (!steps.length) {
          res.status(400).json({ success: false, ok: false, error: "web_replay requires steps (the array returned by web_record {action:'stop'} — edit it freely first)." });
          return;
        }
        const stopOnError = args.stopOnError !== false;
        const stepTimeoutMs = Math.min(Math.max(Number(args.stepTimeoutMs) || 45_000, 5_000), 60_000);
        const results: Array<Record<string, unknown>> = [];
        let okAll = true;
        for (let i = 0; i < steps.length; i++) {
          const step = steps[i];
          const stepTool = String(step.tool || "");
          if (!/^web_[a-z0-9_]+$/.test(stepTool)) {
            results.push({ step: i + 1, tool: stepTool, ok: false, error: "invalid tool name" });
            okAll = false;
            if (stopOnError) break;
            continue;
          }
          const stepArgs = substituteTokens(step.args ?? {}, {}, results) as Record<string, unknown>;
          broadcast({ type: "web_replay_step", at: new Date().toISOString(), step: i + 1, of: steps.length, tool: stepTool });
          const r = await request(stepTool, stepArgs, stepTimeoutMs);
          results.push({ step: i + 1, tool: stepTool, ok: r.ok, data: r.data, error: r.error });
          if (!r.ok) {
            okAll = false;
            if (stopOnError) break;
          }
        }
        res.json({ success: true, ok: okAll, data: { total: steps.length, executed: results.length, okAll, results } });
        return;
      }

      // ── Multi-tab orchestration (mirror of web_fanout) ───────────────────
      if (tool === "web_tab_fanout") {
        const innerTool = String(args.tool || "");
        if (!/^web_[a-z0-9_]+$/.test(innerTool)) {
          res.status(400).json({ success: false, ok: false, error: "web_tab_fanout requires tool (a web_* tool to run on each tab)." });
          return;
        }
        const timeoutMs = Math.min(Math.max(Number(args.timeoutMs) || 45_000, 5_000), 60_000);
        const browser = registry.listOnline()[0];
        if (!browser) {
          res.status(503).json({ success: false, ok: false, error: "No browser is online." });
          return;
        }
        const targetId = browser.instanceId;
        const tabsRes = await request("web_tabs", { __browser: targetId }, timeoutMs);
        const tabsRaw = (tabsRes.data as { tabs?: Array<{ tabId: number; url?: string }> } | undefined)?.tabs ?? [];
        const want = args.tabIds;
        let tabs = tabsRaw;
        if (Array.isArray(want)) tabs = tabsRaw.filter((t) => (want as unknown[]).includes(t.tabId));
        else if (args.urls) {
          const needles = Array.isArray(args.urls) ? args.urls.map(String) : String(args.urls).split(",").map((s) => s.trim());
          tabs = tabsRaw.filter((t) => needles.some((n) => (t.url || "").toLowerCase().includes(n.toLowerCase())));
        }
        if (args.activeOnly === true) tabs = tabsRaw.filter((t) => (t as { active?: boolean }).active === true);
        if (!tabs.length) {
          res.json({ success: true, ok: false, data: { results: [], matched: 0, availableTabs: tabsRaw.length } });
          return;
        }
        const { tool: _t, tabIds: _ti, urls: _u, activeOnly: _a, args: innerA, ...rest } = args;
        const innerArgs = { ...rest, ...(innerA && typeof innerA === "object" ? (innerA as Record<string, unknown>) : {}) };
        const results: Array<Record<string, unknown>> = [];
        for (const t of tabs) {
          const r = await request(innerTool, { ...innerArgs, tabId: t.tabId }, timeoutMs);
          results.push({ tabId: t.tabId, url: t.url, ok: r.ok, data: r.data, error: r.error });
        }
        res.json({ success: true, ok: results.every((r) => r.ok), data: { tool: innerTool, matched: tabs.length, results } });
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
      // `route` is decided ONCE and is both the browser judged able to ask and the one request() dispatches to.
      // A route refused while browsers are online is left to the routing refusal below (pick a profile, not
      // update the extension); either way nothing is relayed, so nobody is asked.
      const route = registry.resolveDispatch(args);
      const gate = gateBeforeRelay(tool, args, session);
      if (gate?.block && !humanCanBeAsked(route) && (route.ok || route.onlineProfiles.length === 0)) {
        res.json({ success: false, ok: false, error: gate.message, data: { gate: gate.decision } });
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
      const timeoutMs = Math.min(Math.max(Number(b.timeoutMs) || 45_000, 5_000), 60_000);
      const startedAt = Date.now();
      const result = await request(tool, args, timeoutMs, gate?.block ? gate.decision : undefined, route);
      emitHubEvent("tool", tool, result.ok);
      if (recorder.active && !RECORD_SKIP.has(tool)) {
        recorder.steps.push({ step: recorder.steps.length + 1, tool, args });
      }
      log("INFO", "Web tool round trip", { tool, ok: result.ok, durationMs: Date.now() - startedAt });
      trackToolExecution(tool, args, result, Date.now() - startedAt, session);
      res.json({ success: result.ok, ok: result.ok, data: result.data, error: result.error, ...(gate ? { cognitiveGate: gate.block ? { ...gate.decision, verdict: "asked" } : gate.decision } : {}) });
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
        error?: string;
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
      entry.resolve({ ok: b.ok === true, data: b.data, error: b.error });
      res.json({ success: true });
    });

    frameStore.registerRoutes(app);
  };

  return {
    registerRoutes,
    status,
    armReloadRequested,
    startSchedules,
    stopSchedules,
  };
}
