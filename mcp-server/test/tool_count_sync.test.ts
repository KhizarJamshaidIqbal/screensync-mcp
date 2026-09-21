// The published tool count is kept in step with the catalogue by scripts/sync-tool-count.ts.
//
// An earlier version rewrote EVERY animated counter, so goal.html's "Built-in agent prompts: 17" and "Servers
// holding your data: 0" both became 225 and were about to be published on a privacy-first product's site.
// `--check` did not notice, because every counter agreed with the number it had just been given. These tests
// pin that only the counter LABELLED as the tool count moves, and that the pages agree with their own labels.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { promptDefinitions, toolDefinitions } from "../catalog.js";
import { quoted, rewrite } from "../scripts/tool-count-text.js";

const P = '<p class="text-sm font-semibold text-[#7A7291] mt-2">';
const stat = (n: number, label: string) => `<div class="stat-num text-4xl font-extrabold grad-text" data-count="${n}">0</div>${P}${label}</p>`;

// goal.html's stat row as it stood before the bad rewrite.
const GOAL_ROW = [stat(171, "MCP tools today"), stat(17, "Built-in agent prompts"), stat(0, "Servers holding your data")].join("\n");

// index.html labels its counters with a <div>, and its latency and percentage counters carry a suffix.
const INDEX_ROW = [
  '<div class="stat-num text-3xl" data-count="201">0</div><div class="text-xs mt-1">MCP Tools</div>',
  '<div class="stat-num text-3xl" data-count="94" data-suffix="ms">0</div><div class="text-xs mt-1">P50 Latency</div>',
  '<div class="stat-num text-3xl" data-count="100" data-suffix="%">0</div><div class="text-xs mt-1">LAN-first Privacy</div>',
].join("\n");

const counters = (html: string): Map<string, number> => {
  const out = new Map<string, number>();
  for (const m of html.matchAll(/data-count="(\d+)"[^>]*>\d*<\/div>\s*<(?:p|div)[^>]*>([^<]*)</g)) out.set(m[2].trim(), Number(m[1]));
  return out;
};

test("only the counter labelled as the tool count is rewritten", () => {
  const after = counters(rewrite(GOAL_ROW, 225));
  assert.equal(after.get("MCP tools today"), 225);
  assert.equal(after.get("Built-in agent prompts"), 17, "the prompt counter keeps its own number");
  assert.equal(after.get("Servers holding your data"), 0, "and 'servers holding your data' stays 0");
});

test("a <div> label works, and counters with a suffix are left alone", () => {
  const after = counters(rewrite(INDEX_ROW, 225));
  assert.equal(after.get("MCP Tools"), 225);
  assert.equal(after.get("P50 Latency"), 94);
  assert.equal(after.get("LAN-first Privacy"), 100);
});

test("--check reports only real tool-count references", () => {
  assert.deepEqual(quoted(GOAL_ROW), ["171"], "17 and 0 are not tool counts, so they are not drift");
  assert.deepEqual(quoted(rewrite(GOAL_ROW, 225)), ["225"]);
  assert.deepEqual(quoted(INDEX_ROW), ["201"]);
});

test("prose is rewritten too, and other numbers in it are not", () => {
  const prose = "Live screen capture, 201 MCP tools, 171 tools and 17 agent prompts";
  assert.equal(rewrite(prose, 225), "Live screen capture, 225 MCP tools, 225 tools and 17 agent prompts");
});

test("the published goal page agrees with the catalogue and with its own labels", () => {
  const goal = counters(readFileSync(resolve("..", "website", "goal.html"), "utf-8"));
  assert.equal(goal.get("MCP tools today"), toolDefinitions().length);
  assert.equal(goal.get("Built-in agent prompts"), promptDefinitions().length);
  assert.equal(goal.get("Servers holding your data"), 0, "a privacy claim is a number a rewrite must never touch");
});
