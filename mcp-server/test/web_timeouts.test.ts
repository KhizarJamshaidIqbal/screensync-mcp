// How long the hub holds a relayed call (web-timeouts.ts).
//
// The hub clamped every call to 5-65s, but web_takeover and web_request_help wait for a person (up to 10 min)
// and web_wait_download for a download (up to 2 min): the catalog advertises those budgets, the extension honours
// them, and the hub answered TIMEOUT at 65s while the person was still logging in. Ordinary tools are unchanged.

import "./_isolate-data-dir.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { HUB_DEFAULT_WAIT_MS, HUB_MAX_WAIT_MS, HUB_MIN_WAIT_MS, LONG_WAIT_MARGIN_MS, LONG_WAIT_TOOLS, LONGEST_STEP_WAIT_MS, MULTI_STEP_TOOLS, hubWaitMs, longWaitBudgetMs, stepWaitMs } from "../web-timeouts.js";

test("ordinary tools keep the old 5-65s clamp", () => {
  assert.equal(hubWaitMs("web_click", undefined), HUB_DEFAULT_WAIT_MS);
  assert.equal(hubWaitMs("web_click", 45_000), 45_000);
  assert.equal(hubWaitMs("web_click", 100), HUB_MIN_WAIT_MS);
  assert.equal(hubWaitMs("web_expect", 30_000), 30_000);
  assert.equal(hubWaitMs("web_expect", 120_000), HUB_MAX_WAIT_MS);
  assert.equal(hubWaitMs("web_click", "nonsense"), HUB_DEFAULT_WAIT_MS);
  assert.equal(HUB_MAX_WAIT_MS, 65_000);
});

test("the long-wait tools match their catalog defaults and maxima", () => {
  assert.deepEqual(LONG_WAIT_TOOLS.web_takeover, { defaultMs: 300_000, maxMs: 600_000 });
  assert.deepEqual(LONG_WAIT_TOOLS.web_request_help, { defaultMs: 120_000, maxMs: 600_000 });
  assert.deepEqual(LONG_WAIT_TOOLS.web_wait_download, { defaultMs: 30_000, maxMs: 120_000 });
  assert.ok(Object.isFrozen(LONG_WAIT_TOOLS));
});

test("a long-wait tool waits its own budget plus the margin, up to its maximum", () => {
  assert.equal(hubWaitMs("web_takeover", undefined), 300_000 + LONG_WAIT_MARGIN_MS, "no budget given: the tool's default");
  assert.equal(hubWaitMs("web_takeover", 600_000), 600_000 + LONG_WAIT_MARGIN_MS);
  assert.equal(hubWaitMs("web_takeover", 3_600_000), 600_000 + LONG_WAIT_MARGIN_MS, "capped at the catalog maximum");
  assert.equal(hubWaitMs("web_request_help", 200_000), 200_000 + LONG_WAIT_MARGIN_MS);
  assert.equal(hubWaitMs("web_request_help", undefined), 120_000 + LONG_WAIT_MARGIN_MS);
  assert.equal(hubWaitMs("web_wait_download", 90_000), 90_000 + LONG_WAIT_MARGIN_MS, "past the old 65s clamp");
  assert.equal(hubWaitMs("web_wait_download", 1_000), 1_000 + LONG_WAIT_MARGIN_MS, "a short budget stays short");
  assert.equal(hubWaitMs("web_wait_download", 500_000), 120_000 + LONG_WAIT_MARGIN_MS);
  assert.equal(hubWaitMs("web_wait_download", -5), 30_000 + LONG_WAIT_MARGIN_MS, "an invalid budget means the default");
});

test("longWaitBudgetMs: null for every other tool, and without a tool", () => {
  assert.equal(longWaitBudgetMs("web_click", 600_000), null);
  assert.equal(longWaitBudgetMs(undefined, 600_000), null);
  assert.equal(longWaitBudgetMs("web_takeover", undefined), 300_000);
  assert.equal(longWaitBudgetMs("web_takeover", 60_000), 60_000);
});

test("stepWaitMs: a relayed long-wait step keeps its own budget; any other step keeps the relay's timeout", () => {
  assert.equal(stepWaitMs("web_takeover", { timeoutMs: 200_000 }, 60_000), 200_000 + LONG_WAIT_MARGIN_MS);
  assert.equal(stepWaitMs("web_takeover", {}, 60_000), 300_000 + LONG_WAIT_MARGIN_MS, "the tool's default budget");
  assert.equal(stepWaitMs("web_wait_download", { timeoutMs: 1_000 }, 45_000), 45_000, "never shorter than the relay's timeout");
  assert.equal(stepWaitMs("web_click", { timeoutMs: 600_000 }, 45_000), 45_000);
  assert.equal(stepWaitMs("web_takeover", undefined, 45_000), 300_000 + LONG_WAIT_MARGIN_MS);
  assert.equal(LONGEST_STEP_WAIT_MS, 600_000 + LONG_WAIT_MARGIN_MS);
});

test("a multi-step call's steps share one budget: each waits at most what is left, none starts once it is spent", async () => {
  const { fitStepToBudget, MULTI_STEP_BUDGET_MS, MIN_STEP_BUDGET_MS } = await import("../web-timeouts.js");
  const { withCallBudget, CALL_BUDGET_SPENT } = await import("../web-multi-dispatch.js");
  const { transportTimeoutMs, HUB_MAX_HOLD_MS } = await import("../hub-web-call.js");
  // Plenty left: unchanged.
  assert.deepEqual(fitStepToBudget("web_click", { a: 1 }, 45_000, 600_000), { args: { a: 1 }, timeoutMs: 45_000 });
  assert.deepEqual(fitStepToBudget("web_takeover", { timeoutMs: 600_000 }, 45_000, MULTI_STEP_BUDGET_MS), { args: { timeoutMs: 600_000 }, timeoutMs: 45_000 });
  // Little left: the relay waits only that long, and a long tool's own budget shrinks so the browser gives up too.
  assert.deepEqual(fitStepToBudget("web_click", {}, 45_000, 20_000), { args: {}, timeoutMs: 20_000 });
  const fitted = fitStepToBudget("web_takeover", { timeoutMs: 600_000, reason: "x" }, 45_000, 100_000)!;
  assert.deepEqual(fitted, { args: { timeoutMs: 100_000 - LONG_WAIT_MARGIN_MS, reason: "x" }, timeoutMs: 45_000 });
  assert.equal(stepWaitMs("web_takeover", fitted.args, fitted.timeoutMs), 100_000, "the hub's wait for it fits exactly");
  assert.equal(fitStepToBudget("web_click", {}, 45_000, MIN_STEP_BUDGET_MS - 1), null, "too little left: not started");

  // Two 10-minute takeovers in one call: the second is never sent.
  let t = 0;
  const sent: Array<{ tool: string; args: Record<string, unknown>; timeoutMs: number }> = [];
  const step = withCallBudget(async (tool, args, timeoutMs) => {
    sent.push({ tool, args, timeoutMs });
    t += stepWaitMs(tool, args, timeoutMs); // the step holds the hub for its whole wait
    return { ok: false, code: "TAKEOVER_TIMEOUT" };
  }, MULTI_STEP_BUDGET_MS, () => t);
  await step("web_takeover", { timeoutMs: 600_000 }, 45_000, "s");
  const second = await step("web_takeover", { timeoutMs: 600_000 }, 45_000, "s");
  assert.equal(sent.length, 1, "the second takeover is not relayed");
  assert.equal(second.code, CALL_BUDGET_SPENT);
  assert.equal(second.retryable, false);
  assert.ok(t <= MULTI_STEP_BUDGET_MS, "the call ended within its budget");
  // The MCP side outlives the budget plus one approval hold on the last step.
  for (const multi of MULTI_STEP_TOOLS) {
    assert.ok(transportTimeoutMs(45_000, multi) > MULTI_STEP_BUDGET_MS + HUB_MAX_HOLD_MS, `${multi}: transport outlives the call budget`);
  }
});
