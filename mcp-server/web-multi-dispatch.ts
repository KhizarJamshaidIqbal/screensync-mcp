// ScreenSync Web Bridge - the calls hub-side tools relay on their own (web_fanout, web_tab_fanout, web_flow_run,
// web_replay, web_visual_baseline).
//
// The tool route makes ONE routing decision per call and uses it for everything that call touches: the approval
// gate and the dispatch. A tool that relays several calls must do the same for each of them. Split out of web.ts,
// which is far over the repo's 500-line limit.

import type { Response } from "express";
import type { DispatchDecision } from "./profile-registry.js";
import { gateBeforeRelay, refusedByGate, type GateDecision } from "./cognitive-policy.js";
import type { WebToolResult } from "./web.js";

type Relay = (tool: string, args: Record<string, unknown>, timeoutMs: number, gate?: GateDecision, decided?: DispatchDecision) => Promise<WebToolResult>;
export type StepResult = WebToolResult & { cognitiveGate?: GateDecision };

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
    return gate ? { ...result, cognitiveGate: gate.block ? { ...gate.decision, verdict: "asked" } : gate.decision } : result;
  };
}
