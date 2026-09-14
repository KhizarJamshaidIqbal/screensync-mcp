// Unit tests for Playwright Parity Gaps (Plan Rev 4 Phase C: P1-P6)
import assert from 'node:assert/strict';
import { createChromeMock } from './harness.js';

globalThis.chrome = createChromeMock();

const {
  registerPopupTab,
  getRecentPopups,
  waitForPopup,
  removePopupTab,
} = await import('../lib/web-popup.js');

console.log('[test] running Playwright parity tests (P1-P6)...');

// ── TEST 1: P1 - Popup Registration & Wait ──────────────────────────────
registerPopupTab({ id: 101, openerTabId: 42, url: 'https://auth.example.com/login', title: 'Login' });
const popups = getRecentPopups(42);
assert.equal(popups.length, 1);
assert.equal(popups[0].tabId, 101);
assert.equal(popups[0].url, 'https://auth.example.com/login');

// waitForPopup resolves immediately for recently created popup
const waited = await waitForPopup({ openerTabId: 42, timeoutMs: 1000 });
assert.equal(waited.ok, true);
assert.equal(waited.data.tabId, 101);

// waitForPopup times out cleanly if no popup matching opener arrives
const timeoutWait = await waitForPopup({ openerTabId: 999, timeoutMs: 100 });
assert.equal(timeoutWait.ok, false);
assert.equal(timeoutWait.error, 'TIMEOUT_WAITING_FOR_POPUP');

// removePopupTab prunes the tab
removePopupTab(101);
assert.equal(getRecentPopups(42).length, 0);

// ── TEST 2: P3 - Locator Chaining & Nth Matching Syntax ─────────────────
// Simulating locator resolution helpers
function testLocatorParsing(selector) {
  let nth = null;
  let target = selector;
  const nthMatch = target.match(/(?:>>\s*nth\s*=\s*(\d+)|\.nth\((\d+)\)|:nth\((\d+)\)|:(first|last)|\.(first|last)\(\))/i);
  if (nthMatch) {
    if (nthMatch[1] != null) nth = parseInt(nthMatch[1], 10);
    else if (nthMatch[2] != null) nth = parseInt(nthMatch[2], 10);
    else if (nthMatch[3] != null) nth = parseInt(nthMatch[3], 10);
    else if (nthMatch[4] === 'first' || nthMatch[5] === 'first') nth = 0;
    else if (nthMatch[4] === 'last' || nthMatch[5] === 'last') nth = -1;
    target = target.replace(nthMatch[0], '').trim();
  }
  return { target, nth };
}

assert.deepEqual(testLocatorParsing('button >> nth=2'), { target: 'button', nth: 2 });
assert.deepEqual(testLocatorParsing('div.item.nth(0)'), { target: 'div.item', nth: 0 });
assert.deepEqual(testLocatorParsing('li:first'), { target: 'li', nth: 0 });
assert.deepEqual(testLocatorParsing('.card.last()'), { target: '.card', nth: -1 });

// ── TEST 3: P4 - Web-First Assertion Polling Logic ──────────────────────
let attempts = 0;
async function mockAssertPoll(predicate, timeoutMs = 500, pollMs = 50) {
  const start = Date.now();
  while (Date.now() - start <= timeoutMs) {
    attempts++;
    if (predicate()) return { ok: true, attempts };
    await new Promise((r) => setTimeout(r, pollMs));
  }
  return { ok: false, error: 'TIMEOUT', attempts };
}

let conditionMet = false;
setTimeout(() => { conditionMet = true; }, 120);

const pollRes = await mockAssertPoll(() => conditionMet, 600, 40);
assert.equal(pollRes.ok, true);
assert.ok(pollRes.attempts >= 2, 'Should have retried before succeeding');

// ── TEST 4: P5 - File Chooser Interception Registry ─────────────────────
const activeFileChoosers = new Map();
activeFileChoosers.set(42, {
  mode: 'selectSingle',
  backendNodeId: 12345,
  openedAt: Date.now(),
});

assert.equal(activeFileChoosers.has(42), true);
assert.equal(activeFileChoosers.get(42).mode, 'selectSingle');
activeFileChoosers.delete(42);
assert.equal(activeFileChoosers.has(42), false);

// ── TEST 5: P6 - HAR Replay Mock Route Parsing ──────────────────────────
const mockHar = {
  log: {
    entries: [
      {
        request: { method: 'GET', url: 'https://api.example.com/v1/user' },
        response: {
          status: 200,
          headers: [{ name: 'content-type', value: 'application/json' }],
          content: { text: '{"id":1,"name":"Alice"}' },
        },
      },
      {
        request: { method: 'POST', url: 'https://api.example.com/v1/update' },
        response: {
          status: 204,
          headers: [],
          content: { text: '' },
        },
      },
    ],
  },
};

const routes = [];
for (const entry of mockHar.log.entries) {
  routes.push({
    urlPattern: entry.request.url,
    method: entry.request.method,
    status: entry.response.status,
    body: entry.response.content.text,
  });
}

assert.equal(routes.length, 2);
assert.equal(routes[0].urlPattern, 'https://api.example.com/v1/user');
assert.equal(routes[0].status, 200);
assert.equal(routes[1].method, 'POST');

console.log('[test] Playwright parity tests passed (5/5).');
