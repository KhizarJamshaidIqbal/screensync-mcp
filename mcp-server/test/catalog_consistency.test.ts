// ScreenSync Contract Guard — Catalogue <-> Handler Consistency Test (Phase A.4)
// Asserts that every tool in toolDefinitions() resolves to an active handler in
// the extension dispatcher or the hub router. Fails on ANY orphan tool.
// Also flags implemented-but-undeclared tools.
//
// The cognitive handlers were extracted out of web.ts into web-cognitive-*-handlers.ts. This guard
// used to read only web.ts, so those tools passed solely because their names also sat in the
// extension's dead `case` list (the hub answers them before any relay to the extension). It now
// scans the handler modules, and a second, stricter rule requires every cognitive catalogue tool to
// be answered by the HUB, so a removed hub handler can no longer hide behind the extension mirror.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { resolve, join } from "node:path";
import { toolDefinitions } from "../catalog.js";

const HUB_TOOL_RE = /tool\s*===?\s*["'](web_[a-z0-9_]+)["']/g;
const COGNITIVE_CATALOGS = [
  "catalog-cognitive.ts", "catalog-cognitive-extended.ts", "catalog-lifespan.ts", "catalog-adolescent.ts", "catalog-dynamics.ts", "catalog-transcendental.ts",
];

/** The extracted hub handler modules (the barrel web-cognitive-handlers.ts holds no handlers). */
function cognitiveHandlerModules(): Array<{ name: string; text: string }> {
  return readdirSync(resolve("."))
    .filter((n) => /^web-cognitive-.*-handlers\.ts$/.test(n))
    .sort()
    .map((n) => ({ name: n, text: readFileSync(resolve(n), "utf-8") }));
}

function toolsAnsweredBy(modules: Array<{ text: string }>): Set<string> {
  const answered = new Set<string>();
  for (const m of modules) for (const x of m.text.matchAll(HUB_TOOL_RE)) answered.add(x[1]);
  return answered;
}

function declaredCognitiveTools(): string[] {
  return COGNITIVE_CATALOGS.flatMap((f) =>
    [...readFileSync(resolve(f), "utf-8").matchAll(/^\s*name:\s*["'](web_[a-z0-9_]+)["']/gm)].map((m) => m[1]));
}

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

  // 5. Hub-side web tools in web.ts AND the extracted cognitive handler modules
  const cognitiveHandlerSrc = cognitiveHandlerModules().map((m) => m.text).join("\n");
  const hubWebCases = (webHubSrc + "\n" + cognitiveHandlerSrc).matchAll(/tool\s*===?\s*['"](web_[a-z0-9_]+)['"]/g);
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

test("strict rule: every cognitive catalogue tool is answered by a HUB handler module", () => {
  const declared = declaredCognitiveTools();
  assert.ok(declared.length >= 40, `expected the cognitive catalogues to declare 40+ tools, found ${declared.length}`);

  const modules = cognitiveHandlerModules();
  assert.ok(modules.length >= 4, `expected the four cognitive handler modules, found ${modules.length}: ${modules.map((m) => m.name).join(", ")}`);

  const answered = toolsAnsweredBy(modules);
  const missing = declared.filter((n) => !answered.has(n));
  assert.deepEqual(
    missing,
    [],
    `cognitive tools with no hub handler (they would only work through the extension's dead mirror): ${missing.join(", ")}`,
  );
});

test("the strict rule really detects a removed hub handler (mutation check)", () => {
  const declared = declaredCognitiveTools();
  const modules = cognitiveHandlerModules();

  const without = modules.filter((m) => m.name !== "web-cognitive-ontology-handlers.ts");
  assert.equal(without.length, modules.length - 1, "the ontology handler module must exist for this check to mean anything");

  const answered = toolsAnsweredBy(without);
  const missing = declared.filter((n) => !answered.has(n));
  // Architectures 10.0 and 11.0 live in that module; if the guard were still satisfied by the
  // extension's dead mirror, these would not show up as missing.
  for (const tool of ["web_synaptic_pruning", "web_forgetting_curve", "web_prospective_memory"]) {
    assert.ok(missing.includes(tool), `removing the ontology handlers must surface ${tool} as an orphan`);
  }
});
