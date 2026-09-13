import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Express, Request, Response } from "express";
import { DATA_DIR, isAuthorized, log } from "./config.js";
import { emitHubEvent, lastEventSeq, recentHubEvents } from "./events.js";
import { createFrameStore } from "./web-frame.js";
import { executeParallelHarvest, executeSessionVault, type HarvestTarget } from "./web-harvest-hub.js";

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
  armReloadRequested: () => void;
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

export function createWebBridge(broadcast: (payload: object, name?: string) => void): WebBridge {
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
    "web_fanout", "web_tab_fanout", "web_session_transfer", "web_route_for",
    "web_parallel_harvest", "web_session_vault",
  ]);

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
        if (!/^web_[a-z_]+$/.test(stepTool)) {
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
    // Reload schedules from disk on hub boot.
    for (const s of loadSchedules()) {
      const sched = s as { id?: string; everyMinutes?: number };
      if (sched.id && Number.isFinite(sched.everyMinutes)) startScheduleTimer(sched as { id: string; everyMinutes: number });
    }

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
      // ── Hub-side multi-browser orchestration ─────────────────────────────
      // These run ONE tool on N browsers by issuing sequential per-browser
      // requests (each extension self-filters via args.__browser) and merging.
      const resolveTargets = (): Array<{ id: string; name: string }> => {
        const online = onlineEntries().map((e) => {
          const id = [...browsers.entries()].find(([, v]) => v === e)?.[0] ?? "default";
          return { id, name: e.name };
        });
        const want = args.browsers;
        if (!want || want === "all") return online;
        const list = Array.isArray(want) ? want.map(String) : String(want).split(",").map((s) => s.trim());
        return online.filter((t) => list.includes(t.name) || list.includes(t.id));
      };
      const callOn = (target: { id: string; name: string }, innerTool: string, innerArgs: Record<string, unknown>, timeoutMs: number): Promise<WebToolResult> =>
        request(innerTool, { ...innerArgs, __browser: target.id }, timeoutMs);

      if (tool === "web_fanout") {
        const innerTool = String(args.tool || "");
        if (!/^web_[a-z_]+$/.test(innerTool)) {
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

      if (tool === "web_session_transfer") {
        const domain = String(args.domain || "").trim();
        if (!domain) {
          res.status(400).json({ success: false, ok: false, error: "web_session_transfer requires domain (e.g. 'linkedin.com')." });
          return;
        }
        const targets = resolveTargets();
        if (targets.length < 2) {
          res.json({ success: true, ok: false, data: { error: `web_session_transfer needs at least 2 connected browsers (from + to). Connected: ${targets.map((t) => t.name).join(", ") || "none"}. Pair another browser (Edge/Brave/second Chrome profile) to sync sessions.` } });
          return;
        }
        const from = args.from ? targets.find((t) => t.name === String(args.from) || t.id === String(args.from)) : targets[0];
        const to = args.to ? targets.find((t) => t.name === String(args.to) || t.id === String(args.to)) : targets.find((t) => t !== from);
        if (!from || !to || from === to) {
          res.json({ success: true, ok: false, data: { error: `Could not resolve from/to. Connected: ${targets.map((t) => `${t.name}(${t.id.slice(0, 8)})`).join(", ")}. Use install ids when several browsers share a name.` } });
          return;
        }
        const timeoutMs = Math.min(Math.max(Number(args.timeoutMs) || 45_000, 5_000), 60_000);
        const exported = await callOn(from, "web_session_export", { domain, localStorage: args.localStorage !== false }, timeoutMs);
        if (!exported.ok) {
          res.json({ success: true, ok: false, data: { from: from.name, to: to.name, domain, error: `export failed on ${from.name}: ${exported.error}` } });
          return;
        }
        const ed = exported.data as { cookieCount?: number; cookies?: unknown[]; localStorage?: Record<string, unknown>; note?: string } | undefined;
        if (!ed?.cookies?.length) {
          res.json({ success: true, ok: false, data: { from: from.name, to: to.name, domain, cookieCount: 0, error: `No session cookies for ${domain} in ${from.name} — likely not logged in there.`, note: ed?.note } });
          return;
        }
        const imported = await callOn(to, "web_session_import", { session: ed }, timeoutMs);
        res.json({
          success: true, ok: imported.ok,
          data: {
            from: from.name, fromId: from.id, to: to.name, toId: to.id,
            domain, cookieCount: ed.cookieCount, localStorageKeys: Object.keys(ed.localStorage || {}).length,
            import: imported.data ?? imported.error,
          },
        });
        return;
      }

      if (tool === "web_route_for") {
        const domain = String(args.domain || String(args.url || "")).replace(/^https?:\/\//, "").split("/")[0].trim();
        if (!domain) {
          res.status(400).json({ success: false, ok: false, error: "web_route_for requires domain or url." });
          return;
        }
        const targets = resolveTargets();
        const timeoutMs = Math.min(Math.max(Number(args.timeoutMs) || 30_000, 5_000), 60_000);
        const probes: Array<Record<string, unknown>> = [];
        for (const target of targets) {
          const r = await callOn(target, "web_profile_sync", { domain }, timeoutMs);
          const d = r.data as { customDomain?: { cookieCount?: number; cookies?: Array<{ name?: string }> } } | undefined;
          const cd = d?.customDomain;
          const authish = (cd?.cookies || []).some((c) => /sess|auth|token|sid|login|jwt/i.test(String(c.name || "")));
          probes.push({
            browser: target.name, browserId: target.id,
            reachable: r.ok, cookieCount: cd?.cookieCount ?? 0,
            authLikeCookies: authish,
            recommended: r.ok && (cd?.cookieCount ?? 0) > 0 && authish,
          });
        }
        const best = probes.filter((p) => p.recommended) ?? [];
        const recommended = best.length
          ? (best.sort((a, b) => Number(b.cookieCount) - Number(a.cookieCount))[0])
          : (probes.find((p) => Number(p.cookieCount) > 0) ?? probes[0] ?? null);
        res.json({ success: true, ok: true, data: { domain, recommended: recommended ? { browser: recommended.browser, browserId: recommended.browserId, cookieCount: recommended.cookieCount, authLikeCookies: recommended.authLikeCookies } : null, browsers: probes } });
        return;
      }

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
        const targets = onlineEntries().map((e) => {
          const id = [...browsers.entries()].find(([, v]) => v === e)?.[0] ?? "default";
          return { id, name: e.name };
        });
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
        const diff = await request("web_pixel_diff", { imageA: baselineDataUrl, imageB: dataUrl, threshold }, timeoutMs);
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
      if (tool === "web_account_report") {
        const targets = onlineEntries().map((e) => {
          const id = [...browsers.entries()].find(([, v]) => v === e)?.[0] ?? "default";
          return { id, name: e.name };
        });
        const timeoutMs = Math.min(Math.max(Number(args.timeoutMs) || 45_000, 5_000), 60_000);
        const accounts: Array<Record<string, unknown>> = [];
        for (const target of targets) {
          const r = await request("web_social_matrix", { __browser: target.id }, timeoutMs);
          const d = r.data as { platforms?: Array<Record<string, unknown>> } | undefined;
          const platforms = Array.isArray(d?.platforms) ? d?.platforms : [];
          for (const p of platforms) {
            accounts.push({ browser: target.name, browserId: target.id, ...p });
          }
        }
        const live = accounts.filter((a) => a.authenticated === true);
        res.json({
          success: true, ok: true,
          data: {
            browsersProbed: targets.length,
            liveAccounts: live.length,
            accounts,
            summary: live.map((a) => `${String(a.platform)} @ ${String(a.browser)}`),
          },
        });
        return;
      }

      if (tool === "web_session_vault") {
        const timeoutMs = Math.min(Math.max(Number(args.timeoutMs) || 45_000, 5_000), 60_000);
        const action = String(args.action || "list");
        const vaultRes = await executeSessionVault(action, args, request, broadcast, timeoutMs);
        res.json({ success: vaultRes.ok, ok: vaultRes.ok, data: vaultRes.data, error: vaultRes.error });
        return;
      }

      if (tool === "web_parallel_harvest") {
        const timeoutMs = Math.min(Math.max(Number(args.timeoutMs) || 60_000, 10_000), 120_000);
        const concurrency = Number(args.concurrency) || 3;
        const targets = Array.isArray(args.targets) ? (args.targets as HarvestTarget[]) : [];
        if (targets.length === 0) {
          res.status(400).json({ success: false, ok: false, error: "web_parallel_harvest requires a non-empty 'targets' array." });
          return;
        }
        const harvestRes = await executeParallelHarvest(targets, request, broadcast, timeoutMs, concurrency);
        res.json({ success: harvestRes.success, ok: harvestRes.success, data: harvestRes });
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
          res.json({ success: true, ok: true, data: { recording: false, stepCount: recorder.steps.length, startedAt: recorder.startedAt, steps: recorder.steps } });
          return;
        }
        if (action === "status") {
          res.json({ success: true, ok: true, data: { recording: recorder.active, stepCount: recorder.steps.length, startedAt: recorder.startedAt } });
          return;
        }
        res.status(400).json({ success: false, ok: false, error: "Unknown web_record action: " + action + ". Supported: start, stop, status." });
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
          if (!/^web_[a-z_]+$/.test(stepTool)) {
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
        if (!/^web_[a-z_]+$/.test(innerTool)) {
          res.status(400).json({ success: false, ok: false, error: "web_tab_fanout requires tool (a web_* tool to run on each tab)." });
          return;
        }
        const timeoutMs = Math.min(Math.max(Number(args.timeoutMs) || 45_000, 5_000), 60_000);
        const browser = onlineEntries()[0];
        if (!browser) {
          res.status(503).json({ success: false, ok: false, error: "No browser is online." });
          return;
        }
        const targetId = [...browsers.entries()].find(([, v]) => v === browser)?.[0] ?? "default";
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
      if (recorder.active && !RECORD_SKIP.has(tool)) {
        recorder.steps.push({ step: recorder.steps.length + 1, tool, args });
      }
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

  return {
    registerRoutes,
    status,
    armReloadRequested,
    stopSchedules: () => {
      for (const timer of scheduleTimers.values()) clearInterval(timer);
      scheduleTimers.clear();
    },
  };
}
