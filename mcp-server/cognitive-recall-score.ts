// ScreenSync Cognitive Recall - which playbook comes back first.
//
// recall() used to return matchingPlaybooks[0]: whichever matching playbook happened to be stored
// first, however stale, however unproven. This ranks them the way Generative Agents (Park et al.)
// rank memories: recency + importance + relevance, all weights 1.
//
//   recency     0.995 per hour since the playbook was last used (a week is about 0.43, a month about 0.03)
//   importance  how much it has earned: verified status, hub-confirmed successes, no recent failures.
//               Computed from data the hub holds. There is no model call.
//   relevance   how well it fits THIS cue: the intent, and the signals the caller detected on the page.
//
// Two deliberate departures from the paper, both because the candidate sets are tiny:
//   - Relevance is lexical, not embeddings. Embeddings would rank open corpora better but need a model and
//     a network; per-domain sets are small, so lexical is deterministic, testable and local-first.
//   - The components are NOT min-max normalised. The paper must, because its raw scores (importance 1-10,
//     cosine similarity) live on different scales. Ours are already absolute 0..1, and normalising a set
//     of two would stretch a few milliseconds' difference in recency into a full point and let it outvote
//     a genuine difference in how well a playbook fits the cue. (A test caught exactly that.)

import type { ProceduralPlaybook } from "./cognitive-memory.js";
import { isFastPath, statusOf } from "./cognitive-skills.js";

const HOURLY_DECAY = 0.995;
const HOUR_MS = 3_600_000;

export interface RecallCue {
  intent?: string;
  detectedSignals?: Record<string, boolean>;
}

export interface Scored {
  playbook: ProceduralPlaybook;
  score: number;
  components: { recency: number; importance: number; relevance: number };
}

/** When the playbook was last exercised, falling back to when it was made, else "long ago". */
function lastUsedMs(pb: ProceduralPlaybook): number {
  for (const stamp of [pb.lastExecutedAt, pb.verifiedAt, pb.createdAt]) {
    const t = stamp ? Date.parse(stamp) : NaN;
    if (Number.isFinite(t)) return t;
  }
  return 0;
}

export function recencyOf(pb: ProceduralPlaybook, now: number): number {
  const hours = Math.max(0, (now - lastUsedMs(pb)) / HOUR_MS);
  return HOURLY_DECAY ** hours;
}

/**
 * 0..1: how much this playbook has earned the right to be recommended.
 *
 * A healthy verified playbook starts at 0.5, so it always outranks a candidate (which tops out at 0.5).
 * A verified one that is CURRENTLY FAILING starts at 0, below an unproven draft: it has demonstrated that
 * it does not work right now, and a fresh candidate someone just got confirmed is the better suggestion.
 * Without that, a proven playbook broken by a site change kept being recommended over its replacement,
 * because its verified base outweighed everything the newcomer had earned.
 */
export function importanceOf(pb: ProceduralPlaybook): number {
  const status = statusOf(pb);
  const base = status === "deprecated" ? 0
    : status === "verified" ? (isFastPath(pb) ? 0.5 : 0)
    : 0.1;
  const earned = 0.4 * Math.min(1, (pb.successCount ?? 0) / 10);
  const docked = 0.1 * Math.min(3, pb.consecutiveFailures ?? 0);
  return Math.max(0, Math.min(1, base + earned - docked));
}

/** The signals a playbook is written around: its environmental probes and its branch triggers. */
function signalsOf(pb: ProceduralPlaybook): Set<string> {
  const out = new Set<string>();
  for (const p of pb.environmentalProbes ?? []) if (p.signal) out.add(p.signal);
  for (const b of pb.branches ?? []) if (b.whenSignal) out.add(b.whenSignal);
  return out;
}

/**
 * 0..1: how well this playbook fits THIS cue.
 *
 * When the caller reports detected page signals, they are what distinguishes one playbook from another and
 * they carry most of the weight. When there are none, only the intent can speak. Splitting it 60/40 in all
 * cases made the signal term worth at most 0.4, which a week of staleness (recency ~0.43 against ~1.0) could
 * outvote - so the playbook written for the modal that is actually open lost to a fresher, unrelated one.
 */
export function relevanceOf(pb: ProceduralPlaybook, cue: RecallCue): number {
  const wanted = (cue.intent ?? "").trim().toLowerCase();
  const intentMatch = wanted && pb.intent.toLowerCase() === wanted ? 1 : 0;

  const detected = Object.entries(cue.detectedSignals ?? {}).filter(([, on]) => on).map(([k]) => k);
  if (detected.length === 0) return intentMatch;

  const mine = signalsOf(pb);
  const signalOverlap = detected.filter((s) => mine.has(s)).length / detected.length;
  return 0.25 * intentMatch + 0.75 * signalOverlap;
}

/**
 * Ranks playbooks for a cue, best first. Deterministic: ties fall to verified status, then the most
 * recently used, then the id, so the same store always answers the same way. Each component is 0..1.
 */
export function scorePlaybooks(playbooks: ProceduralPlaybook[], cue: RecallCue, now: number): Scored[] {
  if (playbooks.length === 0) return [];
  const r3 = (n: number): number => Math.round(n * 1000) / 1000;
  const scored = playbooks.map((playbook): Scored => {
    const components = { recency: recencyOf(playbook, now), importance: importanceOf(playbook), relevance: relevanceOf(playbook, cue) };
    return {
      playbook,
      score: r3(components.recency + components.importance + components.relevance),
      components: { recency: r3(components.recency), importance: r3(components.importance), relevance: r3(components.relevance) },
    };
  });

  const verified = (s: Scored): number => (statusOf(s.playbook) === "verified" ? 1 : 0);
  return scored.sort((a, b) =>
    b.score - a.score
    || verified(b) - verified(a)
    || lastUsedMs(b.playbook) - lastUsedMs(a.playbook)
    || a.playbook.id.localeCompare(b.playbook.id));
}
