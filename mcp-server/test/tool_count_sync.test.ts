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
// A counter shows its real number (the page reads right without JS); the script only animates it up from 0.
const stat = (n: number, label: string) => `<div class="stat-num text-4xl font-extrabold grad-text" data-count="${n}">${n}</div>${P}${label}</p>`;

// goal.html's stat row as it stood before the bad rewrite.
const GOAL_ROW = [stat(171, "MCP tools today"), stat(17, "Built-in agent prompts"), stat(0, "Servers holding your data")].join("\n");

// index.html labelled its counters with a <div>, and its latency and percentage counters carry a suffix.
const INDEX_ROW = [
  '<div class="stat-num text-3xl" data-count="201">201</div><div class="text-xs mt-1">MCP Tools</div>',
  '<div class="stat-num text-3xl" data-count="94" data-suffix="ms">94</div><div class="text-xs mt-1">P50 Latency</div>',
  '<div class="stat-num text-3xl" data-count="100" data-suffix="%">100</div><div class="text-xs mt-1">LAN-first Privacy</div>',
].join("\n");

// Since the SEO pass (133c876) index.html's counter is itself a <p>, which the rewrite silently skipped.
const HERO = '<p class="stat-num text-2xl" data-count="201">201</p><p class="text-xs mt-1">MCP tools</p>';

type Counter = { count: number; shown: string; label: string };
const counters = (html: string): Counter[] =>
  [...html.matchAll(/data-count="(\d+)"[^>]*>(\d*)<\/(?:div|p)>\s*<(?:p|div)[^>]*>([^<]*)</g)]
    .map((m) => ({ count: Number(m[1]), shown: m[2], label: m[3].trim() }));

// The one counter whose label matches. A pattern rather than the exact text, so the copy can grow
// ("MCP tools today: 29 for phone and desktop, ...") without the guard going blind; two matches fail too.
const counter = (html: string, label: RegExp): Counter => {
  const hits = counters(html).filter((c) => label.test(c.label));
  assert.equal(hits.length, 1, `one counter labelled ${label}, found: ${hits.map((c) => c.label).join(" | ") || "none"}`);
  return hits[0];
};

test("only the counter labelled as the tool count is rewritten, its shown number too", () => {
  const after = rewrite(GOAL_ROW, 225);
  assert.deepEqual(counter(after, /^MCP tools/), { count: 225, shown: "225", label: "MCP tools today" });
  assert.equal(counter(after, /agent prompts/).count, 17, "the prompt counter keeps its own number");
  assert.equal(counter(after, /servers holding your data/i).count, 0, "and 'servers holding your data' stays 0");
});

test("<div> and <p> counters work, and counters with a suffix are left alone", () => {
  const after = rewrite(INDEX_ROW, 225);
  assert.equal(counter(after, /MCP Tools/).count, 225);
  assert.equal(counter(after, /P50 Latency/).count, 94);
  assert.equal(counter(after, /LAN-first Privacy/).count, 100);
  assert.deepEqual(counter(rewrite(HERO, 225), /MCP tools/), { count: 225, shown: "225", label: "MCP tools" });
});

test("--check reports only real tool-count references", () => {
  assert.deepEqual(quoted(GOAL_ROW), ["171", "171"], "17 and 0 are not tool counts, so they are not drift");
  assert.deepEqual(quoted(rewrite(GOAL_ROW, 225)), ["225", "225"]);
  assert.deepEqual(quoted(INDEX_ROW), ["201", "201"]);
  assert.deepEqual(quoted(HERO.replace(">201<", ">199<")), ["201", "199"], "a counter showing a stale number is drift");
});

test("prose is rewritten too, and other numbers in it are not", () => {
  const prose = "Live screen capture, 201 MCP tools, 171 tools and 17 agent prompts";
  assert.equal(rewrite(prose, 225), "Live screen capture, 225 MCP tools, 225 tools and 17 agent prompts");
});

test("the published goal page agrees with the catalogue and with its own labels", () => {
  const goal = readFileSync(resolve("..", "website", "goal.html"), "utf-8");
  const tools = toolDefinitions();
  const browser = tools.filter((t) => t.name.startsWith("web_")).length;
  const total = counter(goal, /^MCP tools\b/);
  assert.equal(total.count, tools.length);
  // The label breaks the total down ("29 for phone and desktop, 197 for the browser"). The sync does not
  // rewrite that, so a new tool fails here until the copy is updated by hand.
  const split = total.label.match(/\d+/g)?.map(Number) ?? [];
  if (split.length) assert.deepEqual(split, [tools.length - browser, browser], `"${total.label}" no longer matches the catalogue`);
  assert.equal(counter(goal, /agent prompts/i).count, promptDefinitions().length);
  assert.equal(counter(goal, /servers holding your data/i).count, 0, "a privacy claim is a number a rewrite must never touch");
  for (const c of counters(goal)) assert.equal(c.shown, String(c.count), `"${c.label}" shows ${c.shown} but animates to ${c.count}`);
});
