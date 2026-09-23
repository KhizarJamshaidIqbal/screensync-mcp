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

// Tab and window ids are only unique inside ONE browser process: Chrome and Edge (or two profiles) can both report
// window 5 with tab 7. resolveOwnerByTabOrWindow() used to answer with whichever it scanned first.

const EDGE_B = { ...B, browserName: "edge" };
const C = { instanceId: "inst-c", browserId: "inst-c", browserName: "brave", profileEmail: "c@profile.test", webAccessEnabled: true };

/** A (chrome) and B (edge) both report window 5 / tab 7; C is online and reports window 9 / tab 70. */
async function sameIds() {
  const registry = createProfileRegistry();
  registry.register({ ...EDGE_B, windows: [{ id: 5, focused: true, activeTab: { tabId: 7 } }] });
  await sleep(5);
  registry.register({ ...A, windows: [{ id: 5, focused: false, activeTab: { tabId: 7 } }] });
  registry.register({ ...C, windows: [{ id: 9, focused: false, activeTab: { tabId: 70 } }] });
  return registry;
}

test("dispatch: a tabId or windowId two browsers report is refused, naming both, when nothing picks one", async () => {
  const registry = await sameIds();
  for (const args of [{ tabId: 7 }, { windowId: 5 }, { tabId: 7, __browser: "any" }]) {
    const d = registry.resolveDispatch(args);
    assert.equal(d.ok, false, `${JSON.stringify(args)} must not be guessed`);
    if (d.ok) return;
    assert.equal(d.code, "AMBIGUOUS_TAB_OWNER");
    assert.equal(d.status, 409);
    assert.match(d.error, /a@profile\.test/);
    assert.match(d.error, /b@profile\.test/);
    assert.doesNotMatch(d.error, /c@profile\.test/, "only the browsers that report the id are listed");
    assert.match(d.error, /profile/, "the error says to pass a profile hint");
  }
});

test("dispatch: an explicit hint breaks the tie among the browsers that report the id", async () => {
  const registry = await sameIds();
  registry.setSelectedProfile("a@profile.test");
  const edge = registry.resolveDispatch({ tabId: 7, __browser: "edge" });
  assert.equal(edge.ok && edge.target.instanceId, "inst-b", "the hint outranks the selection");
  const a = registry.resolveDispatch({ windowId: 5, __profile: "a@profile.test" });
  assert.equal(a.ok && a.target.instanceId, "inst-a");
  const elsewhere = registry.resolveDispatch({ tabId: 7, __profile: "c@profile.test" });
  assert.equal(!elsewhere.ok && elsewhere.code, "AMBIGUOUS_TAB_OWNER", "a hint naming neither owner breaks nothing");
});

test("dispatch: with no hint, the selected profile breaks the tie; an offline selection does not", async () => {
  const registry = await sameIds();
  registry.setSelectedProfile("b@profile.test");
  const b = registry.resolveDispatch({ tabId: 7 });
  assert.equal(b.ok && b.target.instanceId, "inst-b");
  registry.setSelectedProfile("a@profile.test");
  const a = registry.resolveDispatch({ tabId: 7 });
  assert.equal(a.ok && a.target.instanceId, "inst-a");
  registry.setSelectedProfile("gone@profile.test");
  assert.equal(registry.resolveDispatch({ tabId: 7 }).ok, false);
});

test("dispatch: an id only one browser reports routes to it exactly as before", async () => {
  const registry = await sameIds();
  registry.setSelectedProfile("a@profile.test");
  const c = registry.resolveDispatch({ tabId: 70 });
  assert.equal(c.ok && c.target.instanceId, "inst-c", "the owner is ground truth, over the selection");
  const byWindow = registry.resolveDispatch({ windowId: 9, __browser: "any" });
  assert.equal(byWindow.ok && byWindow.target.instanceId, "inst-c");
});
