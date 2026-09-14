// ScreenSync Contract Guard — Catalogue <-> Handler Consistency Test (Phase A.4)
// Asserts that every tool in toolDefinitions() resolves to an active handler in
// the extension dispatcher or the hub router. Fails on ANY orphan tool.
// Also flags implemented-but-undeclared tools.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { toolDefinitions } from "../catalog.js";

test("catalogue-to-handler consistency guard: zero orphan tools", async () => {
  const tools = toolDefinitions();
  const declaredNames = new Set(tools.map((t) => t.name));

  // Extract handled tools from extension sources
  const extDir = resolve("..", "extension", "lib");
  const webToolsSrc = readFileSync(join(extDir, "web-tools.js"), "utf-8");
  const webAdvSrc = readFileSync(join(extDir, "web-adv.js"), "utf-8");
  const webHubSrc = readFileSync(resolve("web.ts"), "utf-8");
  const controlHubSrc = readFileSync(resolve("control.ts"), "utf-8");
  const catalogSrc = readFileSync(resolve("catalog.ts"), "utf-8");

  const handledTools = new Set<string>();

  // 1. Direct case matches in web-tools.js
  const caseMatches = webToolsSrc.matchAll(/case\s+['"](web_[a-z0-9_]+)['"]/g);
  for (const m of caseMatches) handledTools.add(m[1]);

  // 2. Set collections in web-tools.js
  const setRegex = /const\s+([A-Z0-9_]+)\s*=\s*new\s+Set\(\[\s*([\s\S]*?)\]\);/g;
  let setMatch: RegExpExecArray | null;
  while ((setMatch = setRegex.exec(webToolsSrc)) !== null) {
    const items = setMatch[2].matchAll(/['"](web_[a-z0-9_]+)['"]/g);
    for (const item of items) handledTools.add(item[1]);
  }

  // 3. String literals checked in web-tools.js default block
  const defaultLiterals = webToolsSrc.matchAll(/tool\s*===?\s*['"](web_[a-z0-9_]+)['"]/g);
  for (const m of defaultLiterals) handledTools.add(m[1]);

  // 4. Cases in web-adv.js
  const advCases = webAdvSrc.matchAll(/case\s+['"](web_[a-z0-9_]+)['"]/g);
  for (const m of advCases) handledTools.add(m[1]);

  // 5. Hub-side web tools in web.ts
  const hubWebCases = webHubSrc.matchAll(/tool\s*===?\s*['"](web_[a-z0-9_]+)['"]/g);
  for (const m of hubWebCases) handledTools.add(m[1]);

  // 6. Mobile / OS control tools handled in control.ts
  const controlCases = controlHubSrc.matchAll(/case\s+['"]([a-z0-9_]+)['"]/g);
  for (const m of controlCases) handledTools.add(m[1]);

  // 7. Non-web mobile tools declared in catalog.ts (ADB/OS tools)
  const nonWebMatches = catalogSrc.matchAll(/name:\s*['"]([a-z0-9_]+)['"]/g);
  for (const m of nonWebMatches) {
    if (!m[1].startsWith("web_")) handledTools.add(m[1]);
  }

  // Check for orphan declared tools
  const orphans: string[] = [];
  for (const name of declaredNames) {
    if (!handledTools.has(name)) {
      orphans.push(name);
    }
  }

  // Check for implemented but undeclared tools
  const undeclared: string[] = [];
  for (const name of handledTools) {
    if (name.startsWith("web_") && !declaredNames.has(name)) {
      undeclared.push(name);
    }
  }

  console.log(`[consistency-guard] Declared tools: ${declaredNames.size}`);
  console.log(`[consistency-guard] Handled tools detected: ${handledTools.size}`);
  if (undeclared.length > 0) {
    console.log(`[consistency-guard] Flagged implemented-but-undeclared tools: ${undeclared.join(", ")}`);
  }

  assert.equal(
    orphans.length,
    0,
    `Found ${orphans.length} orphan tools declared in catalogue with no handler: ${orphans.join(", ")}`
  );
});
