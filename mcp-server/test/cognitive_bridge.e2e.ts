/**
 * Cognitive Architecture E2E: drives the REAL MCP stdio server + hub over HTTP
 * for the developmental cognitive tools (Architecture 10.0 / 11.0).
 *
 * Proves, with NO browser extension registered, that:
 *   1. every new tool is exposed by tools/list with a schema (no duplicates),
 *   2. the MCP -> hub -> handler path resolves hub-side cognitive tools,
 *   3. the same calls work over the raw HTTP bridge (/api/web/tool + Bearer),
 *   4. results are the real engine outputs (not canned extension payloads).
 *
 * Prereq: `npm run build` (spawns dist/index.js).
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const PORT = 3004;
const TOKEN = "e2e-cognitive-token";
const BASE = `http://127.0.0.1:${PORT}`;
const DATA_DIR = mkdtempSync(path.join(tmpdir(), "screensync-e2e-cognitive-"));
const authHeaders = { "Content-Type": "application/json", Authorization: `Bearer ${TOKEN}` };

const serverProcess = spawn(process.execPath, ["dist/index.js"], {
  env: { ...process.env, SCREEN_SYNC_PORT: String(PORT), SCREEN_SYNC_TOKEN: TOKEN, SCREEN_SYNC_DATA_DIR: DATA_DIR },
  stdio: ["pipe", "pipe", "pipe"],
});

async function waitForHealth(timeoutMs = 8000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/health`);
      if (res.ok) return;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error("Hub did not become healthy in time");
}

const ARCH_10 = [
  "web_synaptic_pruning", "web_critical_period", "web_working_memory_span", "web_executive_function",
  "web_erikson_identity", "web_autonoetic_memory", "web_infant_error_signature", "web_wisdom_calibration",
];
const ARCH_11 = [
  "web_assimilation_accommodation", "web_forgetting_curve", "web_reinforcement_schedule", "web_prospective_memory",
  "web_source_monitoring", "web_interference_check", "web_reward_prediction_error", "web_cognitive_load_budget",
];
const ARCH_12 = [
  "web_rem_dream_simulation", "web_system1_reflex_compile", "web_amygdala_threat_inoculation", "web_zpd_scaffold_tutor",
  "web_somatic_marker_risk", "web_baddeley_working_memory", "web_dialectical_synthesis", "web_generative_wisdom_capsule",
];
const ALL_DEVELOPMENTAL = [...ARCH_10, ...ARCH_11, ...ARCH_12];

/** MCP flattens the tool payload into the text content — parse it. */
function payload(res: unknown): Record<string, any> {
  const content = (res as { content?: Array<{ type?: string; text?: string }> }).content ?? [];
  const textPart = content.find((c) => typeof c.text === "string");
  return JSON.parse(String(textPart?.text ?? "{}"));
}

let failed = false;
try {
  await waitForHealth();

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["dist/index.js"],
    env: { ...process.env, SCREEN_SYNC_PORT: String(PORT), SCREEN_SYNC_TOKEN: TOKEN, SCREEN_SYNC_DATA_DIR: DATA_DIR },
  });
  const client = new Client({ name: "cognitive-e2e", version: "1.0.0" });
  await client.connect(transport);

  // 1. All 24 developmental tools are listed, with schemas, without duplicates.
  const listed = await client.listTools();
  const names = listed.tools.map((t) => t.name);
  for (const t of ALL_DEVELOPMENTAL) assert.ok(names.includes(t), `tools/list must include ${t}`);
  const byName = new Map(listed.tools.map((t) => [t.name, t]));
  for (const t of ALL_DEVELOPMENTAL) {
    const def = byName.get(t);
    assert.ok((def as any)?.inputSchema, `${t} must expose an inputSchema`);
    assert.match((def as any)?.description ?? "", /Architecture (10|11|12)\.0/, `${t} description must state its architecture`);
  }
  assert.equal(new Set(names).size, names.length, "tools/list must not contain duplicate names");
  assert.ok(names.length >= 210, `expected >=210 tools, got ${names.length}`);

  // 2. Architecture 10.0 round trips (MCP -> hub -> engine), no extension present.
  const prune = payload(await client.callTool({
    name: "web_synaptic_pruning",
    arguments: {
      domain: "e2e-cognitive.com",
      playbooks: [
        { id: "pb_proven", successCount: 9 },
        { id: "pb_weak", successCount: 0 },
      ],
    },
  }));
  assert.equal(prune.success, true, "web_synaptic_pruning must succeed");
  assert.deepEqual(prune.pruned, ["pb_weak"]);
  assert.deepEqual(prune.myelinated, ["pb_proven"]);

  const wisdom = payload(await client.callTool({
    name: "web_wisdom_calibration",
    arguments: { domain: "e2e-cognitive.com", knowledgeDepth: 0.95, statedConfidence: 0.9, measuredAccuracy: 0.88 },
  }));
  assert.match(String(wisdom.verdict), /^WISE_ADULT/);
  assert.ok(wisdom.wisdomScore >= 0.8);

  const span = payload(await client.callTool({
    name: "web_working_memory_span",
    arguments: { domain: "e2e-cognitive.com", cognitiveAgeYears: 25 },
  }));
  assert.equal(span.digitSpanChunks, 7);

  const identity = payload(await client.callTool({
    name: "web_erikson_identity",
    arguments: { domain: "e2e-cognitive.com", cognitiveAgeYears: 14, knowledgePieces: 20, contradictions: 4 },
  }));
  assert.equal(identity.eriksonStage, "IDENTITY_VS_ROLE_CONFUSION");
  assert.equal(identity.identityCoherence, 0.8);

  // 3. Architecture 11.0 round trips — including stateful prospective memory.
  const burst = payload(await client.callTool({
    name: "web_reward_prediction_error",
    arguments: { domain: "e2e-cognitive.com", expectedReward: 0.5, actualReward: 0.95 },
  }));
  assert.equal(burst.dopamineState, "PHASIC_BURST_POSITIVE_SURPRISE");
  assert.ok(burst.learningRateBoost > 1);

  const decay = payload(await client.callTool({
    name: "web_forgetting_curve",
    arguments: {
      domain: "e2e-cognitive.com",
      items: [{ id: "stale", learnedAt: new Date(Date.now() - 12 * 86400000).toISOString(), reviewCount: 0 }],
    },
  }));
  assert.deepEqual(decay.reviewDue, ["stale"], "stale memory must be flagged for review");

  const load = payload(await client.callTool({
    name: "web_cognitive_load_budget",
    arguments: { domain: "e2e-cognitive.com", intrinsic: 6, extraneous: 3, germane: 2 },
  }));
  assert.equal(load.verdict, "COGNITIVE_OVERLOAD");
  assert.equal(load.overloaded, true);

  const misattribution = payload(await client.callTool({
    name: "web_source_monitoring",
    arguments: {
      domain: "e2e-cognitive.com",
      facts: [{ id: "f1", claimedSource: "x.com", actualEvidenceSource: "threads.net" }],
    },
  }));
  assert.equal(misattribution.misattributed.length, 1);
  assert.ok(misattribution.sourceTrust["x.com"] < 0.5);

  const interference = payload(await client.callTool({
    name: "web_interference_check",
    arguments: { domain: "e2e-cognitive.com", others: [{ domain: "x.com", sharedSelectors: 5, conflictingSteps: 2 }] },
  }));
  assert.ok(interference.interferences[0].proactiveInterference > 0.6);

  const reinforce = payload(await client.callTool({
    name: "web_reinforcement_schedule",
    arguments: { domain: "e2e-cognitive.com", successStreak: 12, totalAttempts: 90, hoursSinceLastPractice: 100 },
  }));
  assert.equal(reinforce.schedule, "VARIABLE_INTERVAL");

  const sanity = payload(await client.callTool({
    name: "web_assimilation_accommodation",
    arguments: { domain: "e2e-cognitive.com", observation: { matchesExistingSchema: true } },
  }));
  assert.equal(sanity.process, "ASSIMILATION");

  // Stateful check: register an implementation intention, then fire it.
  const registered = payload(await client.callTool({
    name: "web_prospective_memory",
    arguments: {
      domain: "e2e-cognitive.com",
      action: "register",
      intention: { triggerEvent: "login_wall", actionPlan: "re-auth then retry" },
    },
  }));
  assert.ok(registered.registered, "intention must be registered");
  const fired = payload(await client.callTool({
    name: "web_prospective_memory",
    arguments: { domain: "e2e-cognitive.com", action: "check", observedEvent: "login_wall" },
  }));
  assert.equal(fired.fired?.length, 1, "intention must fire on the observed trigger");
  assert.equal(fired.fired?.[0].actionPlan, "re-auth then retry");

  // 4. Raw HTTP bridge path — the same handler over /api/web/tool with Bearer.
  const httpRes = await fetch(`${BASE}/api/web/tool`, {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({
      tool: "web_critical_period",
      args: { cognitiveAgeYears: 1.0, baseXp: 10 },
    }),
  });
  assert.equal(httpRes.status, 200, "HTTP bridge must accept hub-side cognitive tools");
  const httpJson = await httpRes.json() as { success: boolean; ok: boolean; data: { activeWindow?: { id?: string }; effectiveXp?: number } };
  assert.equal(httpJson.success, true);
  assert.equal(httpJson.data.activeWindow?.id, "sensory_calibration");
  assert.equal(httpJson.data.effectiveXp, 20, "critical-period window must amplify XP 2x");

  // 4b. Architecture 12.0: the threat breaker is owned by the HUB (it answers the tool itself and
  // never relays it to the extension), so the dashboard must read it here. Trip it over MCP, read
  // it back through the same POST the extension's api.webTool makes, and prove a read is inert.
  const trip = payload(await client.callTool({
    name: "web_amygdala_threat_inoculation",
    arguments: { domain: "e2e-guarded.test", signal: { fingerprint: "cloudflare_turnstile" } },
  }));
  assert.equal(trip.breakerState, "TRIPPED");
  assert.equal(trip.handToHuman, true, "a tripped breaker hands control to the human");

  type StateBody = { ok: boolean; data: { threats: Array<{ domain: string; breakerState: string; consecutiveTrips: number }> } };
  const readState = async (args: Record<string, unknown> = {}): Promise<StateBody> => {
    const r = await fetch(`${BASE}/api/web/tool`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ tool: "web_amygdala_threat_inoculation", args: { action: "state", ...args } }),
    });
    assert.equal(r.status, 200, "the bridge must accept a threat state read");
    return await r.json() as StateBody;
  };
  const before = await readState();
  assert.equal(before.ok, true);
  const rec = before.data.threats.find((t) => t.domain === "e2e-guarded.test");
  assert.ok(rec, "the hub must report the domain it tripped - an empty list here is the bug the panel shipped with");
  assert.equal(rec.breakerState, "TRIPPED");
  assert.equal(rec.consecutiveTrips, 1);
  const after = await readState();
  assert.deepEqual(after.data.threats, before.data.threats, "reading the breaker must not move it");
  const scoped = await readState({ domain: "never-seen.test" });
  assert.equal(scoped.ok, true, "an unknown domain is an empty read, not an error");
  assert.deepEqual(scoped.data.threats, []);

  const noDomain = await fetch(`${BASE}/api/web/tool`, {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({ tool: "web_amygdala_threat_inoculation", args: { signal: {} } }),
  });
  const noDomainJson = await noDomain.json() as { ok: boolean };
  assert.equal(noDomainJson.ok, false, "appraising without a domain must be refused, not recorded under an empty key");
  assert.ok(!(await readState()).data.threats.some((t) => t.domain === ""), "no empty-domain breaker may exist");

  // 5. Unknown tool still fails cleanly (no crash, no false success).
  const bogus = await fetch(`${BASE}/api/web/tool`, {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({ tool: "web_not_a_real_tool", args: {} }),
  });
  assert.ok(bogus.status === 400 || bogus.status === 404 || bogus.status === 503, `unknown tool must fail cleanly, got ${bogus.status}`);

  // 6. Event stream stayed observable throughout (SSE ground truth).
  const events = await (await fetch(`${BASE}/api/events/recent?limit=50`, { headers: authHeaders })).json() as {
    events?: Array<{ type?: string }>;
  };
  assert.ok(Array.isArray(events.events), "hub must expose a replayable event tail");

  await client.close();
  console.log("PASS cognitive-architecture e2e (10.0 - 12.0, 24 tools, MCP + HTTP paths, hub-owned breaker read)");
} catch (err) {
  failed = true;
  console.error("FAIL cognitive-architecture e2e:", err);
} finally {
  serverProcess.kill("SIGTERM");
  await new Promise((r) => setTimeout(r, 400));
  try { rmSync(DATA_DIR, { recursive: true, force: true }); } catch { /* temp dir */ }
}
process.exit(failed ? 1 : 0);