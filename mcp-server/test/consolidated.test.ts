// ScreenSync Consolidated Meta-Tooling Test Suite
import test from "node:test";
import assert from "node:assert/strict";
import {
  consolidatedToolDefinitions,
  resolveConsolidatedCall,
  getToolsForMode,
  isConsolidatedMode,
} from "../catalog-consolidated.js";
import { toolDefinitions as granularToolDefinitions } from "../catalog.js";

test("consolidatedToolDefinitions returns exactly 8 meta-tools", () => {
  const tools = consolidatedToolDefinitions();
  assert.equal(tools.length, 8);

  const expectedNames = [
    "web_session",
    "web_page",
    "web_inspect",
    "web_interact",
    "web_tabs",
    "web_assist",
    "web_evidence",
    "mobile_control",
  ];

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
    assert.equal(getToolsForMode().length, 8);

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
