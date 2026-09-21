/**
 * Consolidated mode over the REAL MCP stdio protocol.
 *
 * TOOL_MODE=consolidated lists a handful of meta-tools instead of the whole catalogue. It used to have no
 * cognitive tools at all, neither listed nor callable, so an agent in that mode could not recall what the
 * hub had learned about a site. This drives web_mind end to end, with NO browser extension registered:
 *   1. tools/list is the small meta-tool set: web_mind is in it and no granular cognitive tool is,
 *   2. help returns one exact schema on demand, and an overview of every action,
 *   3. a learn -> recall round trip works through the meta-tool (MCP -> resolve -> hub -> store -> back),
 *   4. a granular name is refused with a pointer to where it went.
 *
 * Prereq: `npm run build` (spawns dist/index.js).
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const PORT = 3008;
const TOKEN = "e2e-consolidated-token";
const DATA_DIR = mkdtempSync(path.join(tmpdir(), "screensync-e2e-consolidated-"));

/** MCP flattens the tool payload into the text content: parse it. */
function payload(res: unknown): Record<string, any> {
  const content = (res as { content?: Array<{ type?: string; text?: string }> }).content ?? [];
  return JSON.parse(String(content.find((c) => typeof c.text === "string")?.text ?? "{}"));
}

async function waitForHealth(timeoutMs = 8000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(`http://127.0.0.1:${PORT}/health`)).ok) return;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error("Hub did not become healthy in time");
}

let failed = false;
let client: Client | undefined;
try {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["dist/index.js"],
    env: { ...process.env, SCREEN_SYNC_PORT: String(PORT), SCREEN_SYNC_TOKEN: TOKEN, SCREEN_SYNC_DATA_DIR: DATA_DIR, TOOL_MODE: "consolidated" },
  });
  client = new Client({ name: "consolidated-e2e", version: "1.0.0" });
  await client.connect(transport);
  await waitForHealth();

  // 1. The small set, with the mind in it.
  const listed = await client.listTools();
  const names = listed.tools.map((t) => t.name);
  assert.ok(names.includes("web_mind"), "web_mind must be listed");
  assert.ok(names.length < 20, `consolidated mode lists a handful of tools, got ${names.length}`);
  for (const granular of ["web_recall", "web_learn", "web_cognitive_stage", "web_synaptic_pruning"]) {
    assert.ok(!names.includes(granular), `${granular} must NOT be listed: it is reached through web_mind`);
  }
  const mind = listed.tools.find((t) => t.name === "web_mind")!;
  const actions = ((mind.inputSchema.properties as Record<string, { enum?: string[] }>).action.enum) ?? [];
  for (const a of ["help", "recall", "learn", "stage", "consolidate", "synaptic_pruning"]) assert.ok(actions.includes(a), `web_mind must offer ${a}`);
  assert.ok(Buffer.byteLength(JSON.stringify(mind), "utf8") < 2_500, "the whole cognitive surface stays small");

  // 2. help: one exact schema on demand, and the overview.
  const help = payload(await client.callTool({ name: "web_mind", arguments: { action: "help", args: { action: "learn" } } }));
  assert.equal(help.success, true);
  assert.equal(help.tool.name, "web_learn", "an action name is translated to its tool");
  assert.ok(help.tool.inputSchema.properties.data, "the exact schema comes back, so the caller can see the arguments");
  assert.deepEqual(help.reachedVia, { tool: "web_mind", action: "learn" });

  const overview = payload(await client.callTool({ name: "web_mind", arguments: { action: "help" } }));
  assert.equal(Object.keys(overview.actions).length, actions.length, "every action gets a line");
  assert.ok(String(overview.actions.recall).length > 10);

  // 3. learn -> recall through the meta-tool. The tool's OWN `action` is nested in args.
  const domain = "e2e-mind.test";
  const learned = payload(await client.callTool({
    name: "web_mind",
    arguments: { action: "learn", args: { action: "pitfall", domain, data: { symptom: "Save button stays disabled", rootCause: "React state not synced", provenSolution: "dispatch an input event after fill" } } },
  }));
  assert.equal(learned.learned, true, `learn must succeed, got ${JSON.stringify(learned)}`);

  const recalled = payload(await client.callTool({ name: "web_mind", arguments: { action: "recall", args: { domain } } }));
  assert.equal(recalled.pitfalls?.length, 1, "the pitfall comes back through the same door it went in by");
  assert.equal(recalled.pitfalls[0].provenSolution, "dispatch an input event after fill");

  const next = payload(await client.callTool({ name: "web_mind", arguments: { action: "stage", args: { domain, action: "next" } } }));
  assert.equal(next.level, "NOVICE");
  assert.ok(Array.isArray(next.steps), "the curriculum comes back too");

  // 4. A granular name is refused, and told where it went.
  const direct = await client.callTool({ name: "web_recall", arguments: { domain } });
  assert.equal((direct as { isError?: boolean }).isError, true);
  assert.match(String(payload(direct).error), /In this mode it is web_mind with action "recall"/);

  await client.close();
  console.log("PASS consolidated e2e (web_mind: listed small, help on demand, learn -> recall round trip, granular names redirected)");
} catch (err) {
  failed = true;
  console.error("FAIL consolidated e2e:", err);
} finally {
  try { await client?.close(); } catch { /* already closed */ }
  await new Promise((r) => setTimeout(r, 400));
  try { rmSync(DATA_DIR, { recursive: true, force: true }); } catch { /* temp dir */ }
}
process.exit(failed ? 1 : 0);
