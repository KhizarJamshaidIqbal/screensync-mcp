// ScreenSync Cognitive Reflection - turning a pile of episodes into something worth knowing.
//
// Generative Agents (Park et al.) periodically pause and ask "what have I learned?", then store the
// answers as memories that are themselves retrievable. The trigger is the same here: each episode
// carries an importance, and when the unreflected total for a domain crosses REFLECT_THRESHOLD the
// hub synthesises insights and records how far it has read.
//
// The synthesis is DETERMINISTIC - counting and arithmetic over episodes the hub itself recorded.
// There is no model call, so reflection costs nothing, cannot hallucinate, and is testable.
//
// What it reflects ON is the important part. The design this replaces keyed on `conditionSignals` and
// `pitfallsEncountered`, but the auto-tracker never fills those in: of 76 real episodes in a live store,
// exactly one had either. Insights are therefore drawn from what the hub really observes on every call -
// the intent, whether it worked, how long it took, and when - and the two signal-driven rules fire only
// when a caller has actually supplied that data, rather than quietly producing nothing forever.

import type { CognitiveMemoryData, ExecutionEpisode } from "./cognitive-memory.js";
import { NEUTRAL_ERROR_RE } from "./cognitive-spine-observer.js";

/**
 * A run the hub classified as "neutral" - the permission layer declining, the human's confirmation
 * pending, no browser attached - is not evidence about anything. Counting those refusals as failures
 * made reflection report "click fails 100% of the time on example.com" when every one of them was
 * "Action access not granted": the guard working exactly as intended.
 */
export function isInformative(ep: ExecutionEpisode): boolean {
  if (ep.outcome) return ep.outcome !== "neutral";
  // Episodes recorded before the hub stamped its verdict on them carry only the error prose, so fall
  // back to the same pattern the observer uses. Without this, a store full of history keeps being
  // misread until those episodes age out.
  return !(ep.success === false && NEUTRAL_ERROR_RE.test(ep.notes ?? ""));
}

export type ReflectionKind =
  | "intent_reliability"
  | "failure_cluster"
  | "latency_outlier"
  | "pitfall_recurrence"
  | "signal_correlation"
  | "meta";

export interface Reflection {
  id: string;
  /**
   * Stable identity of the THING this says something about (kind + subject), independent of the numbers
   * in the sentence. A later pass about the same subject REPLACES this one.
   *
   * Without it, de-duping compared the rendered sentence - which embeds live counts - so
   * `succeeded in all 40 recorded runs` and `all 80` were "different" insights and every pass piled up
   * another paraphrase. Worse, a superseded claim stayed: once a site broke, recall served
   * `succeeded in all recorded runs` next to `"click" fails often`, and the stale one was never withdrawn.
   */
  key: string;
  domain: string;
  kind: ReflectionKind;
  /** One sentence a human (or an agent) can act on. */
  insight: string;
  /** What to do about it, when there is something to do. */
  advice?: string;
  intent?: string;
  /**
   * The CONCLUSION, independent of the numbers that support it: "never_failed", "flaky", "slow"... Two
   * insights with the same key and the same verdict say the same thing even when their counts differ, so
   * a bigger tally of the same fact does not rewrite the store. A different verdict (a site that broke)
   * does, and replaces the old one.
   */
  verdict: string;
  /** How it was derived, so a reader can check it rather than trust it. */
  evidence: Record<string, number | string>;
  /** 1 = drawn from episodes, 2 = drawn from earlier reflections. Never deeper (see MAX_DEPTH). */
  depth: number;
  createdAt: string;
  /** Timestamp of the newest episode this reflection accounts for; the watermark for the next run. */
  coversThrough: string;
  importanceConsumed: number;
}

/** Unreflected importance that triggers a pass. About a few dozen ordinary runs. */
export const REFLECT_THRESHOLD = 50;
/** Reflections about reflections are allowed; reflections about those are not. */
export const MAX_DEPTH = 2;
/** Most reflections kept per domain, newest first. */
export const MAX_PER_DOMAIN = 30;
/** Most domains kept overall, so a long-lived hub's store cannot grow without bound. */
export const MAX_DOMAINS = 200;
const MIN_EPISODES = 4;

// ── importance ──────────────────────────────────────────────────────────────

/**
 * How much this episode is worth thinking about, in the spirit of the paper's 1-10 scale but computed
 * from what the hub knows rather than asked of a model.
 */
export function importanceOf(ep: ExecutionEpisode, ctx: { seenIntents: Set<string>; previousFailed: boolean }): number {
  if (!isInformative(ep)) return 0;
  const hadPitfall = (ep.pitfallsEncountered ?? []).length > 0;
  if (!ep.success) return hadPitfall ? 8 : 5;
  if (ctx.previousFailed) return 5; // recovering from a failure is the most instructive success
  if (!ctx.seenIntents.has(ep.intent)) return 3; // first time this domain did this at all
  return 1;
}

/** Total importance of episodes newer than `since`, and the newest timestamp seen. */
export function unreflectedImportance(episodes: ExecutionEpisode[], since: string | null): { total: number; newest: string | null; counted: number } {
  const ordered = [...episodes].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  const seenIntents = new Set<string>();
  let previousFailed = false;
  let total = 0;
  let counted = 0;
  let newest: string | null = null;

  for (const ep of ordered) {
    const fresh = (since === null || ep.timestamp > since) && isInformative(ep);
    if (fresh) {
      total += importanceOf(ep, { seenIntents, previousFailed });
      counted += 1;
      newest = ep.timestamp;
    }
    // Context accumulates over ALL episodes still held, not just the fresh ones. Consolidation prunes the
    // store to its newest 50, so an intent last seen long ago can score the "first time" bonus again. That
    // is an accepted imprecision, not a bug: it can only bring a pass forward, and a pass whose verdicts
    // are unchanged writes nothing (see runReflectionPass), so an early trigger costs a comparison and no
    // more. Measured: after pruning, ten routine runs score 10 against a threshold of 50.
    seenIntents.add(ep.intent);
    previousFailed = !ep.success;
  }
  return { total, newest, counted };
}

// ── synthesis ───────────────────────────────────────────────────────────────

const pct = (n: number): string => `${Math.round(n * 100)}%`;
const round = (n: number, dp = 2): number => Math.round(n * 10 ** dp) / 10 ** dp;

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

interface Tally { intent: string; runs: number; failures: number; durations: number[] }

function tallyByIntent(episodes: ExecutionEpisode[]): Map<string, Tally> {
  const out = new Map<string, Tally>();
  for (const ep of episodes) {
    const t = out.get(ep.intent) ?? { intent: ep.intent, runs: 0, failures: 0, durations: [] };
    t.runs += 1;
    if (!ep.success) t.failures += 1;
    if (Number.isFinite(ep.durationMs) && ep.durationMs > 0) t.durations.push(ep.durationMs);
    out.set(ep.intent, t);
  }
  return out;
}

/**
 * Derives insights from a domain's episodes. Pure: same episodes in, same insights out, so a test can
 * pin every rule. `now` and `seq` are supplied so ids and timestamps are not wall-clock dependent.
 */
export function synthesise(domain: string, all: ExecutionEpisode[], now: string, seq = 0): Omit<Reflection, "coversThrough" | "importanceConsumed">[] {
  const episodes = all.filter(isInformative);
  if (episodes.length < MIN_EPISODES) return [];
  const out: Omit<Reflection, "coversThrough" | "importanceConsumed">[] = [];
  let n = seq;
  const add = (kind: ReflectionKind, subject: string, verdict: string, insight: string, evidence: Record<string, number | string>, extra: { advice?: string; intent?: string; depth?: number } = {}) => {
    out.push({ id: `refl_${domain.replace(/\./g, "_")}_${now.replace(/[^0-9]/g, "").slice(0, 14)}_${n++}`, key: `${kind}:${subject}`, verdict, domain, kind, insight, evidence, depth: extra.depth ?? 1, createdAt: now, ...(extra.advice ? { advice: extra.advice } : {}), ...(extra.intent ? { intent: extra.intent } : {}) });
  };

  const byIntent = tallyByIntent(episodes);
  const allDurations = episodes.map((e) => e.durationMs).filter((d) => Number.isFinite(d) && d > 0);
  const domainMedian = allDurations.length ? median(allDurations) : 0;

  // 1. Which intents are reliable here, and which are not. Only worth saying with enough runs.
  for (const t of byIntent.values()) {
    if (t.runs < 3) continue;
    const rate = (t.runs - t.failures) / t.runs;
    if (t.failures === 0) {
      add("intent_reliability", t.intent, "never_failed", `"${t.intent}" has succeeded in all ${t.runs} recorded runs on ${domain}.`,
        { intent: t.intent, runs: t.runs, successRate: round(rate) }, { intent: t.intent });
    } else if (rate < 0.7) {
      add("intent_reliability", t.intent, "flaky", `"${t.intent}" fails often on ${domain}: ${t.failures} of ${t.runs} runs (${pct(1 - rate)} failure rate).`,
        { intent: t.intent, runs: t.runs, failures: t.failures, successRate: round(rate) },
        { intent: t.intent, advice: `Verify each "${t.intent}" with web_expect before relying on it, and record a pitfall when it fails so the cause is not rediscovered.` });
    }
  }

  // 2. Do the failures all land on one intent? That points at the cause much better than a global rate.
  const failures = episodes.filter((e) => !e.success);
  if (failures.length >= 2) {
    const worst = [...byIntent.values()].sort((a, b) => b.failures - a.failures)[0];
    if (worst && worst.failures === failures.length && byIntent.size > 1) {
      add("failure_cluster", worst.intent, "clustered", `Every failure on ${domain} (${failures.length}) was "${worst.intent}"; everything else succeeded.`,
        { intent: worst.intent, failures: worst.failures, totalFailures: failures.length, otherIntents: byIntent.size - 1 },
        { intent: worst.intent, advice: `Treat "${worst.intent}" as the fragile step here rather than distrusting the whole domain.` });
    }
  }

  // 3. A step far slower than the rest of the domain: usually a timeout or a wait worth planning for.
  if (domainMedian > 0) {
    for (const t of byIntent.values()) {
      if (t.durations.length < 2) continue;
      const m = median(t.durations);
      if (m >= domainMedian * 4 && m >= 3000) {
        add("latency_outlier", t.intent, "slow", `"${t.intent}" is much slower than the typical step on ${domain}: ${Math.round(m)}ms against a domain median of ${Math.round(domainMedian)}ms.`,
          { intent: t.intent, medianMs: Math.round(m), domainMedianMs: Math.round(domainMedian), runs: t.durations.length },
          { intent: t.intent, advice: `Allow for ~${Math.ceil(m / 1000)}s on "${t.intent}" and wait on a real condition (web_expect) rather than a fixed pause.` });
      }
    }
  }

  // 4. A documented pitfall that keeps happening anyway is the most actionable thing here.
  const pitfallHits = new Map<string, number>();
  for (const ep of episodes) for (const p of ep.pitfallsEncountered ?? []) pitfallHits.set(p, (pitfallHits.get(p) ?? 0) + 1);
  for (const [pitfall, hits] of pitfallHits) {
    if (hits < 2) continue;
    add("pitfall_recurrence", pitfall, "recurring", `Pitfall "${pitfall}" was cited in ${hits} runs on ${domain}.`,
      { pitfall, hits },
      { advice: "If it is documented, read its provenSolution in web_recall BEFORE acting and correct it if it no longer works; if it is not, record it with web_learn {action:\"pitfall\"}." });
  }

  // 5. Signals only speak when a caller supplied them (see the header): most stores have none.
  const withSignals = episodes.filter((e) => e.conditionSignals && Object.keys(e.conditionSignals).length > 0);
  if (withSignals.length >= MIN_EPISODES) {
    const stats = new Map<string, { onOk: number; onRuns: number; offOk: number; offRuns: number }>();
    for (const ep of withSignals) {
      for (const [sig, on] of Object.entries(ep.conditionSignals!)) {
        const s = stats.get(sig) ?? { onOk: 0, onRuns: 0, offOk: 0, offRuns: 0 };
        if (on) { s.onRuns += 1; if (ep.success) s.onOk += 1; } else { s.offRuns += 1; if (ep.success) s.offOk += 1; }
        stats.set(sig, s);
      }
    }
    for (const [sig, s] of stats) {
      if (s.onRuns < 2 || s.offRuns < 2) continue;
      const onRate = s.onOk / s.onRuns;
      const offRate = s.offOk / s.offRuns;
      if (onRate - offRate >= 0.4) {
        add("signal_correlation", sig, "correlated", `On ${domain}, runs succeed ${pct(onRate)} of the time when "${sig}" is present against ${pct(offRate)} when it is not (${s.onRuns + s.offRuns} runs with the signal recorded).`,
          { signal: sig, withSignalRate: round(onRate), withoutSignalRate: round(offRate), runs: s.onRuns + s.offRuns },
          { advice: `Probe for "${sig}" first and prefer the branch that expects it.` });
      }
    }
  }

  return out;
}

/**
 * A depth-2 pass: what the earlier reflections say together. Kept deliberately narrow - it only reports
 * a pattern that spans several depth-1 insights, so it cannot become a paraphrase treadmill.
 */
export function synthesiseMeta(domain: string, priors: Reflection[], now: string, seq = 0): Omit<Reflection, "coversThrough" | "importanceConsumed">[] {
  const depth1 = priors.filter((r) => r.depth === 1);
  if (depth1.length < 3) return [];

  // DISTINCT intents: three paraphrases about one flaky step are not "several steps", and printing
  // "unreliable across several steps (click, click, click)" is worse than saying nothing.
  const shakyIntents = [...new Set(depth1
    .filter((r) => r.kind === "intent_reliability" && typeof r.evidence.successRate === "number" && (r.evidence.successRate as number) < 0.7)
    .map((r) => r.intent)
    .filter((i): i is string => Boolean(i)))];
  const recurring = depth1.filter((r) => r.kind === "pitfall_recurrence");
  const out: Omit<Reflection, "coversThrough" | "importanceConsumed">[] = [];

  if (shakyIntents.length >= 2) {
    const intents = shakyIntents.join(", ");
    out.push({
      id: `refl_${domain.replace(/\./g, "_")}_${now.replace(/[^0-9]/g, "").slice(0, 14)}_meta${seq}`,
      key: "meta:shaky_intents", verdict: "shaky",
      domain, kind: "meta", depth: 2, createdAt: now,
      insight: `${domain} is unreliable across several steps (${intents}), not just one.`,
      advice: "Treat this domain as unmastered: verify every action with web_expect and do not batch steps, whatever its level says.",
      evidence: { shakyIntents: shakyIntents.length, insights: depth1.length },
    });
  }
  if (recurring.length >= 2) {
    out.push({
      id: `refl_${domain.replace(/\./g, "_")}_${now.replace(/[^0-9]/g, "").slice(0, 14)}_meta${seq + 1}`,
      key: "meta:recurring_pitfalls", verdict: "recurring",
      domain, kind: "meta", depth: 2, createdAt: now,
      insight: `${recurring.length} pitfalls keep being hit on ${domain}: the recorded solutions are not being applied, no longer work, or were never written down.`,
      advice: "Call web_recall and read the pitfalls before acting on this domain; re-verify any provenSolution that keeps failing, and record the ones that have no entry.",
      evidence: { recurringPitfalls: recurring.length },
    });
  }
  return out;
}

// ── the pass ────────────────────────────────────────────────────────────────

export interface ReflectionPassResult {
  domain: string;
  reflected: boolean;
  reason?: string;
  importance: number;
  insights: Reflection[];
}

/**
 * Reflects over every domain with episodes (or just one), mutating `mem.reflections` in place and
 * reporting what it did. Kept here rather than in the store so the whole rule set - what is worth
 * thinking about, and when - lives in one file that a test can drive directly.
 *
 * A domain under REFLECT_THRESHOLD is left completely alone, so an idle store is never rewritten.
 * Insights identical to one already recorded are dropped: a second pass over the same evidence adds
 * nothing rather than piling up paraphrases of itself.
 */
export function runReflectionPass(
  mem: CognitiveMemoryData,
  params: { domain?: string; force?: boolean; normalize: (d: string) => string },
): { results: ReflectionPassResult[]; changed: boolean } {
  const wanted = params.domain ? params.normalize(params.domain) : null;
  const domains = wanted ? [wanted] : [...new Set(mem.episodes.map((e) => params.normalize(e.domain)))];
  const now = new Date().toISOString();
  const results: ReflectionPassResult[] = [];
  let changed = false;

  for (const domain of domains) {
    const episodes = mem.episodes.filter((e) => params.normalize(e.domain) === domain);
    const priors = mem.reflections[domain] ?? [];
    const watermark = priors.reduce<string | null>((max, r) => (max === null || r.coversThrough > max ? r.coversThrough : max), null);
    const { total, newest, counted } = unreflectedImportance(episodes, watermark);

    if (!params.force && total < REFLECT_THRESHOLD) {
      results.push({ domain, reflected: false, reason: `nothing new enough to reflect on yet (${total}/${REFLECT_THRESHOLD} importance across ${counted} new episode(s))`, importance: total, insights: [] });
      continue;
    }

    const fresh = [
      ...synthesise(domain, episodes, now, priors.length),
      ...synthesiseMeta(domain, priors, now, priors.length),
    ].map((r): Reflection => ({ ...r, coversThrough: newest ?? watermark ?? now, importanceConsumed: total }));

    // An insight about a subject SUPERSEDES whatever was said about that subject before, and one that is
    // word-for-word what is already recorded is not worth rewriting the file for.
    const superseded = new Set(fresh.map((r) => r.key));
    const changedAnything = fresh.some((r) => !priors.some((prior) => prior.key === r.key && prior.verdict === r.verdict));
    if (!changedAnything) {
      results.push({ domain, reflected: false, reason: "nothing new to say about this domain yet", importance: total, insights: [] });
      continue;
    }

    mem.reflections[domain] = [...fresh, ...priors.filter((prior) => !superseded.has(prior.key))].slice(0, MAX_PER_DOMAIN);
    changed = true;
    results.push({ domain, reflected: true, importance: total, insights: fresh });
  }

  // Nothing else prunes this collection, and a long-lived hub meets many hosts. Keep the domains that
  // were reflected on most recently; the rest can be worked out again from episodes if they come back.
  if (changed) {
    const keys = Object.keys(mem.reflections);
    if (keys.length > MAX_DOMAINS) {
      const newest = (d: string) => (mem.reflections[d] ?? []).reduce((max, r) => (r.createdAt > max ? r.createdAt : max), "");
      for (const d of keys.sort((a, b) => newest(b).localeCompare(newest(a))).slice(MAX_DOMAINS)) delete mem.reflections[d];
    }
  }

  return { results, changed };
}
