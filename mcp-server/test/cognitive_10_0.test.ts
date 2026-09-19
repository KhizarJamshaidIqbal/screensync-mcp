// ScreenSync Cognitive Memory Architecture 10.0 Test Suite (AIE-EC)
// Tests the child -> adolescent -> adult developmental level system:
// 1. Adolescent Synaptic Pruning (use-it-or-lose-it)
// 2. Critical Periods & Sensitive Windows (experience-expectant XP amplification)
// 3. Working Memory Digit Span Growth (Miller 7+-2)
// 4. Prefrontal Executive Function Battery (Miyake: inhibition, shifting, updating)
// 5. Erikson Psychosocial Identity Stages
// 6. Tulving Autonoetic Remember/Know tagging
// 7. Infant Error-Related Negativity + Social Referencing
// 8. Baltes Adult Wisdom Calibration

import test from "node:test";
import assert from "node:assert/strict";
import { AdolescentCognitionEngine } from "../cognitive-adolescent.js";

test("AIE-EC: Adolescent synaptic pruning eliminates weak playbooks and myelinates strong ones", () => {
  const engine = new AdolescentCognitionEngine();
  const result = engine.synapticPrune("x.com", [
    { id: "pb_proven", successCount: 12, lastExecutedAt: new Date().toISOString() },
    { id: "pb_weak", successCount: 1, lastExecutedAt: new Date().toISOString() },
    { id: "pb_stale", successCount: 4, lastExecutedAt: new Date(Date.now() - 90 * 86400000).toISOString() },
  ]);
  assert.deepEqual(result.pruned.sort(), ["pb_stale", "pb_weak"]);
  assert.deepEqual(result.myelinated, ["pb_proven"]);
  assert.ok(result.pruningIntensity > 0 && result.pruningIntensity < 1);

  // pruning sharpens identity coherence on repeat runs
  const again = engine.synapticPrune("x.com", [{ id: "pb_weak2", successCount: 0 }]);
  assert.ok(again.pruned.includes("pb_weak2"));

  // Regression: a proven playbook with NO timestamp must never be pruned as stale.
  const untracked = engine.synapticPrune("x.com", [{ id: "pb_proven_untracked", successCount: 7 }]);
  assert.deepEqual(untracked.pruned, []);
  assert.deepEqual(untracked.myelinated, ["pb_proven_untracked"]);
});

test("AIE-EC: Critical periods amplify XP inside sensitive windows", () => {
  const engine = new AdolescentCognitionEngine();
  const infant = engine.criticalPeriodBoost(1.0, 10); // sensory calibration window
  assert.equal(infant.windowOpen, true);
  assert.equal(infant.activeWindow?.id, "sensory_calibration");
  assert.equal(infant.effectiveXp, 20); // 2.0x multiplier

  const adolescent = engine.criticalPeriodBoost(10, 10); // abstract transfer window
  assert.equal(adolescent.activeWindow?.id, "abstract_transfer");
  assert.equal(adolescent.effectiveXp, 15);

  const sage = engine.criticalPeriodBoost(48, 10); // outside all windows
  assert.equal(sage.windowOpen, false);
  assert.equal(sage.effectiveXp, 10);
});

test("AIE-EC: Working memory digit span grows with cognitive age", () => {
  const engine = new AdolescentCognitionEngine();
  const infant = engine.workingMemorySpan("new-site.com", 1.0);
  assert.equal(infant.digitSpanChunks, 2);
  assert.equal(infant.recommendedMaxStepsPerPlan, 2);
  assert.match(infant.chunkingAdvice, /micro-chunks/);

  const child = engine.workingMemorySpan("new-site.com", 9);
  assert.equal(child.digitSpanChunks, 5);

  const adult = engine.workingMemorySpan("new-site.com", 25);
  assert.equal(adult.digitSpanChunks, 7);
  assert.match(adult.chunkingAdvice, /chunking/);
});

test("AIE-EC: Prefrontal executive battery scores inhibition, shifting, updating", () => {
  const engine = new AdolescentCognitionEngine();
  const result = engine.executiveFunctionBattery("app.example.com", {
    resistedDistractionClicks: 9, totalDistractions: 10,
    strategySwitchesAfterFailure: 3, failedAttempts: 3,
    stateRefreshCount: 18, actionCount: 20,
  });
  assert.equal(result.executiveScore.inhibition, 0.9);
  assert.equal(result.executiveScore.shifting, 1);
  assert.equal(result.executiveScore.updating, 0.9);
  assert.equal(result.prefrontalMaturity, "SAGE_EXECUTIVE");

  // No telemetry: keeps developmental defaults, grades as immature
  const fresh = engine.executiveFunctionBattery("untouched.io", {});
  assert.equal(fresh.prefrontalMaturity, "IMMATURE_CHILD");
});

test("AIE-EC: Erikson psychosocial stages map cognitive age to identity crises", () => {
  const engine = new AdolescentCognitionEngine();
  const infant = engine.eriksonIdentity("stage-test.com", 0.5, 2, 0);
  assert.equal(infant.eriksonStage, "TRUST_VS_MISTRUST");

  const adolescent = engine.eriksonIdentity("stage-test.com", 14, 20, 4);
  assert.equal(adolescent.eriksonStage, "IDENTITY_VS_ROLE_CONFUSION");
  assert.equal(adolescent.identityCoherence, 0.8); // 1 - 4/20

  const sage = engine.eriksonIdentity("stage-test.com", 55, 100, 0);
  assert.equal(sage.eriksonStage, "EGO_INTEGRITY_VS_DESPAIR");
  assert.equal(sage.identityCoherence, 1);
});

test("AIE-EC: Autonoetic remember/know tagging distinguishes relived vs known", () => {
  const engine = new AdolescentCognitionEngine();
  const relived = engine.autonoeticTag("x.com", ["ep_1", "ep_2"], "replay");
  assert.deepEqual(relived.remember, ["ep_1", "ep_2"]);
  assert.equal(relived.know.length, 0);
  assert.ok(relived.autonoeticConfidence > 0.9);

  const known = engine.autonoeticTag("x.com", ["ep_9"], "semantic");
  assert.deepEqual(known.know, ["ep_9"]);
  assert.ok(known.autonoeticConfidence < 0.7);
});

test("AIE-EC: Infant ERN first-error imprint and social referencing caregiver check", () => {
  const engine = new AdolescentCognitionEngine();
  engine.eriksonIdentity("risky.io", 2.0, 5, 1); // AUTONOMY_VS_SHAME stage

  const first = engine.infantErrorSignature("risky.io", { errorOccurred: true });
  assert.ok(first.ernSignature?.startsWith("ERN_risky.io"));

  // second error does NOT re-imprint
  const second = engine.infantErrorSignature("risky.io", { errorOccurred: true });
  assert.equal(second.ernSignature, null);

  // risky action at immature stage advises social referencing
  const risky = engine.infantErrorSignature("risky.io", { errorOccurred: false, riskyActionPlanned: true });
  assert.equal(risky.socialReferencingAdvised, true);
  assert.match(risky.caregiverPrompt || "", /social referencing/);
});

test("AIE-EC: Baltes wisdom calibration detects overconfidence and imposter states", () => {
  const engine = new AdolescentCognitionEngine();
  const wise = engine.wisdomCalibration("x.com", 0.95, 0.9, 0.88);
  assert.equal(wise.verdict.split(":")[0], "WISE_ADULT");
  assert.ok(wise.wisdomScore >= 0.8);

  const teen = engine.wisdomCalibration("cocky.io", 0.6, 0.95, 0.4);
  assert.equal(teen.verdict.split(":")[0], "ADOLESCENT_OVERCONFIDENCE");

  const imposter = engine.wisdomCalibration("shy.io", 0.6, 0.3, 0.9);
  assert.equal(imposter.verdict.split(":")[0], "IMPOSTER_CHILD");
});

