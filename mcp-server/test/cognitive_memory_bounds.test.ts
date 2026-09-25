// cognitive-memory-limits.ts + the store's coalesced save (M9): the store is bounded, and what a person or
// agent wrote (pitfalls, facts) is never silently lost to a limit.

// Must stay the first import: see _isolate-data-dir.ts
import "./_isolate-data-dir.js";
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { DomainPitfall } from "../cognitive-memory.js";
import {
  EPISODES_PER_DOMAIN, EPISODES_TOTAL, FACT_MAX_KEY_SELECTORS, PITFALLS_PER_DOMAIN, PITFALL_CODE_MAX, PITFALL_TEXT_MAX,
} from "../cognitive-memory-limits.js";
import { scratchStore } from "./_cognitive-helpers.js";

const episode = (i: number) => ({ id: `ep_bound_${i}`, success: true, durationMs: i });

test("episodes: at most EPISODES_PER_DOMAIN per domain, oldest evicted, other domains untouched", () => {
  const { store, cleanup } = scratchStore();
  try {
    store.learn({ action: "episode", domain: "quiet.example", data: episode(-1) });
    for (let i = 0; i < EPISODES_PER_DOMAIN + 25; i += 1) store.learn({ action: "episode", domain: "chatty.example", data: episode(i), deferSave: true });
    const eps = store.load().episodes;
    const chatty = eps.filter((e) => e.domain === "chatty.example");
    assert.equal(chatty.length, EPISODES_PER_DOMAIN);
    assert.equal(chatty[0].id, "ep_bound_25", "the oldest 25 went");
    assert.equal(chatty[chatty.length - 1].id, `ep_bound_${EPISODES_PER_DOMAIN + 24}`);
    assert.equal(eps.filter((e) => e.domain === "quiet.example").length, 1, "one chatty domain no longer evicts another's history");
    assert.equal(eps.filter((e) => e.domain === "x.com").length, 1, "the seeded episode survives too");
  } finally { cleanup(); }
});

test("episodes: over EPISODES_TOTAL, the largest domain gives up its oldest", () => {
  const { store, cleanup } = scratchStore();
  try {
    const domains = Math.ceil(EPISODES_TOTAL / EPISODES_PER_DOMAIN);
    for (let d = 0; d < domains; d += 1) {
      for (let i = 0; i < EPISODES_PER_DOMAIN; i += 1) store.learn({ action: "episode", domain: `d${d}.example`, data: episode(d * 1000 + i), deferSave: true });
    }
    store.learn({ action: "episode", domain: "late.example", data: episode(99_999), deferSave: true });
    const eps = store.load().episodes;
    assert.equal(eps.length, EPISODES_TOTAL);
    assert.equal(eps.filter((e) => e.domain === "late.example").length, 1, "the newcomer is kept");
    assert.equal(eps.filter((e) => e.domain === "x.com").length, 1, "a small domain is not the one evicted");
    store.flush();
  } finally { cleanup(); }
});

test("pitfalls: over-long fields are clamped, and the caller is told", () => {
  const { store, cleanup } = scratchStore();
  try {
    const r = store.learn({ action: "pitfall", domain: "long.example", data: { symptom: "s".repeat(PITFALL_TEXT_MAX + 500), codeSnippet: "c".repeat(PITFALL_CODE_MAX + 1), provenSolution: "short" } });
    const pf = store.load().pitfalls["long.example"][0];
    assert.equal(pf.symptom.length, PITFALL_TEXT_MAX);
    assert.equal(pf.codeSnippet?.length, PITFALL_CODE_MAX);
    assert.equal(pf.provenSolution, "short");
    assert.match(String(r.note), /symptom/);
    assert.match(String(r.note), /codeSnippet/);
  } finally { cleanup(); }
});

test("pitfalls: a full domain merges exact duplicates first, then refuses - it never evicts", () => {
  const { store, cleanup } = scratchStore();
  try {
    const mem = store.load();
    const mk = (i: number, text = `solution ${i}`): DomainPitfall => ({ id: `pf_${i}`, domain: "full.example", symptom: `symptom ${i}`, rootCause: "r", antiPattern: "", provenSolution: text, discoveredAt: new Date(1_000 + i).toISOString() });
    mem.pitfalls["full.example"] = Array.from({ length: PITFALLS_PER_DOMAIN }, (_, i) => mk(i));
    mem.pitfalls["full.example"][PITFALLS_PER_DOMAIN - 1] = { ...mk(0), id: "pf_dup_of_0" }; // an exact copy of pf_0

    const made = store.learn({ action: "pitfall", domain: "full.example", data: { id: "pf_new", symptom: "new", rootCause: "r", provenSolution: "fresh" } });
    assert.equal(made.entryId, "pf_new", "merging the duplicate made room");
    const list = store.load().pitfalls["full.example"];
    assert.equal(list.length, PITFALLS_PER_DOMAIN);
    assert.deepEqual(list.find((p) => p.id === "pf_0")?.mergedFrom, ["pf_dup_of_0"], "the merged copy's id is kept");

    const same = store.learn({ action: "pitfall", domain: "full.example", data: { symptom: "symptom 5", rootCause: "r", provenSolution: "solution 5" } });
    assert.equal(same.entryId, "pf_5", "a duplicate of a stored pitfall folds into it");
    assert.equal(store.load().pitfalls["full.example"].length, PITFALLS_PER_DOMAIN);

    assert.throws(() => store.learn({ action: "pitfall", domain: "full.example", data: { symptom: "another", rootCause: "r2", provenSolution: "new idea" } }), /NOT stored[\s\S]*web_cognitive_hygiene/);
    const after = store.load().pitfalls["full.example"];
    assert.equal(after.length, PITFALLS_PER_DOMAIN);
    for (let i = 0; i < PITFALLS_PER_DOMAIN - 1; i += 1) assert.ok(after.some((p) => p.id === `pf_${i}`), `pf_${i} was not evicted`);
  } finally { cleanup(); }
});

test("facts: size and keySelectors caps refuse, and never trim what was stored", () => {
  const { store, cleanup } = scratchStore();
  try {
    store.learn({ action: "fact", domain: "facts.example", data: { framework: "react", keySelectors: { compose: "#c" } } });
    const tooMany = Object.fromEntries(Array.from({ length: FACT_MAX_KEY_SELECTORS + 1 }, (_, i) => [`k${i}`, `#s${i}`]));
    assert.throws(() => store.learn({ action: "fact", domain: "facts.example", data: { keySelectors: tooMany } }), /at most 200 keySelectors/);
    assert.throws(() => store.learn({ action: "fact", domain: "facts.example", data: { notes: "n".repeat(20_000) } }), /limit 16384/);
    const fact = store.load().domains["facts.example"];
    assert.equal(fact.framework, "react");
    assert.deepEqual(fact.keySelectors, { compose: "#c" }, "a refused write leaves the stored facts as they were");
  } finally { cleanup(); }
});

test("saveSoon: 20 deferred learns cost at most 2 writes, flush persists them, and the file parses", () => {
  const { store, cleanup } = scratchStore();
  try {
    store.load(); // the first load seeds and writes; not counted
    let writes = 0;
    const realSave = store.save.bind(store);
    store.save = () => { writes += 1; realSave(); };

    for (let i = 0; i < 20; i += 1) store.learn({ action: "episode", domain: "burst.example", data: episode(i), deferSave: true });
    assert.ok(writes <= 2, `20 deferred learns wrote ${writes} times`);
    assert.equal(store.hasPendingSave(), true);

    assert.equal(store.flush(), true);
    assert.equal(store.flush(), false, "nothing left to flush");
    assert.ok(writes <= 2, `still at most 2 writes after flush (${writes})`);

    const onDisk = JSON.parse(readFileSync(store.file, "utf8"));
    assert.equal(onDisk.episodes.filter((e: { domain: string }) => e.domain === "burst.example").length, 20);

    // A synchronous learn writes at once and takes any pending deferred episodes with it.
    store.learn({ action: "episode", domain: "burst.example", data: episode(21), deferSave: true });
    store.learn({ action: "fact", domain: "burst.example", data: { framework: "vue" } });
    assert.equal(store.hasPendingSave(), false);
    assert.equal(JSON.parse(readFileSync(store.file, "utf8")).episodes.filter((e: { domain: string }) => e.domain === "burst.example").length, 21);
  } finally { cleanup(); }
});
