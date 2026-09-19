/**
 * Soft-gate E2E (Phase 3 of the cognitive spine): the gate is wired into the hub's relay path.
 *
 * Two real hub processes, no browser extension connected, so any call that gets PAST the gate simply
 * fails at the "extension not connected" check. That makes the gate observable without a browser:
 *   enforce  a destructive-looking click on a NOVICE domain is refused with USER_CONFIRMATION_REQUIRED,
 *            even with no browser attached; everything else reaches the connection check.
 *   warn     (the default) the same click is never refused. The advisory that rides on the RESPONSE of
 *            a relayed call needs a real extension, so it is checked live rather than here.
 *
 * Prereq: `npm run build` (spawns dist/index.js).
 */
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const TOKEN = "e2e-gate-token";
const ENFORCE_PORT = 3006;
const WARN_PORT = 3007;
const enforceDir = mkdtempSync(path.join(tmpdir(), "screensync-e2e-gate-enforce-"));
const warnDir = mkdtempSync(path.join(tmpdir(), "screensync-e2e-gate-warn-"));
const authHeaders = { "Content-Type": "application/json", Authorization: `Bearer ${TOKEN}` };

// A human allowlisted this domain BEFORE the hub started, the way an operator would.
mkdirSync(path.join(enforceDir, "cognitive"), { recursive: true });
writeFileSync(path.join(enforceDir, "cognitive", "policy.json"), JSON.stringify({ allowDomains: ["allowed.example"] }));

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

const DANGEROUS = { url: "https://gated.example/account", selector: "button.delete-account" };
const gateRefusal = /^USER_CONFIRMATION_REQUIRED \(cognitive gate\)/;

const enforceHub = spawnHub(ENFORCE_PORT, enforceDir, "enforce");
const warnHub = spawnHub(WARN_PORT, warnDir);
let failed = false;
try {
  await Promise.all([healthy(ENFORCE_PORT), healthy(WARN_PORT)]);

  // ── enforce ──
  const blocked = await call(ENFORCE_PORT, "web_click", DANGEROUS);
  assert.equal(blocked.ok, false);
  assert.match(String(blocked.error), gateRefusal, "a destructive-looking click on a NOVICE domain is refused before any relay");
  assert.equal(blocked.data.gate.verdict, "block");
  assert.equal(blocked.data.gate.domain, "gated.example");
  assert.equal(blocked.data.gate.earnedName, "NOVICE");

  const bypass = await call(ENFORCE_PORT, "web_click", { ...DANGEROUS, confirmed: true, force: true });
  assert.match(String(bypass.error), gateRefusal, "confirmed/force typed by the caller open nothing");

  const usable = await call(ENFORCE_PORT, "web_click", { url: "https://gated.example/", selector: "#save-draft" });
  assert.doesNotMatch(String(usable.error), gateRefusal, "a harmless click on a fresh domain is not gated");
  assert.match(String(usable.error), /not connected/i);

  const read = await call(ENFORCE_PORT, "web_screenshot", { url: "https://gated.example/", selector: "button.delete-account" });
  assert.doesNotMatch(String(read.error), gateRefusal, "reads and perception are never gated");

  const allowed = await call(ENFORCE_PORT, "web_click", { url: "https://allowed.example/account", selector: "button.delete-account" });
  assert.doesNotMatch(String(allowed.error), gateRefusal, "an allowlisted domain passes");

  // ── warn (the default) ──
  const warned = await call(WARN_PORT, "web_click", DANGEROUS);
  assert.doesNotMatch(String(warned.error), gateRefusal, "warn mode never refuses");
  assert.match(String(warned.error), /not connected/i, "the call went on to the relay path, which fails only because no browser is attached");

  console.log("PASS cognitive gate e2e (enforce refuses even with no browser; warn never refuses; reads, harmless calls and allowlisted domains pass)");
} catch (err) {
  failed = true;
  console.error("FAIL cognitive gate e2e:", err);
} finally {
  for (const p of [enforceHub, warnHub]) { try { p.kill("SIGKILL"); } catch { /* already gone */ } }
  await new Promise((r) => setTimeout(r, 500));
  for (const d of [enforceDir, warnDir]) { try { rmSync(d, { recursive: true, force: true }); } catch { /* temp dir */ } }
}
process.exit(failed ? 1 : 0);
