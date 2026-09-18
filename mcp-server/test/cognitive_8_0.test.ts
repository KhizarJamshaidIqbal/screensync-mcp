// ScreenSync Cognitive Memory Architecture 8.0 Test Suite (OCM-PGL)
// Tests:
// 1. Ontogenetic Cognitive Maturation & Developmental Stage Transitions
// 2. BigQuery/Property-Graph Epistemic Topology & Causal Lineage Tracing (data-agent-kit-plugin parity)
// 3. Epistemic Curiosity Frontier & Entropy Reduction
// 4. Biological Homeostatic Regulation & Allostatic Resilience

import test from "node:test";
import assert from "node:assert/strict";
import { CognitiveMaturationEngine } from "../cognitive-maturation.js";

test("OCM-PGL: Ontogenetic Cognitive Maturation & Stage Transitions", () => {
  const engine = new CognitiveMaturationEngine();

  // Test 1: Seeded adult profile for x.com
  const xProfile = engine.getOrEvolveProfile("x.com");
  assert.equal(xProfile.stage, "STAGE_4_ADULT_RPD_MASTER");
  assert.equal(xProfile.stageLevel, 4);
  assert.equal(xProfile.policy.allowAutonomousBatching, true);
  assert.equal(xProfile.policy.exploratoryCaution, "autonomous_high");

  // Test 2: Brand new domain starts as Infant (Sensorimotor / Hot-stove caution)
  const newDomain = engine.getOrEvolveProfile("new-ecommerce-site.com");
  assert.equal(newDomain.stage, "STAGE_1_INFANT_SENSORIMOTOR");
  assert.equal(newDomain.stageLevel, 1);
  assert.equal(newDomain.policy.allowAutonomousBatching, false);
  assert.equal(newDomain.policy.exploratoryCaution, "extreme_nociceptive");
  assert.equal(newDomain.policy.requireUndoPreflight, true);

  // Test 3: Evolve maturity with successful interactions (Gaining XP -> Child -> Adolescent)
  engine.getOrEvolveProfile("new-ecommerce-site.com", { outcome: "success", xpGain: 150 });
  const childDomain = engine.getOrEvolveProfile("new-ecommerce-site.com");
  assert.equal(childDomain.stage, "STAGE_2_CHILD_SYMBOLIC");
  assert.equal(childDomain.stageLevel, 2);

  // Test 4: Trauma incident (hot-stove burn / WAF block) causes XP penalty and regression
  const traumaResult = engine.getOrEvolveProfile("new-ecommerce-site.com", { outcome: "trauma" });
  assert.equal(traumaResult.traumaIncidents, 1);
  assert.ok(traumaResult.cognitiveXp < 150);
});

test("OCM-PGL: Property Graph Topology & Backward Causal Lineage Tracing", () => {
  const engine = new CognitiveMaturationEngine();

  // Test 1: Insert nodes into epistemic property graph
  const pageNode = engine.addNode({
    id: "page_checkout",
    label: "PAGE",
    properties: { url: "https://store.example.com/checkout", title: "Checkout" },
  });
  const buttonNode = engine.addNode({
    id: "btn_place_order",
    label: "COMPONENT",
    properties: { selector: "#place-order-btn", role: "button" },
  });
  const errorNode = engine.addNode({
    id: "incident_payment_declined",
    label: "INCIDENT",
    properties: { error: "CARD_EXPIRED", code: 402 },
  });

  assert.equal(pageNode.id, "page_checkout");
  assert.equal(buttonNode.id, "btn_place_order");

  // Test 2: Insert directed edges
  engine.addEdge({
    fromId: "page_checkout",
    toId: "btn_place_order",
    label: "CONTAINS_COMPONENT",
    weight: 0.1,
  });
  engine.addEdge({
    fromId: "btn_place_order",
    toId: "incident_payment_declined",
    label: "CAUSED_BY",
    weight: 0.9,
  });

  // Test 3: Backward Causal Lineage Tracing (from error node back to root cause)
  const lineage = engine.traceLineage("incident_payment_declined");
  assert.equal(lineage.targetNodeId, "incident_payment_declined");
  assert.equal(lineage.lineageChain.length, 2);
  assert.equal(lineage.lineageChain[0].node.id, "btn_place_order");
  assert.equal(lineage.lineageChain[1].node.id, "page_checkout");
  assert.equal(lineage.rootCauseNode?.id, "page_checkout");

  // Test 4: Graph summary statistics
  const stats = engine.getGraphStats();
  assert.ok(stats.nodeCount >= 3);
  assert.ok(stats.edgeCount >= 2);
  assert.equal(stats.nodeTypes["PAGE"], 1);
  assert.equal(stats.nodeTypes["COMPONENT"], 1);
  assert.equal(stats.nodeTypes["INCIDENT"], 1);
});

test("OCM-PGL: Epistemic Curiosity Frontier & Entropy Reduction", () => {
  const engine = new CognitiveMaturationEngine();

  // Test 1: Evaluate candidate DOM elements for novelty vs danger
  const evaluation = engine.evaluateCuriosityFrontier([
    { selector: "a[href='/analytics']", text: "Analytics Dashboard", tag: "a" },
    { selector: "button[data-action='purge']", text: "Delete Workspace", tag: "button" },
    { selector: "a[href='/faq']", text: "Help Center", tag: "a" },
  ]);

  assert.equal(evaluation.frontier.length, 3);

  // High novelty element recommended for next exploration step
  assert.ok(evaluation.recommendedNextStep);
  assert.equal(evaluation.recommendedNextStep.selector, "a[href='/analytics']");
  assert.equal(evaluation.recommendedNextStep.recommendedAction, "safe_click");

  // Destructive element safely marked to skip
  const deleteEl = evaluation.frontier.find((f) => f.selector.includes("purge"));
  assert.ok(deleteEl);
  assert.equal(deleteEl.recommendedAction, "skip_destructive");
  assert.ok(deleteEl.riskScore > 0.9);

  // Entropy reduction estimate is positive
  assert.ok(evaluation.entropyReductionEstimate > 0);
});

test("OCM-PGL: Biological Homeostatic Regulation & Stress Adaptation", () => {
  const engine = new CognitiveMaturationEngine();

  // Test 1: Optimal calm conditions
  const calm = engine.evaluateHomeostasis({
    domNodeCount: 800,
    actionsPerMinute: 12,
    recentErrorRate: 0.0,
    averageLatencyMs: 320,
    threatSuspicionScore: 0.1,
  });
  assert.equal(calm.allostaticState, "OPTIMAL");
  assert.equal(calm.recommendedInterventions.injectCalmPauseMs, 0);
  assert.equal(calm.recommendedInterventions.flushWorkingMemoryCache, false);

  // Test 2: Heavy stress conditions (DOM bloat, high error rate, WAF challenge)
  const stressed = engine.evaluateHomeostasis({
    domNodeCount: 7500,
    actionsPerMinute: 85,
    recentErrorRate: 0.45,
    averageLatencyMs: 2500,
    threatSuspicionScore: 0.8,
  });
  assert.ok(stressed.stressIndex >= 0.85);
  assert.equal(stressed.allostaticState, "CRITICAL_EXHAUSTION");
  assert.equal(stressed.recommendedInterventions.injectCalmPauseMs, 5000);
  assert.equal(stressed.recommendedInterventions.flushWorkingMemoryCache, true);
  assert.equal(stressed.recommendedInterventions.escalateToHumanOperator, true);
});
