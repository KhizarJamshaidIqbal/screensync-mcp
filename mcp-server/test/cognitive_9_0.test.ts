// ScreenSync Cognitive Memory Architecture 9.0 Test Suite (LCO-EPG)
// Tests:
// 1. Lifespan Cognitive Ontogeny & Milestone Progression (Infant to Sovereign Sage)
// 2. BigQuery/Property-Graph GQL Pattern Matcher & Cycle Detection (data-agent-kit-plugin parity)
// 3. Infant Motor Babbling & Coordinate Calibration
// 4. Gentner's Structure-Mapping Analogical Metaphoric Transfer

// Must stay the first import: see _isolate-data-dir.ts
import "./_isolate-data-dir.js";
import test from "node:test";
import assert from "node:assert/strict";
import { CognitiveLifespanEngine } from "../cognitive-lifespan.js";

test("LCO-EPG: Lifespan Cognitive Ontogeny & Milestone Progression", () => {
  const engine = new CognitiveLifespanEngine();

  // Test 1: x.com is NOT special. It used to be seeded as a 24.5-year-old adult with 240 invented
  // milestones; a level is now earned from evidence the hub observed, so it starts as an infant.
  const xcom = engine.evaluateLifespan("x.com");
  assert.equal(xcom.stage, "LEVEL_1_INFANT_REFLEX");
  assert.equal(xcom.scaffoldingLevel, "MAXIMAL_INFANT");
  assert.equal(xcom.successfulMilestones, 0, "no invented milestones");
  assert.equal(xcom.parameters.requireParentalConsent, true);
  assert.equal(xcom.parameters.allowMotorMacros, false);

  // Test 2: Unvisited domain begins at Level 1 Infant with maximal scaffolding
  const infant = engine.evaluateLifespan("brand-new-platform.org");
  assert.equal(infant.stage, "LEVEL_1_INFANT_REFLEX");
  assert.equal(infant.scaffoldingLevel, "MAXIMAL_INFANT");
  assert.equal(infant.parameters.requireParentalConsent, true);
  assert.equal(infant.parameters.allowMotorMacros, false);
  assert.equal(infant.parameters.deliberatePauseMs, 2500);

  // Test 3: Milestone progress advances cognitive age
  engine.evaluateLifespan("brand-new-platform.org", { outcome: "success", milestoneName: "first_form_submit" });
  const toddler = engine.evaluateLifespan("brand-new-platform.org");
  assert.ok(toddler.successfulMilestones >= 1);
  assert.ok(toddler.cognitiveAgeYears > 0.5);

  // Test 4: Hot-stove burn (trauma) decreases cognitive age and reinstates strict scaffolding
  const burned = engine.evaluateLifespan("brand-new-platform.org", { outcome: "burn" });
  assert.equal(burned.nociceptiveBurns, 1);
  assert.equal(burned.parameters.requireParentalConsent, true);
});

test("LCO-EPG: Property Graph GQL Pattern Matching & Cycle Detection", () => {
  const engine = new CognitiveLifespanEngine();

  const nodes = [
    { id: "page_home", type: "PAGE" },
    { id: "page_login", type: "PAGE" },
    { id: "btn_login_submit", type: "BUTTON" },
    { id: "page_dashboard", type: "PAGE" },
    { id: "btn_create_post", type: "BUTTON" },
  ];

  const edges = [
    { fromId: "page_home", toId: "page_login", type: "NAVIGATES_TO", weight: 0.1 },
    { fromId: "page_login", toId: "btn_login_submit", type: "CONTAINS_COMPONENT", weight: 0.1 },
    { fromId: "btn_login_submit", toId: "page_dashboard", type: "SUBMITS_TO", weight: 0.3 },
    { fromId: "page_dashboard", toId: "btn_create_post", type: "CONTAINS_COMPONENT", weight: 0.1 },
    // Cycle back to login
    { fromId: "page_dashboard", toId: "page_login", type: "REDIRECTS_TO", weight: 0.8 },
  ];

  // Test 1: Match path from home to post button
  const match = engine.matchGraphPattern(nodes, edges, {
    startNodeId: "page_home",
    targetNodeId: "btn_create_post",
  });

  assert.ok(match.matchedPaths.length >= 1);
  assert.ok(match.shortestSafePath);
  assert.deepEqual(match.shortestSafePath.pathNodes, [
    "page_home",
    "page_login",
    "btn_login_submit",
    "page_dashboard",
    "btn_create_post",
  ]);
  assert.equal(match.shortestSafePath.cumulativeRisk, 0.6);

  // Test 2: Cycle detection identifies the redirect cycle
  assert.equal(match.cycleDetected, true);
});

test("LCO-EPG: Infant Motor Babbling & Coordinate Calibration", () => {
  const engine = new CognitiveLifespanEngine();

  // Test 1: ContentEditable element selects native_execCommand
  const contentEditable = engine.calibrateMotorBabbling({
    domain: "editor.example.com",
    sampleLatencyMs: 42,
    devicePixelRatio: 2.0,
    targetElementType: "contenteditable",
  });
  assert.equal(contentEditable.recommendedDispatchType, "native_execCommand");
  assert.equal(contentEditable.inputLagMs, 42);
  assert.equal(contentEditable.dprScale, 2.0);

  // Test 2: Canvas or Shadow DOM selects pointer_synthetic
  const canvas = engine.calibrateMotorBabbling({
    domain: "drawing.example.com",
    sampleLatencyMs: 18,
    targetElementType: "canvas",
  });
  assert.equal(canvas.recommendedDispatchType, "pointer_synthetic");
});

test("LCO-EPG: Gentner's Structure-Mapping Analogical Metaphoric Transfer", () => {
  const engine = new CognitiveLifespanEngine();

  // Test 1: Transfer from x.com to threads.net (Social Feed analogy)
  const transfer = engine.transferMetaphor("x.com", "threads.net");
  assert.equal(transfer.sourceDomain, "x.com");
  assert.equal(transfer.targetDomain, "threads.net");
  assert.ok(transfer.similarityScore >= 0.85);
  assert.ok(transfer.transferredPlaybooks.length > 0);

  // Structural component analogies mapped
  const composerAnalogy = transfer.componentAnalogies.find((a) => a.sourceRole === "composer_editor");
  assert.ok(composerAnalogy);
  assert.equal(composerAnalogy.targetSelector, "div[contenteditable='true']");

  // Test 2: Transfer to ecommerce store maps checkout analogies
  const shopTransfer = engine.transferMetaphor("shopify.com", "my-store.com/shop");
  assert.ok(shopTransfer.componentAnalogies.some((a) => a.sourceRole === "checkout_btn"));
});
