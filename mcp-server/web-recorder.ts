// ScreenSync Web Bridge - teach-once-replay-anywhere: web_record captures every default-path tool call as
// {tool, args} while active, and web_replay re-executes such a step list (each step through the approval gate).
// Split out of web.ts, which is over the repo's 500-line limit; behaviour is unchanged.

import type { Response } from "express";
import { generateFlow, generatePlaywright } from "./codegen.js";
import type { Broadcast, FlowEngine, GatedStep } from "./web-flows.js";
import { withCallBudget } from "./web-multi-dispatch.js";

export function createRecorder({ flows, gatedStep, broadcast }: { flows: Pick<FlowEngine, "saveFlow" | "substituteTokens">; gatedStep: GatedStep; broadcast: Broadcast }) {
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

  /** Records a default-path tool call while a recording is active. */
  const capture = (tool: string, args: Record<string, unknown>) => {
    if (recorder.active && !RECORD_SKIP.has(tool)) {
      recorder.steps.push({ step: recorder.steps.length + 1, tool, args });
    }
  };

  /** Handles web_record and web_replay. Returns true when the tool was handled (a response was sent). */
  const handleTool = async (tool: string, args: Record<string, unknown>, res: Response, session: string): Promise<boolean> => {
    // ── Teach-once-replay: record / replay ──────────────────────────────
    if (tool === "web_record") {
      const action = String(args.action || "start");
      if (action === "start") {
        recorder.active = true;
        recorder.startedAt = new Date().toISOString();
        recorder.steps = [];
        res.json({ success: true, ok: true, data: { recording: true, startedAt: recorder.startedAt, note: "Every web tool call is now captured. web_record {action:'stop'} returns the steps." } });
        return true;
      }
      if (action === "stop") {
        recorder.active = false;
        const out: Record<string, unknown> = { recording: false, stepCount: recorder.steps.length, startedAt: recorder.startedAt, steps: recorder.steps };
        if (args.codegen === true || args.format === "flow" || args.format === "playwright") {
          const flow = generateFlow(recorder.steps, String(args.name || "recorded_flow"));
          out.flow = flow;
          out.playwright = generatePlaywright(recorder.steps, String(args.name || "recorded_flow"));
          if (args.saveFlow === true && flow.steps.length) {
            flows.saveFlow(flow);
            out.saved = true;
          }
        }
        res.json({ success: true, ok: true, data: out });
        return true;
      }
      if (action === "status") {
        res.json({ success: true, ok: true, data: { recording: recorder.active, stepCount: recorder.steps.length, startedAt: recorder.startedAt } });
        return true;
      }
      if (action === "codegen") {
        const rawSteps = Array.isArray(args.steps) ? (args.steps as any) : recorder.steps;
        const name = String(args.name || "recorded_flow");
        const flow = generateFlow(rawSteps, name);
        const playwright = generatePlaywright(rawSteps, name);
        let saved = false;
        if (args.saveFlow === true && flow.steps.length) {
          flows.saveFlow(flow);
          saved = true;
        }
        res.json({ success: true, ok: true, data: { name: flow.name, stepCount: flow.stepCount, flow, playwright, saved } });
        return true;
      }
      res.status(400).json({ success: false, ok: false, error: "Unknown web_record action: " + action + ". Supported: start, stop, status, codegen." });
      return true;
    }

    if (tool === "web_replay") {
      const steps = Array.isArray(args.steps) ? (args.steps as Array<{ tool?: string; args?: Record<string, unknown> }>) : [];
      if (!steps.length) {
        res.status(400).json({ success: false, ok: false, error: "web_replay requires steps (the array returned by web_record {action:'stop'} — edit it freely first)." });
        return true;
      }
      const stopOnError = args.stopOnError !== false;
      const stepTimeoutMs = Math.min(Math.max(Number(args.stepTimeoutMs) || 45_000, 5_000), 60_000);
      const budgeted = withCallBudget(gatedStep); // every step of this replay shares one time budget (web-timeouts.ts)
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
        const stepArgs = flows.substituteTokens(step.args ?? {}, {}, results) as Record<string, unknown>;
        broadcast({ type: "web_replay_step", at: new Date().toISOString(), step: i + 1, of: steps.length, tool: stepTool });
        const r = await budgeted(stepTool, stepArgs, stepTimeoutMs, session);
        results.push({ step: i + 1, tool: stepTool, ...r });
        if (!r.ok) {
          okAll = false;
          if (stopOnError) break;
        }
      }
      res.json({ success: true, ok: okAll, data: { total: steps.length, executed: results.length, okAll, results } });
      return true;
    }

    return false;
  };

  return { handleTool, capture };
}
