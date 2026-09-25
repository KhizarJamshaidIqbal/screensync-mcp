// hub-sse.ts: the hub's /api/events streams, in process on an ephemeral port.
//
// What used to go wrong (1.14.0): the keepalive write had no try/catch, a response had no 'error' listener
// (index.ts exits on an uncaught exception), clients were only forgotten on req 'close', a reader that stopped
// reading made the hub buffer every broadcast for it forever, streams were anonymous (the phone's stream made
// every browser look connected), and Last-Event-ID replay sent the NEWEST 100 events after the cursor, so a
// long gap silently lost its oldest events.

import "./_isolate-data-dir.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter, once } from "node:events";
import http from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { createSseHub, sanitizeInstanceId, type SseHub, type SseHubOptions } from "../hub-sse.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitFor(cond: () => boolean, timeoutMs: number, what: string): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!cond()) {
    if (Date.now() > deadline) throw new Error(`timed out after ${timeoutMs}ms waiting for ${what}`);
    await sleep(5);
  }
}

type Served = { sse: SseHub; base: string; close: () => Promise<void> };

async function serve(opts: Partial<SseHubOptions> = {}): Promise<Served> {
  const sse = createSseHub({
    keepaliveMs: 60_000,
    isAuthorized: (h) => h === "Bearer t",
    welcome: () => ({ type: "agent_connect", agentName: "Test" }),
    ...opts,
  });
  const app = express();
  sse.mount(app);
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    sse,
    base,
    close: async () => {
      sse.close();
      server.closeAllConnections();
      await new Promise<void>((r) => server.close(() => r()));
    },
  };
}

type Reader = { text: () => string; abort: () => void; done: Promise<void> };

/** A client that reads everything the hub sends and keeps it (or only hands each chunk to `onChunk`). */
async function connect(base: string, query = "", headers: Record<string, string> = {}, onChunk?: (text: string) => void): Promise<Reader> {
  const ctrl = new AbortController();
  const res = await fetch(`${base}/api/events${query}`, { headers: { Authorization: "Bearer t", ...headers }, signal: ctrl.signal });
  assert.equal(res.status, 200);
  let buf = "";
  const reader = (res.body as ReadableStream<Uint8Array>).getReader();
  const decoder = new TextDecoder();
  const done = (async () => {
    for (;;) {
      const { done: end, value } = await reader.read();
      if (end) return;
      const text = decoder.decode(value, { stream: true });
      if (onChunk) onChunk(text);
      else buf += text;
    }
  })().catch(() => { /* aborted */ });
  return { text: () => buf, abort: () => ctrl.abort(), done };
}

/** Frames of a stream: comments dropped, each event as {id, data}. */
function frames(text: string): Array<{ id: number | null; data: any }> {
  return text.split("\n\n").filter((f) => f.includes("data: ")).map((f) => {
    const lines = f.split("\n");
    const id = lines.find((l) => l.startsWith("id: "));
    return { id: id ? Number(id.slice(4)) : null, data: JSON.parse(lines.find((l) => l.startsWith("data: "))!.slice(6)) };
  });
}

test("a stream opens with ': connected' and the welcome, and gets a keepalive every keepaliveMs", async () => {
  const hub = await serve({ keepaliveMs: 50 });
  try {
    const c = await connect(hub.base);
    await waitFor(() => c.text().includes(": keepalive"), 1000, "a keepalive");
    assert.ok(c.text().startsWith(": connected\n\n"), c.text().slice(0, 40));
    assert.deepEqual(frames(c.text())[0], { id: null, data: { type: "agent_connect", agentName: "Test" } }, "the welcome carries no id");
    const at = c.text().split(": keepalive").length;
    await waitFor(() => c.text().split(": keepalive").length >= at + 2, 1000, "two more keepalives");
    c.abort();
  } finally {
    await hub.close();
  }
});

test("a broadcast reaches every stream as 'id: <seq>' + data, and the seq is returned", async () => {
  const hub = await serve();
  try {
    const a = await connect(hub.base);
    const b = await connect(hub.base, "?client=app");
    const seq = hub.sse.broadcast({ type: "frame", n: 1 });
    for (const c of [a, b]) await waitFor(() => c.text().includes(`id: ${seq}\ndata: {"type":"frame","n":1}\n\n`), 1000, "the frame");
    a.abort();
    b.abort();
  } finally {
    await hub.close();
  }
});

test("a missing or wrong token is refused with 401 and no stream", async () => {
  const hub = await serve();
  try {
    const res = await fetch(`${hub.base}/api/events`, { headers: { Authorization: "Bearer nope" } });
    assert.equal(res.status, 401);
    assert.equal((await res.json()).success, false);
    assert.equal(hub.sse.count(), 0);
  } finally {
    await hub.close();
  }
});

test("attribution: ?client= and ?instanceId= say whose stream it is; hasInstance ignores case", async () => {
  const hub = await serve();
  try {
    const ext = await connect(hub.base, "?client=extension&instanceId=inst_chrome_lz1_ab12cd34");
    const phone = await connect(hub.base, "?client=app");
    const anon = await connect(hub.base, "?client=robot&instanceId=%20%20");
    await waitFor(() => hub.sse.count() === 3, 1000, "three streams");
    assert.equal(hub.sse.extensionCount(), 1);
    assert.equal(hub.sse.hasInstance("inst_chrome_lz1_ab12cd34"), true);
    assert.equal(hub.sse.hasInstance("INST_CHROME_LZ1_AB12CD34"), true);
    assert.equal(hub.sse.hasInstance("inst_other"), false);
    assert.equal(hub.sse.hasInstance(""), false);
    const kinds = hub.sse.clients().map((c) => `${c.kind}:${c.instanceId}`).sort();
    assert.deepEqual(kinds, ["app:null", "extension:inst_chrome_lz1_ab12cd34", "null:null"]);
    for (const c of [ext, phone, anon]) c.abort();
  } finally {
    await hub.close();
  }
});

test("instance ids are reduced to [A-Za-z0-9._:-] and at most 128 chars", () => {
  assert.equal(sanitizeInstanceId("inst_edge_x.1:2-3"), "inst_edge_x.1:2-3");
  assert.equal(sanitizeInstanceId("bad id<script>"), "badidscript");
  assert.equal(sanitizeInstanceId("a".repeat(300))!.length, 128);
  assert.equal(sanitizeInstanceId("<>"), null);
  assert.equal(sanitizeInstanceId(["x"]), null);
  assert.equal(sanitizeInstanceId(undefined), null);
});

test("a client that goes away is forgotten: count and hasInstance drop", async () => {
  const hub = await serve();
  try {
    const c = await connect(hub.base, "?client=extension&instanceId=gone-soon");
    await waitFor(() => hub.sse.count() === 1, 1000, "the stream");
    c.abort();
    await waitFor(() => hub.sse.count() === 0, 2000, "the count to drop after the client aborted");
    assert.equal(hub.sse.hasInstance("gone-soon"), false);
    assert.doesNotThrow(() => hub.sse.broadcast({ type: "frame" }));
  } finally {
    await hub.close();
  }
});

// A response the hub still holds after its socket died: the broadcaster must drop it, never throw.
class FakeRes extends EventEmitter {
  destroyed = false;
  writableEnded = false;
  writableLength = 0;
  chunks: string[] = [];
  throwOnWrite = false;
  socket = { setNoDelay: () => undefined };
  writeHead() { return this; }
  flushHeaders() {}
  status() { return this; }
  json() { return this; }
  write(chunk: string) {
    if (this.throwOnWrite) throw new Error("write after end");
    this.chunks.push(chunk);
    return true;
  }
  end() { this.writableEnded = true; }
  destroy() { this.destroyed = true; }
}

function fakeClient(sse: SseHub, query: Record<string, string> = {}) {
  let handler: ((req: any, res: any) => void) | undefined;
  sse.mount({ get: (_path: string, h: any) => { handler = h; } } as any);
  const req = Object.assign(new EventEmitter(), { query, headers: {}, header: () => "Bearer t" });
  const res = new FakeRes();
  handler!(req, res);
  return { req, res };
}

test("writing to a destroyed or throwing client does not throw; the client is dropped", async () => {
  const sse = createSseHub({ keepaliveMs: 60_000, isAuthorized: () => true });
  try {
    const dead = fakeClient(sse, { client: "extension", instanceId: "dead" });
    const broken = fakeClient(sse, { client: "extension", instanceId: "broken" });
    const fine = fakeClient(sse);
    assert.equal(sse.count(), 3);
    dead.res.destroyed = true;
    broken.res.throwOnWrite = true;
    assert.doesNotThrow(() => sse.broadcast({ type: "frame", n: 7 }));
    assert.equal(sse.count(), 1, "the destroyed and the throwing client are gone");
    assert.equal(sse.hasInstance("dead"), false);
    assert.equal(sse.hasInstance("broken"), false);
    assert.equal(broken.res.destroyed, true, "a client whose write threw is destroyed");
    assert.ok(fine.res.chunks.some((c) => c.includes('"n":7')), "the healthy client still got the event");
    // An 'error' on a response must have a listener (an uncaught one exits the hub) and removes it once.
    assert.doesNotThrow(() => fine.res.emit("error", new Error("ECONNRESET")));
    assert.equal(sse.count(), 0);
    fine.res.emit("close");
    fine.req.emit("close");
    assert.equal(sse.count(), 0, "every close path is idempotent");
  } finally {
    sse.close();
  }
});

test("backpressure is judged on the backlog before a write: one large event never evicts a reader", () => {
  const sse = createSseHub({ keepaliveMs: 60_000, isAuthorized: () => true, maxBufferedBytes: 100 });
  try {
    const { res } = fakeClient(sse, { client: "app" });
    sse.broadcast({ type: "big", blob: "y".repeat(10_000) });
    assert.equal(sse.count(), 1, "a chunk larger than the limit is still delivered");
    res.writableLength = 100;
    sse.broadcast({ type: "small" });
    assert.equal(sse.count(), 1, "a backlog AT the limit is tolerated");
    res.writableLength = 101;
    sse.broadcast({ type: "small" });
    assert.equal(sse.count(), 0, "a backlog over the limit evicts");
    assert.equal(res.destroyed, true);
  } finally {
    sse.close();
  }
});

test("a reader that stops reading is evicted above maxBufferedBytes while the others keep receiving", async () => {
  const hub = await serve({ maxBufferedBytes: 64 * 1024 });
  const paused: http.ClientRequest[] = [];
  try {
    // The stalled client: an HTTP response we never read, so the TCP window fills and the hub's queue grows.
    await new Promise<void>((resolve, reject) => {
      const req = http.get(`${hub.base}/api/events?client=extension&instanceId=stalled`, { headers: { Authorization: "Bearer t" } }, (res) => {
        res.pause();
        resolve();
      });
      req.on("error", () => { /* destroyed by the hub, as intended */ });
      req.setTimeout(0);
      paused.push(req);
      setTimeout(() => reject(new Error("stalled client never connected")), 2000);
    });
    // `live` reads everything but keeps only a tail; each event is awaited before the next is sent, so only
    // the stalled client's queue grows.
    let lastSeen = -1;
    let tail = "";
    const live = await connect(hub.base, "?client=extension&instanceId=live", {}, (text) => {
      const window = (tail + text).replace(/x{64,}/g, "x");
      for (const m of window.matchAll(/"n":(\d+),/g)) lastSeen = Math.max(lastSeen, Number(m[1]));
      tail = window.slice(-256);
    });
    await waitFor(() => hub.sse.count() === 2, 1000, "both streams");
    const blob = "x".repeat(256 * 1024);
    let n = 0;
    for (; n < 400 && hub.sse.hasInstance("stalled"); n++) {
      hub.sse.broadcast({ type: "bulk", n, blob });
      await waitFor(() => lastSeen >= n, 5000, `live client to receive bulk ${n}`);
    }
    assert.equal(hub.sse.hasInstance("stalled"), false, `the stalled reader was never evicted after ${n} x 256KB`);
    assert.equal(hub.sse.hasInstance("live"), true, "the reading client is kept");
    assert.equal(hub.sse.count(), 1);
    const seq = hub.sse.broadcast({ type: "after_eviction" });
    await waitFor(() => tail.includes(`id: ${seq}\ndata: {"type":"after_eviction"}`), 2000, "the event after the eviction");
    live.abort();
  } finally {
    for (const r of paused) r.destroy();
    await hub.close();
  }
});

test("Last-Event-ID replay: oldest first, past the old 100-event limit, replayed:true, null skips, then the welcome", async () => {
  const hub = await serve();
  try {
    const seqs: number[] = [];
    for (let n = 0; n < 150; n++) seqs.push(hub.sse.broadcast({ type: "replay_probe", n }));
    // A payload function can rewrite or drop what is replayed (the web bridge drops answered web_requests).
    hub.sse.setReplayPayload((e) => {
      if (e.payload.type !== "replay_probe") return e.payload;
      if (e.payload.n === 3) return null;
      if (e.payload.n === 4) throw new Error("a broken payload function skips, it does not break the stream");
      return { ...e.payload, live: true };
    });
    const c = await connect(hub.base, "", { "Last-Event-ID": String(seqs[0]) });
    await waitFor(() => frames(c.text()).some((f) => f.data.type === "agent_connect"), 2000, "the welcome");
    const got = frames(c.text());
    const probes = got.filter((f) => f.data.type === "replay_probe");
    assert.equal(probes.length, 147, "events 1..149 after the cursor, minus the two skipped");
    assert.deepEqual(probes.slice(0, 3).map((f) => f.data.n), [1, 2, 5], "oldest first; 3 (null) and 4 (threw) skipped");
    assert.deepEqual(probes.map((f) => f.id), [...probes.map((f) => f.id)].sort((a, b) => a! - b!), "ascending ids");
    assert.equal(probes[0].id, seqs[1]);
    assert.ok(probes.every((f) => f.data.replayed === true && f.data.live === true), "replayed:true on every replayed event");
    assert.equal(got[got.length - 1].data.type, "agent_connect", "the welcome comes after the replay");
    assert.equal(got[got.length - 1].data.replayed, undefined);
    // ?lastEventId= works like the header.
    const q = await connect(hub.base, `?lastEventId=${seqs[148]}`);
    await waitFor(() => frames(q.text()).some((f) => f.data.type === "agent_connect"), 2000, "the welcome");
    assert.deepEqual(frames(q.text()).filter((f) => f.data.type === "replay_probe").map((f) => f.data.n), [149]);
    c.abort();
    q.abort();
  } finally {
    await hub.close();
  }
});

test("replay defaults to the ring payload when no replayPayload is set", async () => {
  const hub = await serve();
  try {
    const first = hub.sse.broadcast({ type: "default_probe", n: 0 });
    hub.sse.broadcast({ type: "default_probe", n: 1 });
    const c = await connect(hub.base, "", { "Last-Event-ID": String(first) });
    await waitFor(() => frames(c.text()).some((f) => f.data.type === "agent_connect"), 2000, "the welcome");
    assert.deepEqual(frames(c.text()).filter((f) => f.data.type === "default_probe").map((f) => f.data), [{ type: "default_probe", n: 1, replayed: true }]);
    c.abort();
  } finally {
    await hub.close();
  }
});

test("maxClients: the oldest stream is ended to make room", async () => {
  const hub = await serve({ maxClients: 2 });
  try {
    const a = await connect(hub.base, "?client=extension&instanceId=first");
    const b = await connect(hub.base, "?client=extension&instanceId=second");
    const c = await connect(hub.base, "?client=extension&instanceId=third");
    await waitFor(() => hub.sse.hasInstance("third"), 1000, "the third stream");
    assert.equal(hub.sse.count(), 2);
    assert.equal(hub.sse.hasInstance("first"), false);
    await a.done;
    for (const r of [b, c]) r.abort();
  } finally {
    await hub.close();
  }
});

test("close() clears the keepalive timer, ends every stream and refuses new ones", async () => {
  const created: unknown[] = [];
  const cleared = new Set<unknown>();
  const realSet = globalThis.setInterval;
  const realClear = globalThis.clearInterval;
  (globalThis as any).setInterval = (...args: Parameters<typeof setInterval>) => {
    const h = realSet(...args);
    created.push(h);
    return h;
  };
  (globalThis as any).clearInterval = (h: any) => {
    cleared.add(h);
    return realClear(h);
  };
  let hub: Served;
  try {
    hub = await serve({ keepaliveMs: 20 });
  } finally {
    globalThis.setInterval = realSet;
    globalThis.clearInterval = realClear;
  }
  const c = await connect(hub.base);
  await waitFor(() => c.text().includes(": keepalive"), 1000, "a keepalive");
  assert.equal(created.length, 1, "one keepalive interval per hub");
  (globalThis as any).clearInterval = (h: any) => {
    cleared.add(h);
    return realClear(h);
  };
  try {
    hub.sse.close();
  } finally {
    globalThis.clearInterval = realClear;
  }
  assert.ok(created.every((h) => cleared.has(h)), "every interval the hub created is cleared");
  await c.done; // the stream was ended by the hub
  assert.equal(hub.sse.count(), 0);
  const res = await fetch(`${hub.base}/api/events`, { headers: { Authorization: "Bearer t" } });
  assert.equal(res.status, 503, "no new streams after close()");
  await res.body?.cancel();
  const before = c.text().length;
  await sleep(80);
  assert.equal(c.text().length, before, "no keepalive after close()");
  await hub.close();
});
