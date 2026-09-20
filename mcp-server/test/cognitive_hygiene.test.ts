// Hygiene and pruning (Phase 4b): what the cleaner and the pruner leave in the store.
//
// The rule they share: nothing a person wrote is destroyed. Every claim about the store is checked by
// reading the FILE back through a second store. Asserting through the instance that did the work only
// proves it mutated its own in-memory cache, which passes even with save() removed - and is exactly how
// several deletions went unnoticed until an adversarial review found them.

import "./_isolate-data-dir.js"; // Must stay the first import (points the data dir at a temp folder)
import test from "node:test";
import assert from "node:assert/strict";
import { cognitiveStore, type PlaybookBranch, type ProceduralPlaybook } from "../cognitive-memory.js";
import { globalReplayAndHygieneEngine as hygiene } from "../cognitive-replay.js";
import { DRAFT_GRACE_DAYS, pruneVerdict } from "../cognitive-skills.js";
import { DAY, STEPS, call, iso, reopen, verify } from "./_cognitive-helpers.js";

// ── duplicate pitfalls ──────────────────────────────────────────────────────

test("autocleaning merges true duplicates into the richest copy, inherits their ids, and really saves", () => {
  const d = "dirty.example";
  const base = { symptom: "Button stays disabled", rootCause: "React state not synced" };
  const thin = cognitiveStore.learn({ action: "pitfall", domain: d, data: { ...base, antiPattern: "web_fill" } });
  const rich = cognitiveStore.learn({ action: "pitfall", domain: d, data: { ...base, provenSolution: "Use execCommand insertText", codeSnippet: "document.execCommand(...)" } });
  cognitiveStore.learn({ action: "pitfall", domain: d, data: { symptom: "Different thing", rootCause: "Other cause", provenSolution: "x" } });
  // An episode cites the copy that is about to be merged away.
  cognitiveStore.learn({ action: "episode", domain: d, intent: "click", data: { success: false, durationMs: 10, pitfallsEncountered: [String(thin.entryId)] } });

  const profile = call("web_cognitive_hygiene", { domain: d }).data;
  assert.equal(profile.duplicatePitfallsDetected, 1, "three pitfalls, two of them the same: one redundant copy");
  assert.equal(profile.healthy, false);

  assert.equal(call("web_cognitive_hygiene", { domain: d, action: "autoclean" }).data.mergedDuplicates, 1);

  const kept = reopen().load().pitfalls[d];
  assert.equal(kept.length, 2, "the merge reached the file, not just the live object");
  const merged = kept.find((p) => p.symptom === base.symptom)!;
  assert.equal(merged.id, rich.entryId, "the copy carrying the real solution survives");
  assert.equal(merged.antiPattern, "web_fill", "and it absorbed what the thinner copy knew");
  assert.deepEqual(merged.mergedFrom, [String(thin.entryId)], "and inherited the dropped id, which an episode still cites");
  assert.equal(call("web_cognitive_hygiene", { domain: d }).data.healthy, true);
});

test("REGRESSION: two pitfalls that disagree about the fix are BOTH kept", () => {
  // Duplicates were keyed on symptom + root cause alone and merged by keeping one copy's fix, so a second
  // solution to the same symptom vanished - the very thing "nothing a human wrote is lost" promised.
  const d = "conflict.example";
  const same = { symptom: "Click does nothing", rootCause: "overlay" };
  cognitiveStore.learn({ action: "pitfall", domain: d, data: { ...same, provenSolution: "Close the cookie banner first", conditionTrigger: "cookie banner visible", codeSnippet: "document.querySelector('.cookie').remove()" } });
  cognitiveStore.learn({ action: "pitfall", domain: d, data: { ...same, provenSolution: "Press Escape to dismiss the modal", conditionTrigger: "modal visible", codeSnippet: "web_key('Escape')" } });
  assert.equal(hygiene.profileHygiene(d).duplicatePitfallsDetected, 0, "different knowledge is not a duplicate");
  assert.equal(hygiene.runAutocleaning(d).mergedDuplicates, 0);
  const text = JSON.stringify(reopen().load().pitfalls[d]);
  for (const piece of ["cookie banner first", "Escape", "modal visible", "web_key('Escape')"]) assert.ok(text.includes(piece), `lost: ${piece}`);

  // learn() fills a missing symptom and root cause with the same default text, so two UNRELATED pitfalls
  // saved with only a fix used to look identical.
  const e = "defaults.example";
  cognitiveStore.learn({ action: "pitfall", domain: e, data: { provenSolution: "use execCommand" } });
  cognitiveStore.learn({ action: "pitfall", domain: e, data: { provenSolution: "use CDP Input.insertText" } });
  assert.equal(hygiene.runAutocleaning(e).mergedDuplicates, 0);
  assert.equal(reopen().load().pitfalls[e].length, 2);

  // A copy that only ADDS to another still folds in; one that contradicts it stays apart.
  const f = "fold.example";
  const alike = { symptom: "S", rootCause: "R" };
  cognitiveStore.learn({ action: "pitfall", domain: f, data: { ...alike, provenSolution: "fix X" } });
  cognitiveStore.learn({ action: "pitfall", domain: f, data: { ...alike } });
  cognitiveStore.learn({ action: "pitfall", domain: f, data: { ...alike, provenSolution: "fix Y" } });
  assert.equal(hygiene.runAutocleaning(f).mergedDuplicates, 1, "only the empty copy folds in");
  assert.deepEqual(reopen().load().pitfalls[f].map((p) => p.provenSolution).sort(), ["fix X", "fix Y"]);
});

test("REGRESSION: pitfalls that share an id do not delete each other", () => {
  const d = "sameid.example";
  const first = cognitiveStore.learn({ action: "pitfall", domain: d, data: { id: "overlay-blocks-click", symptom: "S", rootCause: "R", provenSolution: "v1 fix" } });
  const second = cognitiveStore.learn({ action: "pitfall", domain: d, data: { id: "overlay-blocks-click", symptom: "S2", rootCause: "R2", provenSolution: "v2 fix" } });
  assert.equal(first.entryId, "overlay-blocks-click");
  assert.notEqual(second.entryId, first.entryId, "a taken id is never issued twice");
  assert.match(String(second.note), /already used/);

  // A store that already holds two pitfalls under one id (written before ids were checked) is not made
  // worse by a merge: the survivor used to be deleted along with the copy, because the merge dropped by id.
  const legacy = "legacy-ids.example";
  const twin = { id: "dup", domain: legacy, symptom: "S", rootCause: "R", antiPattern: "", provenSolution: "same fix", discoveredAt: iso(Date.now() - DAY) };
  cognitiveStore.load().pitfalls[legacy] = [{ ...twin }, { ...twin }];
  assert.equal(hygiene.runAutocleaning(legacy).mergedDuplicates, 1);
  const left = reopen().load().pitfalls[legacy];
  assert.equal(left.length, 1, "exactly one survives");
  assert.equal(left[0].provenSolution, "same fix");
});

test("REGRESSION: a pitfall is never removed for being old", () => {
  // Nothing records when a pitfall is avoided or applied (the tracker cites none), so "not seen for 90
  // days" cannot tell an obsolete pitfall from one that is working: the better it is followed, the quieter
  // it looks. Archiving by age deleted them - and the shipped x.com pitfalls with them.
  const d = "old-lessons.example";
  cognitiveStore.learn({ action: "pitfall", domain: d, data: { symptom: "S", rootCause: "R", provenSolution: "the hard-won fix" } });
  cognitiveStore.load().pitfalls[d][0].discoveredAt = iso(Date.now() - 400 * DAY);
  const seeded = cognitiveStore.load().pitfalls["x.com"] ?? [];
  for (const pf of seeded) pf.discoveredAt = iso(Date.now() - 400 * DAY);
  assert.ok(seeded.length > 0, "precondition: x.com ships with pitfalls");
  const shipped = seeded.length;

  assert.equal(hygiene.profileHygiene(d).healthy, true, "age alone is not a hygiene problem");
  hygiene.runAutocleaning(d);
  hygiene.runAutocleaning("x.com");
  const reread = reopen().load().pitfalls;
  assert.equal(reread[d]?.[0]?.provenSolution, "the hard-won fix");
  assert.equal(reread["x.com"].length, shipped);
});

// ── orphan branches ─────────────────────────────────────────────────────────

test("orphan branches come off unproven drafts only, are kept, and the profile agrees with the cleaner", () => {
  const d = "branches.example";
  const probes = [{ signal: "logged_in", expected: "present", humanAnalogy: "" }];
  const branch = (name: string, whenSignal: string) => ({ name, conditionDescription: name, whenSignal, alternateSteps: [{ step: 1, name: `${name}_step`, tool: "web_fill" }] });
  const save = (name: string, branches: unknown[]) => call("web_learn", { action: "playbook", domain: d, intent: name, data: { name, steps: STEPS, environmentalProbes: probes, branches } });

  save("draft", [branch("handle_2fa", "two_factor_prompt"), branch("known", "logged_in"), branch("interrupt", "food_burning_unsaved_draft_dialog")]);
  save("proven", [branch("proven_orphan", "captcha_seen")]);
  save("retired", [branch("retired_orphan", "anything")]);
  verify(cognitiveStore, d, "proven");
  cognitiveStore.archivePlaybooks(d, [cognitiveStore.findPlaybook(d, "retired")!.id], "test");

  const before = hygiene.profileHygiene(d);
  assert.equal(before.orphanBranchesCount, 1, "only the draft's genuine orphan: the interrupt branch is the hub's own, and verified or archived playbooks are not judged");
  assert.equal(before.healthy, false);
  assert.ok(before.recommendations.some((r) => /verified playbooks/.test(r)), "the verified playbook's unprobed branch is mentioned, not counted");

  assert.equal(hygiene.runAutocleaning(d).prunedOrphans, 1);

  const stored = Object.values(reopen().load().playbooks);
  const named = (name: string): ProceduralPlaybook => stored.find((p) => p.name === name)!;
  const names = (bs?: PlaybookBranch[]) => (bs ?? []).map((b) => b.name);
  assert.deepEqual(names(named("draft").branches), ["known", "interrupt"]);
  assert.deepEqual(names(named("draft").prunedBranches), ["handle_2fa"], "kept, not discarded");
  assert.equal(named("draft").prunedBranches![0].alternateSteps![0].name, "handle_2fa_step", "with its steps intact");
  assert.deepEqual(names(named("proven").branches), ["proven_orphan"], "a verified playbook is never edited");
  assert.deepEqual(names(named("retired").branches), ["retired_orphan"], "nor is an archived one");

  const after = hygiene.profileHygiene(d);
  assert.equal(after.orphanBranchesCount, 0);
  assert.equal(after.healthy, true, "the domain can now actually BECOME healthy: the profile and the cleaner share one definition");
  assert.equal(after.staleSelectorRate, 0);
});

// ── synaptic pruning ────────────────────────────────────────────────────────

/** Backdates a stored draft. */
const aged = (domain: string, name: string, daysAgo: number): ProceduralPlaybook => {
  const pb = cognitiveStore.findPlaybook(domain, name)!;
  pb.createdAt = iso(Date.now() - daysAgo * DAY);
  delete pb.lastExecutedAt;
  return pb;
};
const coherenceOf = (domain: string): number => call("web_erikson_identity", { domain }).data.identityCoherence;

test("the pruning verdict: only an abandoned draft is ever pruned", () => {
  const now = Date.now();
  const pb = (over: Partial<ProceduralPlaybook>): ProceduralPlaybook => ({
    id: "p", name: "p", domain: "d.example", intent: "i", description: "", environmentalProbes: [], preconditions: [], steps: [],
    successCount: 0, status: "candidate", createdAt: iso(now - 90 * DAY), ...over,
  });
  assert.equal(pruneVerdict(pb({}), now), "prune", "an unproven draft left alone for months");
  assert.equal(pruneVerdict(pb({ createdAt: iso(now - (DRAFT_GRACE_DAYS - 1) * DAY) }), now), "keep", "inside the grace period");
  assert.equal(pruneVerdict(pb({ lastExecutedAt: iso(now - DAY) }), now), "keep", "run yesterday");
  assert.equal(pruneVerdict(pb({ createdAt: undefined }), now), "keep", "no dated evidence: the absence of data is not staleness");
  assert.equal(pruneVerdict(pb({ createdAt: "garbage" }), now), "keep");
  assert.equal(pruneVerdict(pb({ createdAt: iso(now + 90 * DAY) }), now), "keep", "a future stamp is not age");
  assert.equal(pruneVerdict(pb({ status: "verified", successCount: 40, lastExecutedAt: iso(now - 400 * DAY) }), now), "myelinate", "a proven skill is never pruned however long it sits idle");
  assert.equal(pruneVerdict(pb({ status: "verified", successCount: 3, lastExecutedAt: iso(now - 400 * DAY) }), now), "keep");
  assert.equal(pruneVerdict(pb({ status: "verified", successCount: 40, consecutiveFailures: 3 }), now), "keep", "one the hub has stopped offering is not 'myelinated' either");
  assert.equal(pruneVerdict(pb({ status: "deprecated" }), now), "keep");
});

test("a dry run judges without changing anything, including the identity profile", () => {
  const d = "dryrun.example";
  call("web_learn", { action: "playbook", domain: d, intent: "post", data: { name: "abandoned", steps: STEPS } });
  aged(d, "abandoned", 60);
  const before = coherenceOf(d);

  let dry: any;
  for (let i = 0; i < 5; i += 1) dry = call("web_synaptic_pruning", { domain: d, playbooks: [{ id: "invented", successCount: 0 }] }).data;
  assert.equal(dry.pruned.length, 1, "the real stored draft is what gets judged");
  assert.equal(dry.applied, false);
  assert.match(String(dry.note), /Dry run/);
  assert.deepEqual(dry.argsIgnored, ["playbooks"], "a caller cannot prune playbooks it made up");
  assert.deepEqual(dry.archived, []);
  assert.equal(coherenceOf(d), before, "five dry runs changed nothing about who the domain is: they used to raise identityCoherence each time");
  assert.equal(reopen().findPlaybook(d, "abandoned")?.status, "candidate", "and nothing was archived");
});

test("apply archives an abandoned draft, keeps the record, and cannot be repeated for credit", () => {
  const d = "apply.example";
  call("web_learn", { action: "playbook", domain: d, intent: "post", data: { name: "abandoned", steps: STEPS } });
  aged(d, "abandoned", 60);
  const before = coherenceOf(d);

  const first = call("web_synaptic_pruning", { domain: d, apply: true }).data;
  assert.equal(first.applied, true);
  assert.equal(first.archived.length, 1);

  // Archived, not destroyed: still in the FILE, marked deprecated, with a reason and a date.
  const stored = Object.values(reopen().load().playbooks).find((p) => p.name === "abandoned" && p.domain === d)!;
  assert.equal(stored.status, "deprecated");
  assert.match(String(stored.deprecatedReason), /synaptic pruning/);
  assert.ok(Date.parse(String(stored.deprecatedAt)) > 0);
  assert.equal(call("web_recall", { domain: d, intent: "post" }).data.recommendedPlaybook, null, "and it is never offered again");

  const afterFirst = coherenceOf(d);
  assert.ok(afterFirst > before, "pruning is what sharpens identity");
  assert.deepEqual(call("web_synaptic_pruning", { domain: d, apply: true }).data.archived, [], "an archived playbook cannot be archived twice");
  assert.equal(coherenceOf(d), afterFirst, "so repeating the call cannot inflate it");
});

test("REGRESSION: a verified playbook is never pruned, however long it has gone unused", () => {
  // Pruning archived a verified playbook with 40 successes for not running in 31 days, taking its fast
  // path away. Idle is not wrong: the curriculum asks for a re-run instead.
  const d = "monthly.example";
  call("web_learn", { action: "playbook", domain: d, intent: "invoice", data: { name: "monthly", steps: STEPS } });
  verify(cognitiveStore, d, "monthly");
  const pb = cognitiveStore.findPlaybook(d, "monthly")!;
  pb.successCount = 40;
  pb.lastExecutedAt = iso(Date.now() - 400 * DAY);

  const out = call("web_synaptic_pruning", { domain: d, apply: true }).data;
  assert.deepEqual(out.pruned, []);
  assert.deepEqual(out.archived, []);
  assert.equal(out.myelinated.length, 1, "a proven skill myelinates instead");
  assert.equal(call("web_recall", { domain: d, intent: "invoice" }).data.fastPathAvailable, true, "its fast path is intact");
  assert.equal(reopen().findPlaybook(d, "monthly")?.status, "verified");
});

test("REGRESSION: a draft has time to be verified before pruning may call it weak", () => {
  // Any candidate has successCount 0, so "weak" was true of a draft saved seconds ago - and of an edit one
  // session from promotion. Age is now judged from dated evidence only.
  const d = "grace.example";
  for (const name of ["fresh", "inside_grace", "past_grace", "undated", "worked_recently"]) {
    call("web_learn", { action: "playbook", domain: d, intent: name, data: { name, steps: STEPS } });
  }
  aged(d, "inside_grace", DRAFT_GRACE_DAYS - 1);
  aged(d, "past_grace", DRAFT_GRACE_DAYS + 1);
  delete aged(d, "undated", 999).createdAt;
  aged(d, "worked_recently", 90).lastExecutedAt = iso(Date.now() - 5 * DAY);

  const out = call("web_synaptic_pruning", { domain: d }).data;
  const pruned = out.pruned.map((id: string) => cognitiveStore.findPlaybook(d, id)!.name);
  assert.deepEqual(pruned, ["past_grace"], "only a draft with dated evidence of being left alone");
});
