// ScreenSync Cognitive Memory Architecture 4.0 Test Suite (CR-FLI)
// Tests Metacognitive Reflex Calibration, Semantic Similarity Search, and Federated Multi-Profile Catalog.

// Must stay the first import: see _isolate-data-dir.ts
import "./_isolate-data-dir.js";
import test from "node:test";
import assert from "node:assert/strict";
import { MetacognitiveReflexEngine } from "../cognitive-metacognition.js";
import { SemanticSimilarityEngine } from "../cognitive-similarity.js";
import { FederatedCatalogEngine } from "../cognitive-federation.js";

test("CR-FLI: Metacognitive Reflex & Confidence Calibration (Dual Process System 1 vs 2)", () => {
  const engine = new MetacognitiveReflexEngine();

  // Test 1: High confidence playbook -> SYSTEM_1_REFLEX (< 3s target)
  const highConf = engine.evaluateConfidence({
    domain: "x.com",
    intent: "post",
    playbookSuccessCount: 10,
    playbookFailCount: 0,
    driftCount: 0,
    failedProbesCount: 0,
  });

  assert.ok(highConf.confidenceScore >= 0.85, `Expected score >= 0.85, got ${highConf.confidenceScore}`);
  assert.equal(highConf.mode, "SYSTEM_1_REFLEX");
  assert.equal(highConf.targetDurationSeconds, 3);
  assert.equal(highConf.anomalyDetected, false);

  // Test 2: Moderate confidence / drifted playbook -> SYSTEM_2_DELIBERATE
  const modConf = engine.evaluateConfidence({
    domain: "x.com",
    intent: "post",
    playbookSuccessCount: 3,
    playbookFailCount: 2,
    driftCount: 2,
    failedProbesCount: 1,
  });

  assert.ok(modConf.confidenceScore >= 0.50 && modConf.confidenceScore < 0.85);
  assert.equal(modConf.mode, "SYSTEM_2_DELIBERATE");
  assert.equal(modConf.targetDurationSeconds, 12);

  // Test 3: Anomaly detection on latency spike
  engine.recordLatency("x.com", 800);
  engine.recordLatency("x.com", 850);
  const anomalyConf = engine.evaluateConfidence({
    domain: "x.com",
    intent: "post",
    currentLatencyMs: 3500, // Spike > 2.2x
  });

  assert.equal(anomalyConf.anomalyDetected, true);
  assert.ok(anomalyConf.adjustedTimeoutMs >= 20000);
});

test("CR-FLI: Semantic Similarity & Intent Vector Matching (BigQuery AI.SIMILARITY pattern)", () => {
  const engine = new SemanticSimilarityEngine();

  // Test 1: Fuzzy intent resolution
  const resTweet = engine.resolveIntent("tweet thoughts");
  assert.equal(resTweet.canonicalIntent, "post");
  assert.ok(resTweet.similarityScore >= 0.80);

  const resPublish = engine.resolveIntent("publish status update");
  assert.equal(resPublish.canonicalIntent, "post");

  const resLogin = engine.resolveIntent("sign on to account");
  assert.equal(resLogin.canonicalIntent, "login");

  // Test 2: Semantic Element Candidate Matching
  const candidates = [
    { selector: "button.cancel", text: "Cancel", role: "button" },
    { selector: "button.primary", text: "Post Tweet", ariaLabel: "Send Tweet", role: "button" },
    { selector: "input.search", text: "", ariaLabel: "Search", role: "searchbox" },
  ];

  const matched = engine.matchCandidateElement("post button", candidates);
  assert.ok(matched.bestMatch !== null);
  assert.equal(matched.bestMatch.selector, "button.primary");
  assert.ok(matched.bestMatch.score >= 0.40);
});

test("CR-FLI: Federated Cognitive Catalog & Privacy Scrubbing (federate_lakehouse_catalog pattern)", () => {
  const catalog = new FederatedCatalogEngine();

  // Test 1: Seed verification
  const seed = catalog.querySharedRecipes("x.com", "post");
  assert.ok(seed.length >= 1);
  assert.equal(seed[0].sourceFramework, "Draft.js / Lexical");

  // Test 2: Publish recipe with private data -> Verify automatic scrubbing
  const published = catalog.publishSharedRecipe({
    originProfile: "operator_dev@gmail.com",
    domain: "threads.net",
    intent: "post",
    framework: "Lexical",
    recipe: {
      action: "publish",
      userAccount: "testuser@gmail.com",
      authHeader: "Bearer secret_jwt_token_12345",
      cookieHeader: "auth_token=super_secret_cookie_value;",
      selector: "div[contenteditable='true']",
    },
  });

  assert.equal(published.domain, "threads.net");
  assert.equal(published.sanitizedRecipe.userAccount, "[USER_EMAIL]");
  assert.equal(published.sanitizedRecipe.authHeader, "Bearer [REDACTED_TOKEN]");
  assert.equal(published.sanitizedRecipe.cookieHeader, "auth_token=[REDACTED]");
  assert.equal(published.sanitizedRecipe.selector, "div[contenteditable='true']");

  // Test 3: Cross-profile query
  const queryRes = catalog.querySharedRecipes("threads.net", "post");
  assert.equal(queryRes.length, 1);
  assert.equal(queryRes[0].sanitizedRecipe.userAccount, "[USER_EMAIL]");

  // Test 4: Profile linking
  const linkRes = catalog.linkProfile("secondary_worker@company.com");
  assert.equal(linkRes.linked, true);
  assert.ok(catalog.getLinkedProfiles().includes("secondary_worker@company.com"));
});
