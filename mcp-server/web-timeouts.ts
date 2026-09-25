// How long the hub (and the MCP side in front of it) waits for one relayed web_* call.
//
// The hub used to clamp every call to 5-65s. That is right for an ordinary tool, but three tools wait for
// something the browser cannot hurry: a person taking over the tab (web_takeover, up to 10 min), a person
// answering a help request (web_request_help, up to 10 min) and a download finishing (web_wait_download, up
// to 2 min). Their catalog entries advertise those budgets, the extension honours them, and the hub gave up
// at 65s anyway, answering TIMEOUT while the person was still logging in. No imports: hub-web-call.ts (the MCP
// process) and web.ts (the hub) both read it.

export type LongWait = { defaultMs: number; maxMs: number };

/** Tools whose own args.timeoutMs budget may exceed the ordinary clamp, with the catalog's default and maximum. */
export const LONG_WAIT_TOOLS: Readonly<Record<string, LongWait>> = Object.freeze({
  web_takeover: { defaultMs: 300_000, maxMs: 600_000 },
  web_request_help: { defaultMs: 120_000, maxMs: 600_000 },
  web_wait_download: { defaultMs: 30_000, maxMs: 120_000 },
});

/** Room after a long tool's own budget runs out, for the extension's answer (e.g. TAKEOVER_TIMEOUT) to arrive. */
export const LONG_WAIT_MARGIN_MS = 5_000;

/** The ordinary clamp, unchanged: 45s by default, never under 5s, never over 65s (a 60s budget + 5s margin). */
export const HUB_DEFAULT_WAIT_MS = 45_000;
export const HUB_MIN_WAIT_MS = 5_000;
export const HUB_MAX_WAIT_MS = 65_000;

const positive = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
};

/** The browser-side budget of a long tool (its args.timeoutMs, else its default, capped at its max); null otherwise. */
export function longWaitBudgetMs(tool: string | undefined, requested: unknown): number | null {
  const long = tool ? LONG_WAIT_TOOLS[tool] : undefined;
  if (!long) return null;
  return Math.min(positive(requested) ?? long.defaultMs, long.maxMs);
}

/**
 * How long the hub holds one call. For a long tool `requested` is the tool's own budget (args.timeoutMs) and the
 * hub waits that plus LONG_WAIT_MARGIN_MS; for every other tool `requested` is the caller's per-call timeout
 * (the /api/web/tool body's timeoutMs), clamped to 5-65s exactly as before.
 */
export function hubWaitMs(tool: string, requested: unknown): number {
  const budget = longWaitBudgetMs(tool, requested);
  if (budget !== null) return budget + LONG_WAIT_MARGIN_MS;
  return Math.min(Math.max(positive(requested) ?? HUB_DEFAULT_WAIT_MS, HUB_MIN_WAIT_MS), HUB_MAX_WAIT_MS);
}

/**
 * The hub's wait for ONE relayed call, whatever relays it (the tool route, web_flow_run, web_replay, web_fanout,
 * web_tab_fanout, web_test_run, schedules): a long-wait tool never waits less than its own budget (hubWaitMs), even
 * when the relay clamps its steps to 5-60s. Otherwise a web_takeover step in a flow was answered TIMEOUT after at
 * most 60s while the person was still logging in, and the flow went on without them. Every other tool keeps the
 * relay's own timeout.
 */
export function stepWaitMs(tool: string, args: Record<string, unknown> | undefined, stepTimeoutMs: number): number {
  return LONG_WAIT_TOOLS[tool] ? Math.max(stepTimeoutMs, hubWaitMs(tool, args?.timeoutMs)) : stepTimeoutMs;
}

/** Hub tools that relay other web_* calls as their steps, so one of those steps may be a long wait. */
export const MULTI_STEP_TOOLS: ReadonlySet<string> = new Set(["web_flow_run", "web_replay", "web_fanout", "web_tab_fanout", "web_test_run"]);

/** The longest a single relayed step can hold the hub: the largest long-wait maximum plus its margin. */
export const LONGEST_STEP_WAIT_MS = Math.max(...Object.values(LONG_WAIT_TOOLS).map((l) => l.maxMs)) + LONG_WAIT_MARGIN_MS;
