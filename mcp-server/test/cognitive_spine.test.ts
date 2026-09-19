// The competence spine (Phase 2 of the cognitive spine): one earned level per domain.
//
// Three engines used to decide how "grown up" a domain was, from different numbers, and disagreed:
// after 20 successful calls one domain was a child (maturation), a 24-year-old adult (lifespan) and an
// infant (development) at once, and none of it changed any behaviour. These tests pin the replacement:
// a level earned only from hub-observed evidence, hard to farm, lost as well as won, and shown
// identically by every level tool.

import "./_isolate-data-dir.js"; // Must stay the first import (points the data dir at a temp folder)
import test from "node:test";
import assert from "node:assert/strict";
import { CognitiveSpine, globalSpine, normalizeDomain } from "../cognitive-spine.js";
import { DAY_MS as D, REQUIREMENTS, gaps, newRecord } from "../cognitive-spine-ladder.js";
import { AGE_CUTOFFS, XP_CUTOFFS, ageFor, syncViews, xpFor } from "../cognitive-spine-views.js";
import { CognitiveDevelopmentEngine } from "../cognitive-development.js";
import { CognitiveLifespanEngine } from "../cognitive-lifespan.js";
import { CognitiveMaturationEngine } from "../cognitive-maturation.js";

const T0 = Date.UTC(2026, 0, 1, 12);
const H = 3_600_000;

/** `sessions` distinct sessions, each with `per` verified successes, one session per `spacing`. */
function feed(spine: CognitiveSpine, domain: string, sessions: number, per: number, first = 0, start = T0, spacing = 1000): number {
  let t = start;
  for (let i = first; i < first + sessions; i += 1) {
    for (let j = 0; j < per; j += 1) { t = start + i * spacing + j * 10; spine.record(domain, "verified", `s${i}`, t); }
  }
  return t;
}

// ── the ladder ──────────────────────────────────────────────────────────────

test("an unknown domain is a NOVICE and evaluating it stores nothing", () => {
  const s = new CognitiveSpine();
  const ev = s.evaluate("nobody.example", T0);
  assert.equal(ev.level, 1);
  assert.equal(ev.levelName, "NOVICE");
  assert.equal(ev.source, "earned");
  assert.equal(s.has("nobody.example"), false, "reading must not create a record");
});

test("each rung needs ALL of its criteria: weight, distinct sessions, elapsed days", () => {
  const s = new CognitiveSpine();
  const d = "climb.example";

  // One busy session is never enough for the second rung: it needs 2 distinct sessions.
  for (let i = 0; i < 10; i += 1) s.record(d, "verified", "s0", T0 + i * 10);
  assert.equal(s.evaluate(d, T0 + 1000).level, 1);
  assert.match(s.evaluate(d, T0 + 1000).next!.needs.join(" | "), /distinct session/);

  s.record(d, "verified", "s1", T0 + 2000);
  assert.equal(s.evaluate(d, T0 + 2000).levelName, "ADVANCED_BEGINNER");

  s.record(d, "verified", "s2", T0 + 3000);
  assert.equal(s.evaluate(d, T0 + 3000).levelName, "COMPETENT");

  // PROFICIENT: 20 weighted successes and 5 sessions are met, but all within seconds: it needs 3 days.
  feed(s, d, 2, 5, 3, T0, 1000);
  s.record(d, "verified", "s5", T0 + 9000);
  const burst = s.evaluate(d, T0 + 9000);
  assert.equal(burst.level, 3, "a burst cannot skip the elapsed-time requirement");
  assert.match(burst.next!.needs.join(" | "), /day\(s\) of activity/);

  s.record(d, "verified", "s6", T0 + REQUIREMENTS[4].days * D);
  assert.equal(s.evaluate(d, T0 + 3 * D).levelName, "PROFICIENT");

  // EXPERT: 50 weighted, 8 sessions, 7 days.
  for (let i = 7; i < 14; i += 1) feed(s, d, 1, 8, i, T0, D);
  const top = s.evaluate(d, T0 + 14 * D);
  assert.equal(top.levelName, "EXPERT");
  assert.ok(top.evidence.spanDays >= REQUIREMENTS[5].days);
  assert.equal(top.next, null, "nothing above EXPERT");
});

test("one session cannot farm a level however many successes it reports", () => {
  const s = new CognitiveSpine();
  for (let i = 0; i < 500; i += 1) s.record("farm.example", "verified", "only-session", T0 + i);
  const ev = s.evaluate("farm.example", T0 + 1000);
  assert.equal(ev.level, 1, "500 successes in one session still leave a NOVICE");
  assert.equal(ev.evidence.weightedSuccesses, 10, "diminishing returns cap a session at 10");
  assert.equal(ev.evidence.sessions, 1);

  for (let i = 0; i < 500; i += 1) s.record("farm.example", "verified", "second-session", T0 + 2000 + i);
  const two = s.evaluate("farm.example", T0 + 4000);
  assert.equal(two.evidence.weightedSuccesses, 20);
  assert.equal(two.level, 2, "two sessions reach ADVANCED_BEGINNER and no higher");
});

test("unverified and merely reported successes are worth little and are capped per session", () => {
  const s = new CognitiveSpine();
  for (let i = 0; i < 1000; i += 1) s.record("weak.example", "weak", "s", T0 + i);
  assert.equal(s.evaluate("weak.example", T0 + 5000).evidence.weightedSuccesses, 1, "1000 bare 'ok's are worth one verified success");

  for (let i = 0; i < 1000; i += 1) s.record("claim.example", "reported", "s", T0 + i);
  assert.equal(s.evaluate("claim.example", T0 + 5000).evidence.weightedSuccesses, 0.5, "1000 self-reported successes are worth half of one");
  assert.equal(s.evaluate("claim.example", T0 + 5000).level, 1);
});

test("two failures in a row drop a rung and freeze promotion for a day; one failure does not", () => {
  const s = new CognitiveSpine();
  const d = "regress.example";
  feed(s, d, 3, 3);
  assert.equal(s.evaluate(d, T0 + 10_000).levelName, "COMPETENT");

  s.record(d, "failure", "s0", T0 + 20_000);
  s.record(d, "verified", "s1", T0 + 21_000);
  s.record(d, "failure", "s1", T0 + 22_000);
  assert.equal(s.evaluate(d, T0 + 23_000).levelName, "COMPETENT", "isolated failures between successes are not a regression");

  s.record(d, "failure", "s1", T0 + 24_000);
  const dropped = s.evaluate(d, T0 + 25_000);
  assert.equal(dropped.levelName, "ADVANCED_BEGINNER");
  assert.equal(dropped.regressedRecently, true);
  assert.ok(dropped.frozenUntil);

  // While frozen, even a criteria-satisfying success cannot promote.
  s.record(d, "verified", "s7", T0 + 30_000);
  const frozen = s.evaluate(d, T0 + 30_000);
  assert.equal(frozen.level, 2);
  assert.match(frozen.next!.needs.join(" | "), /frozen/);

  s.record(d, "verified", "s8", T0 + 25 * H);
  assert.equal(s.evaluate(d, T0 + 25 * H).levelName, "COMPETENT", "after the freeze the earned rung comes back");
});

test("a breaker trip drops a rung, and EXPERT needs a breaker-free fortnight", () => {
  const s = new CognitiveSpine();
  feed(s, "trip.example", 3, 3);
  s.record("trip.example", "breaker", "hub", T0 + 10_000);
  const ev = s.evaluate("trip.example", T0 + 11_000);
  assert.equal(ev.levelName, "ADVANCED_BEGINNER");
  assert.equal(ev.evidence.breakers, 1);

  // The fortnight rule, on a hand-built record that meets every other EXPERT criterion.
  const rec = newRecord("gate.example", T0);
  rec.level = 4;
  rec.archived = { w: 60, sessions: 9 };
  rec.firstSuccessAt = T0;
  rec.lastSuccessAt = T0 + 9 * D;
  rec.lastBreakerAt = T0 + 9 * D - 5 * D;
  assert.match(gaps(rec, 5, T0 + 9 * D).join(" | "), /no breaker trip for 14 days/);
  rec.lastBreakerAt = T0 + 9 * D - 15 * D;
  assert.deepEqual(gaps(rec, 5, T0 + 9 * D), [], "fifteen quiet days later every criterion is met");
});

test("a rung decays after 30 idle days and a fresh success resets the clock", () => {
  const s = new CognitiveSpine();
  const last = feed(s, "decay.example", 3, 3);
  assert.equal(s.evaluate("decay.example", last + 29 * D).levelName, "COMPETENT");
  assert.equal(s.evaluate("decay.example", last + 31 * D).levelName, "ADVANCED_BEGINNER");
  assert.equal(s.evaluate("decay.example", last + 31 * D).levelName, "ADVANCED_BEGINNER", "decay is idempotent for a given moment");
  assert.equal(s.evaluate("decay.example", last + 61 * D).levelName, "NOVICE");
  assert.equal(s.evaluate("decay.example", last + 400 * D).levelName, "NOVICE", "it floors at NOVICE");

  const fresh = new CognitiveSpine();
  const t = feed(fresh, "keep.example", 3, 3);
  fresh.record("keep.example", "verified", "later", t + 25 * D);
  assert.equal(fresh.evaluate("keep.example", t + 25 * D + 25 * D).levelName, "COMPETENT", "a success at day 25 restarts the 30-day clock");
});

test("a high recent failure rate blocks promotion even with plenty of successes", () => {
  const s = new CognitiveSpine();
  // Alternate success / failure across three sessions: never two failures in a row, so no demotion.
  for (let i = 0; i < 3; i += 1) {
    for (let j = 0; j < 4; j += 1) {
      s.record("flaky.example", "verified", `s${i}`, T0 + i * 1000 + j * 20);
      s.record("flaky.example", "failure", `s${i}`, T0 + i * 1000 + j * 20 + 10);
    }
  }
  const ev = s.evaluate("flaky.example", T0 + 5000);
  assert.ok(ev.evidence.weightedSuccesses >= REQUIREMENTS[3].w && ev.evidence.sessions >= REQUIREMENTS[3].sessions);
  assert.equal(ev.level, 2, "weight and sessions are enough, but a 50% failure rate is not");
  assert.match(ev.next!.needs.join(" | "), /failure rate/);
});

test("a vouch is audited and capped at COMPETENT, and never becomes earned level", () => {
  const s = new CognitiveSpine();
  s.vouch("trusted.example", 5, "I know this site", "operator", T0);
  const ev = s.evaluate("trusted.example", T0);
  assert.equal(ev.level, 1, "the EARNED level is untouched");
  assert.equal(ev.effectiveLevel, 3, "the advisory level is capped at COMPETENT");
  assert.equal(ev.source, "vouched");
  assert.equal(ev.vouch?.requested, 5);
  assert.equal(s.earnedLevel("trusted.example", T0), 1, "a safety decision reading earnedLevel() cannot be moved by a vouch");

  feed(s, "trusted2.example", 3, 3);
  s.vouch("trusted2.example", 2, "meh", "operator", T0 + 10_000);
  assert.equal(s.evaluate("trusted2.example", T0 + 10_000).source, "earned", "a vouch below what was earned changes nothing");

  for (let i = 0; i < 15; i += 1) s.vouch("trusted.example", 2, `note ${i}`, "operator", T0 + i);
  const snap = s.snapshotState() as { records: Array<[string, { vouches: unknown[] }]> };
  assert.equal(snap.records.find(([k]) => k === "trusted.example")![1].vouches.length, 10, "the audit trail is bounded");
});

test("trimming old sessions never lowers the weight or session count", () => {
  const s = new CognitiveSpine();
  for (let i = 0; i < 60; i += 1) s.record("wide.example", "verified", `s${i}`, T0 + i * 1000);
  const ev = s.evaluate("wide.example", T0 + 100_000);
  assert.equal(ev.evidence.weightedSuccesses, 60);
  assert.equal(ev.evidence.sessions, 60);
  const snap = s.snapshotState() as { records: Array<[string, { sessions: Record<string, unknown> }]> };
  assert.ok(Object.keys(snap.records[0][1].sessions).length <= 40, "the per-session map is bounded");
});

test("domains are normalised, an empty one is refused, and the record count is bounded", () => {
  const s = new CognitiveSpine();
  s.record("WWW.Example.COM", "verified", "s", T0);
  assert.equal(s.evaluate("example.com", T0).evidence.verified, 1);
  assert.equal(normalizeDomain("  www.X.com "), "x.com");
  assert.throws(() => s.record("   ", "verified", "s", T0), /domain is required/);

  feed(s, "established.example", 2, 2);
  assert.equal(s.evaluate("established.example", T0 + 5000).level, 2);
  for (let i = 0; i < 520; i += 1) s.record(`filler-${i}.example`, "weak", "s", T0 + 10_000 + i);
  assert.ok(s.domains().length <= 500);
  assert.ok(s.has("established.example"), "eviction forgets NOVICE domains first, not one that earned a level");
});

test("a saved spine restores exactly, and a corrupt one is rejected without touching the live one", () => {
  const s = new CognitiveSpine();
  feed(s, "keep.example", 3, 3);
  s.vouch("keep.example", 3, "ok", "op", T0 + 5000);
  const saved = JSON.parse(JSON.stringify(s.snapshotState()));

  const revived = new CognitiveSpine();
  revived.restoreState(saved);
  assert.deepEqual(revived.evaluate("keep.example", T0 + 10_000), s.evaluate("keep.example", T0 + 10_000));

  const live = new CognitiveSpine();
  feed(live, "mine.example", 2, 2);
  const before = JSON.stringify(live.snapshotState());
  for (const bad of [
    { records: [["a.example", { level: 9 }]] },
    { records: [["a.example", { ...saved.records[0][1], level: 99 }]] },
    { records: [["a.example", { ...saved.records[0][1], recent: ["yes"] }]] },
    { records: [["a.example", { ...saved.records[0][1], totals: { verified: -1, weak: 0, reported: 0, failures: 0, breakers: 0 } }]] },
    { records: "nope" },
  ]) {
    assert.throws(() => live.restoreState(bad), Error);
    assert.equal(JSON.stringify(live.snapshotState()), before, "a rejected snapshot must not change the live spine");
  }
});

// ── the views: every level tool agrees ─────────────────────────────────────

const stageOf = (s: string, re: RegExp): number => Number(s.match(re)![1]);

test("maturation, lifespan and stage show the SAME level at every rung, with XP and age inside its band", () => {
  const dom = "views-agree.example";
  const base = Date.now() - 12 * D;
  const expected = [1, 2, 3, 3, 4, 4, 4, 5];
  for (let k = 0; k < 8; k += 1) {
    for (let j = 0; j < 8; j += 1) globalSpine.record(dom, "verified", `agree-${k}`, base + k * D + j * 10);
    const v = syncViews(dom);
    const level = expected[k];
    assert.equal(v.evaluation.level, level, `after session ${k + 1} the spine is at level ${level}`);
    assert.equal(v.development.stage, level);
    assert.equal(v.maturation.stageLevel, level);
    assert.equal(stageOf(v.maturation.stage, /STAGE_(\d)/), level);
    assert.equal(stageOf(v.lifespan.stage, /LEVEL_(\d)/), level);
    assert.ok(v.maturation.cognitiveXp >= XP_CUTOFFS[level - 1] && v.maturation.cognitiveXp <= XP_CUTOFFS[level], `XP ${v.maturation.cognitiveXp} must sit in level ${level}'s band`);
    assert.ok(v.lifespan.cognitiveAgeYears >= AGE_CUTOFFS[level - 1] && v.lifespan.cognitiveAgeYears <= AGE_CUTOFFS[level], `age ${v.lifespan.cognitiveAgeYears} must sit in level ${level}'s band`);
    assert.equal(v.maturation.successfulActions, v.lifespan.successfulMilestones, "the evidence counters agree too");
  }
});

test("the old contradiction is gone: 20 successes in one session leave every tool saying NOVICE", () => {
  // Before: maturation = child, lifespan = a 24-year-old adult, development = infant, from the same 20 calls.
  const dom = "twenty-calls.example";
  for (let i = 0; i < 20; i += 1) globalSpine.record(dom, "verified", "one-session", Date.now() - 60_000 + i);
  const v = syncViews(dom);
  assert.equal(v.development.stage, 1);
  assert.equal(v.maturation.stageLevel, 1);
  assert.equal(stageOf(v.lifespan.stage, /LEVEL_(\d)/), 1);
  assert.ok(v.lifespan.cognitiveAgeYears < 2, `age ${v.lifespan.cognitiveAgeYears} must not be an adult's`);
});

test("a vouched domain shows the START of its vouched level, and the earned level stays visible", () => {
  const dom = "vouched-view.example";
  globalSpine.vouch(dom, 5, "operator says so", "op");
  const v = syncViews(dom);
  assert.equal(v.evaluation.level, 1);
  assert.equal(v.evaluation.effectiveLevel, 3);
  assert.equal(v.maturation.stageLevel, 3);
  assert.equal(v.maturation.cognitiveXp, XP_CUTOFFS[2], "a human's word is not progress within the level");
  assert.equal(v.lifespan.cognitiveAgeYears, AGE_CUTOFFS[2]);
});

test("the XP and age scales are monotone across the level boundaries", () => {
  let lastXp = -1;
  let lastAge = -1;
  for (const level of [1, 2, 3, 4, 5] as const) {
    for (const p of [0, 0.25, 0.5, 0.75, 0.99]) {
      assert.ok(xpFor(level, p) >= lastXp && ageFor(level, p) >= lastAge, `level ${level} progress ${p} must not go backwards`);
      lastXp = xpFor(level, p);
      lastAge = ageFor(level, p);
    }
  }
});

// ── the engines under the views ────────────────────────────────────────────

test("x.com is not special: no engine seeds it as a Sage any more", () => {
  const dev = new CognitiveDevelopmentEngine().getMaturity("x.com");
  const mat = new CognitiveMaturationEngine().getOrEvolveProfile("x.com");
  const life = new CognitiveLifespanEngine().evaluateLifespan("x.com");
  assert.deepEqual([dev.stage, mat.stageLevel, life.stage], [1, 1, "LEVEL_1_INFANT_REFLEX"]);
  assert.deepEqual([dev.episodesCount, mat.cognitiveXp, life.successfulMilestones], [0, 0, 0], "no invented history");
});

test("lifespan applySpine sets the stage from the level, not from age and a burn count", () => {
  const engine = new CognitiveLifespanEngine();
  // The old age+burns rule would call 40 years with 9 burns a level-4 adult; the spine's level wins.
  const p = engine.applySpine("engine.example", { level: 5, ageYears: 40, milestones: 60, burns: 9 });
  assert.equal(p.stage, "LEVEL_5_SAGE_SYNTHESIS");
  assert.equal(p.scaffoldingLevel, "SOVEREIGN_SAGE");
  assert.equal(p.parameters.requireParentalConsent, false);
});

test("recordEpisode promotions now unlock capabilities (they used to stay frozen at the infant list)", () => {
  const engine = new CognitiveDevelopmentEngine();
  const before = engine.getMaturity("caps.example").unlockedCapabilities;
  assert.ok(!before.includes("linear_playback"));
  const after = engine.recordEpisode({ domain: "caps.example", success: true, durationMs: 4000, drift: false });
  assert.equal(after.stage, 2);
  assert.ok(after.unlockedCapabilities.includes("linear_playback"));
  assert.ok(after.unlockedCapabilities.includes("raw_clicks"), "and keeps what the earlier stage unlocked");
});
