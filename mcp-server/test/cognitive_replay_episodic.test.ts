// web_cognitive_replay finds a playbook by the id recall hands out (M7), and web_episodic_query answers from
// the real, durable episodes rather than an invented in-memory log (M1).

// Must stay the first import: see _isolate-data-dir.ts
import "./_isolate-data-dir.js";
import test from "node:test";
import assert from "node:assert/strict";
import { CognitiveReplayAndHygieneEngine } from "../cognitive-replay.js";
import { cognitiveStore } from "../cognitive-memory.js";
import { trackToolExecution } from "../cognitive-auto-tracker.js";
import { call, reopen } from "./_cognitive-helpers.js";

test("M7: replay accepts the playbook id that web_recall returns", () => {
  const recalled = call("web_recall", { domain: "x.com", intent: "post" }).data;
  const id = recalled.recommendedPlaybook.id;
  assert.equal(id, "pb_x_publish_post", "recall hands out ids, not storage keys");

  const byId = call("web_cognitive_replay", { domain: "x.com", playbookId: id }).data;
  assert.equal(byId.playbookId, id);
  assert.ok(byId.scenariosTested >= 3, "the replay actually ran");
  assert.equal(byId.vulnerabilitiesDetected.some((v: string) => /No playbook found/.test(v)), false);

  // Names and the old storage key still resolve to the same playbook.
  assert.equal(call("web_cognitive_replay", { domain: "x.com", playbookId: "x_publish_post" }).data.playbookId, id);
});

test("M7: replay never picks another domain's playbook or an archived one", () => {
  const engine = new CognitiveReplayAndHygieneEngine();
  const other = engine.simulateOfflineReplay({ domain: "threads.net", playbookId: "pb_x_publish_post" });
  assert.equal(other.scenariosTested, 0, "an id of another domain is not this domain's playbook");

  cognitiveStore.learn({ action: "playbook", domain: "archive.example", data: { name: "old_flow", steps: [{ step: 1, name: "go", tool: "web_navigate" }] } });
  const [pbId] = cognitiveStore.archivePlaybooks("archive.example", [cognitiveStore.findPlaybook("archive.example", "old_flow")!.id], "test");
  assert.ok(pbId);
  assert.equal(engine.simulateOfflineReplay({ domain: "archive.example", playbookId: pbId }).scenariosTested, 0, "archived by id");
  assert.equal(engine.simulateOfflineReplay({ domain: "archive.example" }).scenariosTested, 0, "and not as the domain's default either");
});

test("M1: episodic query reads the durable store, newest first, and logEpisode writes to it", () => {
  const engine = new CognitiveReplayAndHygieneEngine();
  const session = "episodic-real";
  trackToolExecution("web_navigate", { url: "https://real.example/a", tabId: 5 }, { ok: true }, 210, session);
  trackToolExecution("web_click", { tabId: 5, selector: "#buy" }, { ok: false, error: "Element not found" }, 90, session);

  const all = engine.queryEpisodicMemory({ domain: "https://WWW.real.example:443/" });
  assert.equal(all.totalCount, 2, "exactly the episodes the tracker logged - nothing invented");
  assert.deepEqual(all.episodes.map((e) => e.intent), ["click", "navigate"], "newest first");
  const [click, nav] = all.episodes;
  assert.equal(click.outcome, "failure");
  assert.equal(click.hubOutcome, "failure");
  assert.equal(click.latencyMs, 90);
  assert.match(String(click.lessonsLearned), /Element not found/);
  assert.equal(nav.outcome, "success");
  assert.equal(engine.queryEpisodicMemory({ domain: "real.example", outcome: "failure" }).totalCount, 1);
  assert.equal(engine.queryEpisodicMemory({ domain: "real.example", limit: 1 }).episodes.length, 1);

  const logged = engine.logEpisode({ domain: "logged.example", intent: "post", latencyMs: 700, outcome: "success", probesObserved: { auth: true }, lessonsLearned: "worked" });
  assert.match(logged.id, /^ep_/);
  cognitiveStore.flush();
  const stored = reopen().load().episodes.find((e) => e.id === logged.id);
  assert.ok(stored, "logEpisode lands in the durable store");
  assert.equal(stored.domain, "logged.example");
  assert.equal(stored.durationMs, 700);
  assert.deepEqual(stored.conditionSignals, { auth: true });

  // A fresh engine (as after a restart) sees the same history: the log is not engine state.
  assert.equal(new CognitiveReplayAndHygieneEngine().queryEpisodicMemory({ domain: "logged.example" }).totalCount, 1);
});

test("M1: no seeded fiction - an unknown domain has no episodes", () => {
  const result = new CognitiveReplayAndHygieneEngine().queryEpisodicMemory({ domain: "never-visited.example" });
  assert.equal(result.totalCount, 0);
  assert.match(result.autobiographicalSummary, /No autobiographical episodes/);
});
