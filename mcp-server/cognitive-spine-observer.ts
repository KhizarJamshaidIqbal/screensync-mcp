// ScreenSync Cognitive Spine - turns what the hub SEES into evidence.
//
// This runs on every relayed tool result (from the auto-tracker). It is the only place a success
// becomes evidence, and it is stricter than the tracker it replaces, which scored any `ok:true` as a
// success (so a FAILED web_expect, which returns ok:true with passed:false, earned XP) and scored the
// safety layer's own refusals as "trauma".
//
//   verified  an action tool succeeded, then a NON-trivial assertion on the same domain in the same
//             session passed within a minute. The act, expect loop is the only full-weight success.
//   weak      an action tool returned ok. Worth a fifth of a verified success, capped per session.
//   failure   an action tool failed on the page, or the assertion that followed it failed.
//   neutral   nothing recorded: perception tools, a lone assertion, an assertion that could not run,
//             a trivially-true one (`body`, `html`), and refusals or outages that say nothing about
//             the agent's competence (web access off, awaiting the human's confirmation, no browser).
//
// An unrecognised refusal string is scored as a failure. That errs toward a LOWER level, which is the
// safe direction for a level that will gate risky actions.

import { globalSpine, normalizeDomain, type CognitiveSpine } from "./cognitive-spine.js";
import type { EvidenceKind } from "./cognitive-spine-ladder.js";

/** Page-mutating tools whose outcome an assertion can meaningfully verify. */
export const ACTION_TOOLS: ReadonlySet<string> = new Set([
  "web_click", "web_type", "web_fill", "web_key", "web_key_combo", "web_select", "web_check", "web_clear",
  "web_drag_and_drop", "web_upload_file", "web_paste", "web_cdp_click", "web_cdp_type", "web_touch", "web_mouse",
  "web_navigate", "web_go_back", "web_go_forward", "web_reload",
]);

/** The tools whose passing result verifies the action before it. */
export const VERIFIER_TOOLS: ReadonlySet<string> = new Set(["web_expect", "web_assert"]);

const PENDING_TTL_MS = 60_000;
const CONTEXT_TTL_MS = 120_000;
const MAX_CONTEXT = 300;

/** Refusals and outages that say nothing about competence. Confirmed strings only. */
const NEUTRAL_ERROR_RE = /web access is disabled|USER_CONFIRMATION_REQUIRED|waiting for the browser extension|no connected browser|not reachable|extension not connected/i;
const TRIVIAL_SELECTORS = new Set(["body", "html", ":root", "*", "document", "css=body", "css=html", "css=:root"]);

export interface ToolResultLike { ok: boolean; data?: unknown; error?: string }

export type Outcome = EvidenceKind | "neutral" | null;

/** The MCP relay sends its process id as X-Session-Id; raw HTTP callers fall back to one session per day. */
export function sessionOf(header: string | undefined, now: number = Date.now()): string {
  const clean = (header ?? "").trim().replace(/[^A-Za-z0-9._:-]/g, "").slice(0, 64);
  return clean || `http:${new Date(now).toISOString().slice(0, 10)}`;
}

export function hostOf(raw: unknown): string {
  const s = typeof raw === "string" ? raw.trim() : "";
  if (!s) return "";
  let host = "";
  if (s.startsWith("http://") || s.startsWith("https://")) {
    try { host = new URL(s).hostname; } catch { return ""; }
  } else if (s.includes(".") && !s.includes(" ") && !s.includes("/")) {
    host = s;
  }
  host = normalizeDomain(host);
  return host === "localhost" || host === "127.0.0.1" ? "" : host;
}

/** True when an assertion cannot tell us anything: it targets the whole document, or nothing at all. */
export function isTrivialCheck(args: Record<string, unknown>): boolean {
  const selector = typeof args.selector === "string" ? args.selector.trim().toLowerCase() : "";
  if (TRIVIAL_SELECTORS.has(selector)) return true;
  if (selector) return false;
  const condition = String(args.condition ?? "visible").toLowerCase();
  const needle = String(args.text ?? "").trim();
  // No selector: only a check of the URL, title or a specific piece of text is a real one.
  return !(["url", "title", "text", "has_text"].includes(condition) && needle.length >= 3);
}

export class SpineObserver {
  private tabDomain = new Map<string, { domain: string; t: number }>();
  private sessionDomain = new Map<string, { domain: string; t: number }>();
  private pending = new Map<string, { tool: string; t: number }>();

  constructor(private readonly spine: CognitiveSpine, private readonly clock: () => number = Date.now) {}

  private prune(now: number): void {
    for (const m of [this.tabDomain, this.sessionDomain]) {
      if (m.size > MAX_CONTEXT) for (const [k, v] of m) if (now - v.t > CONTEXT_TTL_MS) m.delete(k);
    }
    if (this.pending.size > MAX_CONTEXT) for (const [k, v] of this.pending) if (now - v.t > PENDING_TTL_MS) this.pending.delete(k);
  }

  /**
   * The domain a result belongs to. Most tools name it (url / origin / domain, or a url in the reply);
   * a click or an assertion does not, so those inherit the last domain seen on the same tab, or else
   * in the same session within CONTEXT_TTL_MS.
   */
  public resolveDomain(args: Record<string, unknown>, data: unknown, session: string, now: number): string {
    const tabId = args.tabId ?? (data as { tabId?: unknown } | null | undefined)?.tabId;
    const tabKey = tabId === undefined || tabId === null ? null : `${session}|${String(tabId)}`;
    const direct = hostOf(args.url) || hostOf(args.origin) || hostOf((data as { url?: unknown } | null | undefined)?.url) || hostOf(args.domain);
    if (direct) {
      this.sessionDomain.set(session, { domain: direct, t: now });
      if (tabKey) this.tabDomain.set(tabKey, { domain: direct, t: now });
      return direct;
    }
    const byTab = tabKey ? this.tabDomain.get(tabKey) : undefined;
    if (byTab && now - byTab.t <= CONTEXT_TTL_MS) return byTab.domain;
    const bySession = this.sessionDomain.get(session);
    return bySession && now - bySession.t <= CONTEXT_TTL_MS ? bySession.domain : "";
  }

  /** Feeds one relayed tool result to the spine. Never throws. */
  public observe(input: { tool: string; args: Record<string, unknown>; result: ToolResultLike; session: string }): { domain: string; outcome: Outcome } {
    const { tool, args, result, session } = input;
    const now = this.clock();
    try {
      this.prune(now);
      const domain = this.resolveDomain(args, result.data, session, now);
      if (!domain) return { domain: "", outcome: null };
      const key = `${session}|${domain}`;

      if (VERIFIER_TOOLS.has(tool)) return { domain, outcome: this.verify(tool, args, result, session, domain, key, now) };

      if (ACTION_TOOLS.has(tool)) {
        if (result.ok) {
          this.spine.record(domain, "weak", session, now);
          this.pending.set(key, { tool, t: now });
          return { domain, outcome: "weak" };
        }
        if (NEUTRAL_ERROR_RE.test(result.error ?? "")) return { domain, outcome: "neutral" };
        this.pending.delete(key);
        this.spine.record(domain, "failure", session, now);
        return { domain, outcome: "failure" };
      }
      return { domain, outcome: null };
    } catch {
      return { domain: "", outcome: null }; // telemetry must never break a tool call
    }
  }

  private verify(tool: string, args: Record<string, unknown>, result: ToolResultLike, session: string, domain: string, key: string, now: number): Outcome {
    if (isTrivialCheck(args)) return "neutral";
    const data = (result.data ?? {}) as { passed?: unknown };
    // web_expect answers ok:true with passed:false; web_assert answers ok:false with "Assertion failed...".
    const passed = result.ok && data.passed === true;
    const failedAssertion = tool === "web_assert"
      ? !result.ok && /^Assertion failed/i.test(result.error ?? "")
      : result.ok && data.passed === false;
    if (!passed && !failedAssertion) return "neutral"; // could not run: says nothing either way

    const action = this.pending.get(key);
    this.pending.delete(key);
    if (!action || now - action.t > PENDING_TTL_MS) return "neutral"; // a lone assertion verifies nothing

    const kind: EvidenceKind = passed ? "verified" : "failure";
    this.spine.record(domain, kind, session, now);
    return kind;
  }
}

export const globalObserver = new SpineObserver(globalSpine);

export function observeToolResult(tool: string, args: Record<string, unknown>, result: ToolResultLike, session: string): { domain: string; outcome: Outcome } {
  return globalObserver.observe({ tool, args, result, session });
}
