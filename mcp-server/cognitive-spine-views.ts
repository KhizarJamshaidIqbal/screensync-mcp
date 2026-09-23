// ScreenSync Cognitive Spine - the "views": maturation, lifespan and stage all read one level.
//
// web_cognitive_stage, web_cognitive_maturation and web_cognitive_lifespan keep the response shapes
// they always had, but their stage, XP and cognitive age are now DERIVED from the spine on every
// read. They agree by construction, and none of them can be moved by a number a caller supplies.
//
// The XP and age scales are anchored to the boundaries each engine already used (XP 100/500/1500/3500,
// age 2/7/18/35), so a level lands on the same side of every old threshold, and progress toward the
// next rung slides the number smoothly between them.

import { globalSpine } from "./cognitive-spine.js";
import { REQUIREMENTS, type Evaluation, type Level } from "./cognitive-spine-ladder.js";
import { globalDevelopmentEngine, type DomainMaturity } from "./cognitive-development.js";
import { globalMaturationEngine, type OntogeneticProfile } from "./cognitive-maturation.js";
import { globalLifespanEngine, type LifespanProfile } from "./cognitive-lifespan.js";

/**
 * Who is calling, and (optionally) what page they're on. Handlers that record evidence need a session to
 * count distinct ones. `activeTabUrl` is the URL of the browser tab a hint-less web_* call would be routed
 * to right now (the same resolution resolveDispatch()/web_status's `activeTab` use) - null when no browser
 * is online. It lets a tool like web_recall infer a domain when the caller omits both `domain` and `url`,
 * instead of falling back to an unscoped guess.
 */
export interface CognitiveContext { session: string; activeTabUrl?: string | null }
export const HUB_SESSION = "hub";

/** Level L spans [c[L-1], c[L]). */
export const XP_CUTOFFS = [0, 100, 500, 1500, 3500, 5000];
export const AGE_CUTOFFS = [0.5, 2, 7, 18, 35, 50];
/** A verified success is worth about this much old-style development XP. */
const DEV_XP_PER_WEIGHT = 10;

function along(cutoffs: number[], level: Level, progress: number): number {
  const lo = cutoffs[level - 1];
  const hi = cutoffs[level];
  return lo + Math.max(0, Math.min(1, progress)) * (hi - lo);
}

export const xpFor = (level: Level, progress: number): number => Math.round(along(XP_CUTOFFS, level, progress));
export const ageFor = (level: Level, progress: number): number => Math.round(along(AGE_CUTOFFS, level, progress) * 10) / 10;

export interface Views {
  evaluation: Evaluation;
  development: DomainMaturity;
  maturation: OntogeneticProfile;
  lifespan: LifespanProfile;
}

/** Brings the three legacy profiles in line with the spine and returns them with the evaluation. */
export function syncViews(domain: string): Views {
  const ev = globalSpine.evaluate(domain);
  const level = ev.effectiveLevel;
  // A vouched level shows as the START of that level: a human's word is not progress within it.
  const progress = ev.source === "vouched" ? 0 : ev.progress;
  const successes = ev.evidence.verified + ev.evidence.weak + ev.evidence.reported;
  const setbacks = ev.evidence.failures + ev.evidence.breakers;

  return {
    evaluation: ev,
    development: globalDevelopmentEngine.applySpine(domain, {
      level,
      xp: Math.round(ev.evidence.weightedSuccesses * DEV_XP_PER_WEIGHT),
      episodes: successes + setbacks,
      successes,
      consecutiveFailures: ev.evidence.consecutiveFailures,
      regressed: ev.regressedRecently,
    }),
    maturation: globalMaturationEngine.applySpine(domain, { level, xp: xpFor(level, progress), successes, traumas: setbacks }),
    lifespan: globalLifespanEngine.applySpine(domain, { level, ageYears: ageFor(level, progress), milestones: successes, burns: setbacks }),
  };
}

/** The cognitive age a tool should default to when the caller did not supply one. */
export function spineAgeYears(domain: string): number {
  const ev = globalSpine.evaluate(domain);
  return ageFor(ev.effectiveLevel, ev.source === "vouched" ? 0 : ev.progress);
}

/** What every level tool adds to its response: where the level came from and what it would take to rise. */
export function competenceOf(ev: Evaluation): Record<string, unknown> {
  return {
    level: ev.level, levelName: ev.levelName,
    effectiveLevel: ev.effectiveLevel, effectiveName: ev.effectiveName,
    source: ev.source,
    progress: ev.progress,
    evidence: ev.evidence,
    next: ev.next,
    frozenUntil: ev.frozenUntil,
    regressedRecently: ev.regressedRecently,
    vouch: ev.vouch,
  };
}

/** Outcomes needed before the spine's own numbers may replace a caller's in the wisdom score. */
const WISDOM_MIN_OUTCOMES = 5;

/**
 * The two wisdom inputs a caller could otherwise inflate, measured by the hub instead: knowledge depth
 * from the weighted evidence toward PROFICIENT, and accuracy from the recent failure rate. Null until the
 * spine has seen enough outcomes to say anything, in which case the tool stays a plain calculator.
 */
export function hubWisdomInputs(domain: string): { knowledgeDepth: number; measuredAccuracy: number } | null {
  const ev = globalSpine.evaluate(domain).evidence;
  const outcomes = ev.verified + ev.weak + ev.reported + ev.failures + ev.breakers;
  if (outcomes < WISDOM_MIN_OUTCOMES) return null;
  return {
    knowledgeDepth: Math.min(1, ev.weightedSuccesses / REQUIREMENTS[4].w),
    measuredAccuracy: Math.max(0, Math.min(1, 1 - ev.failureRate)),
  };
}
