// M8: the cognitive dispatcher canonicalizes args.domain once, so every handler treats
// "https://WWW.x.com:443/" and "x.com" as the same domain - including handlers that used the raw string.

// Must stay the first import: see _isolate-data-dir.ts
import "./_isolate-data-dir.js";
import test from "node:test";
import assert from "node:assert/strict";
import { call } from "./_cognitive-helpers.js";

const MESSY = "https://WWW.x.com:443/";

test("M8: a fact learned under a messy spelling is recalled under the clean one", () => {
  const learned = call("web_learn", { action: "fact", domain: MESSY, data: { framework: "react-m8" } });
  assert.equal(learned.data.domain, "x.com");
  const recalled = call("web_recall", { domain: "x.com" }).data;
  assert.equal(recalled.domainFacts.framework, "react-m8");
});

test("M8: replay, episodic query and metacognition answer the same for both spellings", () => {
  const replayMessy = call("web_cognitive_replay", { domain: MESSY }).data;
  const replayClean = call("web_cognitive_replay", { domain: "x.com" }).data;
  assert.equal(replayMessy.domain, "x.com");
  assert.equal(replayMessy.playbookId, "pb_x_publish_post", "the raw spelling used to find no playbook at all");
  assert.equal(replayMessy.playbookId, replayClean.playbookId);

  const epMessy = call("web_episodic_query", { domain: MESSY }).data;
  const epClean = call("web_episodic_query", { domain: "x.com" }).data;
  assert.ok(epMessy.totalCount >= 1);
  assert.deepEqual(epMessy.episodes.map((e: { id: string }) => e.id), epClean.episodes.map((e: { id: string }) => e.id));

  const metaMessy = call("web_metacognition", { domain: MESSY, intent: "post" }).data;
  const metaClean = call("web_metacognition", { domain: "x.com", intent: "post" }).data;
  assert.equal(metaMessy.domain, "x.com");
  assert.equal(metaMessy.confidenceScore, metaClean.confidenceScore);
  assert.equal(metaMessy.mode, metaClean.mode);
});

test("M8: object permanence registered under one spelling resolves under the other", () => {
  const reg = call("web_object_permanence", { domain: MESSY, selector: "#m8-target", action: "register", rect: { top: 2400, left: 10, width: 100, height: 40 } }).data;
  assert.equal(reg.domain, "x.com");
  assert.equal(call("web_object_permanence", { domain: "x.com", selector: "#m8-target" }).data.foundInPermanenceMemory, true);
  assert.equal(call("web_object_permanence", { domain: "WWW.X.COM", selector: "#m8-target" }).data.foundInPermanenceMemory, true);
});

test("M8: theory of mind is keyed the same way", () => {
  assert.deepEqual(call("web_theory_of_mind", { domain: MESSY, actionCountInLastMinute: 3 }).data, call("web_theory_of_mind", { domain: "x.com", actionCountInLastMinute: 3 }).data);
});

test("M8: the caller's args are never mutated, and an unparseable domain keeps its own error", () => {
  const args = { action: "fact", domain: MESSY, data: { framework: "keep" } };
  call("web_learn", args);
  assert.equal(args.domain, MESSY);
  const bad = call("web_learn", { action: "fact", domain: "not a domain", data: {} });
  assert.equal(bad.ok, false);
  assert.match(String(bad.data?.error ?? bad.error), /domain is required/);
});
