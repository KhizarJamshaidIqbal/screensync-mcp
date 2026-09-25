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
