// ScreenSync Cognitive Spine - the competence ladder (pure logic, no I/O).
//
// There used to be three engines that each decided how "grown up" a domain was, from different
// numbers, and disagreed (after 20 successful calls one domain was a child, a 24-year-old adult and
// an infant at once). None of them changed any behaviour. This is the single replacement: one
// competence level per domain on Benner's novice-to-expert ladder, EARNED from evidence the hub
// itself observed, never from a number the caller passes.
//
// The rules are deliberately hard to game:
//   - Promotion needs weighted successes, several DISTINCT sessions, elapsed days and a low recent
//     failure rate. One session cannot farm a level however hard it tries.
//   - A success counts fully only when VERIFIED (an action followed by a passing assertion). A bare
//     "the tool returned ok" is worth a fifth of that, capped per session; a success merely REPORTED
//     by the caller is worth a tenth, capped lower still.
//   - Levels are lost as well as won: two failures in a row or a breaker trip drop a rung and freeze
//     promotion for a day, and a rung decays after 30 idle days.
//   - A human "vouch" is audited, capped at COMPETENT and never counts as earned evidence.

export const LEVEL_NAMES = ["NOVICE", "ADVANCED_BEGINNER", "COMPETENT", "PROFICIENT", "EXPERT"] as const;
export type LevelName = (typeof LEVEL_NAMES)[number];
export type Level = 1 | 2 | 3 | 4 | 5;
export type EvidenceKind = "verified" | "weak" | "reported" | "failure" | "breaker";

export const DAY_MS = 86_400_000;
export const FREEZE_MS = DAY_MS;
export const IDLE_DECAY_MS = 30 * DAY_MS;
export const VOUCH_CAP: Level = 3;
const MAX_SESSIONS = 40;
const RECENT_MAX = 50;
const VOUCH_LOG_MAX = 10;

/** Per-session contribution: the first VERIFIED_FULL count 1.0, the next VERIFIED_HALF count 0.5. */
const VERIFIED_FULL = 5;
const VERIFIED_HALF = 10;
const WEAK_WEIGHT = 0.2;
const WEAK_CAP = 1.0;
const REPORTED_WEIGHT = 0.1;
const REPORTED_CAP = 0.5;

export interface Requirement {
  /** Weighted successes needed to ENTER this level. */
  w: number;
  sessions: number;
  days: number;
  maxFailRate: number;
  /** How many of the most recent outcomes the failure rate is measured over. */
  window: number;
  breakerFreeDays: number;
}

export const REQUIREMENTS: Record<2 | 3 | 4 | 5, Requirement> = {
  2: { w: 3, sessions: 2, days: 0, maxFailRate: 1, window: 20, breakerFreeDays: 0 },
  3: { w: 8, sessions: 3, days: 0, maxFailRate: 0.25, window: 20, breakerFreeDays: 0 },
  4: { w: 20, sessions: 5, days: 3, maxFailRate: 0.15, window: 30, breakerFreeDays: 0 },
  5: { w: 50, sessions: 8, days: 7, maxFailRate: 0.08, window: 50, breakerFreeDays: 14 },
};

export interface SessionTally { first: number; last: number; verified: number; weak: number; reported: number }
export interface VouchEntry { level: Level; requested: number; at: number; reason: string; session: string }

export interface SpineRecord {
  domain: string;
  /** The EARNED level. The destructive-action gate reads this and nothing else. */
  level: Level;
  levelSince: number;
  firstSeenAt: number;
  lastSeenAt: number;
  firstSuccessAt: number | null;
  lastSuccessAt: number | null;
  lastFailureAt: number | null;
  lastBreakerAt: number | null;
  regressedAt: number | null;
  frozenUntil: number;
  decayedThrough: number;
  consecutiveFailures: number;
  totals: { verified: number; weak: number; reported: number; failures: number; breakers: number };
  /** The last RECENT_MAX outcomes, oldest first; true = ok. */
  recent: boolean[];
  sessions: Record<string, SessionTally>;
  /** What sessions trimmed out of `sessions` had already contributed, so W and S never shrink by trimming. */
  archived: { w: number; sessions: number };
  vouches: VouchEntry[];
  /** Stored by web_wisdom_calibration so the reflex gate can read a hub-held score, not a caller's. */
  wisdom: { score: number; at: number } | null;
}

export function newRecord(domain: string, now: number): SpineRecord {
  return {
    domain, level: 1, levelSince: now, firstSeenAt: now, lastSeenAt: now,
    firstSuccessAt: null, lastSuccessAt: null, lastFailureAt: null, lastBreakerAt: null, regressedAt: null,
    frozenUntil: 0, decayedThrough: 0, consecutiveFailures: 0,
    totals: { verified: 0, weak: 0, reported: 0, failures: 0, breakers: 0 },
    recent: [], sessions: {}, archived: { w: 0, sessions: 0 }, vouches: [], wisdom: null,
  };
}

// ── measurements ────────────────────────────────────────────────────────────

const verifiedCurve = (n: number): number => Math.min(n, VERIFIED_FULL) + 0.5 * Math.min(Math.max(n - VERIFIED_FULL, 0), VERIFIED_HALF);

export function sessionWeight(t: SessionTally): number {
  return verifiedCurve(t.verified) + Math.min(WEAK_CAP, WEAK_WEIGHT * t.weak) + Math.min(REPORTED_CAP, REPORTED_WEIGHT * t.reported);
}

/** W: weighted successes across every session. */
export function totalWeight(rec: SpineRecord): number {
  return rec.archived.w + Object.values(rec.sessions).reduce((sum, t) => sum + sessionWeight(t), 0);
}

/** S: distinct sessions that contributed at least one success. */
export function sessionCount(rec: SpineRecord): number {
  return rec.archived.sessions + Object.values(rec.sessions).filter((t) => sessionWeight(t) > 0).length;
}

export function spanDays(rec: SpineRecord): number {
  return rec.firstSuccessAt === null || rec.lastSuccessAt === null ? 0 : (rec.lastSuccessAt - rec.firstSuccessAt) / DAY_MS;
}

export function failRate(rec: SpineRecord, window: number): number {
  const last = rec.recent.slice(-window);
  return last.length === 0 ? 0 : last.filter((ok) => !ok).length / last.length;
}

const round1 = (n: number): number => Math.round(n * 10) / 10;
const pct = (n: number): string => `${Math.round(n * 100)}%`;

/** What still stands between this record and `next`. Empty means promotable. Single source of truth. */
export function gaps(rec: SpineRecord, next: 2 | 3 | 4 | 5, now: number): string[] {
  const req = REQUIREMENTS[next];
  const needs: string[] = [];
  const w = totalWeight(rec);
  if (w < req.w) needs.push(`${round1(req.w - w)} more weighted verified successes`);
  const s = sessionCount(rec);
  if (s < req.sessions) needs.push(`${req.sessions - s} more distinct session(s)`);
  const d = spanDays(rec);
  if (d < req.days) needs.push(`${round1(req.days - d)} more day(s) of activity`);
  const fr = failRate(rec, req.window);
  if (fr > req.maxFailRate) needs.push(`failure rate ${pct(fr)} must fall to ${pct(req.maxFailRate)} over the last ${req.window} outcomes`);
  if (req.breakerFreeDays > 0 && rec.lastBreakerAt !== null && now - rec.lastBreakerAt < req.breakerFreeDays * DAY_MS) {
    needs.push(`no breaker trip for ${req.breakerFreeDays} days`);
  }
  if (now < rec.frozenUntil) needs.push(`promotion is frozen until ${new Date(rec.frozenUntil).toISOString()}`);
  return needs;
}

// ── state transitions ───────────────────────────────────────────────────────

function demote(rec: SpineRecord, now: number): void {
  if (rec.level > 1) rec.level = (rec.level - 1) as Level;
  rec.levelSince = now;
  rec.regressedAt = now;
  rec.frozenUntil = now + FREEZE_MS;
}

/** A rung is lost per IDLE_DECAY_MS without a success. Idempotent for a given `now`. */
export function applyDecay(rec: SpineRecord, now: number): void {
  let anchor = Math.max(rec.lastSuccessAt ?? rec.firstSeenAt, rec.decayedThrough);
  while (rec.level > 1 && now - anchor >= IDLE_DECAY_MS) {
    rec.level = (rec.level - 1) as Level;
    rec.levelSince = now;
    anchor += IDLE_DECAY_MS;
    rec.decayedThrough = anchor;
  }
}

function pushOutcome(rec: SpineRecord, ok: boolean): void {
  rec.recent.push(ok);
  if (rec.recent.length > RECENT_MAX) rec.recent.splice(0, rec.recent.length - RECENT_MAX);
}

function trimSessions(rec: SpineRecord): void {
  const ids = Object.keys(rec.sessions);
  if (ids.length <= MAX_SESSIONS) return;
  ids.sort((a, b) => rec.sessions[a].last - rec.sessions[b].last);
  for (const id of ids.slice(0, ids.length - MAX_SESSIONS)) {
    const w = sessionWeight(rec.sessions[id]);
    if (w > 0) { rec.archived.w += w; rec.archived.sessions += 1; }
    delete rec.sessions[id];
  }
}

/** Folds one observation into the record. Mutates `rec`. */
export function applyEvidence(rec: SpineRecord, kind: EvidenceKind, session: string, now: number): void {
  applyDecay(rec, now);
  rec.lastSeenAt = now;

  if (kind === "verified" || kind === "weak" || kind === "reported") {
    const tally = (rec.sessions[session] ??= { first: now, last: now, verified: 0, weak: 0, reported: 0 });
    tally.last = now;
    tally[kind] += 1;
    rec.totals[kind] += 1;
    rec.firstSuccessAt ??= now;
    rec.lastSuccessAt = now;
    rec.consecutiveFailures = 0;
    pushOutcome(rec, true);
    trimSessions(rec);
    if (rec.level < 5 && gaps(rec, (rec.level + 1) as 2 | 3 | 4 | 5, now).length === 0) {
      rec.level = (rec.level + 1) as Level;
      rec.levelSince = now;
    }
    return;
  }

  pushOutcome(rec, false);
  if (kind === "failure") {
    rec.totals.failures += 1;
    rec.lastFailureAt = now;
    rec.consecutiveFailures += 1;
    if (rec.consecutiveFailures >= 2) { demote(rec, now); rec.consecutiveFailures = 0; }
  } else {
    rec.totals.breakers += 1;
    rec.lastBreakerAt = now;
    rec.consecutiveFailures = 0;
    demote(rec, now);
  }
}

/** Records an audited human vouch. Capped at VOUCH_CAP and never touches the earned level. */
export function applyVouch(rec: SpineRecord, requested: number, reason: string, session: string, now: number): VouchEntry {
  const level = Math.max(1, Math.min(VOUCH_CAP, Math.round(requested))) as Level;
  const entry: VouchEntry = { level, requested: Math.round(requested), at: now, reason, session };
  rec.vouches.push(entry);
  if (rec.vouches.length > VOUCH_LOG_MAX) rec.vouches.splice(0, rec.vouches.length - VOUCH_LOG_MAX);
  return entry;
}

// ── the read model ──────────────────────────────────────────────────────────

export interface Evaluation {
  domain: string;
  /** EARNED level: the only one a safety decision may use. */
  level: Level;
  levelName: LevelName;
  /** What advisory views show: earned, or a human vouch if that is higher. */
  effectiveLevel: Level;
  effectiveName: LevelName;
  source: "earned" | "vouched";
  /** 0..1 toward the next rung (a slow ramp past EXPERT). */
  progress: number;
  evidence: {
    weightedSuccesses: number; sessions: number; spanDays: number; failureRate: number;
    verified: number; weak: number; reported: number; failures: number; breakers: number;
    consecutiveFailures: number;
    lastSuccessAt: string | null;
  };
  next: { level: Level; name: LevelName; needs: string[] } | null;
  frozenUntil: string | null;
  regressedRecently: boolean;
  vouch: { level: Level; requested: number; at: string; reason: string } | null;
}

const iso = (t: number | null): string | null => (t === null ? null : new Date(t).toISOString());

export function evaluate(rec: SpineRecord, now: number): Evaluation {
  applyDecay(rec, now);
  const w = totalWeight(rec);
  const s = sessionCount(rec);
  const d = spanDays(rec);
  const vouch = rec.vouches.length ? rec.vouches[rec.vouches.length - 1] : null;
  const vouched = vouch !== null && vouch.level > rec.level;
  const effectiveLevel = vouched ? vouch.level : rec.level;

  let progress: number;
  let next: Evaluation["next"] = null;
  if (rec.level >= 5) {
    progress = Math.min(1, w / (REQUIREMENTS[5].w * 2));
  } else {
    const nl = (rec.level + 1) as 2 | 3 | 4 | 5;
    const req = REQUIREMENTS[nl];
    progress = Math.max(0, Math.min(0.99, Math.min(w / req.w, s / req.sessions, req.days > 0 ? d / req.days : 1)));
    next = { level: nl, name: LEVEL_NAMES[nl - 1], needs: gaps(rec, nl, now) };
  }

  return {
    domain: rec.domain,
    level: rec.level, levelName: LEVEL_NAMES[rec.level - 1],
    effectiveLevel, effectiveName: LEVEL_NAMES[effectiveLevel - 1],
    source: vouched ? "vouched" : "earned",
    progress: Math.round(progress * 1000) / 1000,
    evidence: {
      weightedSuccesses: round1(w), sessions: s, spanDays: round1(d), failureRate: Math.round(failRate(rec, 50) * 1000) / 1000,
      verified: rec.totals.verified, weak: rec.totals.weak, reported: rec.totals.reported,
      failures: rec.totals.failures, breakers: rec.totals.breakers, consecutiveFailures: rec.consecutiveFailures,
      lastSuccessAt: iso(rec.lastSuccessAt),
    },
    next,
    frozenUntil: rec.frozenUntil > now ? iso(rec.frozenUntil) : null,
    regressedRecently: rec.regressedAt !== null && now - rec.regressedAt < FREEZE_MS,
    vouch: vouch ? { level: vouch.level, requested: vouch.requested, at: iso(vouch.at)!, reason: vouch.reason } : null,
  };
}
