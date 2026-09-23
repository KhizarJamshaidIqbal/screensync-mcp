// web_status must describe the browser the next web_* call is routed to.
//
// With two Chrome profiles connected, the top-level activeTab used to come from whichever instance sent the
// latest heartbeat (online[0]), not from the one resolveTarget() would pick. Observed live: selectedProfile
// was profile B and every call went to B, while web_status reported profile A's x.com tab as "the" active
// tab. An agent that calls web_status before acting was told it was about to act in a different logged-in
// account. These cases pin the status to the router's own resolution.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createProfileRegistry } from "../profile-registry.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Status = {
  selectedProfile: string | null;
  targetInstanceId: string | null;
  targetProfile: string | null;
  lastSeenAt: string | null;
  activeTab: { url?: string } | null;
  browsers: Array<{ instanceId: string; activeTab: { url?: string } | null }>;
};

const A = { instanceId: "inst-a", browserId: "inst-a", browserName: "chrome", profileEmail: "a@profile.test", webAccessEnabled: true };
const B = { instanceId: "inst-b", browserId: "inst-b", browserName: "chrome", profileEmail: "b@profile.test", webAccessEnabled: true };
const tabA = { url: "https://x.test/home", title: "A home" };
const tabB = { url: "https://citytour.test/explore", title: "B page" };

/** B heartbeats first, A last, so A is online[0] (the most recent heartbeat). */
async function twoProfiles(opts: { bFocused?: boolean; aFocused?: boolean } = {}) {
  const registry = createProfileRegistry();
  registry.register({ ...B, tab: tabB, windows: [{ id: 20, focused: opts.bFocused === true, activeTab: { tabId: 200, ...tabB } }] });
  await sleep(5); // distinct lastSeenAt, so "most recent" is unambiguous
  registry.register({ ...A, tab: tabA, windows: [{ id: 10, focused: opts.aFocused === true, activeTab: { tabId: 100, ...tabA } }] });
  assert.equal(registry.listOnline()[0].instanceId, "inst-a", "fixture: A must hold the most recent heartbeat");
  return registry;
}

test("selectedProfile = B while A heartbeated last: the top level reports B's tab and B as the target", async () => {
  const registry = await twoProfiles({ bFocused: true });
  registry.setSelectedProfile("b@profile.test");
  const s = registry.statusPayload(2) as Status;

  assert.equal(s.selectedProfile, "b@profile.test");
  assert.equal(s.targetInstanceId, "inst-b");
  assert.equal(s.targetProfile, "b@profile.test");
  assert.deepEqual(s.activeTab, tabB, "activeTab must be the routed profile's tab, not the latest heartbeat's");
  assert.equal(s.lastSeenAt, registry.get("inst-b")!.lastSeenAt);
  // the router agrees: a call with no routing hints goes to the same instance
  assert.equal(registry.resolveTarget(null)!.instanceId, s.targetInstanceId);
});

test("selectedProfile wins even when the other profile holds the focused window", async () => {
  const registry = await twoProfiles({ aFocused: true });
  registry.setSelectedProfile("b@profile.test");
  const s = registry.statusPayload(2) as Status;
  assert.equal(s.targetInstanceId, "inst-b");
  assert.deepEqual(s.activeTab, tabB);
});

test("no selectedProfile: the focused-window instance is the target, not the latest heartbeat", async () => {
  const registry = await twoProfiles({ bFocused: true });
  const s = registry.statusPayload(2) as Status;
  assert.equal(s.targetInstanceId, "inst-b");
  assert.deepEqual(s.activeTab, tabB);
});

test("no selectedProfile and no focused window: falls back to the most recent heartbeat", async () => {
  const registry = await twoProfiles();
  const s = registry.statusPayload(2) as Status;
  assert.equal(s.targetInstanceId, "inst-a");
  assert.equal(s.targetProfile, "a@profile.test");
  assert.deepEqual(s.activeTab, tabA);
});

test("a selectedProfile that matches no connected browser reports no target instead of a guess", async () => {
  const registry = await twoProfiles({ aFocused: true });
  registry.setSelectedProfile("gone@profile.test");
  const s = registry.statusPayload(2) as Status;
  assert.equal(s.targetInstanceId, null);
  assert.equal(s.targetProfile, null);
  assert.equal(s.activeTab, null);
});

test("the per-browser list is unchanged: every instance still reports its own tab", async () => {
  const registry = await twoProfiles({ bFocused: true });
  registry.setSelectedProfile("b@profile.test");
  const s = registry.statusPayload(2) as Status;
  assert.deepEqual(s.browsers.find((b) => b.instanceId === "inst-a")!.activeTab, tabA);
  assert.deepEqual(s.browsers.find((b) => b.instanceId === "inst-b")!.activeTab, tabB);
});

// resolveDispatch(): the routing decision request() in web.ts relays with. It must name exactly one instance or
// refuse - the extension runs a web_request that names none in every connected profile (web_dispatch.test.ts).

test("dispatch: a selectedProfile matching no connected browser is refused, not re-routed to the other profile", async () => {
  const registry = await twoProfiles({ aFocused: true });
  registry.setSelectedProfile("gone@profile.test");
  const d = registry.resolveDispatch({ selector: "#post" });
  assert.equal(d.ok, false);
  if (d.ok) return;
  assert.equal(d.code, "SELECTED_PROFILE_OFFLINE");
  assert.match(d.error, /selected profile 'gone@profile\.test' is offline/);
  assert.deepEqual(d.onlineProfiles, ["a@profile.test", "b@profile.test"]);
});

test("dispatch: 'any' and 'default' name no browser, so they cannot bypass an offline selection", async () => {
  const registry = await twoProfiles({ aFocused: true });
  registry.setSelectedProfile("gone@profile.test");
  for (const wildcard of ["any", "default", "ANY", " "]) {
    assert.equal(registry.resolveDispatch({ __browser: wildcard }).ok, false, `__browser: '${wildcard}'`);
  }
  registry.setSelectedProfile("b@profile.test");
  const d = registry.resolveDispatch({ __browser: "any" });
  assert.equal(d.ok && d.target.instanceId, "inst-b", "a wildcard follows the selection, not the focused window");
});

test("dispatch: an explicit hint and a tab owner still route while the selection is offline", async () => {
  const registry = await twoProfiles({ aFocused: true });
  registry.setSelectedProfile("gone@profile.test");
  const byHint = registry.resolveDispatch({ __profile: "b@profile.test" });
  assert.equal(byHint.ok && byHint.target.instanceId, "inst-b");
  const byTab = registry.resolveDispatch({ tabId: 200 });
  assert.equal(byTab.ok && byTab.target.instanceId, "inst-b", "the owning instance is ground truth, not a fallback");
});

test("dispatch: a hint matching no connected browser is refused even when a tab owner exists", async () => {
  const registry = await twoProfiles();
  const d = registry.resolveDispatch({ tabId: 100, __browser: "firefox" });
  assert.equal(d.ok, false);
  if (d.ok) return;
  assert.equal(d.code, "PROFILE_NOT_CONNECTED");
  assert.match(d.error, /No connected browser matches 'firefox'/);
});

test("dispatch: one browser online and nothing selected names that browser; none online is refused", () => {
  const registry = createProfileRegistry();
  const none = registry.resolveDispatch({});
  assert.equal(!none.ok && none.code, "NO_BROWSER_ONLINE");
  registry.register({ ...A, tab: tabA, windows: [] });
  const one = registry.resolveDispatch({});
  assert.equal(one.ok && one.target.instanceId, "inst-a");
});
