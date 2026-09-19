/**
 * Restart-persistence E2E (Phase 1 of the cognitive spine): the failure that was seen live.
 *
 * Trip a breaker, restart the hub, and it used to come back with nothing tracked. This drives the REAL
 * hub process through the HTTP tool bridge, HARD-KILLS it (a crash: no shutdown handler, no final
 * flush, so only the periodic flush can have saved anything), starts a new process on the same data
 * directory and reads everything back through the same bridge.
 *
 * Also proves the two safety properties that make persistence safe to ship:
 *   - a hub that LOSES the port race never reads, quarantines or writes the owner's state files, and
 *   - a corrupt state file is moved aside on boot without stopping the hub or the other engines.
 *
 * Prereq: `npm run build` (spawns dist/index.js).
 */
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const PORT = 3005;
const TOKEN = "e2e-restart-token";
const BASE = `http://127.0.0.1:${PORT}`;
const DATA_DIR = mkdtempSync(path.join(tmpdir(), "screensync-e2e-restart-"));
const COG_DIR = path.join(DATA_DIR, "cognitive");
const authHeaders = { "Content-Type": "application/json", Authorization: `Bearer ${TOKEN}` };

type Hub = { proc: ChildProcess; log: () => string };

function spawnHub(): Hub {
  const proc = spawn(process.execPath, ["dist/index.js"], {
    env: { ...process.env, SCREEN_SYNC_PORT: String(PORT), SCREEN_SYNC_TOKEN: TOKEN, SCREEN_SYNC_DATA_DIR: DATA_DIR },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let out = "";
  const keep = (b: Buffer) => { out = (out + b.toString()).slice(-200_000); };
  proc.stdout?.on("data", keep);
  proc.stderr?.on("data", keep);
  return { proc, log: () => out };
}

async function until(what: string, pred: () => boolean | Promise<boolean>, timeoutMs = 8000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if (await pred()) return;
    } catch {
      // Transient by design: on Windows a read can hit the instant another process renames over the file.
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`timed out waiting for: ${what}`);
}

const healthy = async () => {
  try { return (await fetch(`${BASE}/health`)).ok; } catch { return false; }
};

/** A crash, not a shutdown: on Windows kill() is TerminateProcess, so no SIGTERM handler ever runs. */
async function crash(hub: Hub): Promise<void> {
  if (hub.proc.exitCode === null) {
    const exited = new Promise<void>((r) => hub.proc.once("exit", () => r()));
    hub.proc.kill("SIGKILL");
    await exited;
  }
  await until("the port to be released", async () => !(await healthy()), 5000);
}

async function call(tool: string, args: Record<string, unknown>): Promise<any> {
  const res = await fetch(`${BASE}/api/web/tool`, { method: "POST", headers: authHeaders, body: JSON.stringify({ tool, args }) });
  assert.equal(res.status, 200, `${tool} must be accepted by the bridge`);
  return await res.json();
}
const data = (r: any) => r.data ?? r;

const stateFile = (ns: string) => path.join(COG_DIR, `${ns}.json`);
const readState = (ns: string): any => JSON.parse(readFileSync(stateFile(ns), "utf8")).state;
const corruptCopies = () => (existsSync(COG_DIR) ? readdirSync(COG_DIR).filter((n) => n.includes(".corrupt-")) : []);
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

let failed = false;
let hub = spawnHub();
let twin: Hub | null = null;
try {
  await until("the first hub to become healthy", healthy);
  assert.equal(existsSync(COG_DIR), false, "a fresh data dir has no cognitive state yet");

  // 1. Build up state through the real tool path.
  const trip = data(await call("web_amygdala_threat_inoculation", { domain: "restart-guarded.test", signal: { fingerprint: "cloudflare_turnstile" } }));
  assert.equal(trip.breakerState, "TRIPPED");

  let grown: any;
  for (let i = 0; i < 3; i += 1) {
    grown = data(await call("web_cognitive_maturation", { domain: "restart-grown.test", event: { outcome: "success", xpGain: 25 } }));
  }
  assert.equal(grown.successfulActions, 3);
  assert.equal(grown.cognitiveXp, 75);

  for (let i = 0; i < 2; i += 1) await call("web_cognitive_lifespan", { domain: "restart-grown.test", event: { outcome: "success" } });

  const reg = data(await call("web_prospective_memory", {
    domain: "restart-grown.test", action: "register", intention: { triggerEvent: "login_wall", actionPlan: "re-auth then retry" },
  }));
  assert.ok(reg.registered, "the intention must register before the restart");

  // 2. Wait until the periodic flush has written the FINAL state of each engine (a tick can land
  //    between two of the calls above, so "the file exists" is not enough).
  await until("all four engines to be flushed", () =>
    ["transcendental", "maturation", "lifespan", "dynamics"].every((ns) => existsSync(stateFile(ns))) &&
    readState("transcendental").threats.some(([d]: [string]) => d === "restart-guarded.test") &&
    readState("maturation").profiles.some(([d, p]: [string, any]) => d === "restart-grown.test" && p.successfulActions === 3) &&
    readState("lifespan").lifespanProfiles.some(([d, p]: [string, any]) => d === "restart-grown.test" && p.successfulMilestones === 2) &&
    readState("dynamics").intentions.some(([d]: [string]) => d === "restart-grown.test"));

  // 3. Crash the hub, start a new process on the same data directory.
  await crash(hub);
  hub = spawnHub();
  await until("the restarted hub to become healthy", healthy);
  assert.match(hub.log(), /Cognitive state hydrated/, "the new process must report that it hydrated");

  // 4. Everything is back, read through the same bridge an agent (and the dashboard panel) uses.
  const threats = data(await call("web_amygdala_threat_inoculation", { action: "state" })).threats as Array<{ domain: string; breakerState: string; consecutiveTrips: number }>;
  const breaker = threats.find((t) => t.domain === "restart-guarded.test");
  assert.ok(breaker, "the tripped breaker must survive the restart - this is the bug seen live (tracked=0)");
  assert.equal(breaker.breakerState, "TRIPPED");
  assert.equal(breaker.consecutiveTrips, 1);

  const profile = data(await call("web_cognitive_maturation", { domain: "restart-grown.test" }));
  assert.equal(profile.successfulActions, 3, "learned maturation must survive");
  assert.equal(profile.cognitiveXp, 75);

  const lifespan = data(await call("web_cognitive_lifespan", { domain: "restart-grown.test" }));
  assert.equal(lifespan.successfulMilestones, 2, "learned lifespan must survive");

  const fired = data(await call("web_prospective_memory", { domain: "restart-grown.test", action: "check", observedEvent: "login_wall" }));
  assert.equal(fired.fired?.length, 1, "a registered implementation intention must still fire after a restart");
  assert.equal(fired.fired?.[0].actionPlan, "re-auth then retry");
  assert.deepEqual(corruptCopies(), [], "a healthy restart must not quarantine anything");

  // 5. A hub that loses the port race must leave the owner's files completely alone. Plant a corrupt
  //    file AFTER the owner has booted (so only a process that wrongly hydrates would ever touch it).
  await pause(1500); // let the owner's flush settle so the only change below is ours
  const garbage = "{ this is not json";
  writeFileSync(stateFile("rpd"), garbage);
  twin = spawnHub();
  await until("the twin to fall back to MCP-only mode", () => /MCP-only mode/.test(twin!.log()), 10_000);
  await pause(2500); // longer than the flush interval, so a wrongly started timer or hydrate would have acted
  twin.proc.kill("SIGKILL");
  assert.equal(readFileSync(stateFile("rpd"), "utf8"), garbage, "the port-race loser must not have moved or rewritten the owner's file");
  assert.deepEqual(corruptCopies(), [], "the port-race loser must not have quarantined anything");
  assert.doesNotMatch(twin.log(), /Cognitive state hydrated/, "the port-race loser must never hydrate");

  // 6. A corrupt state file is set aside on boot and stops nothing else from restoring.
  await crash(hub);
  hub = spawnHub();
  await until("the hub to boot past a corrupt state file", healthy);
  await until("the corrupt file to be quarantined", () => corruptCopies().length === 1);
  const moved = path.join(COG_DIR, corruptCopies()[0]);
  assert.equal(readFileSync(moved, "utf8"), garbage, "the corrupt bytes are kept for a human, not deleted");
  assert.match(hub.log(), /set aside/, "the operator must be told a file was quarantined");
  const still = data(await call("web_amygdala_threat_inoculation", { action: "state" })).threats as Array<{ domain: string }>;
  assert.ok(still.some((t) => t.domain === "restart-guarded.test"), "one bad file must not stop the other engines restoring");

  console.log("PASS cognitive restart-persistence e2e (crash + restore, port-race loser inert, corrupt file quarantined)");
} catch (err) {
  failed = true;
  console.error("FAIL cognitive restart-persistence e2e:", err);
  console.error("--- last hub log ---\n" + hub.log().slice(-3000));
} finally {
  for (const h of [twin, hub]) { try { h?.proc.kill("SIGKILL"); } catch { /* already gone */ } }
  await pause(500);
  try { rmSync(DATA_DIR, { recursive: true, force: true }); } catch { /* temp dir */ }
}
process.exit(failed ? 1 : 0);
