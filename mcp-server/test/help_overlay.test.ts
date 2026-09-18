// ScreenSync Help Overlay & Completion Criteria Test Suite
import test from "node:test";
import assert from "node:assert/strict";
import { toolDefinitions } from "../catalog.js";
// @ts-ignore
import * as helpMod from "../../extension/lib/web-unit-help-overlay.js";
const ssCheckCompletionCriteria = (helpMod as any).ssCheckCompletionCriteria || (helpMod as any).default?.ssCheckCompletionCriteria;

test("web_request_help: catalogue schema validation", () => {
  const tools = toolDefinitions();
  const helpTool = tools.find((t) => t.name === "web_request_help");
  assert.ok(helpTool, "web_request_help must be present in tool definitions");
  assert.equal(helpTool.name, "web_request_help");

  const schema = helpTool.inputSchema as any;
  assert.equal(schema.type, "object");
  assert.ok(schema.required.includes("prompt"), "prompt must be required");
  assert.ok(schema.properties.prompt, "prompt property must exist");
  assert.ok(schema.properties.targetSelector, "targetSelector property must exist");
  assert.ok(schema.properties.timeoutMs, "timeoutMs property must exist");
  assert.ok(schema.properties.completionCriteria, "completionCriteria property must exist");
});

test("ssCheckCompletionCriteria: urlChanged detection", () => {
  // Mock global location
  const origLocation = (globalThis as any).location;
  (globalThis as any).location = { href: "https://example.com/checkout/success" };

  try {
    const result = ssCheckCompletionCriteria({
      startUrl: "https://example.com/checkout",
    });
    assert.equal(result.met, true);
    assert.equal(result.reason, "urlChanged");
  } finally {
    (globalThis as any).location = origLocation;
  }
});

test("ssCheckCompletionCriteria: selectorAppeared / selectorGone", () => {
  // Mock document.querySelector
  const origDoc = (globalThis as any).document;
  (globalThis as any).document = {
    querySelector: (sel: string) => {
      if (sel === "#success-badge") return { tagName: "DIV" };
      if (sel === ".captcha-modal") return null;
      return null;
    },
  };

  try {
    const appearedRes = ssCheckCompletionCriteria({ selectorAppeared: "#success-badge" });
    assert.equal(appearedRes.met, true);
    assert.equal(appearedRes.reason, "selectorAppeared");

    const goneRes = ssCheckCompletionCriteria({ selectorGone: ".captcha-modal" });
    assert.equal(goneRes.met, true);
    assert.equal(goneRes.reason, "selectorGone");

    const notAppeared = ssCheckCompletionCriteria({ selectorAppeared: "#missing" });
    assert.equal(notAppeared.met, false);
  } finally {
    (globalThis as any).document = origDoc;
  }
});
