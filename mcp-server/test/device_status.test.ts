// device-status.ts: what "the phone is connected" means, on both surfaces that report it.
//
// What used to go wrong: GET /api/device/status (connected: Boolean(frame)) and the get_device_status MCP tool
// (connected: frame !== undefined) said connected:true as soon as ANY frame file existed on disk. A phone whose last
// frame was 15 days old, or that was not even online, still read as connected - which is how the phone app showed
// "connected" while the live mirror pushed nothing. Now:
//   connected   = a frame arrived within the last 60 seconds
//   hasFrames   = at least one frame is retained (however old)
//   phoneOnline = an SSE client that opened as ?client=app is connected right now
//   state       = streaming (connected) | linked_no_frames (phoneOnline, not connected) | no_phone
//
// The pure helper is tested directly; the HTTP route and the MCP tool are tested against a real in-process hub on a
// free port with a temp data dir (never 3000, never the real data/).

import { ISOLATED_DATA_DIR } from "./_isolate-data-dir.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdirSync, writeFileSync } from "node:fs";
import http from "node:http";
import net, { type AddressInfo } from "node:net";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

async function freePort(): Promise<number> {
  const probe = net.createServer();
  probe.listen(0, "127.0.0.1");
  await once(probe, "listening");
  const port = (probe.address() as AddressInfo).port;
  await new Promise<void>((r) => probe.close(() => r()));
  return port;
}

const PORT = await freePort();
process.env.SCREEN_SYNC_PORT = String(PORT);
process.env.SCREEN_SYNC_HOST = "127.0.0.1";
process.env.SCREEN_SYNC_TOKEN = "device-status-token";
process.env.SCREEN_SYNC_COGNITIVE_GATE = "off";

const { deviceStatusFrom, phoneOnlineFrom, fetchHubPhoneOnline, FRAME_FRESH_MS } = await import("../device-status.js");
const { startHttpHub } = await import("../hub.js");
const { createMcpServer } = await import("../mcp.js");
const { DATA_DIR, FRAMES_DIR } = await import("../config.js");
type FrameMetadata = import("../storage.js").FrameMetadata;

const BASE = `http://127.0.0.1:${PORT}`;
const auth = { Authorization: "Bearer device-status-token" };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitFor(cond: () => boolean | Promise<boolean>, timeoutMs: number, what: string): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await cond())) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await sleep(10);
  }
}

const NOW = Date.parse("2026-09-30T12:00:00.000Z");
const frame = (receivedAt: string, deviceModel = "Pixel 8"): FrameMetadata => ({
  id: "frame", filename: "f.png", filePath: "/x/f.png", mimeType: "image/png", timestamp: receivedAt, receivedAt,
  deviceModel, screenResolution: { width: 1, height: 1 }, byteLength: 1,
});
const ago = (ms: number) => new Date(NOW - ms).toISOString();

test("the data dir is the isolated temp dir, never the repo's data/", () => {
  assert.equal(DATA_DIR, ISOLATED_DATA_DIR);
});

// ── the pure definition ─────────────────────────────────────────────────────────────────────────────────────────

test("states: streaming while a frame is fresh, linked_no_frames when only the link is up, otherwise no_phone", () => {
  const fresh = [frame(ago(5_000))];
  const old = [frame(ago(15 * 24 * 3600_000))];

  const streaming = deviceStatusFrom(fresh, true, NOW);
  assert.deepEqual([streaming.state, streaming.connected, streaming.hasFrames, streaming.phoneOnline], ["streaming", true, true, true]);

  // Frames still arriving means streaming even if the phone's stream is momentarily down (it is reconnecting).
  const noLink = deviceStatusFrom(fresh, false, NOW);
  assert.deepEqual([noLink.state, noLink.connected, noLink.phoneOnline], ["streaming", true, false]);

  const linked = deviceStatusFrom(old, true, NOW);
  assert.deepEqual([linked.state, linked.connected, linked.hasFrames, linked.phoneOnline], ["linked_no_frames", false, true, true]);

  const gone = deviceStatusFrom(old, false, NOW);
  assert.deepEqual([gone.state, gone.connected, gone.hasFrames, gone.phoneOnline], ["no_phone", false, true, false]);

  const linkedEmpty = deviceStatusFrom([], true, NOW);
  assert.deepEqual([linkedEmpty.state, linkedEmpty.connected, linkedEmpty.hasFrames, linkedEmpty.retainedFrames], ["linked_no_frames", false, false, 0]);

  const nothing = deviceStatusFrom([], false, NOW);
  assert.deepEqual([nothing.state, nothing.connected, nothing.hasFrames, nothing.lastFrameAt, nothing.lastFrameAgeMs, nothing.deviceModel], ["no_phone", false, false, null, null, null]);
});

test("the old bug: a 15-day-old frame on disk is NOT a connected phone", () => {
  const s = deviceStatusFrom([frame(ago(15 * 24 * 3600_000), "Old Pixel")], false, NOW);
  assert.equal(s.connected, false, "connected:true here is exactly what the phone app used to show");
  assert.equal(s.stale, true);
  assert.equal(s.hasFrames, true);
  assert.equal(s.retainedFrames, 1);
  assert.equal(s.deviceModel, "Old Pixel", "the model of the last known device is still reported");
  assert.equal(s.lastFrameAgeMs, 15 * 24 * 3600_000);
});

test("'within the last 60 seconds' is inclusive at the boundary", () => {
  assert.equal(FRAME_FRESH_MS, 60_000);
  assert.equal(deviceStatusFrom([frame(ago(59_999))], false, NOW).connected, true);
  assert.equal(deviceStatusFrom([frame(ago(60_000))], false, NOW).connected, true);
  assert.equal(deviceStatusFrom([frame(ago(60_001))], false, NOW).connected, false);
});

test("an unreadable receivedAt is never treated as fresh", () => {
  const s = deviceStatusFrom([frame("not a date")], true, NOW);
  assert.equal(s.connected, false);
  assert.equal(s.lastFrameAgeMs, null);
  assert.equal(s.hasFrames, true);
  assert.equal(s.state, "linked_no_frames");
});

test("every field the old responses had is still there, with the same meaning", () => {
  const s = deviceStatusFrom([frame(ago(1_000), "Pixel 8"), frame(ago(9_000))], false, NOW);
  assert.equal(s.transport, "local-http");
  assert.equal(s.lastFrameAt, ago(1_000));
  assert.equal(s.lastFrameAgeMs, 1_000);
  assert.equal(s.stale, false);
  assert.equal(s.deviceModel, "Pixel 8");
  assert.equal(s.retainedFrames, 2);
  for (const key of ["connected", "transport", "lastFrameAt", "lastFrameAgeMs", "stale", "deviceModel", "retainedFrames", "hasFrames", "phoneOnline", "state"]) {
    assert.ok(key in s, key);
  }
});

test("phoneOnline counts only streams that opened as the phone app", () => {
  assert.equal(phoneOnlineFrom([]), false);
  assert.equal(phoneOnlineFrom([{ kind: "extension" }, { kind: null }]), false, "a browser extension or an anonymous stream is not the phone");
  assert.equal(phoneOnlineFrom([{ kind: "extension" }, { kind: "app" }]), true);
});

// ── fetchHubPhoneOnline: what the stdio MCP server can learn about the hub ─────────────────────────────────────

test("fetchHubPhoneOnline is false for a hub that is down, refuses the token, or predates phoneOnline", async () => {
  const dead = await freePort(); // nothing listens there now
  assert.equal(await fetchHubPhoneOnline(`http://127.0.0.1:${dead}`, "t"), false);

  const older = http.createServer((_req, res) => { res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ connected: true })); });
  older.listen(0, "127.0.0.1");
  await once(older, "listening");
  try {
    assert.equal(await fetchHubPhoneOnline(`http://127.0.0.1:${(older.address() as AddressInfo).port}`, "t"), false, "an older hub says nothing about the phone's link");
  } finally {
    older.closeAllConnections();
    await new Promise<void>((r) => older.close(() => r()));
  }
});

test("fetchHubPhoneOnline is false when the hub answers 401, even if the body claims the phone is online", async () => {
  let seenAuth: string | undefined;
  const strict = http.createServer((req, res) => {
    seenAuth = req.headers.authorization;
    res.statusCode = 401;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ phoneOnline: true })); // a refusal must win over whatever the body says
  });
  strict.listen(0, "127.0.0.1");
  await once(strict, "listening");
  try {
    assert.equal(await fetchHubPhoneOnline(`http://127.0.0.1:${(strict.address() as AddressInfo).port}`, "t"), false);
    assert.equal(seenAuth, "Bearer t", "the caller's token is sent as a Bearer header");
  } finally {
    strict.closeAllConnections();
    await new Promise<void>((r) => strict.close(() => r()));
  }
});

// ── the real hub and the real MCP tool ──────────────────────────────────────────────────────────────────────────

/** Opens /api/events the way the phone (?client=app) or the extension does; abort() closes it. */
async function openStream(client: "app" | "extension"): Promise<{ abort: () => void }> {
  const ctrl = new AbortController();
  const res = await fetch(`${BASE}/api/events?client=${client}`, { headers: auth, signal: ctrl.signal });
  assert.equal(res.status, 200);
  const reader = (res.body as ReadableStream<Uint8Array>).getReader();
  void (async () => { for (;;) { const { done } = await reader.read(); if (done) return; } })().catch(() => { /* aborted */ });
  return { abort: () => ctrl.abort() };
}

// A 1x1 PNG: what the phone's upload route accepts.
const PNG_1X1 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

test("GET /api/device/status and the get_device_status tool agree through every state of a phone's day", async () => {
  const hub = await startHttpHub();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const mcp = createMcpServer();
  await mcp.connect(serverTransport);
  const client = new Client({ name: "device-status-test", version: "1.0.0" });
  await client.connect(clientTransport);

  const httpStatus = async () => (await (await fetch(`${BASE}/api/device/status`, { headers: auth })).json()) as Record<string, unknown>;
  const toolStatus = async () => {
    const r = await client.callTool({ name: "get_device_status", arguments: {} });
    assert.notEqual(r.isError, true);
    return JSON.parse(String((r.content as Array<{ text?: string }>)[0]?.text)) as Record<string, unknown>;
  };
  /** Both surfaces must say the same thing about the same moment. */
  const both = async () => {
    const [h, t] = [await httpStatus(), await toolStatus()];
    for (const key of ["connected", "hasFrames", "phoneOnline", "state", "retainedFrames", "lastFrameAt", "transport", "deviceModel", "stale"]) {
      assert.deepEqual(h[key], t[key], `${key}: the HTTP route and the MCP tool must agree`);
    }
    return h;
  };
  const pick = (s: Record<string, unknown>) => [s.state, s.connected, s.hasFrames, s.phoneOnline];
  let app: { abort: () => void } | undefined;
  let ext: { abort: () => void } | undefined;
  try {
    // 1. A fresh hub: nothing has happened.
    assert.deepEqual(pick(await both()), ["no_phone", false, false, false]);

    // 2. A browser extension connects: not the phone, so still no phone.
    ext = await openStream("extension");
    await sleep(50);
    assert.deepEqual(pick(await both()), ["no_phone", false, false, false], "an extension stream is not a phone");
    ext.abort();

    // 3. The phone opens its stream but has not captured anything.
    app = await openStream("app");
    await waitFor(async () => (await httpStatus()).phoneOnline === true, 2000, "the phone's stream to register");
    assert.deepEqual(pick(await both()), ["linked_no_frames", false, false, true]);

    // 4. An old frame sits on disk (15 days). The phone is linked but nothing is flowing: NOT connected.
    mkdirSync(FRAMES_DIR, { recursive: true });
    const oldAt = new Date(Date.now() - 15 * 24 * 3600_000).toISOString();
    const oldFrame: FrameMetadata = { ...frame(oldAt, "Old Pixel"), id: "old-frame", filePath: path.join(FRAMES_DIR, "old-frame.png") };
    writeFileSync(oldFrame.filePath, Buffer.from(PNG_1X1, "base64"));
    writeFileSync(path.join(FRAMES_DIR, "old-frame.json"), JSON.stringify(oldFrame));
    const stale = await both();
    assert.deepEqual(pick(stale), ["linked_no_frames", false, true, true], "the old code said connected:true here");
    assert.equal(stale.stale, true);
    assert.equal(stale.retainedFrames, 1);

    // 5. The phone goes away: still not connected, and now there is no phone at all.
    app.abort();
    app = undefined;
    await waitFor(async () => (await httpStatus()).phoneOnline === false, 2000, "the phone's stream to drop");
    assert.deepEqual(pick(await both()), ["no_phone", false, true, false], "an old frame on disk with no phone: the old code said connected:true");

    // 6. A frame arrives through the real upload route: streaming, connected, and a moment ago is enough.
    const up = await fetch(`${BASE}/api/screens/upload`, {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ imageDataUrl: `data:image/png;base64,${PNG_1X1}`, filename: "live.png", timestamp: new Date().toISOString(), deviceModel: "Pixel 8" }),
    });
    assert.equal(up.status, 201);
    const live = await both();
    assert.deepEqual(pick(live), ["streaming", true, true, false]);
    assert.equal(live.deviceModel, "Pixel 8", "the newest frame's device, not the old one");
    assert.equal(live.retainedFrames, 2);
    assert.equal(live.stale, false);
    assert.ok((live.lastFrameAgeMs as number) < 5_000);

    // 7. And with the phone back on its stream too.
    app = await openStream("app");
    await waitFor(async () => (await httpStatus()).phoneOnline === true, 2000, "the phone to reconnect");
    assert.deepEqual(pick(await both()), ["streaming", true, true, true]);
  } finally {
    app?.abort();
    ext?.abort();
    await client.close().catch(() => undefined);
    await hub.stop().catch(() => undefined);
  }
});

test("GET /api/device/status still needs the bearer token", async () => {
  const hub = await startHttpHub();
  try {
    assert.equal((await fetch(`${BASE}/api/device/status`)).status, 401);
    assert.equal((await fetch(`${BASE}/api/device/status`, { headers: { Authorization: "Bearer nope" } })).status, 401);
    assert.equal((await fetch(`${BASE}/api/device/status`, { headers: auth })).status, 200);
  } finally {
    await hub.stop().catch(() => undefined);
  }
});
