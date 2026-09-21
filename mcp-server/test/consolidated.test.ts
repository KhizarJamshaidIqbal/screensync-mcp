// ScreenSync Consolidated Meta-Tooling Test Suite
// Must stay the first import: see _isolate-data-dir.ts
import "./_isolate-data-dir.js";
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  catalogFor,
  consolidatedToolDefinitions,
  resolveConsolidatedCall,
  getToolsForMode,
  isConsolidatedMode,
} from "../catalog-consolidated.js";
import { toolDefinitions as granularToolDefinitions } from "../catalog.js";
import { cognitiveToolDefinitions } from "../catalog-cognitive.js";
import { lifespanToolDefinitions } from "../catalog-lifespan.js";
import { adolescentToolDefinitions } from "../catalog-adolescent.js";
import { dynamicsToolDefinitions } from "../catalog-dynamics.js";
import { transcendentalToolDefinitions } from "../catalog-transcendental.js";

const cognitiveNames = (): string[] => [...cognitiveToolDefinitions(), ...lifespanToolDefinitions(), ...adolescentToolDefinitions(), ...dynamicsToolDefinitions(), ...transcendentalToolDefinitions()].map((t) => t.name);
const bytes = (v: unknown): number => Buffer.byteLength(JSON.stringify(v), "utf8");
const mindActions = (): string[] => (consolidatedToolDefinitions().find((t) => t.name === "web_mind")!.inputSchema.properties.action as { enum: string[] }).enum;

test("consolidatedToolDefinitions returns the meta-tools, cognitive memory included", () => {
  const tools = consolidatedToolDefinitions();

  const expectedNames = [
    "web_session",
    "web_page",
    "web_inspect",
    "web_interact",
    "web_tabs",
    "web_assist",
    "web_evidence",
    "mobile_control",
    "web_mind",
  ];
  assert.equal(tools.length, expectedNames.length, "no meta-tool beyond the ones listed here");

  for (const name of expectedNames) {
    const t = tools.find((tool) => tool.name === name);
    assert.ok(t, `Tool ${name} must exist`);
    assert.equal(t.inputSchema.type, "object");
    assert.ok(t.inputSchema.properties.action, `Tool ${name} must have action property`);
    assert.deepEqual(t.inputSchema.required, ["action"]);
  }
});

test("all mapped granular tools exist in actual granular catalog", () => {
  const granularTools = granularToolDefinitions();
  const granularNameSet = new Set(granularTools.map((t) => t.name));

  const metaTools = consolidatedToolDefinitions();
  const missing: string[] = [];

  for (const mt of metaTools) {
    const enumActions = (mt.inputSchema.properties.action as any).enum as string[];
    assert.ok(enumActions && enumActions.length > 0, `Meta tool ${mt.name} must have enum actions`);

    for (const act of enumActions) {
      const res = resolveConsolidatedCall(mt.name, { action: act });
      if ("error" in res) {
        missing.push(`${mt.name}:${act} -> ERROR: ${res.error}`);
      } else if (!granularNameSet.has(res.toolName)) {
        missing.push(`${mt.name}:${act} -> ${res.toolName}`);
      }
    }
  }

  if (missing.length > 0) {
    console.log("Missing granular tools:", missing);
  }
  assert.equal(missing.length, 0, `All actions must map to existing granular tools. Missing: ${missing.join(", ")}`);
});

test("resolveConsolidatedCall maps actions correctly", () => {
  // web_session
  const sessRes = resolveConsolidatedCall("web_session", { action: "status", args: { verbose: true } });
  assert.deepEqual(sessRes, { toolName: "web_status", args: { verbose: true } });

  // web_page
  const navRes = resolveConsolidatedCall("web_page", { action: "navigate", args: { url: "https://example.com" } });
  assert.deepEqual(navRes, { toolName: "web_navigate", args: { url: "https://example.com" } });

  // web_inspect
  const obsRes = resolveConsolidatedCall("web_inspect", { action: "observe", args: { maxTokens: 2000 } });
  assert.deepEqual(obsRes, { toolName: "web_page_observe", args: { maxTokens: 2000 } });

  // web_interact
  const clickRes = resolveConsolidatedCall("web_interact", { action: "click", args: { selector: "button#submit" } });
  assert.deepEqual(clickRes, { toolName: "web_click", args: { selector: "button#submit" } });

  // web_tabs
  const tabRes = resolveConsolidatedCall("web_tabs", { action: "list" });
  assert.deepEqual(tabRes, { toolName: "web_tab", args: { action: "list" } });

  // web_assist
  const helpRes = resolveConsolidatedCall("web_assist", {
    action: "request_help",
    args: { message: "Solve CAPTCHA" },
  });
  assert.deepEqual(helpRes, { toolName: "web_request_help", args: { message: "Solve CAPTCHA" } });

  // web_evidence
  const baseRes = resolveConsolidatedCall("web_evidence", {
    action: "visual_baseline",
    args: { name: "checkout" },
  });
  assert.deepEqual(baseRes, { toolName: "web_visual_baseline", args: { name: "checkout" } });

  // mobile_control
  const tapRes = resolveConsolidatedCall("mobile_control", { action: "tap", args: { x: 100, y: 200 } });
  assert.deepEqual(tapRes, { toolName: "control_tap", args: { x: 100, y: 200 } });
});

test("resolveConsolidatedCall error handling", () => {
  const invalidMeta = resolveConsolidatedCall("non_existent_meta", { action: "status" });
  assert.ok("error" in invalidMeta);
  assert.match(invalidMeta.error, /Unknown meta-tool/);

  const invalidAction = resolveConsolidatedCall("web_session", { action: "destroy_everything" });
  assert.ok("error" in invalidAction);
  assert.match(invalidAction.error, /Unknown action 'destroy_everything'/);
});

test("getToolsForMode reacts to TOOL_MODE environment variable", () => {
  const oldEnv = process.env.TOOL_MODE;
  try {
    process.env.TOOL_MODE = "consolidated";
    assert.equal(isConsolidatedMode(), true);
    assert.equal(getToolsForMode().length, consolidatedToolDefinitions().length);

    delete process.env.TOOL_MODE;
    assert.equal(isConsolidatedMode(), false);
    assert.equal(getToolsForMode().length, granularToolDefinitions().length);
  } finally {
    if (oldEnv !== undefined) {
      process.env.TOOL_MODE = oldEnv;
    } else {
      delete process.env.TOOL_MODE;
    }
  }
});

// ── web_mind: the cognitive tools, reachable from one meta-tool ────────────────

test("web_mind reaches EVERY cognitive tool, and only cognitive tools", () => {
  // Consolidated mode had no cognitive tools at all: they were neither listed nor callable, so an agent
  // in this mode could not recall what the hub had learned about a site.
  const reached = new Map<string, string>();
  for (const action of mindActions()) {
    if (action === "help") continue;
    const res = resolveConsolidatedCall("web_mind", { action });
    assert.ok("toolName" in res, `${action} must resolve`);
    reached.set(action, res.toolName);
  }
  const cognitive = cognitiveNames();
  assert.deepEqual([...reached.values()].sort(), [...cognitive].sort(), "the map and the catalogues agree, in both directions");
  assert.equal(reached.size, cognitive.length, "no two tools share an action");
  for (const action of reached.keys()) assert.doesNotMatch(action, /^web_/, `${action}: the meta-tool is already 'mind', the prefix says nothing`);
});

test("web_mind hands the caller's arguments through untouched", () => {
  assert.deepEqual(resolveConsolidatedCall("web_mind", { action: "recall", args: { domain: "x.com", intent: "post" } }), { toolName: "web_recall", args: { domain: "x.com", intent: "post" } });
  // The tool's OWN `action` argument stays nested in args, so it cannot be mistaken for the meta-tool's.
  assert.deepEqual(resolveConsolidatedCall("web_mind", { action: "stage", args: { domain: "x.com", action: "next" } }), { toolName: "web_cognitive_stage", args: { domain: "x.com", action: "next" } });

  const bad = resolveConsolidatedCall("web_mind", { action: "forget_everything" });
  assert.ok("error" in bad);
  assert.match(bad.error, /Unknown action 'forget_everything'.*recall/, "and the error lists what is valid");
});

test("help asks get_mcp_catalog for one target, named by action or by tool", () => {
  // The resolver only normalises the target; catalogFor is what looks it up (tested below).
  assert.deepEqual(resolveConsolidatedCall("web_mind", { action: "help", args: { action: "learn" } }), { toolName: "get_mcp_catalog", args: { tool: "learn" } });
  assert.deepEqual(resolveConsolidatedCall("web_mind", { action: "help", args: { tool: "web_learn" } }), { toolName: "get_mcp_catalog", args: { tool: "web_learn" } });
  assert.deepEqual(resolveConsolidatedCall("web_mind", { action: "help" }), { toolName: "get_mcp_catalog", args: { tool: "web_mind" } }, "with no target: the overview");
});

test("catalogFor returns exactly one definition, and says how to reach it", () => {
  const old = process.env.TOOL_MODE;
  try {
    delete process.env.TOOL_MODE;
    const one = catalogFor({ tool: "web_recall" }) as { success: boolean; tool: unknown; reachedVia?: unknown };
    assert.equal(one.success, true);
    assert.deepEqual(one.tool, granularToolDefinitions().find((t) => t.name === "web_recall"), "the granular definition, unabridged");
    assert.equal(one.reachedVia, undefined, "the default mode has no meta-tool to route through");
    for (const empty of [undefined, null, {}, { tool: "" }, { tool: 7 }]) {
      assert.ok("tools" in (catalogFor(empty as never) as object), "no target: the whole catalogue, exactly as before");
    }

    process.env.TOOL_MODE = "consolidated";
    const viaMind = catalogFor({ tool: "recall" }) as { tool: { name: string }; reachedVia: unknown };
    assert.equal(viaMind.tool.name, "web_recall", "an action name works too");
    assert.deepEqual(viaMind.reachedVia, { tool: "web_mind", action: "recall" });
    assert.deepEqual((catalogFor({ tool: "web_status" }) as { reachedVia: unknown }).reachedVia, { tool: "web_session", action: "status" });

    const miss = catalogFor({ tool: "web_recal" }) as { success: boolean; didYouMean?: string[] };
    assert.equal(miss.success, false);
    assert.deepEqual(miss.didYouMean, ["web_recall"]);

    const overview = catalogFor({ tool: "web_mind" }) as { actions: Record<string, string> };
    assert.deepEqual(Object.keys(overview.actions).sort(), [...mindActions()].sort(), "every action gets a line");
    for (const [action, line] of Object.entries(overview.actions)) assert.ok(line.length > 10, `${action} needs a real summary`);
    assert.match(overview.actions.help, /exact schema/, "help describes itself, rather than borrowing get_mcp_catalog's description");
    assert.ok("screenshot" in (catalogFor({ tool: "web_inspect" }) as { actions: object }).actions, "any meta-tool can be asked what its actions do");
  } finally {
    if (old !== undefined) process.env.TOOL_MODE = old; else delete process.env.TOOL_MODE;
  }
});

test("a granular tool called in consolidated mode is told where it went", () => {
  const res = resolveConsolidatedCall("web_recall", { action: "x" });
  assert.ok("error" in res);
  assert.match(res.error, /In this mode it is web_mind with action "recall"/);
  const unknown = resolveConsolidatedCall("nonsense_tool", { action: "x" });
  assert.ok("error" in unknown);
  assert.equal(unknown.error, "Unknown meta-tool: nonsense_tool.", "and a name that exists nowhere gets no false hint");
});

test("the diet is real: the whole cognitive surface costs a fraction of its granular size", () => {
  const mind = consolidatedToolDefinitions().find((t) => t.name === "web_mind")!;
  const granular = bytes(granularToolDefinitions().filter((t) => cognitiveNames().includes(t.name)));
  assert.ok(bytes(mind) < 2_500, `web_mind should stay small, was ${bytes(mind)} bytes`);
  assert.ok(bytes(mind) * 10 < granular, `web_mind (${bytes(mind)} bytes) should be under a tenth of the ${granular} bytes it stands in for`);
});

test("no tool count is typed into the consolidated header", () => {
  // It once said "175 granular tools" for a catalogue of 225. A number in prose is a number that drifts.
  assert.doesNotMatch(readFileSync(resolve("catalog-consolidated.ts"), "utf-8"), /\b\d{2,3}\s+(granular\s+)?tools\b/i);
});
