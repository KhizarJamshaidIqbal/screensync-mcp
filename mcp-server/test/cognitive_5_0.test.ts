// ScreenSync Cognitive Memory Architecture 5.0 Test Suite (ND-MS)
// Tests Neuro-Developmental Memory Stages: Infant -> Toddler -> Child -> Adult -> Sovereign Sage

// Must stay the first import: see _isolate-data-dir.ts
import "./_isolate-data-dir.js";
import test from "node:test";
import assert from "node:assert/strict";
import { CognitiveDevelopmentEngine } from "../cognitive-development.js";

test("ND-MS: Initial Seed & Default Infant Scaffolding", () => {
  const engine = new CognitiveDevelopmentEngine();

  // Test 1: x.com is NOT special. It used to be seeded as a Sovereign Sage with 22 invented episodes;
  // a level is now earned from evidence the hub observed (see cognitive_spine.test.ts), so it starts
  // as an infant like every other domain.
  const xMaturity = engine.getMaturity("x.com");
  assert.equal(xMaturity.stage, 1);
  assert.equal(xMaturity.stageName, "SENSORIMOTOR_INFANT");
  assert.equal(xMaturity.episodesCount, 0, "no invented history");
  assert.equal(xMaturity.scaffolding.requireHumanConfirm, true);
  assert.equal(xMaturity.scaffolding.allowSystem1Reflex, false);

  // Test 2: Unseen domain starts at Stage 1 (Sensorimotor Infant)
  const newMaturity = engine.getMaturity("brand-new-site.org");
  assert.equal(newMaturity.stage, 1);
  assert.equal(newMaturity.stageName, "SENSORIMOTOR_INFANT");
  assert.equal(newMaturity.scaffolding.requireHumanConfirm, true);
  assert.equal(newMaturity.scaffolding.allowSystem1Reflex, false);
  assert.ok(newMaturity.scaffolding.perceptionPauseMs >= 3000);
});

test("ND-MS: Experiential Progression & Level Up Transitions (Piaget Stages)", () => {
  const engine = new CognitiveDevelopmentEngine();
  const domain = "sandbox-portal.dev";

  // Initially Stage 1
  assert.equal(engine.getMaturity(domain).stage, 1);

  // Episode 1 success -> Levels up to Stage 2 (Toddler)
  const ep1 = engine.recordEpisode({ domain, success: true, durationMs: 4200, drift: false });
  assert.ok(ep1.xp >= 15);
  assert.equal(ep1.stage, 2);
  assert.equal(ep1.stageName, "PREOPERATIONAL_TODDLER");

  // Accumulate episodes to reach Stage 3 (Concrete Child)
  engine.recordEpisode({ domain, success: true });
  const ep3 = engine.recordEpisode({ domain, success: true });
  assert.equal(ep3.stage, 3);
  assert.equal(ep3.stageName, "CONCRETE_OPERATIONAL_CHILD");
  assert.equal(ep3.scaffolding.allowFastBranchSkip, true);
  assert.equal(ep3.scaffolding.requireHumanConfirm, false);

  // Continue progression to Stage 4 (Formal Adult)
  for (let i = 0; i < 6; i++) {
    engine.recordEpisode({ domain, success: true });
  }
  const adultStage = engine.getMaturity(domain);
  assert.equal(adultStage.stage, 4);
  assert.equal(adultStage.stageName, "FORMAL_OPERATIONAL_ADULT");
  assert.equal(adultStage.scaffolding.crossDomainTransferEnabled, true);
});

test("ND-MS: Stress Regression & Manual Override (Vygotsky ZPD Safeguard)", () => {
  const engine = new CognitiveDevelopmentEngine();
  const domain = "fragile-banking-app.com";

  // Operator manually sets to Stage 4 (Adult)
  const overridden = engine.overrideStage(domain, 4);
  assert.equal(overridden.stage, 4);

  // Simulate 2 consecutive failures -> Stress Regression triggers
  engine.recordEpisode({ domain, success: false });
  const regressed = engine.recordEpisode({ domain, success: false });

  assert.equal(regressed.recentRegression, true);
  assert.equal(regressed.stage, 3); // Down-leveled to Child
  assert.equal(regressed.scaffolding.requireHumanConfirm, true); // Safety scaffolding re-armed!
});
