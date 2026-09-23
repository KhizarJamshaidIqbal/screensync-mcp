// ScreenSync Web Bridge - the calls hub-side tools relay on their own (web_fanout, web_tab_fanout, web_flow_run,
// web_replay, web_visual_baseline).
//
// The tool route makes ONE routing decision per call and uses it for everything that call touches. A tool that
// relays several calls must do the same for each of them. Split out of web.ts, which is far over the repo's
// 500-line limit.

import type { Response } from "express";
import type { DispatchDecision } from "./profile-registry.js";

/** Answers a call whose browser could not be decided, the way the tool route answers any routing refusal. */
export function sendRouteRefusal(res: Response, route: Extract<DispatchDecision, { ok: false }>): void {
  const { status, code, error, onlineProfiles } = route;
  res.status(status).json({ success: false, ok: false, error, code, onlineProfiles, data: { code, onlineProfiles } });
}
