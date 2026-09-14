// Guards the MCP extension-control surface.
//
// Decision of 2026-09-14 (owner-confirmed): the web-access gate stays READ-ONLY over MCP.
// It is the control that stops an agent from reading the user's browsing, so an agent must
// never be able to switch it back on after the user has turned it off. This suite fails if a
// future change quietly turns that off switch into a suggestion.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';

const ROOT = resolve(import.meta.dirname, '..', '..');
// SS_CATALOG lets a harness point this guard at a mutated copy, to prove it has teeth.
const catalog = readFileSync(process.env.SS_CATALOG || resolve(ROOT, 'mcp-server', 'catalog-web.ts'), 'utf-8');
const tools = readFileSync(resolve(ROOT, 'extension', 'lib', 'web-tools.js'), 'utf-8');

console.log('[test] running extension tool surface guard...');

// 1. web_extension_settings must not accept a writable argument.
const at = catalog.indexOf('name: "web_extension_settings"');
assert.ok(at > -1, 'web_extension_settings must exist in the catalogue');
const block = catalog.slice(at, at + 900);   // generous window: covers description + inputSchema

assert.ok(
  block.includes('additionalProperties: false'),
  'web_extension_settings must reject unknown properties'
);

// Read ONLY the keys declared inside the tool's own properties object.
const pAt = block.indexOf('properties: {');
const propsSrc = pAt > -1 ? block.slice(pAt + 'properties: {'.length, block.indexOf('}', pAt)) : '';
const declaredProps = [...propsSrc.matchAll(/([A-Za-z_]\w*)\s*:/g)].map((m) => m[1]);
const writish = declaredProps.filter((p) => /(enab|set|toggle|action|value|write|patch)/i.test(p));
assert.equal(
  writish.length,
  0,
  'web_extension_settings must not expose a writable argument: ' + writish.join(', ')
);

// 2. No extension tool may exist whose name implies it sets web access.
const setters = [...catalog.matchAll(/name:\s*"(web_extension_[a-z0-9_]*)"/g)]
  .map((m) => m[1])
  .filter((n) => n !== 'web_extension_settings')   // read-only reader, not a setter
  .filter((n) => /(enab|toggle|grant|write|revoke)/i.test(n));
assert.equal(setters.length, 0, 'no extension tool may act as a web-access setter: ' + setters.join(', '));

// 3. The settings handler must be a pure reader.
const hAt = tools.indexOf("case 'web_extension_settings'");
assert.ok(hAt > -1, 'the web_extension_settings handler must exist');
const nextCase = tools.indexOf("case '", hAt + 10);
const handler = nextCase > 0 ? tools.slice(hAt, nextCase) : tools.slice(hAt, hAt + 1500);

assert.ok(
  !handler.includes('saveSettings'),
  'the settings handler must never write settings (no saveSettings call)'
);
assert.ok(
  handler.includes('readOnly: true'),
  'the settings handler must report itself read-only so callers know it cannot change anything'
);

// 4. The gate itself must still be a real gate in the service worker.
assert.ok(
  tools.includes('if (!s.webAccessEnabled)'),
  'the webAccessEnabled gate must still short-circuit web tool execution'
);

// 5. The consent record is the user's, not the agent's: web_consent must be read-only.
const cAt = tools.indexOf("case 'web_consent'");
assert.ok(cAt > -1, 'the web_consent handler must exist');
const cNext = tools.indexOf("case '", cAt + 10);
const consentHandler = cNext > 0 ? tools.slice(cAt, cNext) : tools.slice(cAt, cAt + 1200);
assert.ok(!consentHandler.includes('saveOriginGrant'),
  'web_consent must never call saveOriginGrant - an agent must not grant itself origin access');
assert.ok(!consentHandler.includes('revokeOriginGrant'),
  'web_consent must never call revokeOriginGrant - an agent must not alter the user consent record');
assert.ok(consentHandler.includes('readOnly: true'),
  'web_consent must report itself read-only');

console.log('[test] extension_tools_guard.test.js: ALL ASSERTIONS PASSED (the gate stays read-only)');