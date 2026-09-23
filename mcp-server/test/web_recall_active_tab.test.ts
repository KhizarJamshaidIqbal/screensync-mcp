// web_recall's own description says to call it "BEFORE interacting with any domain or web task" - inviting a
// caller to omit `domain`/`url` and let the hub work out what page it's on. Observed live: with two pitfalls
// saved for citytourinbarcelona.com and the browser actively on that domain, web_recall() with NO arguments
// returned domain: "" and confidently recommended an unrelated seeded x.com playbook (alternatives full of
// more cross-domain noise, each with a plausible-looking "score"). Passing domain explicitly worked correctly.
//
// Root cause: the no-domain path fell through to an unscoped ranking over every stored playbook, instead of
// either (a) inferring the domain from the browser's actively-routed tab - the same target resolveDispatch()
// and web_status's activeTab already use - or (b) admitting no domain could be resolved. These drive the real
// bridge (routes, registry, cognitive store) in-process, the same harness as web_dispatch.test.ts.

import "./_isolate-data-dir.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { A, startHub } from "./_web-hub-harness.js";

// cognitiveStore is a module-level singleton shared by every test in this process (see cognitive-memory.ts),
// so each test needs its own domains - reusing a name would leak one test's learned data into another's
// assertions, the same isolation cognitive_memory.test.ts's "test-site-" + Date.now() pattern gives itself.
let n = 0;
const uniqueDomain = (label: string) => `${label}-${Date.now()}-${n++}.test`;

/** A's actively-routed tab is on `domain` - the same instance resolveTarget()/web_status would pick with no
 *  hint. Both the top-level `tab` (what resolveTarget().tab / web_status's activeTab read) and the window's
 *  own `activeTab` (what tab/window-owner routing reads) are set, matching how the extension's heartbeat
 *  reports it. */
const browserOnDomain = (domain: string) => {
  const tab = { url: `https://${domain}/tours`, title: "Tours" };
  return { ...A, tab, windows: [{ id: 10, focused: true, activeTab: { tabId: 100, ...tab } }] };
};

async function learnTwoPitfalls(hub: Awaited<ReturnType<typeof startHub>>, domain: string) {
  for (const symptom of ["Booking modal won't submit", "Date picker ignores keyboard input"]) {
    const res = await hub.call("web_learn", { action: "pitfall", domain, data: { symptom, rootCause: "test fixture", antiPattern: "x", provenSolution: "y" } });
    assert.equal(res.ok, true, String((res as any).error));
  }
}

test("no domain, no url, active tab on domain A, pitfalls stored for A: recall scopes to A, no cross-domain leak", async () => {
  const domainA = uniqueDomain("citytourinbarcelona");
  const hub = await startHub();
  try {
    await hub.register(browserOnDomain(domainA));
    await learnTwoPitfalls(hub, domainA);

    const reply = await hub.call("web_recall", {});
    assert.equal(reply.ok, true, String(reply.error));
    assert.equal(reply.data.domain, domainA, "the response must echo which domain was actually searched");
    assert.equal(reply.data.pitfalls.length, 2, "must return domain A's own pitfalls");
    assert.ok(reply.data.pitfalls.every((p: any) => p.domain === domainA));
    assert.equal(reply.data.recommendedPlaybook, null, "no playbook exists for A, so none should be recommended");
  } finally {
    await hub.close();
  }
});

test("no domain, no url, active tab on domain A, but only domain B has stored data: recall does not leak B's playbook", async () => {
  const domainA = uniqueDomain("citytourinbarcelona");
  const domainB = uniqueDomain("other-unrelated-shop");
  const hub = await startHub();
  try {
    await hub.register(browserOnDomain(domainA));
    // Only B has anything stored - this reproduces the live bug where the global top-scored playbook
    // (there, x.com's seeded x_publish_post) was recommended regardless of what page the agent was on.
    await hub.call("web_learn", { action: "playbook", domain: domainB, intent: "book", data: { name: "b_only_playbook", steps: [{ tool: "web_click", args: { selector: "#b" } }] } });

    const reply = await hub.call("web_recall", {});
    assert.equal(reply.ok, true, String(reply.error));
    assert.equal(reply.data.domain, domainA, "must scope to the active tab's domain (A), not fall through to B");
    assert.equal(reply.data.recommendedPlaybook, null, "must not recommend B's playbook while routed to A");
    assert.equal(reply.data.alternatives.length, 0, "alternatives must not leak B's playbook either");
    assert.equal(reply.data.found, false, "A itself has nothing stored, so recall must admit it found nothing");
  } finally {
    await hub.close();
  }
});

test("no domain, no url, no browser online at all: recall admits it, instead of a confident global guess", async () => {
  const domainB = uniqueDomain("other-unrelated-shop");
  const hub = await startHub();
  try {
    // Give some other domain data to rank over, so a regression back to the global-ranking bug would surface it.
    await hub.call("web_learn", { action: "playbook", domain: domainB, intent: "book", data: { name: "b_only_playbook", steps: [{ tool: "web_click", args: { selector: "#b" } }] } });

    const reply = await hub.call("web_recall", {});
    assert.equal(reply.ok, true, String(reply.error));
    assert.equal(reply.data.domain, "", "nothing could be resolved");
    assert.equal(reply.data.recommendedPlaybook, null, "must not surface a confident but irrelevant top-scored playbook");
    assert.equal(reply.data.found, false);
    assert.equal(reply.data.domainSource, "unresolved");
    assert.match(String(reply.data.note), /no domain|no browser|pass.*domain/i, "must tell the caller to pass a domain explicitly");
  } finally {
    await hub.close();
  }
});

test("explicit domain still works unchanged, even while a different browser tab is active", async () => {
  const domainA = uniqueDomain("citytourinbarcelona");
  const domainB = uniqueDomain("other-unrelated-shop");
  const hub = await startHub();
  try {
    await hub.register(browserOnDomain(domainA)); // active tab is A, but the call below names B explicitly
    await hub.call("web_learn", { action: "pitfall", domain: domainB, data: { symptom: "B-specific issue", rootCause: "x", antiPattern: "y", provenSolution: "z" } });

    const reply = await hub.call("web_recall", { domain: domainB });
    assert.equal(reply.ok, true, String(reply.error));
    assert.equal(reply.data.domain, domainB, "an explicit domain must win over the active tab");
    assert.equal(reply.data.pitfalls.length, 1);
    assert.equal(reply.data.pitfalls[0].domain, domainB);
    assert.equal(reply.data.domainSource, "explicit");
  } finally {
    await hub.close();
  }
});
