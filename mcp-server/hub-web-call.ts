// ScreenSync MCP -> hub round trip for web_* tools, and what its failures mean.
//
// Split out of mcp.ts, which reported EVERY fetch failure as "ScreenSync hub is not reachable ... Start the hub".
// The live case was a timeout: the extension had asked a person to approve the call and told the hub to keep
// waiting (the approval window + 20s), but this side aborted its own request after the ordinary call timeout
// + 5s and said the hub was down, while web_status answered fine. Now:
//   - the request is allowed to live as long as the hub may hold a call (APPROVAL_MAX_MS + run headroom), so the
//     extension's real outcome arrives: APPROVAL_TIMEOUT or USER_DECLINED, with its code;
//   - a timeout is reported as a timeout ("the browser didn't answer ... maybe waiting for your approval");
//   - only a refused connection or an unknown host says the hub is not reachable.

import { randomUUID } from "node:crypto";
import { AUTH_TOKEN, HTTP_PORT, hubSelfCheck } from "./config.js";
import { APPROVAL_MAX_MS, APPROVAL_RUN_HEADROOM_MS } from "./web-ext-routes.js";
import { MULTI_STEP_BUDGET_MS, MULTI_STEP_TOOLS, longWaitBudgetMs } from "./web-timeouts.js";

export type HubWebResult = { ok: boolean; data?: unknown; error?: string; code?: string; retryable?: boolean };

/** One id per MCP process, so the hub can tell distinct agent sessions apart (competence needs several). */
export const SESSION_ID = `mcp-${randomUUID()}`;

/** The longest the hub holds one call: a person being asked for up to APPROVAL_MAX_MS, then the action itself. */
export const HUB_MAX_HOLD_MS = APPROVAL_MAX_MS + APPROVAL_RUN_HEADROOM_MS;
const TRANSPORT_MARGIN_MS = 10_000;
const DEFAULT_CALL_TIMEOUT_MS = 45_000;
/**
 * An args.timeoutMs is the browser-side budget of the tool itself (web_expect polls for it, web_wait_for waits
 * for it). The hub used to wait EXACTLY that long, so an assertion that ran its whole budget never got its own
 * answer back ("expected X, got Y"): the hub gave up first with "Timed out ... waiting for the browser
 * extension" (seen live 2026-09-23, web_expect {timeoutMs:25000}). The hub now waits the budget plus this.
 */
export const IN_PAGE_MARGIN_MS = 5_000;

/**
 * The per-call timeout sent to the hub (the hub clamps it to its own 5-65s range). A long-wait tool
 * (web-timeouts.ts: web_takeover, web_request_help, web_wait_download) waits its own budget plus the margin,
 * up to its catalog maximum, instead of being cut at 120s. `tool` is optional: without it, the ordinary rule.
 */
export function callTimeoutOf(args: Record<string, unknown>, tool?: string): number {
  const long = longWaitBudgetMs(tool, args.timeoutMs);
  if (long !== null) return long + IN_PAGE_MARGIN_MS;
  const requested = Number(args.timeoutMs);
  return Number.isFinite(requested) && requested > 0
    ? Math.min(Math.max(requested, 1000) + IN_PAGE_MARGIN_MS, 120_000)
    : DEFAULT_CALL_TIMEOUT_MS;
}

/**
 * How long this side waits for the hub's HTTP answer. Never shorter than the hub may legitimately hold the call
 * (a person being asked), or the transport gives up first and the real outcome is lost.
 */
export function transportTimeoutMs(callTimeoutMs: number, tool?: string): number {
  // A multi-step tool (web_flow_run, web_replay, web_fanout, ...) holds the hub for at most its call budget
  // (web-timeouts.ts: no step starts once it is spent), and a person asked about its last step may add up to one
  // approval hold (HUB_MAX_HOLD_MS) on top.
  const floor = tool && MULTI_STEP_TOOLS.has(tool) ? MULTI_STEP_BUDGET_MS + HUB_MAX_HOLD_MS : HUB_MAX_HOLD_MS;
  return Math.max(callTimeoutMs, floor) + TRANSPORT_MARGIN_MS;
}

/** No hub is listening (or the name does not resolve): the only case that means "start the hub". */
const UNREACHABLE = new Set(["ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "EHOSTUNREACH", "ENETUNREACH", "EADDRNOTAVAIL", "UND_ERR_CONNECT_TIMEOUT"]);
/** The hub took the call and the connection then dropped: it crashed or restarted mid-call. */
const DROPPED = new Set(["ECONNRESET", "EPIPE", "UND_ERR_SOCKET", "UND_ERR_CLOSED"]);

function errorCode(error: unknown): string {
  const e = error as { code?: unknown; cause?: { code?: unknown; errors?: Array<{ code?: unknown }> } } | null;
  const code = e?.cause?.code ?? e?.code ?? e?.cause?.errors?.[0]?.code;
  return typeof code === "string" ? code : "";
}

const isTimeout = (error: unknown): boolean => {
  const name = (error as { name?: unknown } | null)?.name;
  return name === "TimeoutError" || name === "AbortError";
};

/** Turns a failed round trip into what it means, with a code the caller can act on. */
export function describeHubFailure(error: unknown, url: string, waitedMs: number): { error: string; code: string } {
  const code = errorCode(error);
  if (isTimeout(error)) {
    const s = Math.max(1, Math.round(waitedMs / 1000));
    return {
      code: "TIMEOUT",
      error: `The browser didn't answer within ${s}s — it may be waiting for your approval in ScreenSync (check the popup/notification), or the page is busy. The hub is up (a hub that is down refuses the connection at once), so do not restart it; check web_status / web_events, then retry once the approval is answered.`,
    };
  }
  if (DROPPED.has(code)) {
    return {
      code: "HUB_CONNECTION_LOST",
      error: `The ScreenSync hub at ${url} closed the connection while the call was running (${code}); it may have restarted. Check web_status, and web_events to see whether the action ran, before retrying.`,
    };
  }
  return {
    code: "HUB_UNREACHABLE",
    error: `ScreenSync hub is not reachable at ${url} (${code || String(error)}). Start the hub with 'npm start' and make sure the browser extension is connected.`,
  };
}

/** Quick, single-shot check that a real ScreenSync hub (not some unrelated service) answers at `baseUrl`. */
async function isRealHub(baseUrl: string): Promise<boolean> {
  try {
    const res = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(1500) });
    if (!res.ok) return false;
    const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    return body?.service === "screensync-hub";
  } catch {
    return false;
  }
}

/**
 * Round-trips a web_* tool through the HTTP hub, which relays it over SSE to the ScreenSync browser extension.
 * Goes through HTTP (not in-process calls) so it also works when this stdio server runs MCP-only beside another
 * hub instance. `opts` is for tests.
 */
export async function callHubWebTool(
  tool: string,
  args: Record<string, unknown>,
  opts: { baseUrl?: string; token?: string; transportTimeoutMs?: number } = {},
): Promise<HubWebResult> {
  const baseUrl = opts.baseUrl ?? `http://127.0.0.1:${HTTP_PORT}`;
  const url = `${baseUrl}/api/web/tool`;

  // Fail fast + self-heal: this process's own startHttpHub() found a non-ScreenSync service squatting on the
  // port (index.ts). Every previous version of this function would still round-trip the full call to that
  // service anyway, wait out the whole 45s-2min timeout, and report its accidental reply as an opaque
  // "Hub replied 404" — repeatable forever, with nothing pointing at the real cause (this was observed live:
  // web_status and web_navigate both failed identically for 20+ minutes of retries). Re-probe /health first:
  // if a real hub is reachable now (the conflicting process was closed, or the hub was restarted on this port),
  // recover automatically with no restart needed; otherwise say so immediately instead of doing the doomed call.
  if (!hubSelfCheck.ok) {
    if (await isRealHub(baseUrl)) {
      hubSelfCheck.ok = true;
      hubSelfCheck.detail = null;
    } else {
      return {
        ok: false,
        code: "HUB_PORT_CONFLICT",
        error: hubSelfCheck.detail ??
          `ScreenSync hub is not reachable at ${url}: another service is answering on this port instead of the ` +
          `ScreenSync hub (possible port conflict or outdated hub). Check what is listening (Windows: ` +
          `netstat -ano | findstr :${HTTP_PORT}; macOS/Linux: lsof -i :${HTTP_PORT}), stop it or start the hub ` +
          `on another port (SCREEN_SYNC_PORT), then retry.`,
      };
    }
  }

  const timeoutMs = callTimeoutOf(args, tool);
  const signal = AbortSignal.timeout(opts.transportTimeoutMs ?? transportTimeoutMs(timeoutMs, tool));
  const startedAt = Date.now();
  let res: Response;
  let body: { ok?: boolean; data?: unknown; error?: string; code?: unknown; retryable?: unknown };
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${opts.token ?? AUTH_TOKEN}`, "X-Session-Id": SESSION_ID },
      body: JSON.stringify({ tool, args, timeoutMs }),
      signal,
    });
    body = (await res.json().catch((error: unknown) => {
      if (isTimeout(error)) throw error; // the answer started but did not finish in time: still a timeout
      return {};
    })) as typeof body;
  } catch (error) {
    return { ok: false, ...describeHubFailure(error, url, Date.now() - startedAt) };
  }
  // A response with no `ok`/`error`/`success` key at all did not come from this hub's /api/web/tool handler,
  // even though the socket connected — e.g. a DIFFERENT local server now holds the port this process was told
  // to use (SCREEN_SYNC_PORT mismatch between processes, or the hub exited and something else took its place
  // mid-session). Say that plainly instead of the bare, undiagnosable "Hub replied 404" this used to fall back
  // to — mirrors the same "possible port conflict or outdated hub" detection the extension's sse-client.js
  // already does for its /api/events connection.
  const looksLikeHub = body && (typeof body.ok === "boolean" || typeof body.error === "string" || "success" in body);
  if (!res.ok && !looksLikeHub) {
    return {
      ok: false,
      code: "HUB_UNEXPECTED_RESPONSE",
      error: `Hub replied ${res.status} at ${url}, but the response didn't look like the ScreenSync hub at all ` +
        `(possible port conflict or outdated hub — something else may be listening on port ${HTTP_PORT}). ` +
        `Check web_status; if it also fails the same way, verify with 'curl ${baseUrl}/health'.`,
    };
  }
  return {
    ok: body.ok === true,
    data: body.data,
    error: body.error ?? (res.ok ? undefined : `Hub replied ${res.status}`),
    ...(typeof body.code === "string" && body.code ? { code: body.code } : {}),
    ...(typeof body.retryable === "boolean" ? { retryable: body.retryable } : {}),
  };
}
