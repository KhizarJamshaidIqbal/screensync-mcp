import test from "node:test";
import assert from "node:assert/strict";
import { trackToolExecution } from "../cognitive-auto-tracker.js";
import { cognitiveStore } from "../cognitive-memory.js";
import { globalMaturationEngine } from "../cognitive-maturation.js";
import { globalLifespanEngine } from "../cognitive-lifespan.js";

test("cognitive-auto-tracker: tracks successful tool execution and evolves maturity", () => {
  const domain = "testsite-auto.com";
  const beforeProfile = globalMaturationEngine.getOrEvolveProfile(domain);
  const startXp = beforeProfile.cognitiveXp;

  trackToolExecution(
    "web_click",
    { url: `https://${domain}/feed`, selector: "button.test" },
    { ok: true, data: { clicked: true } },
    120
  );

  const afterProfile = globalMaturationEngine.getOrEvolveProfile(domain);
  assert.equal(afterProfile.cognitiveXp, startXp + 5, "Maturity XP should increase by 5 on success");

  const lifespan = globalLifespanEngine.evaluateLifespan(domain);
  assert.ok(lifespan.successfulMilestones >= 1, "Milestones should increment");

  const episodes = cognitiveStore.load().episodes;
  const recent = episodes.find((e) => e.domain === domain);
  assert.ok(recent, "Episode should be logged");
  assert.equal(recent?.success, true);
  assert.equal(recent?.intent, "click");
});

test("cognitive-auto-tracker: tracks failed tool execution and registers trauma", () => {
  const domain = "testsite-burn.com";
  const beforeProfile = globalMaturationEngine.getOrEvolveProfile(domain);
  const startTrauma = beforeProfile.traumaIncidents;

  trackToolExecution(
    "web_fill",
    { domain, selector: "input.missing", text: "hello" },
    { ok: false, error: "Element not found" },
    450
  );

  const afterProfile = globalMaturationEngine.getOrEvolveProfile(domain);
  assert.equal(afterProfile.traumaIncidents, startTrauma + 1, "Trauma incidents should increase on failure");

  const lifespan = globalLifespanEngine.evaluateLifespan(domain);
  assert.ok(lifespan.nociceptiveBurns >= 1, "Nociceptive burns should increment on failure");
});
