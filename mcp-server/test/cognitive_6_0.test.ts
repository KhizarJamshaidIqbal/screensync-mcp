// ScreenSync Cognitive Memory Architecture 6.0 Test Suite (ESR-CDH)
// Tests:
// 1. Hippocampal SWR Offline Replay & Counterfactual Simulation
// 2. Autobiographical Episodic Memory Spatio-Temporal Queries
// 3. Cognitive Store Profiling & Autocleaning Hygiene

import test from "node:test";
import assert from "node:assert/strict";
import { CognitiveReplayAndHygieneEngine } from "../cognitive-replay.js";

test("ESR-CDH: Hippocampal SWR Offline Replay & Counterfactual Simulation", () => {
  const engine = new CognitiveReplayAndHygieneEngine();

  // Test 1: Replay simulation on x.com with default counterfactual scenarios
  const report = engine.simulateOfflineReplay({
    domain: "x.com",
    autoSynthesizeBranch: true,
  });

  assert.equal(report.domain, "x.com");
  assert.ok(report.scenariosTested >= 3);
  assert.ok(report.resilienceScore >= 0.6);
  assert.ok(Array.isArray(report.simulations));

  // Test 2: Survived simulation for modal interruption
  const modalSim = report.simulations.find((s) => s.scenario.type === "unexpected_modal");
  assert.ok(modalSim);
  assert.equal(modalSim.survived, true);
});

test("ESR-CDH: Autobiographical Episodic Memory Spatio-Temporal Queries", () => {
  const engine = new CognitiveReplayAndHygieneEngine();

  // Test 1: Query initial seeded episodic history for x.com
  const query = engine.queryEpisodicMemory({ domain: "x.com", intent: "post" });
  assert.ok(query.totalCount >= 1);
  assert.equal(query.episodes[0].domain, "x.com");
  assert.equal(query.episodes[0].outcome, "success");
  assert.ok(query.autobiographicalSummary.includes("Autobiographical recall"));

  // Test 2: Log new episode dynamically
  const newEp = engine.logEpisode({
    domain: "threads.net",
    intent: "post",
    latencyMs: 780,
    outcome: "success",
    probesObserved: { auth_active: true },
    lessonsLearned: "Cross-domain inherited recipe from x.com worked on threads.net",
  });
  assert.ok(newEp.id.startsWith("ep_"));

  const threadsQuery = engine.queryEpisodicMemory({ domain: "threads.net" });
  assert.equal(threadsQuery.totalCount, 1);
  assert.equal(threadsQuery.episodes[0].domain, "threads.net");
});

test("ESR-CDH: Cognitive Hygiene Data Quality Profiling & Autocleaning", () => {
  const engine = new CognitiveReplayAndHygieneEngine();

  // Test 1: Profile hygiene on x.com
  const profile = engine.profileHygiene("x.com");
  assert.equal(profile.domain, "x.com");
  assert.ok(profile.playbookCount >= 1);
  assert.ok(profile.pitfallCount >= 1);
  assert.ok(profile.recommendations.length > 0);

  // Test 2: Run autocleaning
  const cleanResult = engine.runAutocleaning("x.com");
  assert.equal(cleanResult.cleaned, true);
  assert.ok(cleanResult.message.includes("Autocleaning completed"));
});
