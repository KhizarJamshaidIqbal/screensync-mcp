// S1: a call to a browser whose live event stream (SSE) is down fails fast with BROWSER_STREAM_DOWN.
//
// Requests reach the extension only over its SSE stream, but its HTTP heartbeat keeps it "online" for 90s after
// that stream died, so the hub used to relay the call into nothing and wait out the whole 45-65s timeout. Now
// the tool route and request() (flows, replay, fanout) give the stream a short grace to come back, then refuse
// with a retryable 503 before anything is relayed or counted. Without stream information (no `presence`), the
// bridge relays exactly as before.
//
// Also: bridge.replayPayload(), what a reconnecting extension's Last-Event-ID replay gets for a web_request.

import "./_isolate-data-dir.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import express from "express";
import { A, headers, sleep, startHub } from "./_web-hub-harness.js";
import { createWebBridge } from "../web.js";

const ATTRIBUTED_A = { ...A, sseAttribution: true };
const CLICK = { selector: "#save" };

test("an attributed browser whose stream is down: BROWSER_STREAM_DOWN after the grace, nothing relayed", async () => {
  const asked: string[] = [];
  const hub = await startHub(undefined, { presence: (id) => { asked.push(id); return false; }, streamGraceMs: 100 });
  try {
    await hub.register(ATTRIBUTED_A);
    const startedAt = Date.now();
    const r = await hub.call("web_click", CLICK);
    const took = Date.now() - startedAt;
    assert.equal(r.ok, false);
    assert.equal(r.code, "BROWSER_STREAM_DOWN", JSON.stringify(r));
    assert.equal((r as { retryable?: boolean }).retryable, true);
    assert.match(String(r.error), /live event stream \(SSE\) to the hub is down/);
    assert.equal(r.data?.instanceId, "inst-a");
    assert.ok(took >= 90 && took < 1_500, `fails after the 100ms grace, not a 45s timeout (took ${took}ms)`);
    assert.deepEqual(hub.relayed, [], "nothing was sent to a browser that cannot hear it");
    assert.ok(asked.includes("inst-a"), "the target's own stream was asked about");
  } finally {
    await hub.close();
  }
});

test("the HTTP status is 503 (a caller can tell it from a tool that ran and failed) and it is retryable", async () => {
  const bridge = createWebBridge(() => {}, () => 1, { presence: () => false, streamGraceMs: 50 });
  const app = express();
  app.use(express.json());
  bridge.registerRoutes(app);
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    await fetch(`${base}/api/web/register`, { method: "POST", headers, body: JSON.stringify(ATTRIBUTED_A) });
    const res = await fetch(`${base}/api/web/tool`, { method: "POST", headers, body: JSON.stringify({ tool: "web_click", args: CLICK }) });
    assert.equal(res.status, 503);
    const body = (await res.json()) as Record<string, unknown>;
    assert.equal(body.code, "BROWSER_STREAM_DOWN");
    assert.equal(body.retryable, true);
    assert.equal(body.success, false);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
});

test("presence unknown (null) or no presence information at all: relayed as before", async () => {
  for (const opts of [{ presence: () => null, streamGraceMs: 100 }, {}]) {
    const hub = await startHub(undefined, opts);
    try {
      await hub.register(ATTRIBUTED_A);
      const r = await hub.call("web_click", CLICK);
      assert.equal(r.ok, true, JSON.stringify(r));
      assert.deepEqual(r.data, { ranIn: "inst-a" });
      assert.equal(hub.relayed.length, 1);
    } finally {
      await hub.close();
    }
  }
});

test("a stream that comes back within the grace: the call goes through", async () => {
  let up = false;
  const hub = await startHub(undefined, { presence: () => up, streamGraceMs: 3_000 });
  try {
    await hub.register(ATTRIBUTED_A);
    setTimeout(() => { up = true; }, 200);
    const startedAt = Date.now();
    const r = await hub.call("web_click", CLICK);
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(hub.relayed.length, 1);
    assert.ok(Date.now() - startedAt < 2_000, "relayed as soon as the stream is back, not at the end of the grace");
  } finally {
    await hub.close();
  }
});

test("an older extension (no sseAttribution) is judged by whether any stream is open", async () => {
  let count = 0;
  const hub = await startHub(undefined, { presence: () => false, streamGraceMs: 100, sseCount: () => count });
  try {
    await hub.register(A); // no sseAttribution: its own stream cannot be told apart
    const down = await hub.call("web_click", CLICK);
    assert.equal(down.code, "BROWSER_STREAM_DOWN", "no stream at all");
    count = 1;
    const up = await hub.call("web_click", CLICK);
    assert.equal(up.ok, true, "some stream is open: the old behaviour, presence(id) is not consulted");
    assert.equal(hub.relayed.length, 1);
  } finally {
    await hub.close();
  }
});

test("request() is gated too: a web_fanout step to a browser with a dead stream fails fast", async () => {
  const hub = await startHub(undefined, { presence: () => false, streamGraceMs: 100 });
  try {
    await hub.register(ATTRIBUTED_A);
    const r = await hub.call("web_fanout", { tool: "web_click", args: CLICK });
    assert.equal(r.ok, false);
    assert.equal(r.data.results.length, 1);
    assert.equal(r.data.results[0].code, "BROWSER_STREAM_DOWN", JSON.stringify(r.data.results));
    assert.equal(r.data.results[0].retryable, true);
    assert.deepEqual(hub.relayed, []);
  } finally {
    await hub.close();
  }
});

test("replayPayload: a pending web_request replays whole with its current deadline; an answered one is skipped", async () => {
  const relayed: Array<Record<string, any>> = [];
  const bridge = createWebBridge((p) => { relayed.push(p as Record<string, any>); }, () => 1, { presence: () => true });
  const app = express();
  app.use(express.json({ limit: "5mb" }));
  bridge.registerRoutes(app);
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const post = (route: string, body: unknown) => fetch(`${base}${route}`, { method: "POST", headers, body: JSON.stringify(body) });
  try {
    await post("/api/web/register", ATTRIBUTED_A);
    const image = `data:image/png;base64,${"A".repeat(4_000)}`;
    const call = post("/api/web/tool", { tool: "web_upload_file", args: { selector: "#f", dataUrl: image }, timeoutMs: 10_000 });
    const t0 = Date.now();
    while (!relayed.some((p) => p.type === "web_request") && Date.now() - t0 < 2_000) await sleep(10);
    const live = relayed.find((p) => p.type === "web_request")!;
    assert.ok(live, "fixture: the request was relayed");

    // The ring keeps a sanitized copy (images truncated); the replay must send the real args.
    const ringCopy = { seq: 7, at: new Date().toISOString(), payload: { ...live, args: { selector: "#f", dataUrl: "data:image/png;base64,AAAA... [base64 truncated]" } } };
    const replayed = bridge.replayPayload(ringCopy)!;
    assert.equal(replayed.id, live.id);
    assert.equal((replayed.args as Record<string, unknown>).dataUrl, image, "full args, not the truncated ring copy");
    assert.equal(replayed.deadlineAt, live.deadlineAt);
    // Relative time left, on the hub's clock: the extension trusts it over deadlineAt (clocks can be skewed).
    assert.equal(live.remainingMs, 10_000, "the live event carries the whole wait as remainingMs");
    assert.ok(Number(replayed.remainingMs) > 8_000 && Number(replayed.remainingMs) <= 10_000, `replay remainingMs ${replayed.remainingMs}`);

    // The extension asks for more time (a person is being asked): the replay carries the new deadline.
    const awaiting = await post("/api/web/awaiting", { id: live.id, ms: 30_000 });
    assert.equal(awaiting.status, 200);
    const later = bridge.replayPayload(ringCopy)!;
    assert.ok(Number(later.deadlineAt) > Number(live.deadlineAt) + 20_000, `deadline moved: ${live.deadlineAt} -> ${later.deadlineAt}`);
    assert.ok(Number(later.remainingMs) > 20_000, `remainingMs follows the moved deadline: ${later.remainingMs}`);

    // Answered: never replayed again.
    await post("/api/web/result", { id: live.id, ok: true, data: { uploaded: true }, instanceId: "inst-a", browserName: "chrome" });
    assert.equal(((await (await call).json()) as { ok: boolean }).ok, true);
    assert.equal(bridge.replayPayload(ringCopy), null);

    // Every other event replays as the ring holds it.
    const frame = { seq: 8, at: "", payload: { type: "web_event", data: { url: "https://x.test/" } } };
    assert.deepEqual(bridge.replayPayload(frame), frame.payload);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
});

test("/api/web/awaiting never shortens a longer deadline (a long-wait call that also asks a person)", async () => {
  const relayed: Array<Record<string, any>> = [];
  const bridge = createWebBridge((p) => { relayed.push(p as Record<string, any>); });
  const app = express();
  app.use(express.json());
  bridge.registerRoutes(app);
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const post = (route: string, body: unknown) => fetch(`${base}${route}`, { method: "POST", headers, body: JSON.stringify(body) });
  try {
    await post("/api/web/register", A);
    const call = post("/api/web/tool", { tool: "web_takeover", args: { reason: "login", timeoutMs: 200_000 } });
    const t0 = Date.now();
    while (!relayed.some((p) => p.type === "web_request") && Date.now() - t0 < 2_000) await sleep(10);
    const live = relayed.find((p) => p.type === "web_request")!;
    assert.ok(live.deadlineAt - Date.now() > 190_000, "web_takeover waits its own 200s budget, not the 65s clamp");
    const res = (await (await post("/api/web/awaiting", { id: live.id, ms: 5_000 })).json()) as { waitMs: number };
    assert.ok(res.waitMs > 190_000, `more time, never less (waitMs ${res.waitMs})`);
    await post("/api/web/result", { id: live.id, ok: true, data: {}, instanceId: "inst-a", browserName: "chrome" });
    await call;
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
});

test("close(): a pending long-wait call is answered HUB_STOPPING at once, and later calls are refused", async () => {
  const relayed: Array<Record<string, any>> = [];
  const bridge = createWebBridge((p) => { relayed.push(p as Record<string, any>); });
  const app = express();
  app.use(express.json());
  bridge.registerRoutes(app);
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const post = (route: string, body: unknown) => fetch(`${base}${route}`, { method: "POST", headers, body: JSON.stringify(body) });
  try {
    await post("/api/web/register", A);
    // web_takeover waits up to 10 minutes; a hub stop used to wait for it (server.close() awaits active requests).
    const call = post("/api/web/tool", { tool: "web_takeover", args: { reason: "login", timeoutMs: 600_000 } });
    const t0 = Date.now();
    while (!relayed.some((p) => p.type === "web_request") && Date.now() - t0 < 2_000) await sleep(10);
    assert.ok(relayed.some((p) => p.type === "web_request"), "fixture: the call is pending");
    const stoppedAt = Date.now();
    bridge.close();
    const body = (await (await call).json()) as Record<string, unknown>;
    assert.ok(Date.now() - stoppedAt < 1_000, "answered at once, not after the call's 10-minute budget");
    assert.equal(body.code, "HUB_STOPPING");
    assert.equal(body.retryable, true);
    const after = (await (await post("/api/web/tool", { tool: "web_click", args: CLICK })).json()) as Record<string, unknown>;
    assert.equal(after.code, "HUB_STOPPING", "nothing new is relayed once closed");
    assert.equal(relayed.filter((p) => p.type === "web_request").length, 1);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
});
