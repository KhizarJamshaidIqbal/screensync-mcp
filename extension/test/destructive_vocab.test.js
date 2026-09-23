// The extension's copies of the destructive-action appraisal agree with the hub's, and with the table.
//
// Three places decide "destructive" in the extension: the somatic-marker mirror (cognitive-transcendental-ext.js,
// through lib/destructive-vocab.js) and the page-side units that refuse a destructive-looking click without a
// person's approval (web-unit-interact.js, web-unit-action.js). The page-side units run in the page through
// chrome.scripting and must be self-contained, so they carry their own copy of the two patterns. This test pins
// all of them to the hub's mcp-server/destructive-vocab.ts, character for character, and to the shared table.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const read = (rel) => fs.readFileSync(path.resolve(root, rel), 'utf8');
const cases = JSON.parse(read('test/destructive_cases.json'));

const { execWebSomaticMarkerRisk } = await import('../lib/cognitive-transcendental-ext.js');
const flagged = (markers) => markers.filter((m) => m === 'destructive_keyword' || m.startsWith('destructive_code'));
const appraise = async (text) => (await execWebSomaticMarkerRisk({ domain: 'novice.example', action: { text } })).data;

console.log('[test] running destructive vocabulary tests...');

// ── TEST 1: the somatic mirror: read-only code and look-alike words are not destructive ──
for (const text of [...cases.code.safe, ...cases.ui.safe]) {
  assert.deepEqual(flagged((await appraise(text)).markers), [], `must not be flagged: ${text}`);
}

// ── TEST 2: ...and everything that really changes something still is ──
for (const text of [...cases.code.destructive, ...cases.ui.destructive]) {
  const risk = await appraise(text);
  assert.notDeepEqual(flagged(risk.markers), [], `must be flagged: ${text}`);
  assert.ok(risk.visceralRiskScore >= 0.34, `${text}: ${risk.visceralRiskScore}`);
}

// ── TEST 3: the module the mirror uses answers the table the same way, with what it found ──
const vocab = await import('../lib/destructive-vocab.js');
assert.deepEqual(vocab.destructiveWords(cases.code.safe[0]), [], 'the live incident snippet has no destructive word');
assert.deepEqual(vocab.destructiveCode(cases.code.safe[0]), [], 'and no page-changing code');
assert.deepEqual(vocab.destructiveWords('#buyNowButton'), ['buy'], 'camelCase identifiers are still read word by word');
assert.deepEqual(vocab.destructiveWords('cancelSubscription()'), ['cancel subscription']);
assert.deepEqual(vocab.destructiveCode("document.querySelector('form').submit()"), ['form submit']);

// ── TEST 4: every copy carries the hub's two patterns, character for character ──
const hub = fs.readFileSync(path.resolve(root, '..', 'mcp-server', 'destructive-vocab.ts'), 'utf8');
const literal = (src, name) => {
  const m = src.match(new RegExp(`${name}\\s*=\\s*(\\/.+\\/[gimsuy]*);`));
  assert.ok(m, `${name} is declared as one regex literal`);
  return m[1];
};
const WORD = literal(hub, 'DESTRUCTIVE_WORD_RE');
const BENIGN = literal(hub, 'BENIGN_IDENTIFIER_RE');
assert.equal(String(vocab.DESTRUCTIVE_WORD_RE), WORD, 'lib/destructive-vocab.js word list matches the hub');
assert.equal(String(vocab.BENIGN_IDENTIFIER_RE), BENIGN, 'lib/destructive-vocab.js benign identifiers match the hub');
for (const unit of ['lib/web-unit-interact.js', 'lib/web-unit-action.js']) {
  const src = read(unit);
  assert.ok(src.includes(WORD), `${unit} carries the hub's word list`);
  assert.ok(src.includes(BENIGN), `${unit} carries the hub's benign identifiers`);
  assert.ok(!/\/delete\|remove\|destroy/.test(src), `${unit} no longer matches words inside words`);
}

// ── TEST 5: the page-side check, run the way the unit runs it, on element text ──
// The units' isDestructiveAction is nested inside the injected function; its body is this, verbatim.
const pageCheck = new Function('el', read('lib/web-unit-action.js').match(/function isDestructiveAction\(el\) \{([\s\S]*?)\n  \}/)[1]);
const el = (text) => ({ innerText: text, value: '', getAttribute: () => '' });
for (const text of cases.ui.safe) assert.equal(pageCheck(el(text)), false, `page-side: must not be flagged: ${text}`);
for (const text of cases.ui.destructive) assert.equal(pageCheck(el(text)), true, `page-side: must be flagged: ${text}`);

console.log('[test] destructive_vocab.test.js: ALL ASSERTIONS PASSED (whole words, real code, one table everywhere)');
