// Hub-side tools that relay more than one call must pin each call to the browser they mean.
//
// web_fanout only added a `__browser` hint per pass, and the tab owner and a profile hint both outrank that hint,
// so an inner tabId or `__profile` sent every pass to the same browser. The same bridge and recorder as
// web_dispatch.test.ts (the real routes and request(), with a stand-in extension) show where each call went.

import "./_isolate-data-dir.js";
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { A, B, startHub, sent, heartbeats, selectedProfileGoesOffline, type Relayed } from "./_web-hub-harness.js";

/** A's active tab is 100 in window 10, B's is 200 in window 20: the hub learns tab owners from these heartbeats. */
const A_TAB = { ...A, windows: [{ id: 10, focused: true, activeTab: { tabId: 100, url: "https://a.test/" } }] };
const B_TAB = { ...B, windows: [{ id: 20, focused: false, activeTab: { tabId: 200, url: "https://b.test/" } }] };

// ── web_fanout: one pass per browser, and each pass stays in its browser ────────────────────────────────────

test("fanout: an inner tabId owned by A runs once, in A; B's pass is skipped and says why", async () => {
  const hub = await startHub();
  try {
    await hub.register(A_TAB);
    await hub.register(B_TAB);
    const reply = await hub.call("web_fanout", { tool: "web_title", args: { tabId: 100 } });

    assert.deepEqual(sent(hub), ["web_title#100->inst-a"], "never twice to A, and never to B with A's tab id");
    assert.equal(reply.ok, true, String(reply.error));
    const byBrowser = Object.fromEntries(reply.data.results.map((r: any) => [r.browserId, r]));
    assert.equal(byBrowser["inst-a"].ok, true);
    assert.equal(byBrowser["inst-b"].skipped, true, "B's pass is reported, as skipped");
    assert.match(String(byBrowser["inst-b"].reason), /tabId 100 belongs to a@profile\.test/);
  } finally {
    await hub.close();
  }
});

test("fanout: every pass carries its own browser's targetInstanceId, and its result is filed under that browser", async () => {
  const hub = await startHub();
  try {
    await hub.register(A_TAB);
    await hub.register(B_TAB);
    const reply = await hub.call("web_fanout", { tool: "web_title", args: { __browser: "any" } });

    assert.deepEqual(hub.relayed.map((r) => r.targetInstanceId).sort(), ["inst-a", "inst-b"]);
    for (const r of reply.data.results) assert.deepEqual(r.data, { ranIn: r.browserId }, `${r.browserId}'s result came from ${r.data?.ranIn}`);
  } finally {
    await hub.close();
  }
});

test("fanout: a profile hint inside args cannot re-route the passes: it is refused and nothing is dispatched", async () => {
  const hub = await startHub();
  try {
    await hub.register(A_TAB);
    await hub.register(B_TAB);
    for (const args of [{ args: { __profile: "a@profile.test" } }, { args: { profile: "a@profile.test" } }, { __browser: "inst-a" }]) {
      const reply = await hub.call("web_fanout", { tool: "web_title", ...args });
      assert.equal(reply.ok, false, JSON.stringify(args));
      assert.equal(reply.code, "FANOUT_ROUTING_HINT", JSON.stringify(args));
      assert.match(String(reply.error), /browsers/, "the refusal says how to choose browsers instead");
    }
    assert.deepEqual(sent(hub), []);
  } finally {
    await hub.close();
  }
});

test("fanout: a tabId no connected browser reports is refused instead of sent to every browser", async () => {
  const hub = await startHub();
  try {
    await hub.register(A_TAB);
    await hub.register(B_TAB);
    const unknown = await hub.call("web_fanout", { tool: "web_title", args: { tabId: 999 } });
    assert.equal(unknown.code, "TAB_OWNER_UNKNOWN");
    assert.deepEqual(sent(hub), []);

    // Naming the one browser to use makes the id unambiguous again.
    const chosen = await hub.call("web_fanout", { tool: "web_title", browsers: ["inst-b"], args: { tabId: 999 } });
    assert.equal(chosen.ok, true, String(chosen.error));
    assert.deepEqual(sent(hub), ["web_title#999->inst-b"]);
  } finally {
    await hub.close();
  }
});

test("fanout: a windowId owned by B runs only in B", async () => {
  const hub = await startHub();
  try {
    await hub.register(A_TAB);
    await hub.register(B_TAB);
    const reply = await hub.call("web_fanout", { tool: "web_window", args: { action: "focus", windowId: 20 } });
    assert.deepEqual(hub.relayed.map((r) => `${r.tool}->${r.targetInstanceId}`), ["web_window->inst-b"]);
    assert.equal(reply.data.results.find((r: any) => r.browserId === "inst-a").skipped, true);
  } finally {
    await hub.close();
  }
});

// ── web_visual_baseline: one routing decision takes the screenshot and runs the pixel diff ───────────────────
// It picked the browser that heartbeated last and sent it a __browser hint, which also got around an offline
// selected profile (an explicit hint routes past it).

const PNG = "data:image/png;base64,iVBORw0KGgo=";
const shotAnswer = (ev: Relayed) =>
  ev.tool === "web_screenshot" ? { imageDataUrl: PNG, url: `https://${ev.targetInstanceId}.test/` }
    : ev.tool === "web_pixel_diff" ? { identical: true, diffPercent: 0 } : { ranIn: ev.targetInstanceId };

test("visual baseline: while the selected profile is offline nothing is captured, and the refusal says why", async () => {
  mock.timers.enable({ apis: ["Date"], now: Date.now() });
  const hub = await startHub(shotAnswer);
  try {
    await selectedProfileGoesOffline(hub);
    for (const action of ["save", "compare"]) {
      const reply = await hub.call("web_visual_baseline", { action, name: "offline-page" });
      assert.equal(reply.ok, false, action);
      assert.equal(reply.code, "SELECTED_PROFILE_OFFLINE", action);
    }
    assert.deepEqual(sent(hub), [], "no screenshot from the other profile");
  } finally {
    await hub.close();
    mock.timers.reset();
  }
});

test("visual baseline: B selected while A heartbeated last: the screenshot and the pixel diff both run in B", async () => {
  const hub = await startHub(shotAnswer);
  try {
    await heartbeats(hub, B, A);
    await hub.call("web_profile", { action: "select", profile: "b@profile.test" });
    const saved = await hub.call("web_visual_baseline", { action: "save", name: "routed-page" });
    assert.equal(saved.ok, true, String(saved.error ?? saved.data?.error));
    const compared = await hub.call("web_visual_baseline", { action: "compare", name: "routed-page" });
    assert.equal(compared.ok, true, String(compared.error ?? compared.data?.error));
    assert.equal(compared.data.compared, true);

    assert.deepEqual(hub.relayed.map((r) => `${r.tool}->${r.targetInstanceId}`), ["web_screenshot->inst-b", "web_screenshot->inst-b", "web_pixel_diff->inst-b"]);
  } finally {
    await hub.close();
  }
});
