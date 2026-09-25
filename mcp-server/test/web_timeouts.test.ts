// How long the hub holds a relayed call (web-timeouts.ts).
//
// The hub clamped every call to 5-65s, but web_takeover and web_request_help wait for a person (up to 10 min)
// and web_wait_download for a download (up to 2 min): the catalog advertises those budgets, the extension honours
// them, and the hub answered TIMEOUT at 65s while the person was still logging in. Ordinary tools are unchanged.

import { test } from "node:test";
import assert from "node:assert/strict";
import { HUB_DEFAULT_WAIT_MS, HUB_MAX_WAIT_MS, HUB_MIN_WAIT_MS, LONG_WAIT_MARGIN_MS, LONG_WAIT_TOOLS, hubWaitMs, longWaitBudgetMs } from "../web-timeouts.js";

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
