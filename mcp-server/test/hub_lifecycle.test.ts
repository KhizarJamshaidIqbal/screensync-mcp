// startHttpHub() / stop() can run more than once in one process without leaking.
//
// 1.14.0 subscribed with hubEvents.on("event", (e) => broadcast(e)) and unsubscribed with
// hubEvents.off("event", broadcast): a different function, so nothing was removed. After a restart every hub
// event was broadcast twice (once into the dead hub), and listeners piled up. The APK watcher and its debounce
// timer were never closed at all. Runs on an ephemeral port with a temp data dir.

import { ISOLATED_DATA_DIR } from "./_isolate-data-dir.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";

process.env.SCREEN_SYNC_PORT = "0"; // ephemeral: never 3000, never a port another suite owns
process.env.SCREEN_SYNC_HOST = "127.0.0.1";
process.env.SCREEN_SYNC_TOKEN = "hub-lifecycle-token";
process.env.SCREEN_SYNC_COGNITIVE_GATE = "off";

const { startHttpHub } = await import("../hub.js");
const { hubEvents, emitHubEvent } = await import("../events.js");
const { DATA_DIR } = await import("../config.js");
const { startHubWatchers } = await import("../hub-watchers.js");

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const auth = { Authorization: "Bearer hub-lifecycle-token" };
const resources = (kind: string) => process.getActiveResourcesInfo().filter((r) => r === kind).length;

async function waitFor(cond: () => boolean, timeoutMs: number, what: string): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!cond()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await sleep(10);
  }
}

/** Opens /api/events and collects what arrives. */
async function stream(base: string) {
  const ctrl = new AbortController();
  const res = await fetch(`${base}/api/events?client=app`, { headers: auth, signal: ctrl.signal });
  assert.equal(res.status, 200);
  let text = "";
  const reader = (res.body as ReadableStream<Uint8Array>).getReader();
  const decoder = new TextDecoder();
  const done = (async () => {
    for (;;) {
      const { done: end, value } = await reader.read();
      if (end) return;
      text += decoder.decode(value, { stream: true });
    }
  })().catch(() => { /* aborted */ });
  return { text: () => text, abort: () => ctrl.abort(), done };
}

test("the data dir is the isolated temp dir, never the repo's data/", () => {
  assert.equal(DATA_DIR, ISOLATED_DATA_DIR);
});

test("start / stop / start: one hubEvents listener, one delivery per event, watchers closed on stop", async () => {
  const listeners = () => hubEvents.listenerCount("event");
  const baseListeners = listeners();
  const baseWatchers = resources("FSEventWrap");
  const baseSockets = resources("UDPWrap");

  for (let round = 1; round <= 2; round++) {
    const hub = await startHttpHub();
    const base = `http://127.0.0.1:${(hub.server.address() as AddressInfo).port}`;
    try {
      assert.equal(listeners(), baseListeners + 1, `round ${round}: exactly one hub listener`);
      assert.ok(resources("FSEventWrap") > baseWatchers, `round ${round}: the extension watcher is running`);
      const s = await stream(base);
      await waitFor(() => s.text().includes('"type":"agent_connect"'), 2000, "the welcome");
      emitHubEvent("inspection", `round-${round}`);
      await waitFor(() => s.text().includes(`"label":"round-${round}"`), 2000, "the event");
      await sleep(100);
      assert.equal(s.text().split(`"label":"round-${round}"`).length - 1, 1, `round ${round}: delivered once, not once per past start`);
      const recent = await (await fetch(`${base}/api/events/recent?types=inspection&limit=500`, { headers: auth })).json() as { events: Array<{ payload: { label?: string } }> };
      assert.equal(recent.events.filter((e) => e.payload.label === `round-${round}`).length, 1, `round ${round}: recorded once in the ring`);
      await hub.stop();
      await s.done; // stop() ends open streams, so server.close() can finish
    } catch (err) {
      await hub.stop().catch(() => undefined);
      throw err;
    }
    assert.equal(listeners(), baseListeners, `round ${round}: stop() removed the listener`);
    await waitFor(() => resources("FSEventWrap") === baseWatchers, 2000, `round ${round}: watchers closed`);
    // mDNS: even a failed publish (port 0 here) opened multicast sockets, which used to stay open.
    await waitFor(() => resources("UDPWrap") === baseSockets, 2000, `round ${round}: mDNS sockets closed`);
  }
});

test("startHubWatchers().close() closes both watchers and cancels a pending APK re-hash", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "screensync-watchers-"));
  const extDir = path.join(dir, "extension");
  const apkDir = path.join(dir, "apk");
  const { mkdirSync } = await import("node:fs");
  mkdirSync(extDir);
  mkdirSync(apkDir);
  writeFileSync(path.join(extDir, "a.js"), "1");
  const baseWatchers = resources("FSEventWrap");
  const baseTimers = resources("Timeout");
  const broadcasts: object[] = [];
  const w = startHubWatchers((p) => broadcasts.push(p), { extensionDir: extDir, apkDir });
  try {
    assert.deepEqual(w.active(), { extension: true, apk: true });
    assert.equal(resources("FSEventWrap"), baseWatchers + 2);
    // An APK write arms the 1s debounce timer; close() must cancel it.
    writeFileSync(path.join(apkDir, "app-release.apk"), "apk-bytes");
    await waitFor(() => resources("Timeout") > baseTimers, 3000, "the APK debounce timer");
  } finally {
    w.close();
    w.close(); // idempotent
  }
  assert.deepEqual(w.active(), { extension: false, apk: false });
  await waitFor(() => resources("FSEventWrap") === baseWatchers, 2000, "both watchers closed");
  assert.equal(resources("Timeout"), baseTimers, "the pending APK timer was cleared");
  await sleep(1200);
  assert.deepEqual(broadcasts, [], "nothing fires after close()");
  rmSync(dir, { recursive: true, force: true });
});
