// Cognitive state safety net (Phase 0 of the cognitive spine).
//
// The store used to wipe everything it had learned in two ways: a non-atomic write that a crash
// could truncate, and a load-time gate that reseeded-and-overwrote any file whose seeded playbook
// had lost its probes. These tests pin the replacement behaviour, including the old bug's exact
// scenario, so neither failure can come back quietly.

import "./_isolate-data-dir.js";
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { atomicWriteJson, quarantine, readJsonSafe } from "../cognitive-state.js";
import { CURRENT_MEMORY_VERSION, migrateMemory } from "../cognitive-memory-migrate.js";
import { CognitiveMemoryStore } from "../cognitive-memory.js";
import { getDefaultSeededMemory } from "../cognitive-memory-seed.js";

function scratch(): { dir: string; file: string; cleanup: () => void } {
  const dir = mkdtempSync(path.join(tmpdir(), "cognitive-state-"));
  return { dir, file: path.join(dir, "cognitive-memory.json"), cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}
const leftovers = (dir: string, marker: string) => readdirSync(dir).filter((n) => n.includes(marker));

test("atomicWriteJson writes a complete file and leaves no temp file behind", () => {
  const s = scratch();
  try {
    atomicWriteJson(s.file, { a: 1, nested: { b: [1, 2, 3] } });
    assert.deepEqual(JSON.parse(readFileSync(s.file, "utf8")), { a: 1, nested: { b: [1, 2, 3] } });
    assert.deepEqual(leftovers(s.dir, ".tmp-"), [], "no .tmp-* file may survive a successful write");

    atomicWriteJson(s.file, { a: 2 });
    assert.deepEqual(JSON.parse(readFileSync(s.file, "utf8")), { a: 2 }, "a second write replaces, not appends");
  } finally { s.cleanup(); }
});

test("atomicWriteJson creates missing parent directories", () => {
  const s = scratch();
  try {
    const deep = path.join(s.dir, "cognitive", "nested", "state.json");
    atomicWriteJson(deep, { ok: true });
    assert.deepEqual(readJsonSafe(deep), { status: "ok", value: { ok: true } });
  } finally { s.cleanup(); }
});

test("a failed write leaves the previous file byte-for-byte intact and cleans up its temp file", () => {
  const s = scratch();
  try {
    atomicWriteJson(s.file, { generation: "old" });
    const before = readFileSync(s.file, "utf8");

    // JSON.stringify throws on a cycle, i.e. BEFORE any byte reaches disk - the same observable
    // outcome as a crash between opening the temp file and the rename.
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    assert.throws(() => atomicWriteJson(s.file, cyclic));

    assert.equal(readFileSync(s.file, "utf8"), before, "the old contents must survive a failed write");
    assert.deepEqual(leftovers(s.dir, ".tmp-"), [], "a failed write must not strand a temp file");
  } finally { s.cleanup(); }
});

test("readJsonSafe distinguishes missing, ok and corrupt, and never throws", () => {
  const s = scratch();
  try {
    assert.deepEqual(readJsonSafe(s.file), { status: "missing" });
    writeFileSync(s.file, '{"ok":true}');
    assert.deepEqual(readJsonSafe(s.file), { status: "ok", value: { ok: true } });
    writeFileSync(s.file, '{"truncated": ');
    const r = readJsonSafe(s.file);
    assert.equal(r.status, "corrupt");
    assert.ok(r.status === "corrupt" && r.error.length > 0);
  } finally { s.cleanup(); }
});

test("quarantine moves the file aside with its bytes intact instead of deleting it", () => {
  const s = scratch();
  try {
    writeFileSync(s.file, "precious bytes");
    const dest = quarantine(s.file, "test");
    assert.ok(dest && existsSync(dest));
    assert.equal(readFileSync(dest!, "utf8"), "precious bytes");
    assert.equal(existsSync(s.file), false, "the original path must be free for a fresh file");
    assert.equal(quarantine(s.file, "nothing there"), null, "quarantining a missing file is a no-op");
  } finally { s.cleanup(); }
});

test("migrateMemory: current, older, unversioned, newer and structurally-wrong files", () => {
  const seed = getDefaultSeededMemory();

  const current = migrateMemory(structuredClone(seed));
  assert.ok(current);
  assert.equal(current!.changed, false, "a current, complete file needs no rewrite");

  // Unversioned but memory-shaped = legacy: upgraded, not thrown away.
  const legacy = migrateMemory({ playbooks: { a: { name: "a" } }, episodes: [] });
  assert.ok(legacy);
  assert.equal(legacy!.data.version, CURRENT_MEMORY_VERSION);
  assert.equal(legacy!.changed, true);
  assert.deepEqual(Object.keys(legacy!.data.playbooks), ["a"], "legacy content must survive the upgrade");
  assert.deepEqual(legacy!.data.domains, {}, "missing collections are filled");
  assert.deepEqual(legacy!.data.pitfalls, {});

  assert.equal(migrateMemory({ ...seed, version: "9.0.0" }), null, "a NEWER build's file is never touched");
  assert.equal(migrateMemory({ ...seed, version: "banana" }), null);
  assert.equal(migrateMemory({ unrelated: true }), null, "not a memory file at all");
  assert.equal(migrateMemory(null), null);
  assert.equal(migrateMemory([1, 2]), null);
  assert.equal(migrateMemory({ ...seed, playbooks: [] }), null, "a collection of the wrong type is corruption, not something to overwrite");
  assert.equal(migrateMemory({ ...seed, episodes: {} }), null);
});

test("REGRESSION: a valid v1.1.0 file whose seed playbook lost its probes is preserved, not reseeded", () => {
  // The old load() required playbooks.x_publish_post.environmentalProbes.length > 0. Consolidation or
  // a human pruning that one playbook made the check fail, and the store then wrote DEFAULTS over the
  // real file. Everything learned about every other domain went with it.
  const s = scratch();
  try {
    const data = getDefaultSeededMemory();
    delete data.playbooks["x_publish_post"];
    data.domains["learned.example"] = { domain: "learned.example", framework: "lexical" };
    data.pitfalls["learned.example"] = [{
      id: "pit_1", domain: "learned.example", symptom: "s", rootCause: "r", antiPattern: "a", provenSolution: "p",
      discoveredAt: "2026-09-19T00:00:00.000Z",
    }];
    writeFileSync(s.file, JSON.stringify(data));

    const store = new CognitiveMemoryStore(s.file);
    const loaded = store.load();

    assert.ok(loaded.domains["learned.example"], "learned domain knowledge must survive");
    assert.equal(loaded.pitfalls["learned.example"]?.length, 1, "learned pitfalls must survive");
    assert.equal(loaded.playbooks["x_publish_post"], undefined, "a deliberately removed playbook must NOT be resurrected");
    assert.deepEqual(leftovers(s.dir, ".corrupt-"), [], "a recognisable file must not be quarantined either");
  } finally { s.cleanup(); }
});

test("load quarantines an unreadable file and starts fresh without destroying the original", () => {
  const s = scratch();
  try {
    writeFileSync(s.file, '{"version":"1.1.0","playbooks":{"half-written":');
    const store = new CognitiveMemoryStore(s.file);
    const loaded = store.load();

    assert.equal(loaded.version, CURRENT_MEMORY_VERSION);
    assert.ok(loaded.playbooks["x_publish_post"], "first-run seed is used when nothing usable exists");
    const aside = leftovers(s.dir, ".corrupt-");
    assert.equal(aside.length, 1, "the unreadable original must be kept aside");
    assert.equal(readFileSync(path.join(s.dir, aside[0]), "utf8"), '{"version":"1.1.0","playbooks":{"half-written":');
    assert.equal(readJsonSafe(s.file).status, "ok", "and a good file now sits at the real path");
  } finally { s.cleanup(); }
});

test("load leaves a NEWER build's file alone by quarantining it, never overwriting it in place", () => {
  const s = scratch();
  try {
    const future = { ...getDefaultSeededMemory(), version: "2.0.0", futureField: { keep: "me" } };
    writeFileSync(s.file, JSON.stringify(future));
    new CognitiveMemoryStore(s.file).load();

    const aside = leftovers(s.dir, ".corrupt-");
    assert.equal(aside.length, 1);
    const kept = JSON.parse(readFileSync(path.join(s.dir, aside[0]), "utf8"));
    assert.equal(kept.version, "2.0.0");
    assert.deepEqual(kept.futureField, { keep: "me" }, "the newer build's data must be recoverable byte for byte");
  } finally { s.cleanup(); }
});

test("first run seeds once, and a second store on the same file reads it back instead of reseeding", () => {
  const s = scratch();
  try {
    const first = new CognitiveMemoryStore(s.file);
    first.load();
    first.learn({ action: "fact", domain: "second-run.example", data: { framework: "quill" } });
    assert.ok(existsSync(s.file));

    const second = new CognitiveMemoryStore(s.file).load();
    assert.equal(second.domains["second-run.example"]?.framework, "quill", "state written by one store is read by the next");
    assert.deepEqual(leftovers(s.dir, ".corrupt-"), []);
    assert.deepEqual(leftovers(s.dir, ".tmp-"), []);
  } finally { s.cleanup(); }
});
