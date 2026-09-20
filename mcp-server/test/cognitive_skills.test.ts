// Verified skills and ranked recall (Phase 4a of the cognitive spine).
//
// A playbook the model had just invented started with successCount 1 (or whatever number it typed) and
// was offered at once as a "fast path"; recall() returned whichever matching playbook was stored first.
// These tests pin the replacement: a skill is checked before it enters the library (Voyager), only a
// VERIFIED one is a fast path, and recall ranks by recency + importance + relevance (Generative Agents).

import "./_isolate-data-dir.js"; // Must stay the first import (points the data dir at a temp folder)
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Response } from "express";
import { CognitiveMemoryStore, type ProceduralPlaybook } from "../cognitive-memory.js";
import { migrateMemory } from "../cognitive-memory-migrate.js";
import { HUB_OWNED_FIELDS, PROMOTE_AFTER_SESSIONS, SUSPECT_AFTER_FAILURES, applyOutcome, asCandidate, isFastPath, statusOf } from "../cognitive-skills.js";
import { importanceOf, recencyOf, relevanceOf, scorePlaybooks } from "../cognitive-recall-score.js";
import { SpineObserver, observeToolResult } from "../cognitive-spine-observer.js";
import { CognitiveSpine, globalSpine } from "../cognitive-spine.js";
import { handleCognitiveTool } from "../web-cognitive-handlers.js";

const NOW = Date.UTC(2026, 5, 1, 12);
const H = 3_600_000;
const iso = (ms: number) => new Date(ms).toISOString();

function pb(over: Partial<ProceduralPlaybook> = {}): ProceduralPlaybook {
  return { id: "pb_a", name: "a", domain: "site.example", intent: "post", description: "", environmentalProbes: [], preconditions: [], steps: [], successCount: 0, ...over };
}

function scratchStore(): { store: CognitiveMemoryStore; cleanup: () => void } {
  const dir = mkdtempSync(path.join(tmpdir(), "cognitive-skills-"));
  return { store: new CognitiveMemoryStore(path.join(dir, "memory.json")), cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}
const STEPS = [{ step: 1, name: "go", tool: "web_navigate" }, { step: 2, name: "click", tool: "web_click" }];
const confirm = (store: CognitiveMemoryStore, domain: string, playbook: string, session: string, success = true, hubConfirmed = true) =>
  store.recordOutcome({ domain, playbook, success, session, hubConfirmed });

// ── the lifecycle ───────────────────────────────────────────────────────────

test("a playbook's status is explicit when set, and derived from its successes when it predates statuses", () => {
  assert.equal(statusOf(pb({ status: "deprecated", successCount: 50 })), "deprecated");
  assert.equal(statusOf(pb({ successCount: 2 })), "verified", "two or more legacy successes: it had earned its keep");
  assert.equal(statusOf(pb({ successCount: 1 })), "candidate");
  assert.equal(statusOf(pb()), "candidate");
});

test("asCandidate discards whatever proof the submitter claimed", () => {
  const claimed = pb({ status: "verified", successCount: 999, verifications: [{ session: "x", at: "y" }], provenance: "seed", verifiedAt: "z", consecutiveFailures: 0 });
  const c = asCandidate(claimed, "2026-01-01T00:00:00Z");
  assert.deepEqual([c.status, c.successCount, c.verifications, c.provenance, c.verifiedAt], ["candidate", 0, [], "learned", undefined]);
  assert.ok(HUB_OWNED_FIELDS.includes("status") && HUB_OWNED_FIELDS.includes("successCount"));
});

test("a success only counts when the hub confirmed it, and two DISTINCT sessions promote a candidate", () => {
  const p = asCandidate(pb(), iso(NOW));
  const report = (session: string, hubConfirmed: boolean, success = true) => applyOutcome(p, { success, session, hubConfirmed, now: iso(NOW) });

  const claimed = report("s1", false);
  assert.equal(claimed.recorded, false, "an agent saying it succeeded proves nothing");
  assert.match(String(claimed.reason), /web_expect/, "and it is told how to make it count");
  assert.equal(p.successCount, 0);

  assert.equal(report("s1", true).verifiedSessions, 1);
  const again = report("s1", true);
  assert.equal(again.verifiedSessions, 1, "the same session twice is still one session");
  assert.equal(again.promoted, false);
  assert.equal(p.successCount, 2, "but each confirmed run is counted");
  assert.equal(statusOf(p), "candidate");

  const second = report("s2", true);
  assert.equal(second.promoted, true);
  assert.equal(statusOf(p), "verified");
  assert.equal(PROMOTE_AFTER_SESSIONS, 2);
  assert.ok(p.verifiedAt);
});

test("failures never promote, three in a row make a verified playbook suspect, and a confirmed success clears it", () => {
  const p = pb({ status: "verified", successCount: 5 });
  assert.equal(isFastPath(p), true);
  for (let i = 0; i < SUSPECT_AFTER_FAILURES; i += 1) applyOutcome(p, { success: false, session: "s", hubConfirmed: false, now: iso(NOW) });
  assert.equal(statusOf(p), "verified", "reported failures alone never deprecate (a caller could otherwise retire your playbooks)");
  assert.equal(isFastPath(p), false, "but the fast path is withheld until it is re-verified");
  applyOutcome(p, { success: true, session: "s", hubConfirmed: true, now: iso(NOW) });
  assert.equal(isFastPath(p), true);

  const cand = asCandidate(pb(), iso(NOW));
  for (let i = 0; i < 5; i += 1) applyOutcome(cand, { success: false, session: `s${i}`, hubConfirmed: true, now: iso(NOW) });
  assert.equal(statusOf(cand), "candidate");

  const old = pb({ status: "deprecated" });
  assert.equal(applyOutcome(old, { success: true, session: "s", hubConfirmed: true, now: iso(NOW) }).recorded, false);
});

// ── the ranking ─────────────────────────────────────────────────────────────

test("recency decays 0.995 per hour, and a playbook never used is close to forgotten", () => {
  const fresh = pb({ lastExecutedAt: iso(NOW) });
  assert.equal(recencyOf(fresh, NOW), 1);
  assert.ok(Math.abs(recencyOf(pb({ lastExecutedAt: iso(NOW - 24 * H) }), NOW) - 0.995 ** 24) < 1e-9);
  assert.ok(Math.abs(recencyOf(pb({ lastExecutedAt: iso(NOW - 168 * H) }), NOW) - 0.43) < 0.01, "a week is about 0.43");
  assert.ok(recencyOf(pb(), NOW) < 1e-6);
  assert.equal(recencyOf(pb({ lastExecutedAt: iso(NOW - 24 * H) }), NOW), recencyOf(pb({ lastExecutedAt: undefined, createdAt: iso(NOW - 24 * H) }), NOW), "createdAt is the fallback");
});

test("importance rewards verified status and hub-confirmed successes, and docks recent failures", () => {
  const verified = importanceOf(pb({ status: "verified", successCount: 10 }));
  const draft = importanceOf(pb({ status: "candidate", successCount: 0 }));
  assert.ok(verified > draft);
  assert.ok(importanceOf(pb({ status: "verified", successCount: 8 })) > importanceOf(pb({ status: "verified", successCount: 2 })));
  assert.ok(importanceOf(pb({ status: "verified", successCount: 10, consecutiveFailures: 2 })) < verified);
  assert.equal(importanceOf(pb({ status: "deprecated", successCount: 0 })), 0);
  for (const v of [verified, draft, importanceOf(pb({ status: "verified", successCount: 1e6 }))]) assert.ok(v >= 0 && v <= 1);
});

test("relevance: the intent alone when no signals are detected, mostly the signals when there are", () => {
  const p = pb({ intent: "Post", environmentalProbes: [{ signal: "modal_open", expected: "present", humanAnalogy: "" }], branches: [{ name: "b", conditionDescription: "", whenSignal: "draft_saved" }] });
  // No signals: only the intent can speak.
  assert.equal(relevanceOf(p, { intent: "post" }), 1);
  assert.equal(relevanceOf(p, { intent: "login" }), 0);
  assert.equal(relevanceOf(p, { detectedSignals: { modal_open: false } }), 0, "a signal that is off is not detected");

  // With signals, they carry most of the weight, because they are what tells two playbooks apart once
  // recall has already filtered by intent.
  assert.equal(relevanceOf(p, { intent: "post", detectedSignals: { modal_open: true, draft_saved: true } }), 1);
  assert.equal(relevanceOf(p, { intent: "post", detectedSignals: { modal_open: true, unrelated: true } }), 0.25 + 0.75 * 0.5);
  const ignoresSignals = pb({ intent: "Post" });
  assert.ok(relevanceOf(p, { intent: "post", detectedSignals: { modal_open: true } }) > relevanceOf(ignoresSignals, { intent: "post", detectedSignals: { modal_open: true } }),
    "a playbook built on the detected signal beats one that ignores it");
});

test("scorePlaybooks ranks by all three, deterministically, with each component in [0,1]", () => {
  assert.deepEqual(scorePlaybooks([], {}, NOW), []);

  const stale = pb({ id: "stale", name: "stale", status: "verified", successCount: 5, lastExecutedAt: iso(NOW - 600 * H) });
  const fresh = pb({ id: "fresh", name: "fresh", status: "verified", successCount: 5, lastExecutedAt: iso(NOW - 2 * H) });
  const ranked = scorePlaybooks([stale, fresh], { intent: "post" }, NOW);
  assert.equal(ranked[0].playbook.id, "fresh", "identical but for recency: the fresher wins");
  for (const r of ranked) for (const c of Object.values(r.components)) assert.ok(c >= 0 && c <= 1);

  const twins = [pb({ id: "b", name: "b" }), pb({ id: "a", name: "a" })];
  assert.deepEqual(scorePlaybooks(twins, {}, NOW).map((r) => r.playbook.id), ["a", "b"], "fully tied: by id, so the answer never depends on storage order");
  assert.deepEqual(scorePlaybooks([...twins].reverse(), {}, NOW).map((r) => r.playbook.id), ["a", "b"]);
});

// ── the store ───────────────────────────────────────────────────────────────

test("learning a playbook makes a candidate and ignores every proof the caller tried to attach", () => {
  const { store, cleanup } = scratchStore();
  try {
    const r = store.learn({ action: "playbook", domain: "learn.example", intent: "post", data: { name: "p1", steps: STEPS, status: "verified", successCount: 999, verifications: [{ session: "a", at: "b" }] } });
    assert.equal(r.status, "candidate");
    assert.deepEqual(r.argsIgnored, ["data.status", "data.successCount", "data.verifications"]);
    const stored = store.findPlaybook("learn.example", "p1")!;
    assert.deepEqual([stored.status, stored.successCount, stored.verifications], ["candidate", 0, []]);
    assert.equal(store.recall({ domain: "learn.example", intent: "post" }).fastPathAvailable, false);
  } finally { cleanup(); }
});

test("the shipped x.com playbook is verified and stays a fast path", () => {
  const { store, cleanup } = scratchStore();
  try {
    const r = store.recall({ domain: "x.com", intent: "post" });
    assert.equal(r.playbookStatus, "verified");
    assert.equal(r.fastPathAvailable, true);
    assert.equal(r.recommendedPlaybook?.provenance, "seed");
  } finally { cleanup(); }
});

test("editing a verified playbook waits as a candidate, and replaces it only once it earns verification", () => {
  const { store, cleanup } = scratchStore();
  try {
    const d = "edit.example";
    store.learn({ action: "playbook", domain: d, intent: "post", data: { name: "flow", steps: STEPS } });
    confirm(store, d, "flow", "s1");
    confirm(store, d, "flow", "s2");
    assert.equal(store.findPlaybook(d, "flow")!.status, "verified");

    const edit = store.learn({ action: "playbook", domain: d, intent: "post", data: { name: "flow", steps: [...STEPS, { step: 3, name: "confirm", tool: "web_expect" }] } });
    assert.match(String(edit.note), /untouched/);
    assert.equal(store.findPlaybook(d, "flow")!.steps.length, 2, "the proven playbook is untouched");
    const recalled = store.recall({ domain: d, intent: "post" });
    assert.equal(recalled.recommendedPlaybook?.steps.length, 2);
    assert.equal(recalled.fastPathAvailable, true, "a verified playbook still wins while its edit is on trial");

    const cand = store.findPlaybook(d, `${edit.entryId}`)!;
    assert.equal(cand.status, "candidate");
    confirm(store, d, cand.id, "s1");
    const promoted = confirm(store, d, cand.id, "s2");
    assert.equal(promoted.promoted, true);

    const now = store.findPlaybook(d, "flow")!;
    assert.equal(now.steps.length, 3, "the edit replaced it once verified");
    assert.equal(now.status, "verified");
    assert.ok(!now.id.includes("~candidate") && !now.name.includes("~candidate"));
    const archived = Object.values(store.load().playbooks).filter((p) => p.status === "deprecated");
    assert.equal(archived.length, 1, "the old one is kept, not deleted");
    assert.match(String(archived[0].deprecatedReason), /superseded/);
    assert.equal(store.recall({ domain: d, intent: "post" }).alternatives.some((a) => a.status === "deprecated"), false, "a deprecated playbook is never offered");
  } finally { cleanup(); }
});

test("a playbook with the same name on another domain is stored beside it, never over it", () => {
  const { store, cleanup } = scratchStore();
  try {
    store.learn({ action: "playbook", domain: "one.example", intent: "post", data: { name: "shared", steps: STEPS, description: "one" } });
    const two = store.learn({ action: "playbook", domain: "two.example", intent: "post", data: { name: "shared", steps: STEPS, description: "two" } });
    assert.equal(store.findPlaybook("one.example", "shared")!.description, "one", "the first domain's playbook survives");
    assert.equal(store.findPlaybook("two.example", String(two.entryId))!.description, "two");
    // Both keep the name their author gave them; a lookup is always scoped to its own domain.
    assert.equal(store.findPlaybook("two.example", "shared")!.description, "two");
    assert.equal(store.findPlaybook("one.example", "shared")!.description, "one");
    assert.equal(store.findPlaybook("three.example", "shared"), null, "a domain with no such playbook finds nothing");
  } finally { cleanup(); }
});

test("an outcome for a playbook that does not exist is an error, and a run of failures withholds the fast path", () => {
  const { store, cleanup } = scratchStore();
  try {
    assert.throws(() => confirm(store, "x.com", "no_such_playbook", "s"), /no playbook/);
    for (let i = 0; i < SUSPECT_AFTER_FAILURES; i += 1) confirm(store, "x.com", "x_publish_post", "s", false, false);
    const r = store.recall({ domain: "x.com", intent: "post" });
    assert.equal(r.fastPathAvailable, false);
    assert.equal(r.playbookStatus, "verified", "it is still verified, only withheld");
    assert.match(String(r.guidance), /failed several times/);
  } finally { cleanup(); }
});

test("recall prefers a verified playbook over a fresher draft, and ranks by the signals it was built on", () => {
  const { store, cleanup } = scratchStore();
  try {
    const d = "rank.example";
    store.learn({ action: "playbook", domain: d, intent: "post", data: { name: "old_verified", steps: STEPS } });
    confirm(store, d, "old_verified", "s1"); confirm(store, d, "old_verified", "s2");
    store.learn({ action: "playbook", domain: d, intent: "post", data: { name: "fresh_draft", steps: STEPS } });
    const r = store.recall({ domain: d, intent: "post" });
    assert.equal(r.recommendedPlaybook?.name, "old_verified", "a verified playbook beats a fresher draft");
    assert.equal(r.alternatives.length, 2, "and the alternatives are shown");

    // Two verified playbooks: the cue's detected signals pick the one built on them.
    for (const [name, signal] of [["modal_flow", "modal_open"], ["page_flow", "page_ready"]]) {
      store.learn({ action: "playbook", domain: d, intent: "edit", data: { name, steps: STEPS, environmentalProbes: [{ signal, expected: "present", humanAnalogy: "" }] } });
      confirm(store, d, name, "s1"); confirm(store, d, name, "s2");
    }
    assert.equal(store.recall({ domain: d, intent: "edit", detectedSignals: { page_ready: true } }).recommendedPlaybook?.name, "page_flow");
    assert.equal(store.recall({ domain: d, intent: "edit", detectedSignals: { modal_open: true } }).recommendedPlaybook?.name, "modal_flow");
  } finally { cleanup(); }
});

// ── the migration ───────────────────────────────────────────────────────────

test("1.1.0 -> 1.2.0: a playbook that had earned its keep migrates as verified, the rest as candidates, and nothing is lost", () => {
  const before = {
    version: "1.1.0", updatedAt: "2026-01-01T00:00:00Z", domains: {}, pitfalls: {}, episodes: [],
    playbooks: {
      proven: { id: "proven", name: "proven", domain: "a.example", intent: "post", successCount: 2, steps: [{ step: 1 }], lastExecutedAt: "2026-01-02T00:00:00Z" },
      shaky: { id: "shaky", name: "shaky", domain: "a.example", intent: "post", successCount: 1, steps: [] },
      explicit: { id: "explicit", name: "explicit", domain: "a.example", intent: "post", successCount: 0, status: "deprecated" },
    },
  };
  const out = migrateMemory(JSON.parse(JSON.stringify(before)))!;
  assert.equal(out.changed, true);
  assert.equal(out.data.version, "1.2.0");
  const pbs = out.data.playbooks as Record<string, any>;
  assert.deepEqual([pbs.proven.status, pbs.proven.provenance], ["verified", "legacy"]);
  assert.equal(pbs.shaky.status, "candidate");
  assert.equal(pbs.explicit.status, "deprecated", "an explicit status is never overwritten");
  assert.deepEqual(pbs.proven.steps, [{ step: 1 }], "the playbook's own content is untouched");
  assert.equal(pbs.proven.createdAt, "2026-01-02T00:00:00Z");

  const again = migrateMemory(JSON.parse(JSON.stringify(out.data)))!;
  assert.equal(again.changed, false, "a current file is not rewritten");

  const unversioned = migrateMemory({ playbooks: { p: { id: "p", name: "p", domain: "a.example", intent: "x", successCount: 3, steps: [] } }, domains: {}, pitfalls: {}, episodes: [] })!;
  assert.equal((unversioned.data.playbooks.p as ProceduralPlaybook).status, "verified", "a legacy unversioned file is upgraded too");
});

// ── the credit that makes a report more than a claim ────────────────────────

test("each verified act, expect pair backs exactly one report, for its own session and domain, for ten minutes", () => {
  let now = NOW;
  const obs = new SpineObserver(new CognitiveSpine(() => now), () => now);
  const ok = (data?: unknown) => ({ ok: true, data });
  const pair = (session: string, url: string, passed = true) => {
    obs.observe({ tool: "web_click", args: { url, selector: "#go" }, result: ok(), session });
    now += 100;
    obs.observe({ tool: "web_expect", args: { selector: "#done", condition: "visible" }, result: ok({ passed }), session });
    now += 100;
  };

  pair("s1", "https://credit.example/");
  assert.equal(obs.claimVerifiedCredit("s2", "credit.example"), false, "another session cannot spend it");
  assert.equal(obs.claimVerifiedCredit("s1", "other.example"), false, "nor another domain");
  assert.equal(obs.claimVerifiedCredit("s1", "credit.example"), true);
  assert.equal(obs.claimVerifiedCredit("s1", "credit.example"), false, "and it is spent");

  pair("s1", "https://credit.example/");
  pair("s1", "https://credit.example/");
  assert.equal(obs.claimVerifiedCredit("s1", "credit.example"), true);
  assert.equal(obs.claimVerifiedCredit("s1", "credit.example"), true, "two pairs back two reports");
  assert.equal(obs.claimVerifiedCredit("s1", "credit.example"), false);

  pair("s1", "https://credit.example/", false);
  assert.equal(obs.claimVerifiedCredit("s1", "credit.example"), false, "a FAILED assertion earns no credit");

  obs.observe({ tool: "web_click", args: { url: "https://credit.example/", selector: "#go" }, result: ok(), session: "s3" });
  assert.equal(obs.claimVerifiedCredit("s3", "credit.example"), false, "a bare ok is not verified");

  pair("s1", "https://credit.example/");
  now += 11 * 60_000;
  assert.equal(obs.claimVerifiedCredit("s1", "credit.example"), false, "a credit expires after ten minutes");
});

// ── the tools ───────────────────────────────────────────────────────────────

function call(tool: string, args: Record<string, unknown>, session = "skills-a"): any {
  let body: unknown;
  const res = { json: (b: unknown) => { body = b; }, status: () => res } as unknown as Response;
  assert.equal(handleCognitiveTool(tool, args, res, { session }), true, `${tool} must be handled by the hub`);
  return body;
}
/** Makes the hub SEE a verified act, expect pair in `session` on `domain`. */
function seeVerified(session: string, domain: string): void {
  observeToolResult("web_click", { url: `https://${domain}/`, selector: "#go" }, { ok: true }, session);
  observeToolResult("web_expect", { selector: "#done", condition: "visible" }, { ok: true, data: { passed: true } }, session);
}

test("web_learn: a report counts only with a hub-seen verified success, and two sessions verify the playbook", () => {
  const d = "tool-learn.example";
  const learned = call("web_learn", { action: "playbook", domain: d, intent: "post", data: { name: "t_flow", steps: STEPS, successCount: 50 } });
  assert.equal(learned.data.status, "candidate");
  assert.deepEqual(learned.data.argsIgnored, ["data.successCount"]);
  assert.equal(call("web_recall", { domain: d, intent: "post" }).data.fastPathAvailable, false);

  const claimed = call("web_learn", { action: "outcome", domain: d, data: { playbook: "t_flow", success: true } }, "skills-a");
  assert.equal(claimed.data.recorded, false, "no hub-verified success behind it");
  assert.match(claimed.data.reason, /web_expect/);

  seeVerified("skills-a", d);
  const first = call("web_learn", { action: "outcome", domain: d, data: { playbook: "t_flow", success: true } }, "skills-a");
  assert.deepEqual([first.data.recorded, first.data.verifiedSessions, first.data.status], [true, 1, "candidate"]);

  seeVerified("skills-a", d);
  const sameSession = call("web_learn", { action: "outcome", domain: d, data: { playbook: "t_flow", success: true } }, "skills-a");
  assert.equal(sameSession.data.promoted, false, "the same session cannot verify its own playbook");

  seeVerified("skills-b", d);
  const second = call("web_learn", { action: "outcome", domain: d, data: { playbook: "t_flow", success: true } }, "skills-b");
  assert.equal(second.data.promoted, true);
  const recalled = call("web_recall", { domain: d, intent: "post" }).data;
  assert.equal(recalled.fastPathAvailable, true);
  assert.equal(recalled.playbookStatus, "verified");
});

test("web_learn outcome refuses a missing or unknown playbook", () => {
  const d = "tool-learn-errors.example";
  assert.match(call("web_learn", { action: "outcome", domain: d, data: {} }).data.error, /needs data\.playbook/);
  assert.match(call("web_learn", { action: "outcome", domain: d, data: { playbook: "ghost" } }).data.error, /no playbook "ghost"/);
});

test("a draft can never become a reflex, however well the domain as a whole is doing", () => {
  const d = "tool-reflex.example";
  for (let s = 0; s < 4; s += 1) for (let i = 0; i < 3; i += 1) globalSpine.record(d, "verified", `reflex-${s}`, Date.now() - 5_000 + i);
  globalSpine.setWisdom(d, 0.9);
  call("web_learn", { action: "playbook", domain: d, intent: "post", data: { name: "r_flow", id: "r_flow", steps: [{ step: 1, name: "go", tool: "web_click" }] } });

  const draft = call("web_system1_reflex_compile", { domain: d, playbook: { id: "r_flow", steps: [{ action: "click", selector: "#go" }] } });
  assert.equal(draft.data.compiled, false);
  assert.match(draft.data.reason, /unverified candidate/);

  seeVerified("skills-a", d); call("web_learn", { action: "outcome", domain: d, data: { playbook: "r_flow" } }, "skills-a");
  seeVerified("skills-b", d); call("web_learn", { action: "outcome", domain: d, data: { playbook: "r_flow" } }, "skills-b");
  const verified = call("web_system1_reflex_compile", { domain: d, playbook: { id: "r_flow", steps: [{ action: "click", selector: "#go" }] } });
  assert.equal(verified.data.compiled, true, "once the playbook is verified the domain's evidence lets it compile");
});
