// ScreenSync Cognitive Spine - the durable per-domain competence record.
//
// The pure rules live in cognitive-spine-ladder.ts. This holds the records, is the ONLY writer of a
// domain's level, and persists through the state registry (namespace "spine"). Every other "how
// grown up is this domain" tool is a view over it (cognitive-spine-views.ts).
//
// Nothing here takes a level from a caller. Evidence arrives from the hub's own observation of tool
// results (cognitive-spine-observer.ts), from a breaker trip, or as a low-weight, per-session-capped
// "reported" claim. A human vouch is audited, capped at COMPETENT, and never becomes earned level.

import { asRecord, toMap } from "./cognitive-serial.js";
import { canonicalDomain, rekeyByDomain } from "./cognitive-domain.js";
import {
  LEVEL_NAMES, applyEvidence, applyVouch, evaluate, mergeRecords, newRecord,
  type EvidenceKind, type Evaluation, type Level, type SessionTally, type SpineRecord, type VouchEntry,
} from "./cognitive-spine-ladder.js";

const MAX_DOMAINS = 500;

/** The spine's key for a domain: the shared canonical form (see cognitive-domain.ts). */
export const normalizeDomain = (raw: string): string => canonicalDomain(raw);

// ── strict (de)serialisation: a bad snapshot must throw, never half-apply ──

function num(v: unknown, what: string): number {
  if (typeof v !== "number" || !Number.isFinite(v)) throw new Error(`spine: ${what} must be a finite number`);
  return v;
}
const count = (v: unknown, what: string): number => {
  const n = num(v, what);
  if (n < 0 || !Number.isInteger(n)) throw new Error(`spine: ${what} must be a non-negative integer`);
  return n;
};
const numOrNull = (v: unknown, what: string): number | null => (v === null || v === undefined ? null : num(v, what));
function levelOf(v: unknown, what: string): Level {
  const n = num(v, what);
  if (![1, 2, 3, 4, 5].includes(n)) throw new Error(`spine: ${what} must be a level from 1 to 5`);
  return n as Level;
}
const text = (v: unknown, what: string): string => {
  if (typeof v !== "string") throw new Error(`spine: ${what} must be a string`);
  return v;
};

function coerceRecord(domain: string, raw: unknown): SpineRecord {
  const w = `records.${domain}`;
  const r = asRecord(raw, `spine.${w}`);
  const totals = asRecord(r.totals, `spine.${w}.totals`);
  const archived = asRecord(r.archived, `spine.${w}.archived`);

  const sessions: Record<string, SessionTally> = {};
  for (const [id, t] of Object.entries(asRecord(r.sessions, `spine.${w}.sessions`))) {
    const s = asRecord(t, `spine.${w}.sessions.${id}`);
    sessions[id] = {
      first: num(s.first, "session.first"), last: num(s.last, "session.last"),
      verified: count(s.verified, "session.verified"), weak: count(s.weak, "session.weak"), reported: count(s.reported, "session.reported"),
    };
  }
  if (!Array.isArray(r.recent) || !r.recent.every((x) => typeof x === "boolean")) throw new Error(`spine: ${w}.recent must be a list of booleans`);
  if (!Array.isArray(r.vouches)) throw new Error(`spine: ${w}.vouches must be a list`);
  const vouches: VouchEntry[] = r.vouches.map((v) => {
    const e = asRecord(v, "vouch");
    return { level: levelOf(e.level, "vouch.level"), requested: num(e.requested, "vouch.requested"), at: num(e.at, "vouch.at"), reason: text(e.reason, "vouch.reason"), session: text(e.session, "vouch.session") };
  });
  let wisdom: SpineRecord["wisdom"] = null;
  if (r.wisdom !== null && r.wisdom !== undefined) {
    const x = asRecord(r.wisdom, "wisdom");
    wisdom = { score: num(x.score, "wisdom.score"), at: num(x.at, "wisdom.at") };
  }

  return {
    domain: text(r.domain, "domain"),
    level: levelOf(r.level, "level"),
    levelSince: num(r.levelSince, "levelSince"), firstSeenAt: num(r.firstSeenAt, "firstSeenAt"), lastSeenAt: num(r.lastSeenAt, "lastSeenAt"),
    firstSuccessAt: numOrNull(r.firstSuccessAt, "firstSuccessAt"), lastSuccessAt: numOrNull(r.lastSuccessAt, "lastSuccessAt"),
    lastFailureAt: numOrNull(r.lastFailureAt, "lastFailureAt"), lastBreakerAt: numOrNull(r.lastBreakerAt, "lastBreakerAt"),
    regressedAt: numOrNull(r.regressedAt, "regressedAt"),
    frozenUntil: num(r.frozenUntil, "frozenUntil"), decayedThrough: num(r.decayedThrough, "decayedThrough"),
    consecutiveFailures: count(r.consecutiveFailures, "consecutiveFailures"),
    totals: {
      verified: count(totals.verified, "totals.verified"), weak: count(totals.weak, "totals.weak"), reported: count(totals.reported, "totals.reported"),
      failures: count(totals.failures, "totals.failures"), breakers: count(totals.breakers, "totals.breakers"),
    },
    recent: r.recent as boolean[],
    sessions,
    archived: { w: num(archived.w, "archived.w"), sessions: count(archived.sessions, "archived.sessions") },
    vouches,
    wisdom,
  };
}

// ── the spine ───────────────────────────────────────────────────────────────

export class CognitiveSpine {
  private records: Map<string, SpineRecord> = new Map();

  constructor(private readonly clock: () => number = Date.now) {}

  private key(domain: string): string {
    const d = normalizeDomain(domain);
    if (!d) throw new Error("domain is required");
    return d;
  }

  private evictIfFull(): void {
    if (this.records.size < MAX_DOMAINS) return;
    let victim: string | null = null;
    let victimSeen = Infinity;
    for (const [k, r] of this.records) {
      // Prefer forgetting a domain that never got past NOVICE; otherwise the least recently active.
      const seen = r.level === 1 ? r.lastSeenAt : r.lastSeenAt + 1e15;
      if (seen < victimSeen) { victim = k; victimSeen = seen; }
    }
    if (victim) this.records.delete(victim);
  }

  /** Folds one observation in and returns the fresh evaluation. Creates the record on first evidence. */
  public record(domain: string, kind: EvidenceKind, session: string, now: number = this.clock()): Evaluation {
    const k = this.key(domain);
    let rec = this.records.get(k);
    if (!rec) {
      this.evictIfFull();
      rec = newRecord(k, now);
      this.records.set(k, rec);
    }
    applyEvidence(rec, kind, session, now);
    return evaluate(rec, now);
  }

  /** Read-only: an unknown domain evaluates as a fresh NOVICE without being stored. */
  public evaluate(domain: string, now: number = this.clock()): Evaluation {
    const k = this.key(domain);
    return evaluate(this.records.get(k) ?? newRecord(k, now), now);
  }

  /** The earned level. The only one a safety decision may use. */
  public earnedLevel(domain: string, now: number = this.clock()): Level {
    return this.evaluate(domain, now).level;
  }

  public has(domain: string): boolean {
    return this.records.has(this.key(domain));
  }

  public vouch(domain: string, requested: number, reason: string, session: string, now: number = this.clock()): VouchEntry {
    const k = this.key(domain);
    let rec = this.records.get(k);
    if (!rec) {
      this.evictIfFull();
      rec = newRecord(k, now);
      this.records.set(k, rec);
    }
    return applyVouch(rec, requested, reason, session, now);
  }

  /** Stores the hub-computed wisdom score so a gate can read it instead of trusting a caller's number. */
  public setWisdom(domain: string, score: number, now: number = this.clock()): void {
    const k = this.key(domain);
    let rec = this.records.get(k);
    if (!rec) {
      this.evictIfFull();
      rec = newRecord(k, now);
      this.records.set(k, rec);
    }
    rec.wisdom = { score: Math.max(0, Math.min(1, score)), at: now };
  }

  public wisdom(domain: string): { score: number; at: number } | null {
    return this.records.get(this.key(domain))?.wisdom ?? null;
  }

  public domains(): string[] {
    return [...this.records.keys()];
  }

  // -- durable state (see cognitive-persistence.ts) ----------------------------
  public snapshotState(): unknown {
    return { records: [...this.records.entries()] };
  }

  /**
   * Records are re-keyed by the canonical domain: a snapshot from before every writer used it holds keys such as
   * "https://x.com" or "x.com:443" that key() can no longer reach, so their evidence and vouches were lost and
   * still counted toward MAX_DOMAINS. Two spellings of one domain are merged (mergeRecords); a key that is no
   * domain at all could never be reached by key() and is dropped.
   */
  public restoreState(raw: unknown): void {
    const s = asRecord(raw, "spine");
    const parsed = toMap<unknown>(s.records, "spine.records");
    const coerced: Array<[string, SpineRecord]> = [...parsed].map(([domain, value]) => [domain, coerceRecord(domain, value)]);
    const now = this.clock();
    this.records = rekeyByDomain(coerced, (kept, other) => mergeRecords(kept, other, kept.domain, now), {
      fix: (rec, key) => (rec.domain === key ? rec : { ...rec, domain: key }),
      dropInvalid: true,
    });
  }
}

export { LEVEL_NAMES };
export const globalSpine = new CognitiveSpine();
