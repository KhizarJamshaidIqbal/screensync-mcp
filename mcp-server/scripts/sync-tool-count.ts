// Keeps the published tool count in sync with the catalogue (F7).
//
//   npx tsx scripts/sync-tool-count.ts          # rewrite the docs
//   npx tsx scripts/sync-tool-count.ts --check  # fail if anything disagrees
//
// The count is read from the catalogue itself, never typed by hand.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { toolDefinitions } from "../catalog.js";
import { quoted, rewrite } from "./tool-count-text.js";

const ROOT = resolve(import.meta.dirname, "..", "..");
const TARGETS = [
  "README.md",
  "extension/README.md",
  "website/about.html",
  "website/extension.html",
  "website/index.html",
  // Was omitted until 12.0 and had silently drifted to 171 as a result.
  "website/goal.html",
];

const count = toolDefinitions().length;
const checkOnly = process.argv.includes("--check");

// The text rules live in tool-count-text.ts (pure, and pinned by test/tool_count_sync.test.ts).

let drift = 0;
for (const rel of TARGETS) {
  const file = resolve(ROOT, rel);
  if (!existsSync(file)) { console.log("  missing: " + rel); continue; }
  const before = readFileSync(file, "utf8");
  const found = quoted(before);
  const wrong = found.filter((n) => n !== String(count));
  if (checkOnly) {
    if (wrong.length) { drift++; console.log("  DRIFT " + rel + " -> " + wrong.join(", ") + " (expected " + count + ")"); }
    else console.log("  ok    " + rel);
    continue;
  }
  const after = rewrite(before, count);
  if (after !== before) { writeFileSync(file, after, "utf8"); console.log("  updated " + rel + "  (" + found.length + " refs)"); }
  else console.log("  ok      " + rel);
}

console.log("\ncatalogue tool count: " + count);
if (checkOnly) {
  if (drift) { console.log("RESULT: drift in " + drift + " file(s)"); process.exit(1); }
  console.log("RESULT: every published count matches the catalogue");
}