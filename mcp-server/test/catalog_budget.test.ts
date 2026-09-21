// The cognitive tool surface has a budget.
//
// Every tool schema is paid by EVERY agent session, on every connect, whether or not the tool is ever
// called. When this guard was written the 50 cognitive tools were 27% of the tools/list payload (about
// 42 KB of about 155 KB). This is not a target to shrink towards - the Architecture 12.0 descriptions
// state return codes, thresholds and refusal rules an agent needs, and trimming them would have saved
// under 2% of the payload while deleting real guidance. It is a ceiling, so the surface cannot grow
// without somebody deciding that it should.
//
// If a legitimate addition trips it, raise the constant IN THE SAME COMMIT and say why. That is the point.

import "./_isolate-data-dir.js"; // Must stay the first import (points the data dir at a temp folder)
import test from "node:test";
import assert from "node:assert/strict";
import { cognitiveToolDefinitions } from "../catalog-cognitive.js";
import { lifespanToolDefinitions } from "../catalog-lifespan.js";
import { adolescentToolDefinitions } from "../catalog-adolescent.js";
import { dynamicsToolDefinitions } from "../catalog-dynamics.js";
import { transcendentalToolDefinitions } from "../catalog-transcendental.js";

/** Measured 2026-09-21: 50 tools, 41,885 bytes, the largest 1,684. About 6% of headroom. */
const COGNITIVE_SURFACE_MAX_BYTES = 44_500;
const PER_TOOL_MAX_BYTES = 2_000;

test("the cognitive tool surface stays inside its budget", () => {
  const tools = [...cognitiveToolDefinitions(), ...lifespanToolDefinitions(), ...adolescentToolDefinitions(), ...dynamicsToolDefinitions(), ...transcendentalToolDefinitions()];
  const sized = tools.map((t) => ({ name: t.name, bytes: Buffer.byteLength(JSON.stringify(t), "utf8") }));
  const total = sized.reduce((n, t) => n + t.bytes, 0);

  assert.ok(total <= COGNITIVE_SURFACE_MAX_BYTES, `the ${tools.length} cognitive tools are ${total} bytes; the budget is ${COGNITIVE_SURFACE_MAX_BYTES}. Every session pays this on connect - trim, or raise the budget in this commit and say why.`);
  assert.deepEqual(sized.filter((t) => t.bytes > PER_TOOL_MAX_BYTES), [], `no single tool should exceed ${PER_TOOL_MAX_BYTES} bytes`);
});
