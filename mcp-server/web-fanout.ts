// ScreenSync Web Bridge - hub-side multi-browser and multi-tab orchestration: web_fanout runs ONE tool on N
// browsers, web_tab_fanout runs it on N tabs of one browser, each call pinned to its target and merged. Split out
// of web.ts, which is over the repo's 500-line limit; behaviour is unchanged.

import type { Response } from "express";
import type { BrowserInstance, createProfileRegistry } from "./profile-registry.js";
import { sendRouteRefusal } from "./web-multi-dispatch.js";
import type { GatedStep, WebRelay } from "./web-flows.js";

type Registry = ReturnType<typeof createProfileRegistry>;

export function createFanout({ registry, request, gatedStep }: { registry: Registry; request: WebRelay; gatedStep: GatedStep }) {
  // ── Hub-side multi-browser orchestration ─────────────────────────────
  // These run ONE tool on N browsers by issuing sequential per-browser
  // requests, each pinned to its browser (registry.planFanout), and merging.
  const resolveTargets = (args: Record<string, unknown>): BrowserInstance[] => {
    const online = registry.listOnline();
    const want = args.browsers;
    if (!want || want === "all") return online;
    const list = Array.isArray(want) ? want.map(String) : String(want).split(",").map((s) => s.trim());
    return online.filter((t) => list.includes(t.name) || list.includes(t.instanceId) || (t.profileEmail && list.includes(t.profileEmail)));
  };

  /** Handles one web_fanout call; always sends a response. */
  const fanout = async (args: Record<string, unknown>, res: Response, session: string): Promise<void> => {
    const innerTool = String(args.tool || "");
    if (!/^web_[a-z0-9_]+$/.test(innerTool)) {
      res.status(400).json({ success: false, ok: false, error: "web_fanout requires tool (a web_* tool to run on each browser)." });
      return;
    }
    const targets = resolveTargets(args);
    if (!targets.length) {
      res.json({ success: true, ok: false, data: { results: [], matched: 0, error: "No connected browser matches the requested set." } });
      return;
    }
    const timeoutMs = Math.min(Math.max(Number(args.timeoutMs) || 45_000, 5_000), 60_000);
    const { browsers: _omit, tool: _t, args: innerA, ...rest } = args;
    // The agent passes tool args nested under `args`; forward them as the
    // actual tool arguments (falling back to top-level extras).
    const innerArgs = { ...rest, ...(innerA && typeof innerA === "object" ? (innerA as Record<string, unknown>) : {}) };
    // Each pass carries its own browser's decision: no hint or tab id in innerArgs can send it elsewhere.
    const plan = registry.planFanout(targets, innerArgs);
    if (!plan.ok) { sendRouteRefusal(res, plan); return; }
    const results: Array<Record<string, unknown>> = [];
    for (const { target, decision, skipped } of plan.passes) {
      const who = { browser: target.name, browserId: target.instanceId };
      if (skipped || !decision) { results.push({ ...who, ok: false, skipped: true, reason: skipped }); continue; }
      results.push({ ...who, ...(await gatedStep(innerTool, innerArgs, timeoutMs, session, decision)) });
    }
    const ran = results.filter((r) => !r.skipped);
    res.json({ success: true, ok: ran.length > 0 && ran.every((r) => r.ok), data: { tool: innerTool, matched: targets.length, ran: ran.length, results } });
  };

  // ── Multi-tab orchestration (mirror of web_fanout) ───────────────────
  /** Handles one web_tab_fanout call; always sends a response. */
  const tabFanout = async (args: Record<string, unknown>, res: Response, session: string): Promise<void> => {
    const innerTool = String(args.tool || "");
    if (!/^web_[a-z0-9_]+$/.test(innerTool)) {
      res.status(400).json({ success: false, ok: false, error: "web_tab_fanout requires tool (a web_* tool to run on each tab)." });
      return;
    }
    const timeoutMs = Math.min(Math.max(Number(args.timeoutMs) || 45_000, 5_000), 60_000);
    const { tool: _t, tabIds: _ti, urls: _u, activeOnly: _a, args: innerA, ...rest } = args;
    const innerArgs = { ...rest, ...(innerA && typeof innerA === "object" ? (innerA as Record<string, unknown>) : {}) };
    // ONE browser, routed like any call (never "whoever heartbeated last"), lists the tabs AND runs every per-tab
    // call: a tab id means nothing outside the browser that reported it. The per-tab tabId routes nothing here.
    const route = registry.resolveDispatch({ ...innerArgs, tabId: undefined });
    if (!route.ok) {
      const { status: httpStatus, code, error, onlineProfiles } = route;
      res.status(httpStatus).json({ success: false, ok: false, error, code, onlineProfiles, data: { code, onlineProfiles } });
      return;
    }
    const from = { instanceId: route.target.instanceId, profile: route.target.profileEmail ?? route.target.profileName };
    const tabsRes = await request("web_tabs", {}, timeoutMs, undefined, route);
    const tabsRaw = (tabsRes.data as { tabs?: Array<{ tabId: number; url?: string }> } | undefined)?.tabs ?? [];
    const want = args.tabIds;
    let tabs = tabsRaw;
    if (Array.isArray(want)) tabs = tabsRaw.filter((t) => (want as unknown[]).includes(t.tabId));
    else if (args.urls) {
      const needles = Array.isArray(args.urls) ? args.urls.map(String) : String(args.urls).split(",").map((s) => s.trim());
      tabs = tabsRaw.filter((t) => needles.some((n) => (t.url || "").toLowerCase().includes(n.toLowerCase())));
    }
    if (args.activeOnly === true) tabs = tabs.filter((t) => (t as { active?: boolean }).active === true); // AND, not instead
    if (!tabs.length) {
      res.json({ success: true, ok: false, error: tabsRes.ok ? undefined : tabsRes.error, data: { ...from, results: [], matched: 0, availableTabs: tabsRaw.length } });
      return;
    }
    const results: Array<Record<string, unknown>> = [];
    for (const t of tabs) {
      results.push({ tabId: t.tabId, url: t.url, ...(await gatedStep(innerTool, { ...innerArgs, tabId: t.tabId }, timeoutMs, session, route)) });
    }
    res.json({ success: true, ok: results.every((r) => r.ok), data: { tool: innerTool, ...from, matched: tabs.length, results } });
  };

  return { fanout, tabFanout };
}
