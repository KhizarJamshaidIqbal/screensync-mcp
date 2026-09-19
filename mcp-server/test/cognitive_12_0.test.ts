// ScreenSync Cognitive Memory Architecture 12.0 Test Suite (TEC-SSC)
// Tests the transcendental executive / sleep-consolidation layer:
// 1. REM + slow-wave consolidation      5. Damasio somatic markers
// 2. System 1 reflex compilation        6. Baddeley working memory
// 3. Amygdala threat inoculation        7. Hegelian dialectical synthesis
// 4. Vygotsky ZPD scaffolding           8. Erikson wisdom capsules

import test from "node:test";
import assert from "node:assert/strict";
import { TranscendentalCognitionEngine, CHALLENGE_FINGERPRINTS } from "../cognitive-transcendental.js";
import { transcendentalToolDefinitions } from "../catalog-transcendental.js";

test("TEC-SSC: slow-wave consolidation downscales noise and keeps proven traces", () => {
  const engine = new TranscendentalCognitionEngine();
  const result = engine.remDreamSimulation("x.com", [
    { id: "proven", successCount: 8, failureCount: 1, hasExplicitWaits: true, usesShadowPiercing: true },
    { id: "noise", successCount: 0, failureCount: 4 },
    { id: "coinflip", successCount: 2, failureCount: 3 },
  ]);

  const byId = Object.fromEntries(result.consolidated.map((c) => [c.id, c]));
  assert.equal(byId.proven.verdict, "CONSOLIDATED_TO_NEOCORTEX");
  assert.equal(byId.noise.verdict, "DOWNSCALED_AS_NOISE");
  assert.equal(byId.noise.weight, 0);
  // 2/5 reliability is below the 0.5 bar, so a coin-flip trace is noise too.
  assert.equal(byId.coinflip.verdict, "DOWNSCALED_AS_NOISE");

  // Only the proven trace (weight 10 of 10+5+6=21) survives downscaling.
  assert.ok(result.synapticDownscalingFactor > 0 && result.synapticDownscalingFactor < 1);
  assert.equal(result.synapticDownscalingFactor, Math.round((10 / 21) * 1000) / 1000);
});

test("TEC-SSC: REM surfaces only the guards a trace cannot absorb", () => {
  const engine = new TranscendentalCognitionEngine();

  // This trace has waits and shadow piercing, so those two perturbations survive;
  // the other three should be reported as weaknesses.
  const guarded = engine.remDreamSimulation("x.com", [
    { id: "t1", successCount: 5, hasExplicitWaits: true, usesShadowPiercing: true },
  ]);
  assert.equal(guarded.distilledHeuristics.length, 3);
  assert.ok(!guarded.distilledHeuristics.some((h) => h.includes("latency_spike_3000ms")));
  assert.ok(!guarded.distilledHeuristics.some((h) => h.includes("shadow_root_reparent")));

  // A bare trace absorbs nothing: all five perturbations are weaknesses.
  const bare = engine.remDreamSimulation("x.com", [{ id: "t2", successCount: 5 }]);
  assert.equal(bare.distilledHeuristics.length, 5);
  assert.equal(bare.scenariosDreamt, 1 * 5 * 2);

  // No traces at all: nothing to downscale.
  const empty = engine.remDreamSimulation("x.com", []);
  assert.equal(empty.synapticDownscalingFactor, 1);
  assert.equal(empty.distilledHeuristics.length, 0);
});

test("TEC-SSC: System 1 compilation is gated on practice and calibration", () => {
  const engine = new TranscendentalCognitionEngine();
  const steps = [
    { action: "fill", selector: "#q", value: "hello" },
    { action: "click", selector: "#go" },
  ];

  const green = engine.system1ReflexCompile("x.com", { id: "pb", steps, successCount: 12, wisdomScore: 0.8 });
  assert.equal(green.compiled, true);
  assert.equal(green.tier, "SYSTEM_1_REFLEX");
  assert.ok(green.speedupFactor > 100, "a compiled reflex should be orders of magnitude faster");
  assert.ok(green.system1LatencyMs < 5, "compiled reflex must land under 5ms");

  // The bundle is injected via executeScript, so it must not close over anything.
  assert.ok(green.reflexBundle!.startsWith("(function reflex()"));
  assert.ok(!/\bimport\b|\brequire\(/.test(green.reflexBundle!), "bundle must be self-contained");
  assert.ok(green.reflexBundle!.includes("#q") && green.reflexBundle!.includes("#go"));

  const unpractised = engine.system1ReflexCompile("x.com", { id: "pb", steps, successCount: 4, wisdomScore: 0.9 });
  assert.equal(unpractised.compiled, false);
  assert.equal(unpractised.reflexBundle, null);
  assert.match(unpractised.reason, /4\/10/);

  // Practised but badly calibrated: automating it would entrench an unreliable habit.
  const miscalibrated = engine.system1ReflexCompile("x.com", { id: "pb", steps, successCount: 30, wisdomScore: 0.2 });
  assert.equal(miscalibrated.compiled, false);
  assert.match(miscalibrated.reason, /calibrat/i);
});

test("TEC-SSC: amygdala low road trips on a challenge and backs off exponentially", () => {
  const engine = new TranscendentalCognitionEngine();

  const first = engine.amygdalaThreatInoculation("guarded.io", { fingerprint: "cloudflare_turnstile" });
  assert.equal(first.pathway, "LOW_ROAD");
  assert.equal(first.breakerState, "TRIPPED");
  assert.equal(first.handToHuman, true);
  assert.equal(first.backoffMs, 5000);
  assert.match(first.recommendation, /web_request_help/);

  const second = engine.amygdalaThreatInoculation("guarded.io", { fingerprint: "arkose_labs" });
  assert.equal(second.backoffMs, 10000, "backoff doubles on a consecutive trip");
  assert.ok(second.fearWeight > first.fearWeight);

  // An unclassified 429 still trips, just with a smaller fear increment.
  const rateLimited = engine.amygdalaThreatInoculation("other.io", { httpStatus: 429 });
  assert.equal(rateLimited.breakerState, "TRIPPED");
  assert.equal(rateLimited.fingerprint, "http_429");
  assert.equal(rateLimited.handToHuman, true);
});

test("TEC-SSC: clean encounters extinguish fear so a domain is not punished forever", () => {
  const engine = new TranscendentalCognitionEngine();
  engine.amygdalaThreatInoculation("recovering.io", { fingerprint: "datadome" });

  const firstClean = engine.amygdalaThreatInoculation("recovering.io", {});
  assert.equal(firstClean.pathway, "HIGH_ROAD");
  assert.equal(firstClean.breakerState, "EXTINGUISHING");
  assert.equal(firstClean.fearWeight, 0.25);
  assert.equal(firstClean.backoffMs, 0);

  // Keep encountering it cleanly and the breaker re-arms completely.
  let state = firstClean;
  for (let i = 0; i < 4; i += 1) state = engine.amygdalaThreatInoculation("recovering.io", {});
  assert.equal(state.breakerState, "ARMED");
  assert.equal(state.fearWeight, 0);
  assert.equal(state.handToHuman, false);
});

test("TEC-SSC: threat inoculation is defensive only - it never prescribes evasion", () => {
  const engine = new TranscendentalCognitionEngine();
  // This test exists to keep subsystem 3 defensive. Commit 5fa992e removed the
  // anti-bot evasion tools from this project on purpose; re-introducing cadence
  // randomisation or viewport cloaking here should fail loudly.
  for (const fp of CHALLENGE_FINGERPRINTS) {
    const out = engine.amygdalaThreatInoculation(`site-${fp}.test`, { fingerprint: fp });
    const serialised = JSON.stringify(out).toLowerCase();
    for (const forbidden of ["jitter", "stealth", "cloak", "humaniz", "randomis", "randomiz", "evade", "bypass", "solve"]) {
      assert.ok(!serialised.includes(forbidden), `threat response must not mention '${forbidden}'`);
    }
    assert.equal(out.handToHuman, true, "every detected challenge hands control to the human");
    assert.ok(out.backoffMs > 0, "every detected challenge backs off");
  }
});

test("TEC-SSC: ZPD scaffolding fades as the pupil becomes independent", () => {
  const engine = new TranscendentalCognitionEngine();
  const tier = (rate: number) => engine.zpdScaffoldTutor("bsky.app", "x.com", { independentSuccessRate: rate });

  assert.equal(tier(0.1).tier, "MAXIMAL_DIRECT_GUIDANCE");
  assert.equal(tier(0.1).transferredPrimitives.length, 3);
  assert.equal(tier(0.45).tier, "PROMPTED_SCAFFOLD");
  assert.equal(tier(0.45).transferredPrimitives.length, 2);
  assert.equal(tier(0.7).tier, "FADING_ASSISTANCE");
  assert.equal(tier(0.7).transferredPrimitives.length, 1);

  const mastered = tier(0.9);
  assert.equal(mastered.tier, "AUTONOMOUS_MASTERY");
  assert.equal(mastered.transferredPrimitives.length, 0);
  assert.equal(mastered.withinZpd, false);
});

test("TEC-SSC: somatic markers escalate from tranquil to visceral alarm", () => {
  const engine = new TranscendentalCognitionEngine();

  const calm = engine.somaticMarkerRisk("x.com", { tool: "GET", target: "Open profile" });
  assert.equal(calm.somaticGutResponse, "GUT_TRANQUIL");
  assert.equal(calm.requiresApproval, false);
  assert.equal(calm.code, null);

  // A destructive keyword alone is uncomfortable but not catastrophic.
  const uneasy = engine.somaticMarkerRisk("x.com", { target: "Remove item" });
  assert.equal(uneasy.somaticGutResponse, "GUT_APPREHENSIVE");
  assert.ok(uneasy.markers.includes("destructive_keyword"));
  assert.equal(uneasy.requiresApproval, false);

  const alarm = engine.somaticMarkerRisk("bank.test", { tool: "POST", target: "Transfer funds", irreversible: true });
  assert.equal(alarm.somaticGutResponse, "GUT_VISCERAL_ALARM");
  assert.equal(alarm.requiresApproval, true);
  assert.equal(alarm.code, "USER_CONFIRMATION_REQUIRED");
  assert.ok(alarm.markers.some((m) => m.startsWith("catastrophic_intent:")));
  assert.equal(alarm.visceralRiskScore, 1);
});

test("TEC-SSC: Baddeley buffers report load and demand offload before thrashing", () => {
  const engine = new TranscendentalCognitionEngine();

  const nominal = engine.baddeleyWorkingMemory("x.com", {
    centralExecutive: 2, visuospatialSketchpad: 3, phonologicalLoop: 1, episodicBuffer: 2,
  });
  assert.equal(nominal.status, "NOMINAL");
  assert.equal(nominal.thrashingRisk, false);
  assert.equal(nominal.offloadRecommended.length, 0);
  assert.equal(nominal.components.visuospatialSketchpad.items, 3);

  const saturated = engine.baddeleyWorkingMemory("x.com", {
    centralExecutive: 7, visuospatialSketchpad: 9, phonologicalLoop: 7, episodicBuffer: 7,
  });
  assert.equal(saturated.status, "OVERLOADED");
  assert.equal(saturated.thrashingRisk, true);
  assert.ok(saturated.offloadRecommended.includes("visuospatialSketchpad"));
  assert.equal(saturated.components.visuospatialSketchpad.load, 1);
  assert.match(saturated.advice, /web_learn/);
});

test("TEC-SSC: dialectics raise an antithesis and return a guarded synthesis", () => {
  const engine = new TranscendentalCognitionEngine();
  const out = engine.dialecticalSynthesis("x.com", {
    steps: ["click css=#submit", "navigate to /inbox", "read the heading"],
  });

  assert.equal(out.thesis.length, 3);
  assert.ok(out.antithesis.length >= 3, "a click and a navigate both attract challenges");
  assert.ok(out.antithesis.some((a) => a.vector === "unpierced_shadow_root"));
  assert.ok(out.antithesis.some((a) => a.vector === "unsaved_state_dialog"));

  const clickStep = out.synthesis.find((s) => s.step.startsWith("click"))!;
  assert.ok(clickStep.guards.length > 0, "the click step must carry guards");

  // A purely observational step attracts no adversary and stays unguarded.
  const readStep = out.synthesis.find((s) => s.step.startsWith("read"))!;
  assert.equal(readStep.guards.length, 0);
  assert.equal(out.unresolvedCount, 1);

  const empty = engine.dialecticalSynthesis("x.com", { steps: [] });
  assert.match(empty.advice, /Empty thesis/);
});

test("TEC-SSC: wisdom capsules survive a round trip and reject tampering", () => {
  const engine = new TranscendentalCognitionEngine();
  const exported = engine.generativeWisdomCapsule("export", {
    domain: "X.COM",
    facts: [{ framework: "draft.js" }],
    playbooks: [{ id: "post" }],
    pitfalls: [{ id: "paste_duplication" }],
  });

  assert.equal(exported.capsule.body.domain, "x.com");
  assert.equal(exported.capsule.body.schema, "screensync.wisdom-capsule/12.0");
  assert.match(exported.capsule.checksum, /^[0-9a-f]{64}$/);
  assert.equal(exported.counts.facts, 1);

  const imported = engine.generativeWisdomCapsule("import", { capsule: exported.capsule });
  assert.equal(imported.intact, true);
  assert.equal(imported.accepted, true);
  assert.equal(imported.domain, "x.com");

  // inspect verifies without inheriting.
  const inspected = engine.generativeWisdomCapsule("inspect", { capsule: exported.capsule });
  assert.equal(inspected.intact, true);
  assert.equal(inspected.accepted, false);

  const tampered = JSON.parse(JSON.stringify(exported.capsule));
  tampered.body.playbooks.push({ id: "smuggled" });
  const rejected = engine.generativeWisdomCapsule("import", { capsule: tampered });
  assert.equal(rejected.intact, false);
  assert.equal(rejected.accepted, false);
  assert.match(rejected.advice, /Refusing to inherit/);

  const missing = engine.generativeWisdomCapsule("import", {});
  assert.equal(missing.accepted, false);
});

test("TEC-SSC: every declared tool name passes the bridge's own name validator", () => {
  // Regression: the /api/web/tool guard was /^web_[a-z_]+$/, which silently
  // rejected web_system1_reflex_compile - the first tool name in the project to
  // contain a digit. Unit tests call the engine directly and never saw it; only
  // a live bridge call did. Keep the catalogue and the guard in agreement.
  const BRIDGE_NAME_RE = /^web_[a-z0-9_]+$/;
  const declared = transcendentalToolDefinitions().map((t) => t.name);
  assert.equal(declared.length, 8);
  for (const name of declared) {
    assert.ok(BRIDGE_NAME_RE.test(name), `${name} would be rejected by the web bridge name guard`);
  }
  assert.ok(declared.includes("web_system1_reflex_compile"));
});

test("TEC-SSC: the checksum is canonical - key order does not change it", () => {
  const engine = new TranscendentalCognitionEngine();
  const a = engine.generativeWisdomCapsule("export", { domain: "x.com", facts: [{ a: 1, b: 2 }] });
  const b = engine.generativeWisdomCapsule("export", { domain: "x.com", facts: [{ b: 2, a: 1 }] });
  assert.equal(a.capsule.checksum, b.capsule.checksum);
});
