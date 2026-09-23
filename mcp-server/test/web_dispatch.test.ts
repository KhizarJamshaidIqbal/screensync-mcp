// A web_* call must never leave the hub without a target browser instance.
//
// The extension accepts a web_request that names no instance in EVERY connected profile
// (matchesSelfTarget in extension/lib/profile-identity.js). When selectedProfile named a profile that had
// dropped offline, resolveTarget() found nothing and request() broadcast the call with
// targetInstanceId: null, so with two logged-in Chrome profiles online one web_click / web_fill / post ran
// in BOTH accounts. These cases drive the real bridge (routes, request(), flows, fanout) in-process and
// record every web_request it relays, standing in for the extension that would receive it.

import "./_isolate-data-dir.js";
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import express from "express";
import { AUTH_TOKEN } from "../config.js";
import { createWebBridge } from "../web.js";

// The cognitive gate is covered elsewhere (cognitive_gate.e2e.ts); here it would only add noise.
process.env.SCREEN_SYNC_COGNITIVE_GATE = "off";

type Relayed = { type: string; id: string; tool: string; args: Record<string, unknown>; targetInstanceId: string | null };
type ToolReply = { ok: boolean; error?: string; code?: string; onlineProfiles?: string[]; data?: any };

const headers = { "Content-Type": "application/json", Authorization: `Bearer ${AUTH_TOKEN}` };
const A = { instanceId: "inst-a", browserId: "inst-a", browserName: "chrome", profileEmail: "a@profile.test", webAccessEnabled: true, approvals: true };
const B = { instanceId: "inst-b", browserId: "inst-b", browserName: "chrome", profileEmail: "b@profile.test", webAccessEnabled: true, approvals: true };
const SOLO = { ...A, instanceId: "inst-solo", browserId: "inst-solo", profileEmail: "solo@profile.test" };

/** One bridge on an ephemeral port. Every relayed web_request is recorded, and answered as the addressed extension would. */
async function startHub(answer: (ev: Relayed) => unknown = (ev) => ({ ranIn: ev.targetInstanceId })) {
  const relayed: Relayed[] = [];
  let base = "";
  const bridge = createWebBridge((payload) => {
    const ev = payload as Relayed;
    if (ev?.type !== "web_request") return;
    relayed.push(ev);
    setImmediate(() => {
      fetch(`${base}/api/web/result`, {
        method: "POST",
        headers,
        body: JSON.stringify({ id: ev.id, ok: true, data: answer(ev), ...(ev.targetInstanceId ? { instanceId: ev.targetInstanceId } : {}), browserName: "chrome" }),
      }).catch(() => {});
    });
  }, () => 2);
  const app = express();
  app.use(express.json({ limit: "5mb" }));
  bridge.registerRoutes(app);
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const post = async (route: string, body: unknown) => (await fetch(`${base}${route}`, { method: "POST", headers, body: JSON.stringify(body) })).json();
  return {
    relayed,
    register: (body: Record<string, unknown>) => post("/api/web/register", body),
    call: (tool: string, args: Record<string, unknown> = {}) => post("/api/web/tool", { tool, args }) as Promise<ToolReply>,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

/** A registers, goes silent past the 10-minute presence TTL, B keeps heartbeating: A is offline, B online. */
async function selectedProfileGoesOffline(hub: Awaited<ReturnType<typeof startHub>>) {
  await hub.register(A);
  await hub.register(B);
  await hub.call("web_profile", { action: "select", profile: "a@profile.test" });
  mock.timers.tick(11 * 60_000);
  await hub.register(B);
  const status = (await hub.call("web_status")).data;
  assert.deepEqual(status.browsers.filter((b: any) => b.online).map((b: any) => b.instanceId), ["inst-b"], "fixture: only B is online");
  assert.equal(status.selectedProfile, "a@profile.test");
}

test("(a) selectedProfile offline while another profile is online: web_click is refused and nothing is dispatched", async () => {
  mock.timers.enable({ apis: ["Date"], now: Date.now() });
  const hub = await startHub();
  try {
    await selectedProfileGoesOffline(hub);
    const reply = await hub.call("web_click", { selector: "#publish" });

    assert.deepEqual(hub.relayed.map((r) => r.tool), [], "no web_request may reach any browser");
    assert.equal(reply.ok, false);
    assert.match(String(reply.error), /selected profile 'a@profile\.test' is offline/);
    assert.match(String(reply.error), /web_profile/, "the error must say how to recover");
    assert.match(String(reply.error), /b@profile\.test/, "the error must name the profiles that are online");
    assert.deepEqual(reply.onlineProfiles, ["b@profile.test"]);
  } finally {
    await hub.close();
    mock.timers.reset();
  }
});

test("(a2) a saved flow run while the selected profile is offline dispatches none of its steps", async () => {
  mock.timers.enable({ apis: ["Date"], now: Date.now() });
  const hub = await startHub();
  try {
    await selectedProfileGoesOffline(hub);
    await hub.call("web_flow_save", { name: "offline-post", steps: [{ tool: "web_fill", args: { selector: "#msg", value: "hi" } }, { tool: "web_click", args: { selector: "#post" } }] });
    const run = await hub.call("web_flow_run", { name: "offline-post" });

    assert.deepEqual(hub.relayed.map((r) => r.tool), [], "flows and schedules go through the same guard");
    assert.equal(run.ok, false);
    assert.match(String(run.data.results[0].error), /selected profile 'a@profile\.test' is offline/);
  } finally {
    await hub.close();
    mock.timers.reset();
  }
});

test("an explicit profile hint still routes while the selected profile is offline", async () => {
  mock.timers.enable({ apis: ["Date"], now: Date.now() });
  const hub = await startHub();
  try {
    await selectedProfileGoesOffline(hub);
    const reply = await hub.call("web_click", { selector: "#ok", __profile: "b@profile.test" });
    assert.equal(reply.ok, true);
    assert.deepEqual(hub.relayed.map((r) => r.targetInstanceId), ["inst-b"]);
  } finally {
    await hub.close();
    mock.timers.reset();
  }
});

test("(b) no selection and two profiles online: the call is still sent to exactly one named instance", async () => {
  const hub = await startHub();
  try {
    await hub.register(A);
    await hub.register(B);
    const reply = await hub.call("web_click", { selector: "#ok" });
    assert.equal(reply.ok, true);
    assert.equal(hub.relayed.length, 1);
    assert.ok(["inst-a", "inst-b"].includes(String(hub.relayed[0].targetInstanceId)), `targetInstanceId was ${hub.relayed[0].targetInstanceId}`);
  } finally {
    await hub.close();
  }
});

test("(c) one browser online and nothing selected: the call names that instance explicitly", async () => {
  const hub = await startHub();
  try {
    await hub.register(SOLO);
    const reply = await hub.call("web_click", { selector: "#ok" });
    assert.equal(reply.ok, true);
    assert.deepEqual(hub.relayed.map((r) => r.targetInstanceId), ["inst-solo"]);
  } finally {
    await hub.close();
  }
});

test("(d) web_fanout still reaches every online browser, one targeted request each", async () => {
  const hub = await startHub();
  try {
    await hub.register(A);
    await hub.register(B);
    const reply = await hub.call("web_fanout", { tool: "web_aria_snapshot" });
    assert.equal(reply.ok, true);
    assert.equal(reply.data.matched, 2);
    assert.deepEqual(hub.relayed.map((r) => r.targetInstanceId).sort(), ["inst-a", "inst-b"]);
  } finally {
    await hub.close();
  }
});

test("(d2) web_fanout addresses all browsers on purpose, so an offline selection does not block it", async () => {
  mock.timers.enable({ apis: ["Date"], now: Date.now() });
  const hub = await startHub();
  try {
    await selectedProfileGoesOffline(hub);
    const reply = await hub.call("web_fanout", { tool: "web_aria_snapshot" });
    assert.equal(reply.ok, true);
    assert.deepEqual(hub.relayed.map((r) => r.targetInstanceId), ["inst-b"]);
  } finally {
    await hub.close();
    mock.timers.reset();
  }
});

test("no browser online: a flow step is refused instead of broadcast to whoever is listening", async () => {
  const hub = await startHub();
  try {
    await hub.call("web_flow_save", { name: "nobody-home", steps: [{ tool: "web_click", args: { selector: "#post" } }] });
    const run = await hub.call("web_flow_run", { name: "nobody-home" });
    assert.deepEqual(hub.relayed.map((r) => r.tool), []);
    assert.equal(run.ok, false);
    assert.match(String(run.data.results[0].error), /No browser is online/);
  } finally {
    await hub.close();
  }
});

test("every relayed web_request carries a targetInstanceId", async () => {
  const hub = await startHub();
  try {
    await hub.register(A);
    await hub.register(B);
    await hub.call("web_expect", { condition: "visible", selector: "h1" });
    await hub.call("web_click", { selector: "#ok", __browser: "any" });
    await hub.call("web_fanout", { tool: "web_title" });
    assert.ok(hub.relayed.length >= 4);
    for (const r of hub.relayed) assert.ok(r.targetInstanceId, `${r.tool} was relayed without a target`);
  } finally {
    await hub.close();
  }
});

// ── The approval gate asks the browser the call is dispatched to ─────────────────────────────────────────────
// humanCanBeAsked() used to pick its browser with resolveTarget(), which ignores tabId/windowId, while request()
// dispatched with resolveDispatch(), which follows the tab owner. So approval could be judged on profile A (an
// extension that asks a person) while the call ran in profile B (an older one that would simply run it).

const DANGEROUS = { url: "https://gated.example/account", selector: "button.delete-account" };
const CAPABLE_A = { ...A, approvals: true, windows: [{ id: 10, focused: true, activeTab: { tabId: 100, url: "https://gated.example/" } }] };
const OLD_B = { ...B, approvals: false, windows: [{ id: 20, focused: false, activeTab: { tabId: 200, url: "https://gated.example/" } }] };

async function withGate<T>(mode: string, fn: () => Promise<T>): Promise<T> {
  process.env.SCREEN_SYNC_COGNITIVE_GATE = mode;
  try { return await fn(); } finally { process.env.SCREEN_SYNC_COGNITIVE_GATE = "off"; }
}

test("gate: selectedProfile = A, tabId owned by B: approval is judged on B, so B's old extension never gets the call", async () => {
  const hub = await startHub();
  try {
    await hub.register(CAPABLE_A);
    await hub.register(OLD_B);
    await hub.call("web_profile", { action: "select", profile: "a@profile.test" });
    const reply = await withGate("enforce", () => hub.call("web_click", { ...DANGEROUS, tabId: 200 }));

    assert.deepEqual(hub.relayed.map((r) => `${r.tool}->${r.targetInstanceId}`), [], "B cannot ask a person, so nothing may be relayed to it");
    assert.equal(reply.ok, false);
    assert.match(String(reply.error), /^USER_CONFIRMATION_REQUIRED \(cognitive gate\)/);
  } finally {
    await hub.close();
  }
});

test("gate: selectedProfile = B (cannot ask), tabId owned by A (can ask): the call goes to A, marked for a person", async () => {
  const hub = await startHub();
  try {
    await hub.register(CAPABLE_A);
    await hub.register(OLD_B);
    await hub.call("web_profile", { action: "select", profile: "b@profile.test" });
    const reply = await withGate("enforce", () => hub.call("web_click", { ...DANGEROUS, tabId: 100 }));

    assert.equal(reply.ok, true, String(reply.error));
    assert.deepEqual(hub.relayed.map((r) => r.targetInstanceId), ["inst-a"]);
    assert.equal((hub.relayed[0].args.__gate as { needsHuman?: boolean } | undefined)?.needsHuman, true, "A's extension is told to ask a person");
  } finally {
    await hub.close();
  }
});

test("gate: a dispatch that is refused (selected profile offline) is refused before anyone is asked", async () => {
  mock.timers.enable({ apis: ["Date"], now: Date.now() });
  const hub = await startHub();
  try {
    await selectedProfileGoesOffline(hub);
    const reply = await withGate("enforce", () => hub.call("web_click", DANGEROUS));

    assert.deepEqual(hub.relayed.map((r) => r.tool), [], "no approval prompt for a call that cannot be dispatched");
    assert.equal(reply.code, "SELECTED_PROFILE_OFFLINE", "the routing problem is what to fix, not the extension version");
    assert.match(String(reply.error), /selected profile 'a@profile\.test' is offline/);
  } finally {
    await hub.close();
    mock.timers.reset();
  }
});

// ── web_tab_fanout lists and acts on ONE browser's tabs: the routed one ──────────────────────────────────────
// It listed the tabs of whichever browser heartbeated last (listOnline()[0]) and relayed each per-tab call
// unpinned, so with profile B selected it read A's tab ids and ran them wherever each id happened to route.

/** Each browser's own tabs, as its extension's web_tabs answers. Tab ids are only unique inside one browser. */
const TABS: Record<string, Array<{ tabId: number; url: string }>> = {
  "inst-a": [{ tabId: 100, url: "https://a.test/1" }, { tabId: 101, url: "https://a.test/2" }],
  "inst-b": [{ tabId: 200, url: "https://b.test/1" }, { tabId: 201, url: "https://b.test/2" }],
};
const tabsAnswer = (ev: Relayed) => (ev.tool === "web_tabs" ? { tabs: TABS[String(ev.targetInstanceId)] ?? [] } : { ranIn: ev.targetInstanceId });
const sent = (hub: Awaited<ReturnType<typeof startHub>>) =>
  hub.relayed.map((r) => `${r.tool}${r.args.tabId === undefined ? "" : `#${r.args.tabId}`}->${r.targetInstanceId}`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** `first` heartbeats, then `last`: `last` holds the most recent heartbeat (listOnline()[0]). */
async function heartbeats(hub: Awaited<ReturnType<typeof startHub>>, first: Record<string, unknown>, last: Record<string, unknown>) {
  await hub.register(first);
  await sleep(5);
  await hub.register(last);
  const profiles = (await hub.call("web_profile")).data.profiles;
  assert.equal(profiles[0].instanceId, last.instanceId, "fixture: the most recent heartbeat");
}

test("tab fanout: selectedProfile = B while A heartbeated last: B's tabs are listed and every per-tab call goes to B", async () => {
  const hub = await startHub(tabsAnswer);
  try {
    await heartbeats(hub, B, A);
    await hub.call("web_profile", { action: "select", profile: "b@profile.test" });
    const reply = await hub.call("web_tab_fanout", { tool: "web_title" });

    assert.deepEqual(sent(hub), ["web_tabs->inst-b", "web_title#200->inst-b", "web_title#201->inst-b"]);
    assert.equal(reply.ok, true, String(reply.error));
    assert.deepEqual(reply.data.results.map((r: { tabId: number }) => r.tabId), [200, 201]);
    assert.equal(reply.data.instanceId, "inst-b", "the reply says whose tabs these are");
  } finally {
    await hub.close();
  }
});

test("tab fanout: an explicit profile hint picks the browser, for the listing and for every per-tab call", async () => {
  const hub = await startHub(tabsAnswer);
  try {
    await heartbeats(hub, A, B);
    const reply = await hub.call("web_tab_fanout", { tool: "web_title", profile: "a@profile.test" });
    assert.deepEqual(sent(hub), ["web_tabs->inst-a", "web_title#100->inst-a", "web_title#101->inst-a"]);
    assert.equal(reply.ok, true, String(reply.error));
  } finally {
    await hub.close();
  }
});

test("tab fanout: per-tab calls stay pinned even when another browser reports the same tab id", async () => {
  const hub = await startHub(tabsAnswer);
  try {
    // A's heartbeat says its active tab is 200 too: the same number means a different tab in another browser.
    await heartbeats(hub, B, { ...A, windows: [{ id: 10, focused: true, activeTab: { tabId: 200 } }] });
    await hub.call("web_profile", { action: "select", profile: "b@profile.test" });
    await hub.call("web_tab_fanout", { tool: "web_title", tabIds: [200] });
    assert.deepEqual(sent(hub), ["web_tabs->inst-b", "web_title#200->inst-b"]);
  } finally {
    await hub.close();
  }
});

test("tab fanout: while the selected profile is offline nothing is listed or run, and the refusal says why", async () => {
  mock.timers.enable({ apis: ["Date"], now: Date.now() });
  const hub = await startHub(tabsAnswer);
  try {
    await selectedProfileGoesOffline(hub);
    const reply = await hub.call("web_tab_fanout", { tool: "web_title" });
    assert.deepEqual(sent(hub), []);
    assert.equal(reply.ok, false);
    assert.equal(reply.code, "SELECTED_PROFILE_OFFLINE");
  } finally {
    await hub.close();
    mock.timers.reset();
  }
});
