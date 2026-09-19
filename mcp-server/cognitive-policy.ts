// ScreenSync Cognitive Policy - the soft gate: a domain's EARNED level finally changes behaviour.
//
// Before this, growing up changed nothing: the "scaffolding" flags the level engines produced were
// written into JSON and read by no execution path. This is the first place a level is consulted before
// something happens, and deliberately only there:
//
//   gated    a page-mutating tool the hub judges destructive or irreversible, on a domain whose EARNED
//            level is still below COMPETENT. A vouch never lifts it: only evidence does.
//   free     everything else, at every level: all reads and perception, and every mutation that does
//            not look destructive. A fresh domain stays usable.
//
// The hub judges "destructive" with the same somatic-marker appraisal the transcendental engine already
// exposes (the destructive vocabulary is the regex the extension's page-side check shares). It sees only
// what the caller sends (selector, text, value, url, method), so it is a safety net for honest mistakes,
// not a defence against a caller that lies about its arguments. It composes with, and does not replace,
// the extension's origin grants and precise page-side check, and it never trusts `confirmed` or `force`.
//
// Modes (SCREEN_SYNC_COGNITIVE_GATE): "warn" (default) annotates the response and logs, but lets the call
// through; "enforce" refuses it with USER_CONFIRMATION_REQUIRED; "off" does nothing. It ships as "warn"
// because until the extension's approval queue is wired there is no human to ask, and a refusal would
// just be an error the agent argues around.

import path from "node:path";
import { statSync } from "node:fs";
import { DATA_DIR, log } from "./config.js";
import { readJsonSafe } from "./cognitive-state.js";
import { globalSpine, normalizeDomain } from "./cognitive-spine.js";
import { ACTION_TOOLS, globalObserver } from "./cognitive-spine-observer.js";
import { LEVEL_NAMES } from "./cognitive-spine-ladder.js";
import { globalTranscendentalEngine } from "./cognitive-transcendental.js";

export type GateMode = "off" | "warn" | "enforce";

/** COMPETENT. Below this, a destructive-looking mutation is gated. */
export const REQUIRED_LEVEL = 3;
/** The somatic score at which an action counts as risky (APPREHENSIVE and above). */
const RISK_THRESHOLD = 0.34;
const POLICY_FILE = path.join(DATA_DIR, "cognitive", "policy.json");
const POLICY_TTL_MS = 5_000;

/** Tools that change a page or run arbitrary code in it. Anything not listed passes untouched. */
export const GATED_TOOLS: ReadonlySet<string> = new Set([
  ...ACTION_TOOLS, "web_api_fetch", "web_eval", "web_run_code", "web_cdp_eval", "web_frame_exec",
]);

export interface GateDecision {
  mode: Exclude<GateMode, "off">;
  verdict: "warn" | "block";
  tool: string;
  domain: string | null;
  earnedLevel: number;
  earnedName: string;
  requiredLevel: number;
  requiredName: string;
  riskScore: number;
  markers: string[];
  reason: string;
}

export interface GateOutcome { decision: GateDecision; block: boolean; message: string | null }

export function gateMode(): GateMode {
  const v = String(process.env.SCREEN_SYNC_COGNITIVE_GATE ?? "").trim().toLowerCase();
  return v === "off" || v === "enforce" ? v : "warn";
}

// ── per-domain allowlist (data/cognitive/policy.json: { "allowDomains": ["example.com"] }) ──

let policyCache: { at: number; mtime: number; allow: Set<string> } | null = null;

function allowedDomains(now: number): Set<string> {
  if (policyCache && now - policyCache.at < POLICY_TTL_MS) return policyCache.allow;
  let mtime = 0;
  try { mtime = statSync(POLICY_FILE).mtimeMs; } catch { /* no policy file: nothing allowlisted */ }
  if (policyCache && policyCache.mtime === mtime) {
    policyCache.at = now;
    return policyCache.allow;
  }
  const allow = new Set<string>();
  if (mtime) {
    const read = readJsonSafe(POLICY_FILE);
    if (read.status === "ok" && typeof read.value === "object" && read.value !== null) {
      const list = (read.value as { allowDomains?: unknown }).allowDomains;
      if (Array.isArray(list)) for (const d of list) if (typeof d === "string" && d.trim()) allow.add(normalizeDomain(d));
    } else if (read.status === "corrupt") {
      log("WARN", "cognitive/policy.json is unreadable; no domain is allowlisted", { error: read.error });
    }
  }
  policyCache = { at: now, mtime, allow };
  return allow;
}

/** For tests: forget the cached allowlist. */
export function resetPolicyCache(): void {
  policyCache = null;
}

// ── the appraisal ───────────────────────────────────────────────────────────

const asText = (v: unknown): string => (typeof v === "string" ? v : "");

/** The words a caller sent that could reveal what an action does. */
function surfaceOf(args: Record<string, unknown>): { tool?: string; target: string; text: string; url: string; irreversible: boolean } {
  const target = [args.selector, args.ref, args.xpath, args.target, args.name, args.label].map(asText).filter(Boolean).join(" ");
  const text = [args.text, args.value, args.key, args.code, args.expression, args.script, args.body].map(asText).filter(Boolean).join(" ").slice(0, 2000);
  const method = asText(args.method);
  return { tool: method || undefined, target, text, url: asText(args.url), irreversible: args.irreversible === true };
}

/**
 * Decides whether this call is gated, and if so how. Returns null when nothing needs saying: the gate
 * is off, the tool is not a page mutation, the action does not look destructive, the domain has earned
 * COMPETENT, or the human allowlisted the domain.
 */
export function gateBeforeRelay(tool: string, args: Record<string, unknown>, session: string, now: number = Date.now()): GateOutcome | null {
  const mode = gateMode();
  if (mode === "off" || !GATED_TOOLS.has(tool)) return null;

  const domain = globalObserver.resolveDomain(args, undefined, session, now) || null;
  const risk = globalTranscendentalEngine.somaticMarkerRisk(domain ?? "", surfaceOf(args));
  if (risk.visceralRiskScore < RISK_THRESHOLD) return null;

  // An unresolvable domain is treated as a NOVICE: no evidence means no trust.
  const earned = domain ? globalSpine.earnedLevel(domain, now) : 1;
  if (earned >= REQUIRED_LEVEL) return null;
  if (domain && allowedDomains(now).has(domain)) return null;

  const decision: GateDecision = {
    mode,
    verdict: mode === "enforce" ? "block" : "warn",
    tool,
    domain,
    earnedLevel: earned,
    earnedName: LEVEL_NAMES[earned - 1],
    requiredLevel: REQUIRED_LEVEL,
    requiredName: LEVEL_NAMES[REQUIRED_LEVEL - 1],
    riskScore: risk.visceralRiskScore,
    markers: risk.markers,
    reason: `${tool} looks destructive (${risk.markers.join(", ") || "risk appraisal"}) and ${domain ?? "this page"} has only earned ${LEVEL_NAMES[earned - 1]}; ${LEVEL_NAMES[REQUIRED_LEVEL - 1]} is needed to act on it unsupervised.`,
  };
  log("WARN", "Cognitive gate", { ...decision });

  const block = mode === "enforce";
  return {
    decision,
    block,
    message: block
      ? `USER_CONFIRMATION_REQUIRED (cognitive gate): ${decision.reason} Ask the human to approve this specific action, or to allowlist the domain in data/cognitive/policy.json.`
      : null,
  };
}
