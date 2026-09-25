/**
 * web_status tells the truth about a browser's own event stream.
 *
 * The live bug: the extension's diagnostics showed "SSE Stream: Offline" while web_status said
 * sseConnected:true, because the hub counted ANY open /api/events stream, the phone's included. A 1.14.1
 * extension opens its stream as ?client=extension&instanceId=<its id> and heartbeats sseAttribution:true, so
 * the hub can tell whether THAT browser's stream is up.
 *
 * A call to a browser whose own stream is down fails fast with BROWSER_STREAM_DOWN (S1).
 *
 * Also: the keepalive interval comes from SCREEN_SYNC_SSE_KEEPALIVE_MS (here 300ms), and a browser counts as
 * online for 90s after a heartbeat (profile_registry.test.ts covers the clock).
 *
 * Runs a real hub (dist/index.js) on :3015 with a temp data dir. Prereq: `npm run build`.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const PORT = 3015;
const TOKEN = "e2e-sse-presence-token";
const BASE = `http://127.0.0.1:${PORT}`;
const DATA_DIR = mkdtempSync(path.join(tmpdir(), "screensync-e2e-sse-presence-"));
const auth = { Authorization: `Bearer ${TOKEN}` };
const json = { ...auth, "Content-Type": "application/json" };
const INSTANCE = "inst_chrome_presence_e2e";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const serverProcess = spawn(process.execPath, ["dist/index.js"], {
  env: {
    ...process.env,
    SCREEN_SYNC_PORT: String(PORT),
    SCREEN_SYNC_HOST: "127.0.0.1",
    SCREEN_SYNC_TOKEN: TOKEN,
    SCREEN_SYNC_DATA_DIR: DATA_DIR,
    SCREEN_SYNC_SSE_KEEPALIVE_MS: "300",
  },
  stdio: ["pipe", "pipe", "pipe"],
});
let stderr = "";
serverProcess.stderr.on("data", (d) => { stderr = (stderr + String(d)).slice(-20_000); });

async function healthy(timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { if ((await fetch(`${BASE}/health`)).ok) return; } catch { /* not up yet */ }
    await sleep(150);
  }
  throw new Error(`hub on :${PORT} did not become healthy`);
}

type Stream = { text: () => string; openedAt: number; close: () => void };

async function openStream(query: string): Promise<Stream> {
  const ctrl = new AbortController();
  const res = await fetch(`${BASE}/api/events${query}`, { headers: auth, signal: ctrl.signal });
  assert.equal(res.status, 200);
  const openedAt = Date.now();
  let text = "";
  const reader = (res.body as ReadableStream<Uint8Array>).getReader();
  const decoder = new TextDecoder();
  void (async () => {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      text += decoder.decode(value, { stream: true });
    }
  })().catch(() => { /* closed by the test */ });
  return { text: () => text, openedAt, close: () => ctrl.abort() };
}

type Status = {
  online: boolean; sseConnected: boolean; sseClients: number; sseExtensionClients: number; targetInstanceId: string | null;
  browsers: Array<{ instanceId: string; online: boolean; sseConnected: boolean; sseAttributed: boolean }>;
};

async function webStatus(): Promise<Status> {
  const res = await fetch(`${BASE}/api/web/tool`, { method: "POST", headers: json, body: JSON.stringify({ tool: "web_status", args: {} }) });
  assert.equal(res.status, 200);
  return ((await res.json()) as { data: Status }).data;
}

async function until<T>(get: () => Promise<T>, ok: (v: T) => boolean, timeoutMs: number, what: string): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const v = await get();
    if (ok(v)) return v;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}: ${JSON.stringify(v)}`);
    await sleep(50);
  }
}

let failed = false;
try {
  await healthy();

  // A 1.14.1 extension heartbeats with sseAttribution:true.
  const reg = await fetch(`${BASE}/api/web/register`, {
    method: "POST", headers: json,
    body: JSON.stringify({ instanceId: INSTANCE, browserId: INSTANCE, browserName: "chrome", profileEmail: "presence@e2e.test", webAccessEnabled: true, approvals: true, sseAttribution: true, windows: [] }),
  });
  assert.equal(reg.status, 200);

  // 1. Only the phone holds a stream.
  const phone = await openStream("?client=app");
  const t0 = Date.now();
  while (!phone.text().includes(": keepalive") && Date.now() - t0 < 2000) await sleep(10);
  const keepaliveMs = Date.now() - phone.openedAt;
  assert.ok(phone.text().includes(": keepalive"), `no keepalive within 2s: ${JSON.stringify(phone.text().slice(0, 200))}`);
  assert.ok(keepaliveMs <= 1000, `the keepalive must arrive within 1s with SCREEN_SYNC_SSE_KEEPALIVE_MS=300 (took ${keepaliveMs}ms)`);
  assert.ok(phone.text().startsWith(": connected\n\n"));
  assert.ok(phone.text().includes('"type":"agent_connect"'), "the welcome still arrives");

  const phoneOnly = await until(webStatus, (s) => s.sseClients === 1, 2000, "one stream");
  assert.equal(phoneOnly.targetInstanceId, INSTANCE);
  assert.equal(phoneOnly.sseConnected, false, "the phone's stream must not make the browser look connected");
  assert.equal(phoneOnly.online, false);
  assert.equal(phoneOnly.sseExtensionClients, 0);
  const b0 = phoneOnly.browsers.find((b) => b.instanceId === INSTANCE)!;
  assert.equal(b0.online, true, "the heartbeat is fresh");
  assert.equal(b0.sseAttributed, true);
  assert.equal(b0.sseConnected, false);

  // 2. The extension opens its own attributed stream.
  const ext = await openStream(`?client=extension&instanceId=${encodeURIComponent(INSTANCE)}`);
  const up = await until(webStatus, (s) => s.sseConnected, 2000, "the browser's stream to count");
  assert.equal(up.online, true);
  assert.equal(up.sseClients, 2);
  assert.equal(up.sseExtensionClients, 1);
  assert.equal(up.browsers.find((b) => b.instanceId === INSTANCE)!.sseConnected, true);

  // 3. Its stream drops while the phone's stays: the browser is reported down again.
  ext.close();
  const down = await until(webStatus, (s) => s.sseClients === 1, 3000, "the extension stream to be dropped");
  assert.equal(down.sseConnected, false);
  assert.equal(down.online, false);

  // 3b. S1: a call to that browser fails fast (BROWSER_STREAM_DOWN after the 5s grace), not after a 45s timeout,
  // and nothing is relayed (the phone's stream never sees a web_request).
  const clickStartedAt = Date.now();
  const click = await fetch(`${BASE}/api/web/tool`, {
    method: "POST", headers: json, body: JSON.stringify({ tool: "web_click", args: { selector: "#save" }, timeoutMs: 45_000 }),
  });
  const clickMs = Date.now() - clickStartedAt;
  const clickBody = (await click.json()) as { ok: boolean; code?: string; retryable?: boolean; error?: string };
  assert.equal(click.status, 503, JSON.stringify(clickBody));
  assert.equal(clickBody.ok, false);
  assert.equal(clickBody.code, "BROWSER_STREAM_DOWN", JSON.stringify(clickBody));
  assert.equal(clickBody.retryable, true);
  assert.ok(clickMs < 8_000, `must fail in < 8s, not after the call timeout (took ${clickMs}ms)`);
  assert.ok(!phone.text().includes('"type":"web_request"'), "nothing was relayed to a browser that cannot hear it");

  // 4. The keepalive keeps flowing on the remaining stream.
  const before = phone.text().split(": keepalive").length;
  await sleep(700);
  assert.ok(phone.text().split(": keepalive").length > before, "keepalives keep arriving every ~300ms");
  phone.close();

  console.log("sse-presence e2e: ALL ASSERTIONS PASSED");
} catch (err) {
  failed = true;
  console.error("sse-presence e2e FAILED:", err);
  console.error("hub stderr tail:\n", stderr.slice(-4000));
} finally {
  serverProcess.kill("SIGTERM");
  await sleep(400);
  try { rmSync(DATA_DIR, { recursive: true, force: true }); } catch { /* best effort */ }
}
process.exit(failed ? 1 : 0);
