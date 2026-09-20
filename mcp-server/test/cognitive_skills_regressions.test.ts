// Regressions for Phase 4a of the cognitive spine: every defect an adversarial review of the
// verified-skill lifecycle turned up, pinned so it cannot come back.
//
// Each one reproduced against the code as first written, and every one was a SILENT wrong answer rather
// than a crash: nothing failed, the store just quietly did the wrong thing - emptied a collection it
// could not parse, let one domain overwrite another's proven playbook, let a caller evict a playbook by
// naming its own after it, or kept recommending a recipe that had just failed three times.

import "./_isolate-data-dir.js"; // Must stay the first import (points the data dir at a temp folder)
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { CognitiveMemoryStore } from "../cognitive-memory.js";
import { migrateMemory } from "../cognitive-memory-migrate.js";
import { SUSPECT_AFTER_FAILURES, statusOf } from "../cognitive-skills.js";

function scratchStore(): { store: CognitiveMemoryStore; cleanup: () => void } {
  const dir = mkdtempSync(path.join(tmpdir(), "cognitive-regress-"));
  return { store: new CognitiveMemoryStore(path.join(dir, "memory.json")), cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}
const STEPS = [{ step: 1, name: "go", tool: "web_navigate" }, { step: 2, name: "click", tool: "web_click" }];
const confirm = (store: CognitiveMemoryStore, domain: string, playbook: string, session: string, success = true, hubConfirmed = true) =>
  store.recordOutcome({ domain, playbook, success, session, hubConfirmed });

test("REGRESSION: a wrong-typed playbooks collection is quarantined, never emptied and saved over", () => {
  // The 1.1.0 upgrade coerced a non-object collection to {}, which then passed the wrong-type guard.
  // load() saw changed=true, saved, and every learned playbook was gone with no .corrupt- copy.
  for (const wrong of [[{ id: "pb", name: "n", domain: "a.example", successCount: 12 }], "nonsense", 42]) {
    assert.equal(migrateMemory({ version: "1.1.0", updatedAt: "x", domains: {}, pitfalls: {}, episodes: [], playbooks: wrong }), null,
      `playbooks as ${JSON.stringify(wrong).slice(0, 30)} must be refused so the caller quarantines the bytes`);
  }
  // The same must hold for a legacy unversioned file, which is the path the migration exists to serve.
  assert.equal(migrateMemory({ domains: {}, pitfalls: {}, episodes: [], playbooks: ["x"] }), null);
  assert.equal(migrateMemory({ version: "1.1.0", updatedAt: "x", domains: [], pitfalls: {}, episodes: [], playbooks: {} }), null, "and for the other collections");
  assert.equal(migrateMemory({ version: "1.1.0", updatedAt: "x", domains: {}, pitfalls: {}, episodes: {}, playbooks: {} }), null, "and for episodes");
});

test("REGRESSION: a playbook entry that is not an object is quarantined, not passed through to crash recall()", () => {
  // It used to be copied through verbatim; recall() then read .status on null and threw on every call.
  assert.equal(migrateMemory({ version: "1.1.0", updatedAt: "x", domains: {}, pitfalls: {}, episodes: [], playbooks: { good: { id: "g", name: "g", domain: "a.example", intent: "post", successCount: 1, steps: [] }, bad: null } }), null);

  const { store, cleanup } = scratchStore();
  try {
    store.learn({ action: "playbook", domain: "crash.example", intent: "post", data: { name: "ok", steps: STEPS } });
    assert.doesNotThrow(() => store.recall({ domain: "crash.example", intent: "post" }));
  } finally { cleanup(); }
});

test("REGRESSION: learning for one domain never overwrites another domain's verified playbook of the same name", () => {
  // The existence check read mem.playbooks[name], which found the OTHER domain's entry, so this domain's
  // verified playbook was replaced in place with no candidate slot and no archive.
  const { store, cleanup } = scratchStore();
  try {
    store.learn({ action: "playbook", domain: "one.example", intent: "post", data: { name: "shared", steps: STEPS, description: "ONE" } });
    const two = store.learn({ action: "playbook", domain: "two.example", intent: "post", data: { name: "shared", steps: STEPS, description: "TWO original" } });
    confirm(store, "two.example", String(two.entryId), "s1");
    confirm(store, "two.example", String(two.entryId), "s2");

    store.learn({ action: "playbook", domain: "two.example", intent: "post", data: { name: "shared", steps: STEPS, description: "TWO edit" } });
    assert.equal(store.findPlaybook("two.example", "shared")!.description, "TWO original", "the verified playbook is untouched");
    assert.equal(store.findPlaybook("one.example", "shared")!.description, "ONE", "and the other domain's is too");
  } finally { cleanup(); }
});

test("REGRESSION: a caller cannot evict a verified playbook by naming its own playbook after it", () => {
  // supersede() keyed off a "~candidate" suffix in the NAME, which a caller simply types. A playbook on
  // evil.example named "flow~candidate" archived bank.example's verified "flow" and took its slot.
  const { store, cleanup } = scratchStore();
  try {
    store.learn({ action: "playbook", domain: "bank.example", intent: "pay", data: { name: "flow", steps: STEPS, description: "BANK real flow" } });
    confirm(store, "bank.example", "flow", "s1");
    confirm(store, "bank.example", "flow", "s2");

    const evil = store.learn({ action: "playbook", domain: "evil.example", intent: "x", data: { name: "flow~candidate", steps: STEPS, description: "ATTACKER" } });
    confirm(store, "evil.example", String(evil.entryId), "s1");
    confirm(store, "evil.example", String(evil.entryId), "s2");

    const bank = store.findPlaybook("bank.example", "flow");
    assert.equal(bank?.description, "BANK real flow", "bank's playbook must still be there");
    assert.equal(statusOf(bank!), "verified", "and still verified, not archived");
    assert.equal(store.findPlaybook("evil.example", "flow~candidate")?.domain, "evil.example", "the other domain's playbook stays on its own domain");
  } finally { cleanup(); }
});

test("REGRESSION: a second edit never destroys a pending edit that has already banked a verification", () => {
  // Every edit landed on one shared "<name>~candidate" key, so a typo fix wiped an edit that was one
  // session away from replacing the original, taking its banked verification with it.
  const { store, cleanup } = scratchStore();
  try {
    const d = "edit2.example";
    store.learn({ action: "playbook", domain: d, intent: "post", data: { name: "flow", steps: STEPS, description: "original" } });
    confirm(store, d, "flow", "s1"); confirm(store, d, "flow", "s2");

    const first = store.learn({ action: "playbook", domain: d, intent: "post", data: { name: "flow", steps: STEPS, description: "edit one" } });
    confirm(store, d, String(first.entryId), "sC");
    assert.equal(store.findPlaybook(d, String(first.entryId))!.verifications!.length, 1);

    store.learn({ action: "playbook", domain: d, intent: "post", data: { name: "flow", steps: STEPS, description: "edit two" } });
    const survivor = store.findPlaybook(d, String(first.entryId));
    assert.equal(survivor?.description, "edit one", "the edit with banked work survives");
    assert.equal(survivor?.verifications?.length, 1, "with its verification intact");

    // An edit that has banked NOTHING is just a revision of itself, and does not pile up.
    const e3 = store.learn({ action: "playbook", domain: d, intent: "post", data: { name: "flow", steps: STEPS, description: "edit three" } });
    const pending = Object.values(store.load().playbooks).filter((p) => p.supersedes && statusOf(p) !== "deprecated");
    assert.equal(pending.length, 2, "one banked edit plus one live draft, not a new slot every time");
    assert.equal(store.findPlaybook(d, String(e3.entryId))?.description, "edit three");
  } finally { cleanup(); }
});

test("REGRESSION: a caller-supplied id cannot steer outcomes onto another playbook's record", () => {
  // findPlaybook matched id OR name with no uniqueness guard, so learning {name:"x_v2", id:"checkout"}
  // made every outcome for the new draft land on the REAL verified "checkout".
  const { store, cleanup } = scratchStore();
  try {
    const d = "amb.example";
    store.learn({ action: "playbook", domain: d, intent: "post", data: { name: "checkout", steps: STEPS, description: "REAL checkout" } });
    confirm(store, d, "checkout", "s1"); confirm(store, d, "checkout", "s2");
    const realCount = store.findPlaybook(d, "checkout")!.successCount;

    const v2 = store.learn({ action: "playbook", domain: d, intent: "post", data: { name: "checkout_v2", id: "checkout", steps: STEPS, description: "new draft" } });
    assert.ok(v2.argsIgnored?.includes("data.id"), "the caller is told its id was ignored");
    assert.notEqual(v2.entryId, "checkout");
    assert.equal(store.findPlaybook(d, String(v2.entryId))!.description, "new draft", "the id resolves to the draft that was just stored");

    confirm(store, d, String(v2.entryId), "s1");
    assert.equal(store.findPlaybook(d, "checkout")!.successCount, realCount, "the real playbook's record is untouched");
  } finally { cleanup(); }
});

test("REGRESSION: a broken verified playbook stops outranking the replacement that actually works", () => {
  // A verified playbook that had failed three times still out-scored a fresh, hub-confirmed candidate on
  // importance, so recall kept recommending the one that was known to be broken.
  const { store, cleanup } = scratchStore();
  try {
    const d = "suspect.example";
    store.learn({ action: "playbook", domain: d, intent: "post", data: { name: "old", steps: STEPS } });
    confirm(store, d, "old", "s1"); confirm(store, d, "old", "s2");
    for (let i = 0; i < SUSPECT_AFTER_FAILURES; i += 1) confirm(store, d, "old", "s1", false, false);

    store.learn({ action: "playbook", domain: d, intent: "post", data: { name: "replacement", steps: STEPS } });
    confirm(store, d, "replacement", "sC");
    assert.equal(store.recall({ domain: d, intent: "post" }).recommendedPlaybook?.name, "replacement");

    // ...but a HEALTHY verified playbook still beats any candidate.
    confirm(store, d, "old", "s4");
    assert.equal(store.recall({ domain: d, intent: "post" }).recommendedPlaybook?.name, "old");
  } finally { cleanup(); }
});

test("REGRESSION: the page signals the caller detected outrank a fresher playbook that ignores them", () => {
  // Relevance was split 60/40 intent/signals, but recall pre-filters by intent, so the signal term was
  // worth at most 0.4 - which a week of staleness could outvote.
  const { store, cleanup } = scratchStore();
  try {
    const d = "rel.example";
    store.learn({ action: "playbook", domain: d, intent: "post", data: { name: "signal_match", steps: STEPS, environmentalProbes: [{ signal: "modal_open", expected: "present", humanAnalogy: "" }] } });
    confirm(store, d, "signal_match", "s1"); confirm(store, d, "signal_match", "s2");
    store.findPlaybook(d, "signal_match")!.lastExecutedAt = new Date(Date.now() - 7 * 24 * 3_600_000).toISOString();

    store.learn({ action: "playbook", domain: d, intent: "post", data: { name: "fresh_norel", steps: STEPS } });
    confirm(store, d, "fresh_norel", "s1"); confirm(store, d, "fresh_norel", "s2");

    assert.equal(store.recall({ domain: d, intent: "post", detectedSignals: { modal_open: true } }).recommendedPlaybook?.name, "signal_match");
    assert.equal(store.recall({ domain: d, intent: "post" }).recommendedPlaybook?.name, "fresh_norel", "with no signals detected, recency decides");
  } finally { cleanup(); }
});

test("REGRESSION: an intent with stray whitespace still finds the playbook", () => {
  // The tool layer passes the caller's string through untouched, and recall lowercased without trimming,
  // so `intent: "post "` matched nothing and hid the shipped x.com playbook entirely.
  const { store, cleanup } = scratchStore();
  try {
    for (const intent of ["post", " post", "post ", "  POST  "]) {
      assert.equal(store.recall({ domain: "x.com", intent }).recommendedPlaybook?.name, "x_publish_post", `intent ${JSON.stringify(intent)}`);
    }
  } finally { cleanup(); }
});

test("REGRESSION: web_warm defers to recall's verification verdict instead of re-deriving it", () => {
  // speculativeWarm recomputed fastPathAvailable as "a playbook came back", so the tool agents are told to
  // call FIRST advertised a draft the model had just invented as a proven recipe.
  const { store, cleanup } = scratchStore();
  try {
    const d = "warm.example";
    store.learn({ action: "playbook", domain: d, intent: "post", data: { name: "w_flow", steps: STEPS } });
    const draft = store.warm({ domain: d, intent: "post" });
    assert.equal(draft.fastPathAvailable, false, "an unverified draft is not a fast path");
    assert.equal(draft.playbookStatus, "candidate");
    assert.match(String(draft.guidance), /UNVERIFIED draft/);

    confirm(store, d, "w_flow", "s1"); confirm(store, d, "w_flow", "s2");
    const ready = store.warm({ domain: d, intent: "post" });
    assert.equal(ready.fastPathAvailable, true);
    assert.equal(ready.playbookStatus, "verified");
  } finally { cleanup(); }
});
