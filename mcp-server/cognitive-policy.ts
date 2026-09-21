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
// Modes (SCREEN_SYNC_COGNITIVE_GATE):
//   "enforce" (default)  a gated call is handed to a PERSON. It is relayed to the extension marked as needing
//                        one (`__gate`), and the extension's approval queue holds it until they approve. It
//                        runs only then; a decline or silence refuses it. If no connected browser can ask
//                        (an extension older than 1.11.0, or none) there is nobody to ask, so the call is
//                        refused with USER_CONFIRMATION_REQUIRED.
//   "warn"               annotates the response and logs, but lets the call through.
//   "off"                does nothing.
// It shipped as "warn" while the approval queue had no caller: a refusal with no one to ask is only an
// error the agent argues around. An unrecognised value fails closed, to "enforce".

import path from "node:path";
import { statSync } from "node:fs";
import { DATA_DIR, log } from "./config.js";
import { readJsonSafe } from "./cognitive-state.js";
import { globalSpine, normalizeDomain } from "./cognitive-spine.js";
import { ACTION_TOOLS, globalObserver } from "./cognitive-spine-observer.js";
import { LEVEL_NAMES } from "./cognitive-spine-ladder.js";
import { globalTranscendentalEngine } from "./cognitive-transcendental.js";
import type { createProfileRegistry } from "./profile-registry.js";

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
  /** "block": needs a person. "asked": it was relayed and a person was asked. "warn": logged only. */
  verdict: "warn" | "block" | "asked";
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
  return v === "off" || v === "warn" ? v : "enforce";
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
      ? `USER_CONFIRMATION_REQUIRED (cognitive gate): ${decision.reason} No connected browser extension can ask the human (ScreenSync extension 1.11.0 or later is needed to approve an action from the toolbar): update it, or allowlist the domain in data/cognitive/policy.json.`
      : null,
  };
}

// ── asking a person: who can, and what the extension is told ────────────────

/** The routing hint a call carries, in the precedence web.ts uses to choose a browser. */
function hintOf(args: Record<string, unknown>): string | null {
  for (const key of ["__profile", "profile", "__email", "email", "__instance", "instanceId", "__browser"]) {
    if (typeof args[key] === "string") return args[key] as string;
  }
  return null;
}

/**
 * True when the browser this call will reach can put a request in front of a person: web access is on and
 * its extension says it has an approval queue. Handing a gated call to one that cannot would simply run it.
 */
export function humanCanBeAsked(registry: Pick<ReturnType<typeof createProfileRegistry>, "resolveTarget">, args: Record<string, unknown>): boolean {
  const target = registry.resolveTarget(hintOf(args));
  return Boolean(target && target.webAccessEnabled && target.approvals);
}

/** Flags only the hub or the extension may set. Whatever a caller sends under these names is dropped. */
const INTERNAL_KEYS: ReadonlySet<string> = new Set(["__humanApproved", "__actGranted", "__gate"]);
const MAX_SCRUB_DEPTH = 8;

function scrub(value: unknown, depth = 0): unknown {
  if (depth > MAX_SCRUB_DEPTH || value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((v) => scrub(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
    if (!INTERNAL_KEYS.has(key)) out[key] = scrub(inner, depth + 1);
  }
  return out;
}

/**
 * The arguments as the extension should receive them. Anything a caller put under an internal name is
 * removed FIRST - an agent must not be able to send `__humanApproved`, or forge the hub's own request for a
 * person - and only then does the hub add its own `__gate`, when the gate decided a person must be asked.
 * The extension strips the same keys on arrival, so this is not the only line of defence.
 */
export function forRelay(args: Record<string, unknown>, gate?: GateDecision): Record<string, unknown> {
  const clean = scrub(args) as Record<string, unknown>;
  if (!gate || gate.verdict !== "block") return clean;
  return {
    ...clean,
    __gate: {
      needsHuman: true,
      reason: gate.reason.slice(0, 300),
      riskScore: gate.riskScore,
      markers: gate.markers.slice(0, 6),
      domain: gate.domain,
      level: gate.earnedName,
    },
  };
}
