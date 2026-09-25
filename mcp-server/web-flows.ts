// ScreenSync Web Bridge - the persisted flows library (web_flow_save / list / run / delete), the test runner
// (web_test_run) and the hub-side schedules that run saved flows on an interval (web_flow_schedule / schedules /
// unschedule). Split out of web.ts, which is over the repo's 500-line limit; behaviour is unchanged.

import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Response } from "express";
import { DATA_DIR, log } from "./config.js";
import { withCallBudget, type createStepDispatch, type StepResult } from "./web-multi-dispatch.js";

/** The one relay every hub-side call passes through (web.ts request()). */
export type WebRelay = Parameters<typeof createStepDispatch>[1];
/** A relayed step that meets the approval gate like a direct call (web-multi-dispatch.ts). */
export type GatedStep = ReturnType<typeof createStepDispatch>;
export type Broadcast = (payload: object, name?: string) => void;

type FlowStep = { tool?: string; args?: Record<string, unknown> };
type SavedFlow = { name: string; steps: FlowStep[] };

export type FlowEngine = ReturnType<typeof createFlowEngine>;

export function createFlowEngine({ broadcast, request, gatedStep }: { broadcast: Broadcast; request: WebRelay; gatedStep: GatedStep }) {
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
  /** Writes a flow under DATA_DIR/flows (named by flow.name) and returns the file path. */
  const saveFlow = (flow: { name: string }): string => {
    mkdirSync(FLOWS_DIR, { recursive: true });
    const file = flowPath(flow.name);
    writeFileSync(file, JSON.stringify(flow, null, 2));
    return file;
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

  const executeFlow = async (
    flow: SavedFlow,
    vars: Record<string, string>,
    stopOnError: boolean,
    stepTimeoutMs: number,
    send: (tool: string, args: Record<string, unknown>, timeoutMs: number) => Promise<StepResult> = request,
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
      const r = await send(stepTool, stepArgs, stepTimeoutMs);
      results.push({ step: i + 1, tool: stepTool, ...r });
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

  /** Handles the flow, test-run and schedule tools. Returns true when the tool was handled (a response was sent). */
  const handleTool = async (tool: string, args: Record<string, unknown>, res: Response, session: string): Promise<boolean> => {
    if (tool === "web_flow_save") {
      const name = String(args.name || "").trim();
      const steps = Array.isArray(args.steps) ? (args.steps as Array<{ tool?: string; args?: Record<string, unknown> }>) : [];
      if (!name || !steps.length) {
        res.status(400).json({ success: false, ok: false, error: "web_flow_save requires name and steps (from web_record {action:'stop'} — edit freely, use {{var}} placeholders)." });
        return true;
      }
      const flow = { name, savedAt: new Date().toISOString(), stepCount: steps.length, steps };
      const file = saveFlow(flow);
      log("INFO", "Flow saved", { name, stepCount: steps.length });
      res.json({ success: true, ok: true, data: { saved: true, name, stepCount: steps.length, file } });
      return true;
    }

    if (tool === "web_flow_list") {
      if (!existsSync(FLOWS_DIR)) {
        res.json({ success: true, ok: true, data: { flows: [], note: "No flows saved yet — record with web_record, then web_flow_save." } });
        return true;
      }
      const files = readdirSync(FLOWS_DIR).filter((f) => f.endsWith(".json"));
      const flows = files.map((f) => {
        try {
          const parsed = JSON.parse(readFileSync(path.join(FLOWS_DIR, f), "utf8"));
          return { name: parsed.name ?? f.replace(/\.json$/, ""), savedAt: parsed.savedAt, stepCount: parsed.stepCount, tools: (parsed.steps || []).map((s: { tool?: string }) => s.tool) };
        } catch { return { name: f, corrupted: true }; }
      });
      res.json({ success: true, ok: true, data: { flows } });
      return true;
    }

    if (tool === "web_flow_run") {
      const name = String(args.name || "").trim();
      const flow = loadFlow(name);
      if (!flow || !Array.isArray(flow.steps)) {
        res.json({ success: true, ok: false, data: { error: `Flow '${name}' not found. web_flow_list shows saved flows.` } });
        return true;
      }
      const vars = (args.vars && typeof args.vars === "object" ? args.vars : {}) as Record<string, string>;
      const stopOnError = args.stopOnError !== false;
      const stepTimeoutMs = Math.min(Math.max(Number(args.stepTimeoutMs) || 45_000, 5_000), 60_000);
      const budgeted = withCallBudget(gatedStep); // every step of this run shares one time budget (web-timeouts.ts)
      const run = await executeFlow(flow, vars, stopOnError, stepTimeoutMs, (t, a, ms) => budgeted(t, a, ms, session));
      res.json({ success: true, ok: run.okAll, data: { flow: flow.name, vars: Object.keys(vars), total: flow.steps.length, executed: run.executed, okAll: run.okAll, results: run.results } });
      return true;
    }

    if (tool === "web_flow_delete") {
      const name = String(args.name || "").trim();
      const p = flowPath(name);
      if (!existsSync(p)) {
        res.json({ success: true, ok: false, data: { error: `Flow '${name}' not found.` } });
        return true;
      }
      unlinkSync(p);
      res.json({ success: true, ok: true, data: { deleted: name } });
      return true;
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
        return true;
      }

      for (const tc of suiteDef.tests) {
        if (!tc.steps && tc.flow) {
          const f = loadFlow(tc.flow);
          if (f && Array.isArray(f.steps)) tc.steps = f.steps;
        }
      }

      // Each step meets the approval gate and is attributed to the calling session, like web_flow_run's steps: a
      // destructive click refused as a direct call must not run unasked because it was wrapped in a test.
      // Every step of every test (retries included) shares one time budget (web-timeouts.ts).
      const budgeted = withCallBudget(gatedStep);
      const runnerCallback = async (stepTool: string, stepArgs: Record<string, unknown>) => {
        return await budgeted(stepTool, stepArgs, 45_000, session);
      };

      const { runTestSuite } = await import("./test-runner.js");
      const result = await runTestSuite(suiteDef, runnerCallback);
      res.json({ success: true, ok: result.failed === 0, data: result });
      return true;
    }

    // ── Flow Schedules: the hub itself runs saved flows on an interval ────
    if (tool === "web_flow_schedule") {
      const flowName = String(args.flow || args.name || "").trim();
      const flow = loadFlow(flowName);
      if (!flow || !Array.isArray(flow.steps)) {
        res.json({ success: true, ok: false, data: { error: `Flow '${flowName}' not found. Save it first with web_flow_save.` } });
        return true;
      }
      const everyMinutes = Number(args.everyMinutes);
      if (!Number.isFinite(everyMinutes) || everyMinutes < 0.05) {
        res.status(400).json({ success: false, ok: false, error: "web_flow_schedule requires everyMinutes (minimum 0.05 = every 3 seconds; use ≥1440 for daily)." });
        return true;
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
      return true;
    }

    if (tool === "web_flow_schedules") {
      const all = loadSchedules().map((s) => ({
        id: s.id, flow: s.flow, everyMinutes: s.everyMinutes, vars: Object.keys(s.vars || {}),
        createdAt: s.createdAt, lastRunAt: s.lastRunAt ?? null, lastRunOk: s.lastRunOk ?? null, lastRunExecuted: s.lastRunExecuted ?? null,
      }));
      res.json({ success: true, ok: true, data: { schedules: all, count: all.length } });
      return true;
    }

    if (tool === "web_flow_unschedule") {
      const id = String(args.id || "").trim();
      const p = schedulePath(id);
      if (!existsSync(p)) {
        res.json({ success: true, ok: false, data: { error: `Schedule '${id}' not found. web_flow_schedules lists all.` } });
        return true;
      }
      unlinkSync(p);
      const timer = scheduleTimers.get(id);
      if (timer) { clearInterval(timer); scheduleTimers.delete(id); }
      res.json({ success: true, ok: true, data: { unscheduled: id } });
      return true;
    }

    return false;
  };

  return { handleTool, startSchedules, stopSchedules, substituteTokens, saveFlow };
}
