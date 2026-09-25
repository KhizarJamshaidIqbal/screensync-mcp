// ScreenSync Web Bridge - the calls hub-side tools relay on their own (web_fanout, web_tab_fanout, web_flow_run,
// web_replay, web_test_run, web_visual_baseline).
//
// The tool route makes ONE routing decision per call and uses it for everything that call touches: the approval
// gate and the dispatch. A tool that relays several calls must do the same for each of them. Split out of web.ts,
// which is far over the repo's 500-line limit.

import type { Response } from "express";
import type { DispatchDecision } from "./profile-registry.js";
import { gateBeforeRelay, refusedByGate, type GateDecision } from "./cognitive-policy.js";
import type { WebToolResult } from "./web.js";
import { MULTI_STEP_BUDGET_MS, fitStepToBudget } from "./web-timeouts.js";

type Relay = (tool: string, args: Record<string, unknown>, timeoutMs: number, gate?: GateDecision, decided?: DispatchDecision) => Promise<WebToolResult>;
export type StepResult = WebToolResult & { cognitiveGate?: GateDecision };

/** Codes with which the relay refuses a call before anything is sent: nobody was asked about it. */
const NOT_RELAYED_CODES: ReadonlySet<string> = new Set(["BROWSER_STREAM_DOWN"]);

/** Answers a call whose browser could not be decided, the way the tool route answers any routing refusal. */
export function sendRouteRefusal(res: Response, route: Extract<DispatchDecision, { ok: false }>): void {
  const { status, code, error, onlineProfiles } = route;
  res.status(status).json({ success: false, ok: false, error, code, onlineProfiles, data: { code, onlineProfiles } });
}

/**
 * Relays one step of an interactive multi-step tool through the approval logic the tool route applies to a direct
 * call, judged on the step's own dispatch decision (`decided`, else routed like any call): a risky step is put to
 * a person where the browser can ask and refused where it cannot, and a step the gate has nothing to say about is
 * relayed exactly as before. Scheduled runs do not use this: nobody is there to answer a person's prompt.
 */
export function createStepDispatch(resolveDispatch: (args: Record<string, unknown>) => DispatchDecision, relay: Relay) {
  return async (tool: string, args: Record<string, unknown>, timeoutMs: number, session: string, decided?: DispatchDecision): Promise<StepResult> => {
    const route = decided ?? resolveDispatch(args);
    const gate = gateBeforeRelay(tool, args, session);
    if (gate && refusedByGate(gate, route)) return { ok: false, error: gate.message ?? undefined, data: { gate: gate.decision } };
    const result = await relay(tool, args, timeoutMs, gate?.block ? gate.decision : undefined, route);
    if (!gate) return result;
    // "asked" means it was relayed and a person was asked (cognitive-policy.ts); a step the relay refused before
    // sending (unroutable, or its browser's stream is down) keeps the gate's own verdict.
    const relayed = route.ok && !(typeof result.code === "string" && NOT_RELAYED_CODES.has(result.code));
    return { ...result, cognitiveGate: gate.block && relayed ? { ...gate.decision, verdict: "asked" } : gate.decision };
  };
}

type Step = ReturnType<typeof createStepDispatch>;

/** Code of a step that was not started because its multi-step call had used its whole time budget. */
export const CALL_BUDGET_SPENT = "CALL_BUDGET_SPENT";

/**
 * One multi-step call's steps sharing ONE time budget (web-timeouts.ts MULTI_STEP_BUDGET_MS, counted from when
 * this is created): each step waits at most what is left, and once too little is left every further step is
 * answered CALL_BUDGET_SPENT without being relayed, so the call ends before the MCP side stops waiting for it.
 */
export function withCallBudget(step: Step, budgetMs = MULTI_STEP_BUDGET_MS, now: () => number = Date.now): Step {
  const deadline = now() + budgetMs;
  return async (tool, args, timeoutMs, session, decided) => {
    const fitted = fitStepToBudget(tool, args, timeoutMs, deadline - now());
    if (!fitted) {
      return {
        ok: false, code: CALL_BUDGET_SPENT, retryable: false,
        error: `Not run: this multi-step call used its whole time budget (${Math.round(budgetMs / 60_000)} min) on earlier steps, so ${tool} was never sent. Run the remaining steps as a separate call.`,
      };
    }
    return step(tool, fitted.args, fitted.timeoutMs, session, decided);
  };
}
