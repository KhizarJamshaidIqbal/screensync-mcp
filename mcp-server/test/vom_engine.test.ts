// ScreenSync VOM Engine & Renderer Test Suite
import test from "node:test";
import assert from "node:assert/strict";
import { toolDefinitions } from "../catalog.js";
// @ts-ignore
import * as vomRendererMod from "../../extension/lib/web-vom-renderer.js";
const renderVomTree = (vomRendererMod as any).renderVomTree || (vomRendererMod as any).default?.renderVomTree;
const renderVomContinuation = (vomRendererMod as any).renderVomContinuation || (vomRendererMod as any).default?.renderVomContinuation;

test("web_page_observe: catalogue schema validation", () => {
  const tools = toolDefinitions();
  const observeTool = tools.find((t) => t.name === "web_page_observe");
  assert.ok(observeTool, "web_page_observe must be present in tool definitions");
  assert.equal(observeTool.name, "web_page_observe");

  const schema = observeTool.inputSchema as any;
  assert.equal(schema.type, "object");
  assert.ok(schema.properties.maxTokens, "maxTokens property must exist");
  assert.ok(schema.properties.cursor, "cursor property must exist");
  assert.ok(schema.properties.includeOccluded, "includeOccluded property must exist");
});

test("renderVomTree: structured tree output & refs assignment", () => {
  const mockNodes = [
    {
      id: "node_0",
      backendNodeId: 101,
      role: "RootWebArea",
      name: "Test Store Home",
      depth: 0,
      interactive: false,
      rect: { x: 0, y: 0, width: 1920, height: 1080 },
    },
    {
      id: "node_1",
      backendNodeId: 102,
      role: "heading",
      name: "Welcome to ScreenSync Store",
      depth: 1,
      interactive: false,
      rect: { x: 40, y: 40, width: 600, height: 40 },
    },
    {
      id: "node_2",
      backendNodeId: 103,
      role: "textbox",
      name: "Search catalog",
      depth: 1,
      interactive: true,
      rect: { x: 40, y: 100, width: 300, height: 35 },
    },
    {
      id: "node_3",
      backendNodeId: 104,
      role: "button",
      name: "Submit Search",
      depth: 1,
      interactive: true,
      rect: { x: 350, y: 100, width: 100, height: 35 },
    },
  ];

  const result = renderVomTree(mockNodes, {
    maxTokens: 4000,
    viewport: { width: 1920, height: 1080 },
  });

  assert.ok(result.text.includes("[page] Test Store Home (1920×1080)"));
  assert.ok(result.text.includes("[heading] Welcome to ScreenSync Store"));
  assert.ok(result.text.includes("[textbox @1] Search catalog"));
  assert.ok(result.text.includes("[button @2] Submit Search"));
  assert.equal(result.refs.length, 2);
  assert.equal(result.refs[0].ref, 1);
  assert.equal(result.refs[0].backendNodeId, 103);
  assert.equal(result.refs[1].ref, 2);
  assert.equal(result.refs[1].backendNodeId, 104);
  assert.equal(result.truncated, false);
});

test("renderVomTree: token budget truncation & continuation cursor", () => {
  const mockNodes = Array.from({ length: 50 }, (_, i) => ({
    id: `node_${i}`,
    backendNodeId: 200 + i,
    role: "button",
    name: `Action Button ${i + 1}`,
    depth: 1,
    interactive: true,
    rect: { x: 10, y: i * 30, width: 120, height: 25 },
  }));

  // With a small token budget, it should truncate
  const result = renderVomTree(mockNodes, {
    maxTokens: 100,
    viewport: { width: 1920, height: 1080 },
  });

  assert.equal(result.truncated, true);
  assert.ok(result.lastIndex > 0 && result.lastIndex < 50);

  // Resume using renderVomContinuation
  const contResult = renderVomContinuation(mockNodes, result.lastIndex, {
    maxTokens: 4000,
  });

  assert.ok(contResult.text.length > 0);
  assert.ok(contResult.refs.length > 0);
});
