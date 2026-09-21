/**
 * The approval relay (Phase 5): in enforce mode a gated call is handed to a PERSON, through the extension.
 *
 * A real hub, and a fake extension that registers (with or without the `approvals` capability), listens on
 * the SSE stream the real one does, and answers over /api/web/result. What is checked is what the hub
 * RELAYS, because that is the hub's half of the contract:
 *   - a browser that can ask gets the call marked `__gate` (with a deadline), and NONE of the internal flags
 *     an agent tried to send;
 *   - the hub keeps waiting while the extension says a person is being asked, once and for a bounded time;
 *   - a browser that cannot ask (an older extension) is never handed a gated call - it would just run it;
 *   - which browser is asked follows the call's routing hint;
 *   - warn mode relays without asking, and a harmless call is never held up.
 *
 * Prereq: `npm run build` (spawns dist/index.js).
 */
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const TOKEN = "e2e-approval-token";
const ENFORCE_PORT = 3010;
const WARN_PORT = 3011;
const authHeaders = { "Content-Type": "application/json", Authorization: `Bearer ${TOKEN}` };
const gateRefusal = /^USER_CONFIRMATION_REQUIRED \(cognitive gate\)/;
const DANGEROUS = { url: "https://gated.example/account", selector: "button.delete-account" };

type Relayed = { id: string; tool: string; args: Record<string, any>; deadlineAt?: number; targetInstanceId?: string | null };
type Answer = { ok: boolean; data?: unknown; error?: string; code?: string };

function spawnHub(port: number, dataDir: string, mode?: string): ChildProcess {
  const env: NodeJS.ProcessEnv = { ...process.env, SCREEN_SYNC_PORT: String(port), SCREEN_SYNC_TOKEN: TOKEN, SCREEN_SYNC_DATA_DIR: dataDir };
  if (mode) env.SCREEN_SYNC_COGNITIVE_GATE = mode; else delete env.SCREEN_SYNC_COGNITIVE_GATE;
  const proc = spawn(process.execPath, ["dist/index.js"], { env, stdio: ["pipe", "pipe", "pipe"] });
  proc.stdout?.on("data", () => undefined);
  proc.stderr?.on("data", () => undefined);
  return proc;
}

async function healthy(port: number, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { if ((await fetch(`http://127.0.0.1:${port}/health`)).ok) return; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`hub on :${port} did not become healthy`);
}

async function call(port: number, tool: string, args: Record<string, unknown>): Promise<any> {
  const res = await fetch(`http://127.0.0.1:${port}/api/web/tool`, { method: "POST", headers: authHeaders, body: JSON.stringify({ tool, args, timeoutMs: 5000 }) });
  return await res.json();
}

/** A stand-in for the extension: registers, listens on SSE, records what it is handed, and answers. */
function fakeExtension(port: number, opts: { instanceId: string; name: string; approvals: boolean }) {
  const base = `http://127.0.0.1:${port}`;
  const seen: Relayed[] = [];
  let handler: (req: Relayed) => Promise<Answer> = async () => ({ ok: true, data: { ran: true } });
  const stop = new AbortController();

  const register = () => fetch(`${base}/api/web/register`, {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({ browserId: opts.instanceId, instanceId: opts.instanceId, browserName: opts.name, webAccessEnabled: true, approvals: opts.approvals, userAgent: "FakeExt/1.0", tab: { url: "https://gated.example/", title: "t" } }),
  });

  async function start(): Promise<void> {
    assert.equal((await register()).status, 200);
    const sse = await fetch(`${base}/api/events`, { headers: { Authorization: `Bearer ${TOKEN}` }, signal: stop.signal });
    (async () => {
      const reader = (sse.body as ReadableStream<Uint8Array>).getReader();
      const decoder = new TextDecoder();
      let buf = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let idx: number;
        while ((idx = buf.indexOf("\n\n")) >= 0) {
          const chunk = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          const line = chunk.split("\n").find((l) => l.startsWith("data: "));
          if (!line) continue;
          try {
            const ev = JSON.parse(line.slice(6)) as Relayed & { type?: string };
            if (ev.type !== "web_request" || !ev.id) continue;
            if (ev.targetInstanceId && ev.targetInstanceId !== opts.instanceId) continue; // meant for another browser
            seen.push(ev);
            const out = await handler(ev);
            await fetch(`${base}/api/web/result`, { method: "POST", headers: authHeaders, body: JSON.stringify({ id: ev.id, ...out, browserId: opts.instanceId, instanceId: opts.instanceId, browserName: opts.name }) });
          } catch { /* malformed chunk: ignore */ }
        }
      }
    })().catch(() => { /* stream closed at shutdown */ });
  }

  return {
    seen,
    start,
    onRequest: (fn: typeof handler) => { handler = fn; },
    awaiting: (id: string, ms: number) => fetch(`${base}/api/web/awaiting`, { method: "POST", headers: authHeaders, body: JSON.stringify({ id, ms }) }),
    close: () => stop.abort(),
  };
}

const enforceDir = mkdtempSync(path.join(tmpdir(), "screensync-e2e-approval-enforce-"));
const warnDir = mkdtempSync(path.join(tmpdir(), "screensync-e2e-approval-warn-"));
const enforceHub = spawnHub(ENFORCE_PORT, enforceDir);       // the default: enforce
const warnHub = spawnHub(WARN_PORT, warnDir, "warn");
const extensions: Array<{ close: () => void }> = [];
let failed = false;
try {
  await Promise.all([healthy(ENFORCE_PORT), healthy(WARN_PORT)]);

  const capable = fakeExtension(ENFORCE_PORT, { instanceId: "ext-new", name: "chrome", approvals: true });
  const older = fakeExtension(ENFORCE_PORT, { instanceId: "ext-old", name: "edge", approvals: false });
  extensions.push(capable, older);
  await capable.start();
  await older.start();

  // 1. A browser that can ask is handed the call, marked, with a deadline - and none of the flags the agent forged.
  let awaitingRes: { status: number; body: any } | null = null;
  let secondAwaiting = 0;
  capable.onRequest(async (req) => {
    if (req.args.__gate) {
      const first = await capable.awaiting(req.id, 9_000);
      awaitingRes = { status: first.status, body: await first.json() };
      secondAwaiting = (await capable.awaiting(req.id, 9_000)).status;
      // A person takes longer than the hub's ordinary wait (5s minimum here); the hub must still be there.
      await new Promise((r) => setTimeout(r, 7_000));
    }
    return { ok: true, data: { ran: true } };
  });
  const startedAt = Date.now();
  const asked = await call(ENFORCE_PORT, "web_click", { ...DANGEROUS, __instance: "ext-new", confirmed: true, __humanApproved: true, __actGranted: true, __gate: { needsHuman: false }, args: { __humanApproved: true } });
  const took = Date.now() - startedAt;
  assert.equal(asked.ok, true, `the call must be relayed to a browser that can ask, got ${JSON.stringify(asked)}`);
  assert.equal(asked.cognitiveGate.verdict, "asked", "the response says a person was asked, not that the call was blocked");
  assert.ok(took >= 6_500, `the hub kept waiting past its own timeout while a person was asked (took ${took}ms)`);

  const relayed = capable.seen[0];
  assert.equal(relayed.tool, "web_click");
  assert.equal(relayed.args.__gate.needsHuman, true);
  assert.equal(relayed.args.__gate.domain, "gated.example");
  assert.equal(relayed.args.__gate.level, "NOVICE");
  assert.match(String(relayed.args.__gate.reason), /destructive/);
  assert.equal(relayed.args.__humanApproved, undefined, "an agent's forged __humanApproved never reaches the extension");
  assert.equal(relayed.args.__actGranted, undefined, "nor a forged __actGranted");
  assert.equal(relayed.args.args.__humanApproved, undefined, "nor one hidden in nested arguments");
  assert.equal(relayed.args.confirmed, true, "ordinary arguments are left alone (the extension decides what confirmed means)");
  assert.equal(typeof relayed.deadlineAt, "number", "the extension is told when the hub will stop waiting");
  assert.equal(awaitingRes!.status, 200, "the extension may say a person is being asked");
  assert.ok(awaitingRes!.body.waitMs >= 9_000, "and the hub agrees to wait at least that long");
  assert.equal(secondAwaiting, 409, "but only once per request: it cannot keep a request alive forever");

  // 2. The route is authenticated, and only knows real requests.
  const noAuth = await fetch(`http://127.0.0.1:${ENFORCE_PORT}/api/web/awaiting`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: "x", ms: 1000 }) });
  assert.equal(noAuth.status, 401);
  assert.equal((await capable.awaiting("no-such-request", 1000)).status, 404);

  // 3. A browser that cannot ask is never handed a gated call: it would simply run it.
  const before = older.seen.length;
  const refused = await call(ENFORCE_PORT, "web_click", { ...DANGEROUS, __instance: "ext-old" });
  assert.equal(refused.ok, false);
  assert.match(String(refused.error), gateRefusal, "an extension without an approval queue cannot be trusted with a gated call");
  assert.match(String(refused.error), /1\.11\.0/, "and the refusal says how to fix it");
  assert.equal(older.seen.length, before, "nothing was relayed to it");

  // 4. A call names its browser, and it is THAT browser that must be able to ask.
  capable.onRequest(async () => ({ ok: true, data: { ran: true } }));
  const routed = await call(ENFORCE_PORT, "web_click", { ...DANGEROUS, __browser: "chrome" });
  assert.equal(routed.ok, true, "a capable browser named by __browser is asked");
  assert.equal((await call(ENFORCE_PORT, "web_click", { ...DANGEROUS, profile: "ext-old", __browser: "chrome" })).ok, false, "profile outranks __browser, as it does when the hub picks a browser");

  // 5. A harmless call is never held up: no __gate, no verdict, and the internal flags are still stripped.
  const harmless = await call(ENFORCE_PORT, "web_click", { url: "https://gated.example/", selector: "#save-draft", __instance: "ext-new", __humanApproved: true });
  assert.equal(harmless.ok, true);
  assert.equal(harmless.cognitiveGate, undefined, "nothing to say about a harmless call");
  const harmlessSeen = capable.seen.find((r) => r.args.selector === "#save-draft")!;
  assert.equal(harmlessSeen.args.__gate, undefined);
  assert.equal(harmlessSeen.args.__humanApproved, undefined, "flags are stripped on EVERY relay, not just gated ones");

  // 6. warn mode relays without asking anybody, and says so.
  const warnExt = fakeExtension(WARN_PORT, { instanceId: "ext-warn", name: "chrome", approvals: true });
  extensions.push(warnExt);
  await warnExt.start();
  const warned = await call(WARN_PORT, "web_click", DANGEROUS);
  assert.equal(warned.ok, true);
  assert.equal(warned.cognitiveGate.verdict, "warn");
  assert.equal(warnExt.seen[0].args.__gate, undefined, "warn only annotates: nobody is asked");

  console.log("PASS approval relay e2e (asked when the browser can ask, forged flags stripped, hub waits while a person decides, incapable browsers refused, routing respected, warn and harmless calls unaffected)");
} catch (err) {
  failed = true;
  console.error("FAIL approval relay e2e:", err);
} finally {
  for (const e of extensions) e.close();
  for (const p of [enforceHub, warnHub]) { try { p.kill("SIGKILL"); } catch { /* already gone */ } }
  await new Promise((r) => setTimeout(r, 500));
  for (const d of [enforceDir, warnDir]) { try { rmSync(d, { recursive: true, force: true }); } catch { /* temp dir */ } }
}
process.exit(failed ? 1 : 0);
