// web_request_access: the catalogue contract an agent reads. The behaviour (one request per site, only a
// person grants, allow-once never grants cookies, a decline blocks re-asking) is pinned by
// extension/test/access_request.test.js, where the logic lives.
import test from "node:test";
import assert from "node:assert/strict";
import { toolDefinitions } from "../catalog.js";
import { resolveConsolidatedCall } from "../catalog-consolidated.js";

test("web_request_access: catalogue schema", () => {
  const tool = toolDefinitions().find((t) => t.name === "web_request_access");
  assert.ok(tool, "web_request_access must be declared");
  const schema = tool.inputSchema as any;
  assert.equal(schema.type, "object");
  assert.deepEqual(schema.required, ["reason"], "a reason the person reads is the only required argument");
  assert.equal(schema.additionalProperties, false);
  assert.equal(schema.properties.waitMs.maximum, 30000, "a call must return before the hub gives up on it");
  for (const forbidden of ["approved", "decision", "grant", "confirmed", "force"]) {
    assert.equal(schema.properties[forbidden], undefined, `${forbidden} must not be an argument: only a person answers`);
  }
  assert.match(String(tool.description), /Only a person can answer/);
  assert.match(String(tool.description), /pending/);
});

test("web_request_access: reachable in consolidated mode through web_assist", () => {
  const resolved = resolveConsolidatedCall("web_assist", { action: "request_access", args: { reason: "r" } }) as any;
  assert.equal(resolved.toolName, "web_request_access");
  assert.equal(resolved.args.reason, "r");
});
