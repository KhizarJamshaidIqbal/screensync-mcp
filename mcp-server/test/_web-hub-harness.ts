// Shared fixture for the in-process routing tests (web_dispatch*.test.ts, web_step_gate.test.ts).
//
// It runs the real bridge (routes, request(), flows, fanouts) on an ephemeral port and records every web_request
// it relays, standing in for the extension that would receive it. Import "./_isolate-data-dir.js" BEFORE this
// module: config.ts must see the temp data dir.

import { mock } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import express from "express";
import { AUTH_TOKEN } from "../config.js";
import { createWebBridge } from "../web.js";

// The cognitive gate is covered elsewhere (cognitive_gate.e2e.ts); a test that needs it turns it on with withGate().
process.env.SCREEN_SYNC_COGNITIVE_GATE = "off";

export type Relayed = { type: string; id: string; tool: string; args: Record<string, unknown>; targetInstanceId: string | null; targetBrowser?: string | null };
export type ToolReply = { ok: boolean; error?: string; code?: string; onlineProfiles?: string[]; data?: any; cognitiveGate?: any };

export const headers = { "Content-Type": "application/json", Authorization: `Bearer ${AUTH_TOKEN}` };
export const A = { instanceId: "inst-a", browserId: "inst-a", browserName: "chrome", profileEmail: "a@profile.test", webAccessEnabled: true, approvals: true };
export const B = { instanceId: "inst-b", browserId: "inst-b", browserName: "chrome", profileEmail: "b@profile.test", webAccessEnabled: true, approvals: true };
export const SOLO = { ...A, instanceId: "inst-solo", browserId: "inst-solo", profileEmail: "solo@profile.test" };

/** One bridge on an ephemeral port. Every relayed web_request is recorded, and answered as the addressed extension would. */
export async function startHub(answer: (ev: Relayed) => unknown = (ev) => ({ ranIn: ev.targetInstanceId })) {
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
        body: JSON.stringify({ id: ev.id, ok: true, data: answer(ev), ...(ev.targetInstanceId ? { instanceId: ev.targetInstanceId } : {}), browserName: ev.targetBrowser || "chrome" }),
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
    bridge,
    register: (body: Record<string, unknown>) => post("/api/web/register", body),
    call: (tool: string, args: Record<string, unknown> = {}) => post("/api/web/tool", { tool, args }) as Promise<ToolReply>,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
export type Hub = Awaited<ReturnType<typeof startHub>>;

/** A registers, goes silent past the 10-minute presence TTL, B keeps heartbeating: A is offline, B online. */
export async function selectedProfileGoesOffline(hub: Hub) {
  await hub.register(A);
  await hub.register(B);
  await hub.call("web_profile", { action: "select", profile: "a@profile.test" });
  mock.timers.tick(11 * 60_000);
  await hub.register(B);
  const status = (await hub.call("web_status")).data;
  assert.deepEqual(status.browsers.filter((b: any) => b.online).map((b: any) => b.instanceId), ["inst-b"], "fixture: only B is online");
  assert.equal(status.selectedProfile, "a@profile.test");
}

// ── the approval gate ────────────────────────────────────────────────────────────────────────────────────────

export const DANGEROUS = { url: "https://gated.example/account", selector: "button.delete-account" };
export const HARMLESS = { url: "https://gated.example/", selector: "#save-draft" };
/** A can put a request in front of a person; B is an older extension that would simply run a gated call. */
export const CAPABLE_A = { ...A, approvals: true, windows: [{ id: 10, focused: true, activeTab: { tabId: 100, url: "https://gated.example/" } }] };
export const OLD_B = { ...B, approvals: false, windows: [{ id: 20, focused: false, activeTab: { tabId: 200, url: "https://gated.example/" } }] };

export async function withGate<T>(mode: string, fn: () => Promise<T>): Promise<T> {
  process.env.SCREEN_SYNC_COGNITIVE_GATE = mode;
  try { return await fn(); } finally { process.env.SCREEN_SYNC_COGNITIVE_GATE = "off"; }
}

/** True when the relayed request was marked for a person (the extension's approval queue holds it). */
export const askedPerson = (r: Relayed) => (r.args.__gate as { needsHuman?: boolean } | undefined)?.needsHuman === true;

// ── tabs ─────────────────────────────────────────────────────────────────────────────────────────────────────

/** Each browser's own tabs, as its extension's web_tabs answers. Tab ids are only unique inside one browser. */
export const TABS: Record<string, Array<{ tabId: number; url: string; active?: boolean }>> = {
  "inst-a": [{ tabId: 100, url: "https://a.test/1" }, { tabId: 101, url: "https://a.test/2" }],
  "inst-b": [{ tabId: 200, url: "https://b.test/1" }, { tabId: 201, url: "https://b.test/2" }],
};
export const tabsAnswer = (ev: Relayed) => (ev.tool === "web_tabs" ? { tabs: TABS[String(ev.targetInstanceId)] ?? [] } : { ranIn: ev.targetInstanceId });
/** What was relayed, as `tool#tabId->instance`. */
export const sent = (hub: Hub) =>
  hub.relayed.map((r) => `${r.tool}${r.args.tabId === undefined ? "" : `#${r.args.tabId}`}->${r.targetInstanceId}`);
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** `first` heartbeats, then `last`: `last` holds the most recent heartbeat (listOnline()[0]). */
export async function heartbeats(hub: Hub, first: Record<string, unknown>, last: Record<string, unknown>) {
  await hub.register(first);
  await sleep(5);
  await hub.register(last);
  const profiles = (await hub.call("web_profile")).data.profiles;
  assert.equal(profiles[0].instanceId, last.instanceId, "fixture: the most recent heartbeat");
}
