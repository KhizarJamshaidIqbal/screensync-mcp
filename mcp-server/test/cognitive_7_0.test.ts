// ScreenSync Cognitive Memory Architecture 7.0 Test Suite (DE-RPD)
// Tests:
// 1. Piagetian Object Permanence (Spatial Tracking & Occlusion Resolution)
// 2. Theory of Mind (ToM) & Anti-Bot Cadence Projection
// 3. Cognitive Reversibility & Transactional Undo (accidental_data_loss_prevention)
// 4. Gary Klein's Recognition-Primed Decision (RPD) Prototype Archetypes

// Must stay the first import: see _isolate-data-dir.ts
import "./_isolate-data-dir.js";
import test from "node:test";
import assert from "node:assert/strict";
import { CognitiveRpdEngine } from "../cognitive-rpd.js";

test("DE-RPD: Piagetian Object Permanence Spatial Tracking & Occlusion Resolution", () => {
  const engine = new CognitiveRpdEngine();

  // Test 1: Register spatial location of a button that was observed
  engine.registerSpatialLocation("dashboard.example.com", {
    selector: "#submit-order-btn",
    lastSeenRect: { top: 1250, left: 340, width: 120, height: 40 },
    scrollOffsetWhenSeen: { x: 0, y: 800 },
    observedAt: new Date().toISOString(),
  });

  // Test 2: Resolve offscreen element from a scrolled-up viewport (scrollY: 0)
  const resolution = engine.resolveOffscreenElement(
    "dashboard.example.com",
    "#submit-order-btn",
    { width: 1280, height: 720, scrollX: 0, scrollY: 0 }
  );

  assert.equal(resolution.foundInPermanenceMemory, true);
  assert.ok(resolution.recommendedScrollVector);
  assert.equal(resolution.recommendedScrollVector.deltaY, 1250);
  assert.equal(resolution.recommendedScrollVector.deltaX, 340);
  assert.ok(resolution.message.includes("Object permanence active"));

  // Test 3: Unregistered element returns cleanly without error
  const unreg = engine.resolveOffscreenElement(
    "dashboard.example.com",
    "#nonexistent-btn",
    { width: 1280, height: 720, scrollX: 0, scrollY: 0 }
  );
  assert.equal(unreg.foundInPermanenceMemory, false);
});

test("DE-RPD: Theory of Mind (ToM) Suspicion Scoring & Anti-Bot Humanized Cadence", () => {
  const engine = new CognitiveRpdEngine();

  // Test 1: Normal benign traffic
  const benign = engine.evaluateTheoryOfMind({
    domain: "x.com",
    actionCountInLastMinute: 12,
    hasCaptchaOrWafDetected: false,
  });
  assert.equal(benign.threatAssessment, "benign");
  assert.ok(benign.suspicionScore < 0.4);
  assert.equal(benign.recommendedMouseCurve, "direct_linear");
  assert.equal(benign.recommendedKeystrokeDelayMs.mean, 65);

  // Test 2: High action frequency & WAF challenge imminent
  const hostile = engine.evaluateTheoryOfMind({
    domain: "x.com",
    actionCountInLastMinute: 95,
    hasCaptchaOrWafDetected: true,
  });
  assert.equal(hostile.threatAssessment, "challenge_imminent");
  assert.ok(hostile.suspicionScore >= 0.7);
  assert.equal(hostile.recommendedMouseCurve, "hesitation_jitter");
  assert.equal(hostile.recommendedKeystrokeDelayMs.mean, 140);
});

test("DE-RPD: Cognitive Reversibility & Transactional Undo Assessment", () => {
  const engine = new CognitiveRpdEngine();

  // Test 1: Text entry is reversible with inverse Ctrl+Z action
  const fillAssess = engine.assessReversibility({
    tool: "web_fill",
    args: { selector: "#first_name", value: "Alex" },
  });
  assert.equal(fillAssess.category, "REVERSIBLE");
  assert.equal(fillAssess.requiresExplicitConsent, false);
  assert.ok(fillAssess.inverseAction);
  assert.equal(fillAssess.inverseAction.tool, "web_key");

  // Test 2: Checkbox toggle is reversible
  const checkAssess = engine.assessReversibility({
    tool: "web_check",
    targetSelector: "#newsletter-optin",
  });
  assert.equal(checkAssess.category, "REVERSIBLE");
  assert.equal(checkAssess.inverseAction?.tool, "web_check");

  // Test 3: Destructive account deletion requires explicit consent
  const deleteAssess = engine.assessReversibility({
    tool: "web_click",
    targetSelector: "#delete-workspace-btn",
  });
  assert.equal(deleteAssess.category, "IRREVERSIBLE_DESTRUCTIVE");
  assert.equal(deleteAssess.requiresExplicitConsent, true);
  assert.ok(deleteAssess.riskScore > 0.9);
});

test("DE-RPD: Klein's Recognition-Primed Decision (RPD) Page Archetypes", () => {
  const engine = new CognitiveRpdEngine();

  // Test 1: Social feed archetype
  const feedArch = engine.classifyPageArchetype({
    url: "https://x.com/home",
    domSignature: { hasInfiniteScroll: true, hasContentEditable: true },
  });
  assert.equal(feedArch.archetype, "ARCHETYPE_RICH_FEED");
  assert.equal(feedArch.recommendedInputMethod, "execCommand");

  // Test 2: Data table archetype
  const tableArch = engine.classifyPageArchetype({
    url: "https://admin.example.com/customers/table",
    domSignature: { hasTable: true },
  });
  assert.equal(tableArch.archetype, "ARCHETYPE_DATA_TABLE");
  assert.ok(tableArch.invariants.some((i) => i.includes("table")));

  // Test 3: Auth checkpoint archetype
  const authArch = engine.classifyPageArchetype({
    url: "https://auth.example.com/signin",
    domSignature: { hasLoginForm: true },
  });
  assert.equal(authArch.archetype, "ARCHETYPE_AUTH_CHECKPOINT");
  assert.ok(authArch.invariants.some((i) => i.includes("passwords")));
});
