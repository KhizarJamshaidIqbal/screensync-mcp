// Cognitive state persistence (Phase 1 of the cognitive spine).
//
// Before this, 17 of the 18 cognitive engines held their state in Maps that reset on every hub
// restart: trip a breaker, restart, and it came back with nothing tracked. These tests pin the
// registry (hydrate / diff-flush / quarantine / versioning) and prove each durable engine survives
// a genuine fresh-instance round trip through JSON, the way a restart does.

import { ISOLATED_DATA_DIR } from "./_isolate-data-dir.js"; // Must stay the first import (points the data dir at a temp folder)
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { CognitiveStateRegistry, cognitiveRegistry, type PersistableEngine } from "../cognitive-persistence.js";
import { DURABLE_ENGINES, startCognitivePersistence, stopCognitivePersistence } from "../cognitive-engines.js";
import { asRecord, capTail, toMap } from "../cognitive-serial.js";
import { CognitiveMaturationEngine } from "../cognitive-maturation.js";
import { CognitiveLifespanEngine } from "../cognitive-lifespan.js";
import { AdolescentCognitionEngine } from "../cognitive-adolescent.js";
import { CognitiveDynamicsEngine } from "../cognitive-dynamics.js";
import { TranscendentalCognitionEngine, globalTranscendentalEngine } from "../cognitive-transcendental.js";
import { CognitiveDevelopmentEngine } from "../cognitive-development.js";
import { CognitiveRpdEngine } from "../cognitive-rpd.js";
import { FederatedCatalogEngine } from "../cognitive-federation.js";

// ── the registry, against a fake engine ────────────────────────────────────

class FakeEngine implements PersistableEngine {
  items = new Map<string, { n: number }>();
  constructor(seed = false) { if (seed) this.items.set("seed", { n: 0 }); }
  snapshotState(): unknown { return { items: [...this.items.entries()] }; }
  restoreState(raw: unknown): void {
    const items = toMap<{ n: number }>(asRecord(raw, "fake").items, "fake.items");
    this.items = items;
  }
}

/** An engine that refuses every snapshot, to prove a refusal cannot half-apply. */
class StubbornEngine extends FakeEngine {
  override restoreState(): void { throw new Error("no thanks"); }
}

function scratch(): { dir: string; file: (ns: string) => string; cleanup: () => void } {
  const dir = mkdtempSync(path.join(tmpdir(), "cognitive-persist-"));
  return { dir, file: (ns) => path.join(dir, `${ns}.json`), cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}
const named = (dir: string, marker: string) => readdirSync(dir).filter((n) => n.includes(marker));
const read = (file: string) => JSON.parse(readFileSync(file, "utf8"));

function registryFor(dir: string, engine: PersistableEngine, ns = "fake", version = 1): CognitiveStateRegistry {
  const r = new CognitiveStateRegistry(dir);
  r.register({ ns, version, engine });
  return r;
}

test("a fresh directory hydrates as 'fresh' and writes nothing until state actually changes", () => {
  const s = scratch();
  try {
    const engine = new FakeEngine(true); // built-in seed present
    const r = registryFor(s.dir, engine);
    assert.deepEqual(r.hydrateAll().map((x) => x.status), ["fresh"]);
    assert.deepEqual(r.flush(), [], "seed data is the baseline, not something learned");
    assert.equal(existsSync(s.file("fake")), false);

    engine.items.set("learned", { n: 1 });
    assert.deepEqual(r.flush(), ["fake"]);
    assert.equal(existsSync(s.file("fake")), true);
  } finally { s.cleanup(); }
});

test("flush writes a versioned envelope and skips unchanged namespaces", () => {
  const s = scratch();
  try {
    const engine = new FakeEngine();
    const r = registryFor(s.dir, engine, "fake", 3);
    r.hydrateAll();
    engine.items.set("a", { n: 1 });
    assert.deepEqual(r.flush(), ["fake"]);

    const env = read(s.file("fake"));
    assert.equal(env.ns, "fake");
    assert.equal(env.version, 3);
    assert.ok(Date.parse(env.savedAt) > 0, "savedAt must be a real timestamp");
    assert.deepEqual(env.state, { items: [["a", { n: 1 }]] });

    const before = readFileSync(s.file("fake"), "utf8");
    assert.deepEqual(r.flush(), [], "no change means no rewrite");
    assert.equal(readFileSync(s.file("fake"), "utf8"), before, "the file must be byte-identical");
    assert.deepEqual(named(s.dir, ".tmp-"), [], "no temp file may survive");
  } finally { s.cleanup(); }
});

test("a new registry restores what an earlier one wrote, and does not immediately rewrite it", () => {
  const s = scratch();
  try {
    const first = new FakeEngine();
    const r1 = registryFor(s.dir, first);
    r1.hydrateAll();
    first.items.set("a", { n: 1 });
    first.items.set("b", { n: 2 });
    r1.flush();

    const second = new FakeEngine();
    const r2 = registryFor(s.dir, second);
    assert.deepEqual(r2.hydrateAll().map((x) => x.status), ["restored"]);
    assert.deepEqual([...second.items.entries()], [["a", { n: 1 }], ["b", { n: 2 }]]);
    assert.deepEqual(r2.flush(), [], "what was just loaded is the baseline");
  } finally { s.cleanup(); }
});

test("corrupt JSON is quarantined byte-for-byte and the engine keeps its own state", () => {
  const s = scratch();
  try {
    const garbage = '{"ns":"fake","version":1,"state":{"items":[["a",';
    writeFileSync(s.file("fake"), garbage);
    const engine = new FakeEngine(true);
    const r = registryFor(s.dir, engine);

    const [report] = r.hydrateAll();
    assert.equal(report.status, "quarantined");
    assert.deepEqual([...engine.items.keys()], ["seed"], "the engine must be left exactly as it was");
    assert.equal(existsSync(s.file("fake")), false, "the bad file is moved, not left in place");
    const moved = named(s.dir, ".corrupt-");
    assert.equal(moved.length, 1);
    assert.equal(readFileSync(path.join(s.dir, moved[0]), "utf8"), garbage, "the original bytes are preserved for a human");

    engine.items.set("fresh", { n: 1 });
    assert.deepEqual(r.flush(), ["fake"], "a clean file can be written afterwards");
    assert.equal(named(s.dir, ".corrupt-").length, 1, "the quarantined copy must still be there");
  } finally { s.cleanup(); }
});

test("a file from a NEWER build is quarantined, never overwritten or parsed", () => {
  const s = scratch();
  try {
    const future = JSON.stringify({ ns: "fake", version: 9, savedAt: "2030-01-01T00:00:00Z", state: { items: [["x", { n: 1 }]] } });
    writeFileSync(s.file("fake"), future);
    const engine = new FakeEngine();
    const r = registryFor(s.dir, engine, "fake", 1);

    const [report] = r.hydrateAll();
    assert.equal(report.status, "quarantined");
    assert.match(String(report.reason), /newer build/);
    assert.equal(engine.items.size, 0, "a newer build's state must not be half-applied");
    assert.equal(readFileSync(path.join(s.dir, named(s.dir, ".corrupt-")[0]), "utf8"), future);
  } finally { s.cleanup(); }
});

test("an envelope for the wrong namespace, or without a state, is quarantined", () => {
  for (const bad of [
    { ns: "someone-else", version: 1, state: { items: [] } },
    { ns: "fake", version: "1", state: { items: [] } },
    { ns: "fake", version: 1 },
    [1, 2, 3],
    "just a string",
  ]) {
    const s = scratch();
    try {
      writeFileSync(s.file("fake"), JSON.stringify(bad));
      const r = registryFor(s.dir, new FakeEngine());
      assert.equal(r.hydrateAll()[0].status, "quarantined", `should reject ${JSON.stringify(bad)}`);
    } finally { s.cleanup(); }
  }
});

test("an engine that refuses the snapshot is quarantined and left untouched", () => {
  const s = scratch();
  try {
    writeFileSync(s.file("fake"), JSON.stringify({ ns: "fake", version: 1, state: { items: [["a", { n: 1 }]] } }));
    const engine = new StubbornEngine(true);
    const r = registryFor(s.dir, engine);
    const [report] = r.hydrateAll();
    assert.equal(report.status, "quarantined");
    assert.match(String(report.reason), /refused/);
    assert.deepEqual([...engine.items.keys()], ["seed"]);
  } finally { s.cleanup(); }
});

test("registering a bad or duplicate namespace throws", () => {
  const r = new CognitiveStateRegistry(tmpdir());
  for (const ns of ["", "Has Caps", "../escape", "a/b", "9lives", "x".repeat(60)]) {
    assert.throws(() => r.register({ ns, version: 1, engine: new FakeEngine() }), /invalid cognitive state namespace/, ns);
  }
  r.register({ ns: "once", version: 1, engine: new FakeEngine() });
  assert.throws(() => r.register({ ns: "once", version: 1, engine: new FakeEngine() }), /registered twice/);
});

test("a failed write does not throw, cleans up after itself, and is retried on the next flush", () => {
  const s = scratch();
  try {
    const engine = new FakeEngine();
    const r = registryFor(s.dir, engine);
    r.hydrateAll();
    engine.items.set("a", { n: 1 });
    assert.deepEqual(r.flush(), ["fake"]);
    const good = readFileSync(s.file("fake"), "utf8");

    // Make the next rename fail: a directory now sits where the file must go.
    rmSync(s.file("fake"));
    mkdirSync(s.file("fake"));
    engine.items.set("b", { n: 2 });
    assert.deepEqual(r.flush(), [], "the failure is swallowed and reported as 'nothing written'");
    assert.deepEqual(named(s.dir, ".tmp-"), [], "a failed write must clean up its temp file");

    rmSync(s.file("fake"), { recursive: true });
    assert.deepEqual(r.flush(), ["fake"], "the same change is retried, not forgotten");
    assert.notEqual(readFileSync(s.file("fake"), "utf8"), good);
    assert.equal(read(s.file("fake")).state.items.length, 2);
  } finally { s.cleanup(); }
});

test("start() flushes on a timer, and stop() does a final flush only if it was started", async () => {
  const s = scratch();
  try {
    const timed = new FakeEngine();
    const r = registryFor(s.dir, timed);
    r.hydrateAll();
    r.start(20);
    assert.equal(r.isStarted(), true);
    timed.items.set("a", { n: 1 });
    const deadline = Date.now() + 3000;
    while (!existsSync(s.file("fake")) && Date.now() < deadline) await new Promise((res) => setTimeout(res, 20));
    assert.equal(existsSync(s.file("fake")), true, "the timer must persist a change without any explicit flush");

    timed.items.set("b", { n: 2 });
    assert.deepEqual(r.stop(), ["fake"], "stop() flushes what the timer had not reached yet");
    assert.equal(r.isStarted(), false);
    assert.equal(read(s.file("fake")).state.items.length, 2);
  } finally { s.cleanup(); }

  // A registry that never started (e.g. a process that lost the port race) must not write at all.
  const s2 = scratch();
  try {
    const idle = new FakeEngine();
    const r = registryFor(s2.dir, idle);
    r.hydrateAll();
    idle.items.set("a", { n: 1 });
    assert.deepEqual(r.stop(), []);
    assert.equal(existsSync(s2.file("fake")), false);
  } finally { s2.cleanup(); }
});

// ── the real engines: a fresh instance restores what the old one held ─────

type Driver = { ns: string; make: () => PersistableEngine; drive: (e: any, tag: string) => void };

const rect = { top: 1, left: 2, width: 30, height: 40 };
const DRIVERS: Driver[] = [
  {
    ns: "maturation", make: () => new CognitiveMaturationEngine(),
    drive: (e, t) => {
      e.getOrEvolveProfile(t, { outcome: "success", xpGain: 25 });
      e.addNode({ id: `${t}-n1`, label: "PAGE", properties: { url: "/a" } });
      e.addNode({ id: `${t}-n2`, label: "ACTION", properties: {} });
      e.addEdge({ fromId: `${t}-n1`, toId: `${t}-n2`, label: "NAVIGATES_TO", weight: 0.5 });
    },
  },
  {
    ns: "lifespan", make: () => new CognitiveLifespanEngine(),
    drive: (e, t) => { e.evaluateLifespan(t, { outcome: "success" }); e.transferMetaphor(t, `${t}.other`); },
  },
  { ns: "adolescent", make: () => new AdolescentCognitionEngine(), drive: (e, t) => { e.eriksonIdentity(t, 15, 10, 1); } },
  {
    ns: "dynamics", make: () => new CognitiveDynamicsEngine(),
    drive: (e, t) => {
      e.prospectiveMemory({ domain: t, action: "register", intention: { triggerEvent: "login", actionPlan: "save the draft" } });
      e.sourceMonitoring(t, [{ id: "f1", claimedSource: "docs", actualEvidenceSource: "docs" }]);
    },
  },
  {
    ns: "transcendental", make: () => new TranscendentalCognitionEngine(),
    drive: (e, t) => { e.amygdalaThreatInoculation(`${t}.com`, { httpStatus: 429, challengeDetected: true }); },
  },
  { ns: "development", make: () => new CognitiveDevelopmentEngine(), drive: (e, t) => { e.overrideStage(t, 3); } },
  {
    ns: "rpd", make: () => new CognitiveRpdEngine(),
    drive: (e, t) => { e.registerSpatialLocation(t, { selector: "#a", lastSeenRect: rect, scrollOffsetWhenSeen: { x: 0, y: 5 }, observedAt: "2026-09-19T00:00:00Z" }); },
  },
  {
    ns: "federation", make: () => new FederatedCatalogEngine(),
    drive: (e, t) => {
      e.publishSharedRecipe({ originProfile: "me@example.com", domain: t, intent: "post", recipe: { steps: [1, 2] } });
      e.linkProfile(`${t}-profile`);
    },
  },
];

const disk = (v: unknown) => JSON.parse(JSON.stringify(v)); // what a restart really does to the state

test("every durable engine has a driver, and the durable set is exactly what we mean it to be", () => {
  assert.deepEqual(
    DURABLE_ENGINES.map(([ns]) => ns).sort(),
    ["adolescent", "development", "dynamics", "federation", "lifespan", "maturation", "rpd", "transcendental"],
  );
  assert.deepEqual(DRIVERS.map((d) => d.ns).sort(), DURABLE_ENGINES.map(([ns]) => ns).sort());
});

for (const d of DRIVERS) {
  test(`${d.ns}: a fresh instance restores exactly what the old one held`, () => {
    const original = d.make();
    d.drive(original, "round.trip");
    const saved = disk(original.snapshotState());
    assert.notDeepEqual(saved, disk(d.make().snapshotState()), "the driver must produce state a pristine engine does not have");

    const revived = d.make();
    revived.restoreState(saved);
    assert.deepEqual(disk(revived.snapshotState()), saved);
  });

  test(`${d.ns}: garbage is rejected and a failed restore changes nothing`, () => {
    const engine = d.make();
    d.drive(engine, "live.site");
    const before = JSON.stringify(engine.snapshotState());

    for (const bad of [null, undefined, "x", 42, [], {}]) {
      assert.throws(() => engine.restoreState(bad), Error, `should reject ${JSON.stringify(bad)}`);
      assert.equal(JSON.stringify(engine.snapshotState()), before, `state must survive a rejected ${JSON.stringify(bad)}`);
    }

    // A donor holding DIFFERENT state. Feeding an engine its own snapshot could not reveal a partial
    // apply (it would just re-assign what it already holds), so the valid collections must visibly differ.
    const donor = d.make();
    d.drive(donor, "donor.site");
    const good = disk(donor.snapshotState()) as Record<string, unknown>;
    assert.notEqual(JSON.stringify(donor.snapshotState()), before, "the donor must hold different state for this check to mean anything");

    // Break each collection on its own while leaving the others valid: the valid ones must NOT be applied.
    for (const key of Object.keys(good)) {
      assert.throws(() => engine.restoreState({ ...good, [key]: "broken" }), Error, `breaking "${key}" must throw`);
      assert.equal(JSON.stringify(engine.snapshotState()), before, `breaking "${key}" must not leave a partial restore`);
    }
  });
}

test("dynamics: a malformed nested trust entry rolls back the intentions too", () => {
  const engine = new CognitiveDynamicsEngine();
  engine.prospectiveMemory({ domain: "mine", action: "register", intention: { triggerEvent: "t", actionPlan: "p" } });
  const before = JSON.stringify(engine.snapshotState());

  // Valid intentions for a DIFFERENT domain, paired with a broken nested trust entry: if intentions were
  // assigned before trust was validated, "mine" would vanish and "theirs" would appear.
  const other = new CognitiveDynamicsEngine();
  other.prospectiveMemory({ domain: "theirs", action: "register", intention: { triggerEvent: "x", actionPlan: "y" } });
  const { intentions } = disk(other.snapshotState()) as { intentions: unknown };

  assert.throws(
    () => engine.restoreState({ intentions, sourceTrust: [["d", [["docs", "not-a-number"]]]] }),
    /malformed trust entry/,
  );
  assert.equal(JSON.stringify(engine.snapshotState()), before);
});

test("federation: the shipped seed recipe is never persisted, never overridden, and always present", () => {
  const seeded = new FederatedCatalogEngine();
  const seedIds = seeded.querySharedRecipes("x.com", "post").map((r) => r.catalogId);
  assert.ok(seedIds.length >= 1, "the build ships a seed recipe for x.com / post");

  const snapshot = seeded.snapshotState() as { sharedPlaybooks: Array<[string, unknown]> };
  for (const id of seedIds) assert.ok(!snapshot.sharedPlaybooks.some(([k]) => k === id), "the seed must not be in the snapshot");

  // A tampered or stale file that carries a seed-provenance record must not replace the shipped one.
  const stale = { ...seeded.querySharedRecipes("x.com", "post")[0], sanitizedRecipe: { editorSelector: "STALE" } };
  const revived = new FederatedCatalogEngine();
  revived.restoreState({ sharedPlaybooks: [[stale.catalogId, stale]], linkedProfiles: [] });
  assert.notEqual(revived.querySharedRecipes("x.com", "post")[0].sanitizedRecipe.editorSelector, "STALE");

  // A recipe an agent published survives, and the seed is still there beside it.
  seeded.publishSharedRecipe({ originProfile: "me@example.com", domain: "site.test", intent: "post", recipe: { a: 1 } });
  const again = new FederatedCatalogEngine();
  again.restoreState(disk(seeded.snapshotState()));
  assert.equal(again.querySharedRecipes("site.test", "post").length, 1);
  assert.ok(again.querySharedRecipes("x.com", "post").length >= 1);
});

test("federation: published recipes stay sanitized on disk (no emails, no bearer tokens)", () => {
  const engine = new FederatedCatalogEngine();
  engine.publishSharedRecipe({
    originProfile: "owner@example.com", domain: "site.test", intent: "post",
    recipe: { note: "mail me at owner@example.com", header: "Bearer abc.def.ghi", cookie: "auth_token=SECRET123;" },
  });
  const onDisk = JSON.stringify(engine.snapshotState());
  assert.ok(!onDisk.includes("SECRET123"), "an auth token must not reach the state file");
  assert.ok(!onDisk.includes("abc.def.ghi"), "a bearer token must not reach the state file");
  assert.ok(!/recipe[^]*owner@example\.com/.test(JSON.stringify((engine.snapshotState() as any).sharedPlaybooks.map((e: any) => e[1].sanitizedRecipe))), "the recipe body must be scrubbed of emails");
});

test("rpd: only the newest 500 spatial memories per domain are written", () => {
  const engine = new CognitiveRpdEngine();
  for (let i = 0; i < 620; i += 1) {
    engine.registerSpatialLocation("busy.site", { selector: `#el-${i}`, lastSeenRect: rect, scrollOffsetWhenSeen: { x: 0, y: 0 }, observedAt: "2026-09-19T00:00:00Z" });
  }
  const [[, list]] = (engine.snapshotState() as { spatialMemoryMap: Array<[string, Array<{ selector: string }>]> }).spatialMemoryMap;
  assert.equal(list.length, 500);
  assert.equal(list[0].selector, "#el-120", "the oldest 120 are dropped");
  assert.equal(list[499].selector, "#el-619", "the newest is kept");
});

test("cognitive-serial helpers are strict", () => {
  assert.deepEqual(capTail([1, 2, 3, 4, 5], 3), [3, 4, 5]);
  assert.deepEqual(capTail([1, 2], 3), [1, 2]);
  assert.throws(() => asRecord([], "x"), /expected an object/);
  assert.throws(() => asRecord(null, "x"), /expected an object/);
  assert.throws(() => toMap([["a", 1]], "x"), /no object value/, "scalars are not valid entries");
  assert.throws(() => toMap([["a"]], "x"), /malformed entry/);
  assert.throws(() => toMap([[1, {}]], "x"), /malformed entry/);
  assert.throws(() => toMap({}, "x"), /expected an array/);
  assert.equal(toMap<{ n: number }>([["a", { n: 1 }]], "x").get("a")?.n, 1);
});

// ── the real singletons, wired the way the hub wires them ─────────────────

test("wiring: importing engines touches no disk; the hub start/stop hooks persist a tripped breaker", () => {
  const dir = path.join(ISOLATED_DATA_DIR, "cognitive");
  assert.equal(existsSync(dir), false, "merely importing the engines must not create the state directory");

  const reports = startCognitivePersistence();
  assert.equal(reports.length, DURABLE_ENGINES.length);
  assert.ok(reports.every((r) => r.status === "fresh"), "an empty data dir hydrates every engine as fresh");
  assert.equal(cognitiveRegistry.isStarted(), true);

  // The exact failure seen live: trip a breaker, restart, and it came back with nothing tracked.
  for (let i = 0; i < 4; i += 1) {
    globalTranscendentalEngine.amygdalaThreatInoculation("wired.example", { httpStatus: 429, challengeDetected: true });
  }
  const live = globalTranscendentalEngine.threatState("wired.example");
  assert.equal(live.length, 1);
  assert.equal(live[0].breakerState, "TRIPPED");

  const written = stopCognitivePersistence();
  assert.ok(written.includes("transcendental"), `the final flush must write the changed engine (wrote: ${written.join(",")})`);
  assert.equal(cognitiveRegistry.isStarted(), false);

  const env = read(path.join(dir, "transcendental.json"));
  assert.equal(env.ns, "transcendental");

  const afterRestart = new TranscendentalCognitionEngine();
  assert.equal(afterRestart.threatState("wired.example").length, 0, "a new process starts with nothing tracked...");
  afterRestart.restoreState(env.state);
  const revived = afterRestart.threatState("wired.example");
  assert.deepEqual(revived, live, "...until hydrate restores the tripped breaker, unchanged");
});
