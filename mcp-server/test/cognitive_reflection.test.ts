// Reflection (Phase 4b of the cognitive spine).
//
// Reflection is deterministic: counting and arithmetic over episodes the hub recorded itself, so every
// rule can be pinned exactly. The thing most worth testing is what it REFUSES to say - an insight drawn
// from the safety layer declining, or a paraphrase of one already recorded, is worth less than silence.
// The curriculum and hygiene suites are cognitive_curriculum.test.ts and cognitive_hygiene.test.ts.

import "./_isolate-data-dir.js"; // Must stay the first import (points the data dir at a temp folder)
import test from "node:test";
import assert from "node:assert/strict";
import { cognitiveStore } from "../cognitive-memory.js";
import { migrateMemory } from "../cognitive-memory-migrate.js";
import { MAX_DOMAINS, REFLECT_THRESHOLD, importanceOf, isInformative, runReflectionPass, synthesise, synthesiseMeta, unreflectedImportance, type Reflection } from "../cognitive-reflection.js";
import { NOW, T0, call, ep, iso, scratchStore } from "./_cognitive-helpers.js";

const insights = (rs: Array<Omit<Reflection, "coversThrough" | "importanceConsumed">>) => rs.map((r) => r.insight);

// ── what counts as worth thinking about ────────────────────────────────────

test("a refusal by the safety layer is not evidence about anything", () => {
  assert.equal(isInformative(ep({ success: false, outcome: "neutral" })), false);
  assert.equal(isInformative(ep({ success: false, outcome: "failure" })), true);
  assert.equal(isInformative(ep({ success: true })), true);

  // Episodes recorded before the hub stamped its verdict carry only the prose, so the same patterns apply.
  for (const notes of [
    "Instant telemetry: web_click failed: Action access not granted for origin https://x.example.",
    "Instant telemetry: web_click failed: Read access not granted for origin https://x.example.",
    "Instant telemetry: web_click failed: USER_CONFIRMATION_REQUIRED",
    "Instant telemetry: web_click failed: Web access is disabled in the extension.",
    "Instant telemetry: web_click failed: Timed out after 45000ms waiting for the browser extension.",
  ]) {
    assert.equal(isInformative(ep({ success: false, notes })), false, notes.slice(40, 80));
  }
  assert.equal(isInformative(ep({ success: false, notes: "Instant telemetry: web_click failed: Element not found: #buy" })), true, "a real page failure still counts");
  assert.equal(importanceOf(ep({ success: false, outcome: "neutral" }), { seenIntents: new Set(), previousFailed: false }), 0);
});

test("importance follows how instructive a run is", () => {
  const ctx = (seen: string[], previousFailed = false) => ({ seenIntents: new Set(seen), previousFailed });
  assert.equal(importanceOf(ep(), ctx(["click"])), 1, "a routine success");
  assert.equal(importanceOf(ep(), ctx([])), 3, "the first time this domain did this at all");
  assert.equal(importanceOf(ep(), ctx(["click"], true)), 5, "recovering from a failure is the most instructive success");
  assert.equal(importanceOf(ep({ success: false }), ctx(["click"])), 5, "a plain failure");
  assert.equal(importanceOf(ep({ success: false, pitfallsEncountered: ["p1"] }), ctx(["click"])), 8, "a failure with a known pitfall");
});

test("unreflected importance counts only what is newer than the watermark", () => {
  const eps = [ep({ timestamp: iso(T0) }), ep({ timestamp: iso(T0 + 1000) }), ep({ timestamp: iso(T0 + 2000) })];
  assert.equal(unreflectedImportance(eps, null).counted, 3);
  assert.equal(unreflectedImportance(eps, iso(T0 + 1000)).counted, 1);
  assert.equal(unreflectedImportance(eps, iso(T0 + 9000)).counted, 0);
  assert.equal(unreflectedImportance(eps, iso(T0 + 9000)).total, 0);
  assert.equal(unreflectedImportance([], null).newest, null);

  // Context accrues over ALL episodes: an intent already seen before the watermark is not "new" again.
  const mixed = [ep({ timestamp: iso(T0), intent: "click" }), ep({ timestamp: iso(T0 + 2000), intent: "click" })];
  assert.equal(unreflectedImportance(mixed, iso(T0 + 1000)).total, 1, "the second click is routine, not a first sighting");
});

// ── the rules ───────────────────────────────────────────────────────────────

test("reliability: a flawless intent is noted, a flaky one comes with advice, a thin one says nothing", () => {
  const flawless = synthesise("site.example", Array.from({ length: 5 }, () => ep({ intent: "navigate" })), NOW);
  assert.match(insights(flawless).join(" "), /"navigate" has succeeded in all 5 recorded runs on site\.example/);

  const flaky = synthesise("site.example", [
    ...Array.from({ length: 3 }, () => ep({ intent: "click", success: false })),
    ...Array.from({ length: 2 }, () => ep({ intent: "click" })),
  ], NOW);
  const found = flaky.find((r) => r.kind === "intent_reliability")!;
  assert.match(found.insight, /"click" fails often .*3 of 5 runs \(60% failure rate\)/);
  assert.match(String(found.advice), /web_expect/);

  const thin = synthesise("site.example", [ep({ intent: "a" }), ep({ intent: "b" }), ep({ intent: "c" }), ep({ intent: "d" })], NOW);
  assert.deepEqual(thin.filter((r) => r.kind === "intent_reliability"), [], "fewer than three runs of an intent proves nothing");

  assert.deepEqual(synthesise("site.example", [ep(), ep()], NOW), [], "and a domain with almost no history says nothing at all");
});

test("failure clustering names the fragile step instead of blaming the domain", () => {
  const out = synthesise("site.example", [
    ep({ intent: "click", success: false }), ep({ intent: "click", success: false }),
    ep({ intent: "navigate" }), ep({ intent: "navigate" }), ep({ intent: "screenshot" }),
  ], NOW);
  const cluster = out.find((r) => r.kind === "failure_cluster")!;
  assert.match(cluster.insight, /Every failure on site\.example \(2\) was "click"; everything else succeeded/);

  // When failures are spread across intents there is no cluster to report.
  const spread = synthesise("site.example", [
    ep({ intent: "click", success: false }), ep({ intent: "navigate", success: false }),
    ep({ intent: "click" }), ep({ intent: "navigate" }),
  ], NOW);
  assert.equal(spread.find((r) => r.kind === "failure_cluster"), undefined);
});

test("a step far slower than the rest of the domain is surfaced with a workable timeout", () => {
  const out = synthesise("site.example", [
    ep({ intent: "navigate", durationMs: 16000 }), ep({ intent: "navigate", durationMs: 15000 }),
    ...Array.from({ length: 6 }, () => ep({ intent: "click", durationMs: 300 })),
  ], NOW);
  const slow = out.find((r) => r.kind === "latency_outlier")!;
  assert.match(slow.insight, /"navigate" is much slower/);
  assert.match(String(slow.advice), /~16s/);

  const even = synthesise("site.example", Array.from({ length: 6 }, () => ep({ intent: "click", durationMs: 300 })), NOW);
  assert.equal(even.find((r) => r.kind === "latency_outlier"), undefined, "no outlier when everything is the same speed");
});

test("a documented pitfall that keeps happening is the most actionable insight of all", () => {
  const out = synthesise("site.example", [
    ep({ success: false, pitfallsEncountered: ["pitfall_draftjs"] }),
    ep({ success: false, pitfallsEncountered: ["pitfall_draftjs"] }),
    ep(), ep(),
  ], NOW);
  const rec = out.find((r) => r.kind === "pitfall_recurrence")!;
  assert.match(rec.insight, /"pitfall_draftjs" was cited in 2 runs on site\.example/);
  assert.match(String(rec.advice), /provenSolution/);
  assert.doesNotMatch(rec.insight, /documented/, "it cannot know the cited id is a stored pitfall, so it does not say so");

  const once = synthesise("site.example", [ep({ success: false, pitfallsEncountered: ["p"] }), ep(), ep(), ep()], NOW);
  assert.equal(once.find((r) => r.kind === "pitfall_recurrence"), undefined, "hitting it once is not a pattern");
});

test("signals speak only when a caller actually supplied them", () => {
  const withSignals = synthesise("site.example", [
    ep({ conditionSignals: { modal_open: true } }), ep({ conditionSignals: { modal_open: true } }),
    ep({ conditionSignals: { modal_open: false }, success: false }), ep({ conditionSignals: { modal_open: false }, success: false }),
  ], NOW);
  const sig = withSignals.find((r) => r.kind === "signal_correlation")!;
  assert.match(sig.insight, /succeed 100% of the time when "modal_open" is present against 0%/);

  const none = synthesise("site.example", Array.from({ length: 6 }, () => ep({ intent: "click" })), NOW);
  assert.equal(none.find((r) => r.kind === "signal_correlation"), undefined, "no signals recorded, nothing invented");
});

test("a depth-2 reflection needs several depth-1 insights, and never goes deeper", () => {
  const shaky = (intent: string): Reflection => ({ id: intent, key: `intent_reliability:${intent}`, verdict: "flaky", domain: "site.example", kind: "intent_reliability", insight: `${intent} is shaky`, intent, evidence: { successRate: 0.5 }, depth: 1, createdAt: NOW, coversThrough: NOW, importanceConsumed: 1 });
  assert.deepEqual(synthesiseMeta("site.example", [shaky("a"), shaky("b")], NOW), [], "two insights is not yet a pattern (needs three priors)");
  assert.deepEqual(synthesiseMeta("site.example", [shaky("a"), shaky("a"), shaky("a")], NOW), [], "three insights about ONE step are not 'several steps'");

  const meta = synthesiseMeta("site.example", [shaky("a"), shaky("b"), shaky("c")], NOW);
  assert.equal(meta.length, 1);
  assert.equal(meta[0].depth, 2);
  assert.match(meta[0].insight, /unreliable across several steps/);

  const depth2 = { ...shaky("a"), depth: 2 };
  assert.deepEqual(synthesiseMeta("site.example", [depth2, depth2, depth2], NOW), [], "reflections about reflections are not reflected on again");
});

// ── the pass, through the store ─────────────────────────────────────────────

const routine = (n: number, domain = "quiet.example") => Array.from({ length: n }, (_, i) => ep({ domain, intent: "click", timestamp: iso(T0 + i * 1000) }));

test("an idle domain is left completely alone until it has something worth saying", () => {
  const { store, cleanup } = scratchStore();
  try {
    for (const e of routine(5)) store.learn({ action: "episode", domain: e.domain, intent: e.intent, data: e });
    const [result] = store.reflect({ domain: "quiet.example" });
    assert.equal(result.reflected, false);
    assert.match(String(result.reason), /nothing new enough/);
    assert.ok(result.importance < REFLECT_THRESHOLD);
    assert.deepEqual(store.load().reflections["quiet.example"], undefined, "and nothing is written");
  } finally { cleanup(); }
});

test("a busy domain reflects, records its watermark, and does not repeat itself", () => {
  const { store, cleanup } = scratchStore();
  try {
    const d = "busy.example";
    // Routine successes are worth 1 each, so it takes a real working session to cross the threshold.
    for (let i = 0; i < 52; i += 1) {
      store.learn({ action: "episode", domain: d, intent: i % 3 === 0 ? "navigate" : "click", data: { success: true, durationMs: 400 } });
    }
    const [first] = store.reflect({ domain: d });
    assert.equal(first.reflected, true);
    assert.ok(first.insights.length > 0);
    assert.ok(first.insights.every((r) => r.coversThrough && r.importanceConsumed > 0), "every insight records how far it read");
    assert.equal(store.load().reflections[d].length, first.insights.length);

    const [again] = store.reflect({ domain: d, force: true });
    assert.equal(again.reflected, false, "the same evidence produces nothing new");
    assert.match(String(again.reason), /nothing new to say/);
    assert.equal(store.load().reflections[d].length, first.insights.length, "and nothing is appended");
  } finally { cleanup(); }
});

test("reflections come back from recall, because they are memories too", () => {
  const { store, cleanup } = scratchStore();
  try {
    const d = "recallme.example";
    for (let i = 0; i < 12; i += 1) store.learn({ action: "episode", domain: d, intent: "click", data: { success: false, durationMs: 100 } });
    store.reflect({ domain: d, force: true });
    const recalled = store.recall({ domain: d });
    assert.ok(recalled.reflections.length > 0);
    assert.ok(recalled.reflections[0].insight);
    assert.equal(store.recall({ domain: "nothing-here.example" }).reflections.length, 0);
  } finally { cleanup(); }
});

test("the refusals in a real store do not become insights about the domain", () => {
  const { store, cleanup } = scratchStore();
  try {
    const d = "refused.example";
    for (let i = 0; i < 6; i += 1) store.learn({ action: "episode", domain: d, intent: "navigate", data: { success: true, durationMs: 200 } });
    for (let i = 0; i < 6; i += 1) {
      store.learn({ action: "episode", domain: d, intent: "click", data: { success: false, durationMs: 50, outcome: "neutral", notes: "Instant telemetry: web_click failed: Action access not granted for origin https://refused.example." } });
    }
    const [r] = store.reflect({ domain: d, force: true });
    const text = r.insights.map((i) => i.insight).join(" ");
    assert.doesNotMatch(text, /"click" fails often/, "a permission refusal is not the domain being unreliable");
    assert.doesNotMatch(text, /failure/i);
  } finally { cleanup(); }
});

test("1.2.0 -> 1.3.0 adds reflections without disturbing anything else", () => {
  const before = { version: "1.2.0", updatedAt: "x", domains: { "a.example": { domain: "a.example" } }, pitfalls: {}, episodes: [{ id: "e", timestamp: NOW, domain: "a.example", intent: "click", success: true, durationMs: 1 }], playbooks: { p: { id: "p", name: "p", domain: "a.example", intent: "post", successCount: 5, steps: [], status: "verified" } } };
  const out = migrateMemory(JSON.parse(JSON.stringify(before)))!;
  assert.equal(out.data.version, "1.3.0");
  assert.deepEqual(out.data.reflections, {});
  assert.equal(out.data.episodes.length, 1);
  assert.equal((out.data.playbooks.p as { status?: string }).status, "verified", "the lifecycle from 1.2.0 is untouched");

  // And the whole chain from the oldest format still arrives intact.
  const ancient = migrateMemory({ playbooks: { old: { id: "old", name: "old", domain: "a.example", intent: "post", successCount: 3, steps: [] } }, domains: {}, pitfalls: {}, episodes: [] })!;
  assert.equal(ancient.data.version, "1.3.0");
  assert.equal((ancient.data.playbooks.old as { status?: string }).status, "verified");
  assert.deepEqual(ancient.data.reflections, {});
});

// ── regressions: what an adversarial review of this change turned up ────────

test("REGRESSION: the hub's own verdict on a run reaches the store", () => {
  // learn({action:"episode"}) built its episode literal without `outcome`, so the classification the
  // tracker had just computed was dropped on the floor and every episode fell back to matching prose.
  const { store, cleanup } = scratchStore();
  try {
    store.learn({ action: "episode", domain: "verdict.example", intent: "click", data: { success: false, durationMs: 5, outcome: "neutral", notes: "x" } });
    const eps = store.load().episodes;
    assert.equal(eps[eps.length - 1].outcome, "neutral");
  } finally { cleanup(); }
});

test("REGRESSION: a later insight about the same subject REPLACES the earlier one", () => {
  // Insights embed live counts, so de-duping on the rendered sentence never fired: "(40/40)" and
  // "(80/80)" looked like different insights and every pass piled up another paraphrase. Worse, the
  // superseded claim stayed, so recall served "succeeded in all runs" beside "fails often".
  const { store, cleanup } = scratchStore();
  try {
    const d = "supersede.example";
    const run = (n: number, success: boolean) => {
      for (let i = 0; i < n; i += 1) store.learn({ action: "episode", domain: d, intent: "click", data: { success, durationMs: 100 } });
      return store.reflect({ domain: d, force: true });
    };

    run(60, true);
    const first = store.load().reflections[d];
    assert.equal(first.length, 1);
    assert.match(first[0].insight, /succeeded in all \d+ recorded runs/);

    // The same kind of evidence again says nothing new, and must not rewrite the store.
    const quiet = run(60, true);
    assert.equal(quiet[0].reflected, false, "a bigger count is not a new insight");
    assert.equal(store.load().reflections[d].length, 1);

    // The site breaks: the old claim is withdrawn, not left standing beside its own contradiction.
    run(90, false);
    const after = store.load().reflections[d];
    assert.equal(after.filter((r) => r.key === "intent_reliability:click").length, 1, "one insight per subject");
    assert.doesNotMatch(after.map((r) => r.insight).join(" "), /succeeded in all/, "the superseded claim is gone");
    assert.match(after.find((r) => r.key === "intent_reliability:click")!.insight, /fails often/);
  } finally { cleanup(); }
});

test("REGRESSION: the number of reflected domains is bounded, keeping the most recently reflected", () => {
  // MAX_PER_DOMAIN capped rows per domain but nothing capped the number of domain KEYS, and nothing
  // ever deleted one, in a file that is rewritten on every relayed tool call.
  const mem = migrateMemory({ version: "1.3.0", updatedAt: "x", domains: {}, pitfalls: {}, playbooks: {}, episodes: [], reflections: {} })!.data;
  const total = MAX_DOMAINS + 50;
  for (let i = 0; i < total; i += 1) {
    const domain = `d${String(i).padStart(3, "0")}.example`;
    // Older domains have older reflections, so d000 is the stalest and d249 the freshest.
    mem.reflections[domain] = [{
      id: `r${i}`, key: "intent_reliability:click", verdict: "never_failed", domain, kind: "intent_reliability", insight: `i${i}`,
      evidence: {}, depth: 1, createdAt: new Date(T0 + i * 1000).toISOString(), coversThrough: NOW, importanceConsumed: 1,
    }];
  }
  // A domain with enough history to reflect forces a pass that actually changes something.
  for (let i = 0; i < 6; i += 1) mem.episodes.push(ep({ domain: "fresh.example", intent: "click", timestamp: iso(T0 + i) }));

  const { changed } = runReflectionPass(mem, { domain: "fresh.example", force: true, normalize: (d) => d });
  assert.equal(changed, true);
  const kept = Object.keys(mem.reflections);
  assert.ok(kept.length <= MAX_DOMAINS, `expected at most ${MAX_DOMAINS} domains, kept ${kept.length}`);
  assert.ok(kept.includes("fresh.example"), "the domain just reflected on is always kept");
  assert.ok(kept.includes(`d${String(total - 1).padStart(3, "0")}.example`), "the most recently reflected survive");
  assert.ok(!kept.includes("d000.example"), "the stalest are what get dropped");
});

// ── the tools ───────────────────────────────────────────────────────────────

test("web_consolidate {reflect:true} reports what the hub worked out, and plain consolidation still works", () => {
  const d = "tool-reflect.example";
  for (let i = 0; i < 12; i += 1) cognitiveStore.learn({ action: "episode", domain: d, intent: "click", data: { success: true, durationMs: 100 } });

  const plain = call("web_consolidate", {}).data;
  assert.equal(plain.reflection, undefined, "reflection is opt-in: an ordinary consolidation is unchanged");
  assert.ok(typeof plain.bronzeRetainedCount === "number");

  const withReflection = call("web_consolidate", { reflect: true, domain: d, force: true }).data;
  assert.ok(Array.isArray(withReflection.reflection));
  assert.equal(withReflection.reflection[0].domain, d);
  assert.equal(withReflection.reflection[0].reflected, true);
  assert.ok(typeof withReflection.bronzeRetainedCount === "number", "and the consolidation report is still there beside it");

  const viaAction = call("web_consolidate", { action: "reflect", domain: d, force: true }).data;
  assert.ok(Array.isArray(viaAction.reflection), "action:'reflect' asks for the same thing");
});
