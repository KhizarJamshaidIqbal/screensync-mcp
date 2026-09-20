// ScreenSync Cognitive Skills - the lifecycle of a playbook: candidate -> verified -> deprecated.
//
// Voyager's rule, applied here: a skill is checked before it enters the library, not after. Until now a
// playbook the model had just invented started with successCount 1 (or whatever number it typed) and was
// offered at once as a "fast path", so a wrong guess was replayed with confidence.
//
//   candidate   Just learned. Never offered as a fast path; recall returns it as a draft to run
//               deliberately, confirming each step with web_expect.
//   verified    Two hub-confirmed executions in two DISTINCT sessions. The only status that is a fast
//               path or eligible to become a reflex.
//   deprecated  Superseded by a newer verified version, or retired by hygiene. Kept, never offered.
//
// "Hub-confirmed" is the point. An agent reports an outcome, but the report only counts when the hub
// itself observed a verified success (an act followed by a passing, non-trivial assertion) on that
// domain in that session (see SpineObserver.claimVerifiedCredit). The count is therefore not something
// a caller can type. A playbook that already earned its keep before this lifecycle existed (two or more
// successes) is migrated as verified with provenance "legacy", so nothing that worked stops working.

import type { ProceduralPlaybook } from "./cognitive-memory.js";

export type SkillStatus = "candidate" | "verified" | "deprecated";
export type Provenance = "learned" | "legacy" | "seed";

export interface Verification { session: string; at: string }

/** Distinct sessions that must each confirm an execution before a candidate is trusted. */
export const PROMOTE_AFTER_SESSIONS = 2;
/** Reported failures in a row after which a verified playbook stops being offered as a fast path. */
export const SUSPECT_AFTER_FAILURES = 3;

/** The status of any stored playbook, including one saved before statuses existed. */
export function statusOf(pb: ProceduralPlaybook): SkillStatus {
  return pb.status ?? ((pb.successCount ?? 0) >= 2 ? "verified" : "candidate");
}

/** Verified, and not currently under a run of reported failures. */
export function isFastPath(pb: ProceduralPlaybook): boolean {
  return statusOf(pb) === "verified" && (pb.consecutiveFailures ?? 0) < SUSPECT_AFTER_FAILURES;
}

/** What a caller may NOT set on a playbook it submits: the hub decides all of it. */
export const HUB_OWNED_FIELDS = ["status", "successCount", "verifications", "provenance", "verifiedAt", "deprecatedAt", "deprecatedReason", "failureCount", "consecutiveFailures"] as const;

/** A freshly learned playbook: a candidate with nothing proven. */
export function asCandidate(pb: ProceduralPlaybook, now: string): ProceduralPlaybook {
  const candidate: ProceduralPlaybook = {
    ...pb,
    status: "candidate",
    provenance: "learned",
    successCount: 0,
    verifications: [],
    failureCount: 0,
    consecutiveFailures: 0,
    createdAt: now,
  };
  // Nothing the submitter claimed about a past life survives: it has not run yet.
  delete candidate.lastExecutedAt;
  delete candidate.verifiedAt;
  delete candidate.deprecatedAt;
  delete candidate.deprecatedReason;
  return candidate;
}

export interface OutcomeResult {
  recorded: boolean;
  status: SkillStatus;
  successCount: number;
  verifiedSessions: number;
  promoted: boolean;
  reason?: string;
}

/**
 * Folds one reported execution into a playbook. Mutates `pb`.
 *   failure                       recorded (it can make a verified playbook "suspect"), never promotes.
 *   success without a hub credit  NOT recorded: an agent saying so proves nothing.
 *   success with a hub credit     counts. A candidate becomes verified once PROMOTE_AFTER_SESSIONS
 *                                 distinct sessions have each confirmed one.
 */
export function applyOutcome(pb: ProceduralPlaybook, o: { success: boolean; session: string; hubConfirmed: boolean; now: string }): OutcomeResult {
  const view = (recorded: boolean, promoted = false, reason?: string): OutcomeResult => ({
    recorded, status: statusOf(pb), successCount: pb.successCount ?? 0, verifiedSessions: (pb.verifications ?? []).length, promoted, ...(reason ? { reason } : {}),
  });

  if (statusOf(pb) === "deprecated") return view(false, false, "this playbook is deprecated; use its verified replacement");

  if (!o.success) {
    pb.failureCount = (pb.failureCount ?? 0) + 1;
    pb.consecutiveFailures = (pb.consecutiveFailures ?? 0) + 1;
    return view(true);
  }
  if (!o.hubConfirmed) {
    return view(false, false, "no hub-verified success to back this report: run the steps, then confirm the result with web_expect (a passing, non-trivial assertion) in this session, and report again");
  }

  pb.consecutiveFailures = 0;
  pb.successCount = (pb.successCount ?? 0) + 1;
  pb.lastExecutedAt = o.now;
  const seen = (pb.verifications ??= []);
  if (!seen.some((v) => v.session === o.session)) seen.push({ session: o.session, at: o.now });

  let promoted = false;
  if (statusOf(pb) === "candidate" && seen.length >= PROMOTE_AFTER_SESSIONS) {
    pb.status = "verified";
    pb.verifiedAt = o.now;
    promoted = true;
  }
  return view(true, promoted);
}
