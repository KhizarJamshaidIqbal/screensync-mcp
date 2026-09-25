// canonicalDomain (cognitive-domain.ts): one spelling of a domain across the spine, the memory store and the
// observer, so a verified success credited under one spelling can be claimed under any other (M4).

// Must stay the first import: see _isolate-data-dir.ts
import "./_isolate-data-dir.js";
import test from "node:test";
import assert from "node:assert/strict";
import { canonicalDomain } from "../cognitive-domain.js";
import { CognitiveSpine, normalizeDomain } from "../cognitive-spine.js";
import { SpineObserver, hostOf } from "../cognitive-spine-observer.js";
import { cognitiveStore } from "../cognitive-memory.js";
import { AdolescentCognitionEngine } from "../cognitive-adolescent.js";
import { CognitiveLifespanEngine } from "../cognitive-lifespan.js";
import { migrateMemory } from "../cognitive-memory-migrate.js";

const SPELLINGS = ["x.com", "X.COM", "www.x.com", "WWW.x.com", "x.com:443", "https://x.com", "https://WWW.x.com:443/", "http://x.com/home?tab=1", "  x.com.  ", "https://x.com./path#frag"];

test("canonicalDomain: every spelling of one host is the same domain", () => {
  for (const s of SPELLINGS) assert.equal(canonicalDomain(s), "x.com", s);
  assert.equal(canonicalDomain("sub.Example.co.uk:8080/a/b"), "sub.example.co.uk");
  assert.equal(canonicalDomain("chrome-extension://abcdef/page.html"), "abcdef");
});

test("canonicalDomain: empty, invalid and non-string input is ''", () => {
  for (const s of ["", "   ", "not a domain", "https://", "http://exa mple.com", "file:///C:/x.txt"]) assert.equal(canonicalDomain(s), "", JSON.stringify(s));
  for (const v of [undefined, null, 42, {}, ["x.com"]]) assert.equal(canonicalDomain(v), "");
});

test("canonicalDomain is idempotent", () => {
  for (const s of [...SPELLINGS, "www.www.x.com", "sub.example.co.uk:8080/a", "shared", "localhost:3000"]) {
    const once = canonicalDomain(s);
    assert.equal(canonicalDomain(once), once, s);
  }
});

test("the spine, the memory store and the observer all use the canonical form", () => {
  for (const s of SPELLINGS) {
    assert.equal(normalizeDomain(s), "x.com", `spine: ${s}`);
    assert.equal(cognitiveStore.normalizeDomain(s), "x.com", `store: ${s}`);
  }
  assert.equal(hostOf("https://WWW.x.com:443/"), "x.com");
  assert.equal(hostOf("x.com:443"), "x.com");
  assert.equal(hostOf("WWW.X.com"), "x.com");
});

test("hostOf keeps its filters: local hosts, free text and non-http schemes are not domains", () => {
  for (const s of ["http://localhost:3000/", "localhost", "127.0.0.1", "http://127.0.0.1:3000", "http://[::1]:3000/", "hello world", "feed/home", "chrome://extensions", ""]) {
    assert.equal(hostOf(s), "", s);
  }
  assert.equal(hostOf(undefined), "");
});

test("one spine record per domain, whatever the spelling", () => {
  const spine = new CognitiveSpine(() => 1_000);
  spine.record("https://WWW.x.com:443/", "weak", "s1", 1_000);
  spine.record("x.com", "weak", "s1", 1_000);
  assert.deepEqual(spine.domains(), ["x.com"]);
  assert.equal(spine.has("X.com:443"), true);
});

test("M4: a verified success is claimable under any spelling of the domain", () => {
  let now = 10_000;
  const observer = new SpineObserver(new CognitiveSpine(() => now), () => now);
  const session = "m4-session";
  observer.observe({ tool: "web_click", args: { url: "https://www.x.com/home", tabId: 7, selector: "#go" }, result: { ok: true }, session });
  now += 1_000;
  const verified = observer.observe({ tool: "web_expect", args: { tabId: 7, selector: "#composer", condition: "visible" }, result: { ok: true, data: { passed: true } }, session });
  assert.deepEqual(verified, { domain: "x.com", outcome: "verified" });

  assert.equal(observer.claimVerifiedCredit(session, "https://x.com"), true, "a scheme-qualified spelling claims the credit");
  assert.equal(observer.claimVerifiedCredit(session, "x.com:443"), false, "and each sighting backs exactly one claim");

  // A second sighting, claimed with the port spelling.
  observer.observe({ tool: "web_click", args: { tabId: 7, selector: "#go" }, result: { ok: true }, session });
  observer.observe({ tool: "web_expect", args: { tabId: 7, selector: "#composer", condition: "visible" }, result: { ok: true, data: { passed: true } }, session });
  assert.equal(observer.claimVerifiedCredit(session, "WWW.x.com:443"), true);
});

// ── stores written before every writer used canonicalDomain are re-keyed on restore / load ──

test("spine restore: legacy spellings of one domain merge into its canonical record; a non-domain key is dropped", () => {
  const T = Date.UTC(2026, 5, 1);
  const a = new CognitiveSpine(() => T);
  a.record("x.com", "verified", "s1", T);
  a.record("x.com", "verified", "s1", T + 1);
  a.vouch("x.com", 2, "owner vouched", "s1", T + 2);
  const b = new CognitiveSpine(() => T);
  b.record("x.com", "verified", "s2", T + 10);
  b.record("x.com", "failure", "s2", T + 11);
  const recOf = (s: CognitiveSpine) => (s.snapshotState() as { records: Array<[string, unknown]> }).records[0][1];
  const legacy = { records: [["https://x.com", recOf(a)], ["x.com:443", recOf(b)], ["not a domain!!", recOf(b)]] };
  const revived = new CognitiveSpine(() => T + 100);
  revived.restoreState(JSON.parse(JSON.stringify(legacy)));
  assert.deepEqual(revived.domains(), ["x.com"], "one record, under the canonical key");
  const ev = revived.evaluate("https://WWW.x.com:443/");
  assert.equal(ev.domain, "x.com");
  assert.equal(ev.evidence.verified, 3, "the evidence of both spellings is summed");
  assert.equal(ev.evidence.failures, 1);
  assert.equal(ev.evidence.sessions, 2);
  assert.equal(ev.vouch?.reason, "owner vouched", "the vouch survives");
  const again = new CognitiveSpine(() => T + 100);
  again.restoreState(revived.snapshotState());
  assert.equal(JSON.stringify(again.snapshotState()), JSON.stringify(revived.snapshotState()), "idempotent");
});

test("adolescent and lifespan restore re-key their domain maps", () => {
  const ado = new AdolescentCognitionEngine();
  ado.restoreState({ profiles: [["https://x.com", { domain: "https://x.com", updatedAt: "2026-01-01" }], ["x.com.", { domain: "x.com.", updatedAt: "2026-02-01" }]] });
  const profiles = (ado.snapshotState() as { profiles: Array<[string, { domain: string; updatedAt: string }]> }).profiles;
  assert.deepEqual(profiles.map(([k, p]) => [k, p.domain, p.updatedAt]), [["x.com", "x.com", "2026-02-01"]], "the newer profile wins");
  const life = new CognitiveLifespanEngine();
  life.restoreState({ motorProfiles: [["x.com:443", { domain: "x.com:443", verifiedAt: "2026-01-01" }]], metaphoricMappings: [["https://x.com", [{ id: 1 }]], ["x.com", [{ id: 2 }]]] });
  const snap = life.snapshotState() as { motorProfiles: Array<[string, { domain: string }]>; metaphoricMappings: Array<[string, unknown[]]> };
  assert.deepEqual(snap.motorProfiles.map(([k, p]) => [k, p.domain]), [["x.com", "x.com"]]);
  assert.deepEqual(snap.metaphoricMappings, [["x.com", [{ id: 1 }, { id: 2 }]]], "both spellings' metaphors kept");
});

test("memory load: facts, pitfalls, reflections, episodes and playbooks move to the canonical domain, idempotently", () => {
  const raw = {
    version: "1.3.0", updatedAt: "2026-01-01T00:00:00.000Z",
    domains: {
      "x.com.": { domain: "x.com.", framework: "react", lastVerifiedAt: "2026-01-01" },
      "https://X.com": { domain: "https://X.com", keySelectors: { compose: "#c" }, framework: "vue", lastVerifiedAt: "2026-02-01" },
      "münchen.de": { domain: "münchen.de", framework: "none" },
      "???": { domain: "???", framework: "kept as is" },
    },
    pitfalls: { "x.com:443": [{ id: "p1", domain: "x.com:443", symptom: "a" }], "x.com": [{ id: "p2", domain: "x.com", symptom: "b" }] },
    reflections: { "https://x.com": [{ id: "r1", key: "k", domain: "https://x.com" }] },
    playbooks: { "x.com.::post": { id: "post", name: "post", domain: "x.com.", intent: "post", steps: [] } },
    episodes: [{ id: "e1", domain: "WWW.x.com", intent: "click", success: true, durationMs: 1, timestamp: "" }],
  };
  const out = migrateMemory(JSON.parse(JSON.stringify(raw)))!;
  assert.equal(out.changed, true);
  const d = out.data;
  assert.deepEqual(Object.keys(d.domains).sort(), ["???", "x.com", "xn--mnchen-3ya.de"]);
  assert.equal(d.domains["x.com"].framework, "vue", "the more recently verified record's fields win");
  assert.deepEqual(d.domains["x.com"].keySelectors, { compose: "#c" });
  assert.equal(d.domains["x.com"].domain, "x.com");
  assert.deepEqual(d.pitfalls["x.com"].map((p) => [p.id, p.domain]), [["p1", "x.com"], ["p2", "x.com"]], "both pitfall lists kept");
  assert.equal(d.reflections["x.com"][0].domain, "x.com");
  assert.equal(d.playbooks["x.com.::post"].domain, "x.com", "playbook keys carry no meaning; the domain field moves");
  assert.equal(d.episodes[0].domain, "x.com");
  assert.equal(migrateMemory(JSON.parse(JSON.stringify(d)))!.changed, false, "a canonical store is left alone");
});

test("canonicalDomain stays idempotent for a unicode host behind a scheme the URL standard does not know", () => {
  for (const s of ["foo://münchen.de", "chrome-extension://münchen/x", "FOO://WWW.München.de:8080/a"]) {
    const once = canonicalDomain(s);
    assert.ok(once.startsWith("xn--"), `${s} -> ${once}: punycode, not an opaque percent-encoded host`);
    assert.equal(canonicalDomain(once), once, s);
  }
  assert.equal(canonicalDomain("foo://münchen.de"), canonicalDomain("https://münchen.de"));
});

test("memory load: two spellings' keySelectors are merged name by name, reflections newest first and one per key", async () => {
  const { MAX_PER_DOMAIN } = await import("../cognitive-reflection.js");
  const { REFLECTIONS_PER_DOMAIN } = await import("../cognitive-memory-migrate.js");
  assert.equal(REFLECTIONS_PER_DOMAIN, MAX_PER_DOMAIN, "the migration caps a merged list like a reflect pass");
  const refl = (id: string, key: string, createdAt: string, verdict = "works") => ({ id, key, verdict, domain: "x", createdAt });
  const many = Array.from({ length: 25 }, (_, i) => refl(`old${i}`, `k${i}`, `2026-01-${String(i + 1).padStart(2, "0")}`));
  const raw = {
    version: "1.3.0", updatedAt: "2026-01-01T00:00:00.000Z",
    domains: {
      "x.com.": { domain: "x.com.", keySelectors: { login: "#l", compose: "#old" }, lastVerifiedAt: "2026-01" },
      "x.com": { domain: "x.com", keySelectors: { compose: "#c" }, lastVerifiedAt: "2026-02" },
    },
    pitfalls: {}, playbooks: {}, episodes: [],
    reflections: {
      "x.com.": many,
      "x.com": [refl("new0", "k0", "2026-03-01", "broken"), ...Array.from({ length: 10 }, (_, i) => refl(`new${i + 1}`, `n${i}`, `2026-02-0${(i % 9) + 1}`))],
    },
  };
  const d = migrateMemory(JSON.parse(JSON.stringify(raw)))!.data;
  assert.deepEqual(d.domains["x.com"].keySelectors, { login: "#l", compose: "#c" }, "the older spelling's login selector is kept");
  const list = d.reflections["x.com"] as Array<{ id: string; key: string; createdAt: string; verdict: string }>;
  assert.equal(list[0].id, "new0", "newest first");
  assert.equal(list.filter((r) => r.key === "k0").length, 1, "one reflection per key");
  assert.equal(list.find((r) => r.key === "k0")!.verdict, "broken", "the newer verdict supersedes the older one");
  assert.ok(list.length <= MAX_PER_DOMAIN);
  assert.ok(list.every((r, i) => i === 0 || list[i - 1].createdAt >= r.createdAt), "ordered newest first throughout");
});
