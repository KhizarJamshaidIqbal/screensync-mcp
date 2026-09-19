// ScreenSync Cognitive Memory Architecture 11.0 Test Suite (MLDP)
// Tests the motivated learning-dynamics & prospective memory layer:
// 1. Piaget Assimilation vs Accommodation
// 2. Ebbinghaus Forgetting Curve + Spaced Repetition
// 3. Operant Conditioning Reinforcement Schedules
// 4. Prospective Memory (implementation intentions)
// 5. Source Monitoring (misattribution detection)
// 6. Proactive/Retroactive Interference between domains
// 7. Dopaminergic Reward Prediction Error
// 8. Sweller Cognitive Load Budgeting

// Must stay the first import: see _isolate-data-dir.ts
import "./_isolate-data-dir.js";
import test from "node:test";
import assert from "node:assert/strict";
import { CognitiveDynamicsEngine } from "../cognitive-dynamics.js";

test("MLDP: Piaget assimilation vs accommodation", () => {
  const engine = new CognitiveDynamicsEngine();

  const fit = engine.assimilateOrAccommodate("x.com", { matchesExistingSchema: true });
  assert.equal(fit.process, "ASSIMILATION");
  assert.equal(fit.schemaAction, "reinforce");
  assert.ok(fit.confidenceDelta > 0);

  const novel = engine.assimilateOrAccommodate("newapp.io", { matchesExistingSchema: false, noveltyScore: 0.9 });
  assert.equal(novel.process, "ACCOMMODATION");
  assert.equal(novel.schemaAction, "create");
  assert.ok(novel.confidenceDelta < 0);

  const partial = engine.assimilateOrAccommodate("newapp.io", { matchesExistingSchema: false, noveltyScore: 0.3 });
  assert.equal(partial.schemaAction, "rewrite");
});

test("MLDP: Ebbinghaus forgetting curve and spaced repetition", () => {
  const engine = new CognitiveDynamicsEngine();
  const now = Date.now();
  const result = engine.forgettingCurve("x.com", [
    { id: "fresh_strong", learnedAt: new Date(now).toISOString(), reviewCount: 3 },
    { id: "stale_weak", learnedAt: new Date(now - 10 * 86400000).toISOString(), reviewCount: 0 },
  ]);

  const fresh = result.retained.find((r) => r.id === "fresh_strong")!;
  const stale = result.retained.find((r) => r.id === "stale_weak")!;
  assert.ok(fresh.retention > 0.9);
  assert.ok(stale.retention < 0.1);

  assert.deepEqual(result.reviewDue, ["stale_weak"]);
  assert.ok(Date.parse(result.nextReviewSchedule.stale_weak) > now);
});

test("MLDP: operant reinforcement schedules track skill phase", () => {
  const engine = new CognitiveDynamicsEngine();

  const learning = engine.reinforcementSchedule("new.io", { successStreak: 1, totalAttempts: 2 });
  assert.equal(learning.schedule, "CONTINUOUS");
  assert.equal(learning.practiceDueNow, true);

  const consolidating = engine.reinforcementSchedule("mid.io", { successStreak: 5, totalAttempts: 20, hoursSinceLastPractice: 30 });
  assert.equal(consolidating.schedule, "FIXED_INTERVAL");
  assert.equal(consolidating.practiceDueNow, true);

  const master = engine.reinforcementSchedule("x.com", { successStreak: 15, totalAttempts: 200, hoursSinceLastPractice: 100 });
  assert.equal(master.schedule, "VARIABLE_INTERVAL");
  assert.ok(master.resistanceToExtinction > 0.8);
});

test("MLDP: prospective memory registers and fires implementation intentions", () => {
  const engine = new CognitiveDynamicsEngine();

  const registered = engine.prospectiveMemory({
    domain: "x.com", action: "register",
    intention: { triggerEvent: "login_wall", actionPlan: "re-authenticate with web_network_auth then retry compose" },
  });
  assert.ok(registered.registered);
  assert.equal(registered.totalIntentions, 1);

  const noMatch = engine.prospectiveMemory({ domain: "x.com", action: "check", observedEvent: "toast_success" });
  assert.equal(noMatch.fired?.length, 0);

  const fired = engine.prospectiveMemory({ domain: "x.com", action: "check", observedEvent: "login_wall" });
  assert.equal(fired.fired?.length, 1);
  assert.equal(fired.fired?.[0].actionPlan.includes("web_network_auth"), true);
});

test("MLDP: source monitoring detects misattribution and adjusts trust", () => {
  const engine = new CognitiveDynamicsEngine();
  const result = engine.sourceMonitoring("threads.net", [
    { id: "fact_verified", claimedSource: "aria_snapshot" },
    { id: "fact_misremembered", claimedSource: "x.com", actualEvidenceSource: "threads.net" },
  ]);

  assert.deepEqual(result.verified, ["fact_verified"]);
  assert.equal(result.misattributed.length, 1);
  assert.equal(result.misattributed[0].claimed, "x.com");
  assert.equal(result.misattributed[0].actual, "threads.net");
  // The falsely-claimed source loses trust; the real evidence source gains it
  assert.ok(result.sourceTrust["x.com"] < 0.5);
  assert.ok(result.sourceTrust["threads.net"] > 0.5);
});

test("MLDP: proactive/retroactive interference between similar domains", () => {
  const engine = new CognitiveDynamicsEngine();
  const result = engine.interferenceCheck("threads.net", [
    { domain: "x.com", sharedSelectors: 5, conflictingSteps: 2 },
    { domain: "example.com", sharedSelectors: 0, conflictingSteps: 0 },
  ]);

  const high = result.interferences.find((i) => i.otherDomain === "x.com")!;
  assert.ok(high.proactiveInterference > 0.6);
  assert.match(high.advice, /HIGH interference/);

  const none = result.interferences.find((i) => i.otherDomain === "example.com")!;
  assert.equal(none.proactiveInterference, 0);
  assert.match(none.advice, /Low interference/);
});

test("MLDP: dopaminergic reward prediction error modulates learning", () => {
  const engine = new CognitiveDynamicsEngine();

  const burst = engine.rewardPredictionError("x.com", { expectedReward: 0.5, actualReward: 0.95 });
  assert.equal(burst.dopamineState, "PHASIC_BURST_POSITIVE_SURPRISE");
  assert.ok(burst.learningRateBoost > 1);

  const dip = engine.rewardPredictionError("x.com", { expectedReward: 0.9, actualReward: 0.2 });
  assert.equal(dip.dopamineState, "PHASIC_DIP_NEGATIVE_SURPRISE");
  assert.match(dip.advice, /web_learn pitfall/);

  const expected = engine.rewardPredictionError("x.com", { expectedReward: 0.5, actualReward: 0.55 });
  assert.equal(expected.dopamineState, "TONIC_BASELINE_EXPECTED");
});

test("MLDP: Sweller cognitive load budgeting detects overload", () => {
  const engine = new CognitiveDynamicsEngine();

  const overloaded = engine.cognitiveLoadBudget("heavy.io", { intrinsic: 6, extraneous: 3, germane: 2 });
  assert.equal(overloaded.overloaded, true);
  assert.equal(overloaded.verdict, "COGNITIVE_OVERLOAD");
  assert.match(overloaded.simplificationAdvice, /Split the plan/);

  const learning = engine.cognitiveLoadBudget("study.io", { intrinsic: 2, extraneous: 0, germane: 5 });
  assert.equal(learning.overloaded, false);
  assert.equal(learning.verdict, "OPTIMAL_LEARNING_ZONE");

  const noisy = engine.cognitiveLoadBudget("ads.io", { intrinsic: 1, extraneous: 3, germane: 1 });
  assert.equal(noisy.verdict, "EXTRANEOUS_NOISE_HIGH");

  const comfy = engine.cognitiveLoadBudget("easy.io", { intrinsic: 1, extraneous: 0, germane: 1 });
  assert.equal(comfy.verdict, "COMFORTABLE");
  assert.equal(comfy.capacity, 7);
});
