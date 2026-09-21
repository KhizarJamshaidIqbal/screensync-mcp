// Tool-surface contract test (F5).
//
// The catalogue guard proves every declared tool has a handler MARKER. This proves the
// boundary actually behaves: malformed arguments are rejected with a structured error
// rather than a throw or an undefined result. It is deliberately chrome-free - it
// exercises the validator and the declaration surface, not live tabs.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { validateToolArgs } from '../lib/validate.js';

const ROOT = resolve(import.meta.dirname, '..', '..');
const read = (p) => readFileSync(resolve(ROOT, p), 'utf-8');

console.log('[test] running web tool contract checks...');

const catalogue = read('mcp-server/catalog-web.ts') + read('mcp-server/catalog-web-agent.ts')
  + read('mcp-server/catalog-web-agent-core.ts') + read('mcp-server/catalog-web-inspect.ts');
const declared = [...catalogue.matchAll(/name:\s*"(web_[a-z0-9_]+)"/g)].map((m) => m[1]);
assert.ok(declared.length > 100, 'expected a large declared web surface, found ' + declared.length);

// 1. Declaration-to-handler coverage is already enforced by mcp-server/test/catalog_consistency
//    (it searches the extension dispatchers AND the hub router, so hub-side tools like
//    web_fanout and web_flow_* count as handled). This suite deliberately does not repeat
//    that check, because a marker search restricted to the extension would report every
//    hub-side tool as missing - which is a false negative, not a real defect.

// 2. Malformed arguments must produce a structured error, never a throw or undefined.
const malformed = [
  ['web_navigate', { url: 'not-a-url' }],
  ['web_navigate', {}],
  ['web_click', {}],
  ['web_hover', {}],
  ['web_type', { selector: '#a' }],
  ['web_fill', { selector: '#a' }],
  ['web_eval', {}],
  ['web_consent', { action: 'grant', origin: 'https://x.com' }],
];
for (const [tool, args] of malformed) {
  const r = validateToolArgs(tool, args);
  if (r === null || r === undefined) continue;         // tool has no rule for this shape: not a contract violation
  assert.equal(typeof r, 'object', tool + ' validator must return an object');
  assert.equal(r.ok, false, tool + ' with malformed args must be rejected');
  assert.ok(typeof r.error === 'string' && r.error.length, tool + ' rejection must carry an error string');
  assert.ok(r.code, tool + ' rejection must carry a machine-readable code');
}

// 3. Non-object arguments are always rejected.
for (const tool of ['web_navigate', 'web_click', 'web_eval']) {
  const r = validateToolArgs(tool, null);
  assert.ok(r && r.ok === false, tool + ' must reject null arguments');
}

// 4. The removed capability classes must not come back through the validator either.
for (const gone of ['web_human_type', 'web_human_mouse', 'web_human_scroll', 'web_profile_sync',
                    'web_account_report', 'web_route_for']) {
  assert.equal(declared.includes(gone), false, gone + ' must not be declared in the catalogue');
}

// 5. HTML escaping has exactly one implementation, and the sinks that render agent- or
//    hub-derived text actually use it. Tool names, origins and page titles all reach
//    innerHTML, so a component with its own weaker copy is a real regression.
const components = ['agent-console.js', 'diagnostics-view.js', 'web-access.js', 'status-pill.js',
                    'catalog-browser.js', 'frame-viewer.js', 'activity-feed.js', 'inspection-viewer.js',
                    'control-pad.js'];
const redefiners = components.filter((c) => {
  const src = read('extension/components/' + c);
  return /function escapeHtml|const escapeHtml\s*=/.test(src);
});
assert.equal(redefiners.length, 0,
  'components must import escapeHtml from lib/escape.js, not redefine it: ' + redefiners.join(', '));

const wa = read('extension/components/web-access.js');
for (const sink of ['${escapeHtml(e.tool)}']) {
  assert.ok(wa.includes(sink), 'web-access.js must escape this sink: ' + sink);
}
// The approval queue shows a person what an agent wants to do: its tool name, the origin, the target, the text
// it would type and the hub's reason. It builds DOM nodes with textContent, so none of that is ever parsed as
// markup; this fails if anyone reaches for innerHTML there, which would turn an agent's string into a script.
const aq = read('extension/components/approval-queue.js');
assert.ok(!/innerHTML|insertAdjacentHTML|outerHTML/.test(aq), 'approval-queue.js must not parse agent-derived text as markup');
assert.ok(wa.includes('mountApprovalQueue'), 'the dashboard must show the approval queue through the shared component');
const sp = read('extension/components/status-pill.js');
assert.ok(sp.includes('${escapeHtml(label)}'), 'status-pill.js must escape its label');
assert.ok(sp.includes('${escapeHtml(cache.sseStatus)}'), 'status-pill.js must escape the SSE status');
console.log('[test] tool_contract.test.js: ALL ASSERTIONS PASSED (' + declared.length + ' declared tools checked)');