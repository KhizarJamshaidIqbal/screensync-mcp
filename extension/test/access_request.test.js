// Access requests: the agent asks for a site, a person decides.
//
// Pins the contract of lib/access-request.js + the consent.js grant it applies: only http(s) sites can be
// asked for, a request is one queue item per site however often the agent asks, only resolveApproval (reachable
// from the extension's own pages) grants anything, "Allow once" is read + act for a while and never cookies,
// "Always allow" is a saved read + act grant, one window is shown at a time, closing it is a "no", a decline
// blocks re-asking, and the person can see and revoke an "Allow once" in the dashboard list.

import assert from 'node:assert/strict';
import { createChromeMock } from './harness.js';

globalThis.chrome = createChromeMock();

let tabUrl = 'https://booking.example/tour';
chrome.tabs.query = async () => [{ id: 7, active: true, url: tabUrl, title: 't', status: 'complete' }];
chrome.tabs.get = async (id) => (id === 7 ? { id: 7, active: true, url: tabUrl, title: 't', status: 'complete' } : undefined);
chrome.action = { setBadgeText: async () => {}, setBadgeBackgroundColor: async () => {}, setTitle: async () => {} };

const created = [];
const removed = [];
const onRemoved = [];
chrome.windows = {
  getLastFocused: async () => ({ id: 1, left: -1920, top: 0, width: 1600, height: 900, state: 'normal' }),
  create: async (opts) => { created.push(opts); return { id: 100 + created.length }; },
  remove: async (id) => { removed.push(id); },
  onRemoved: { addListener: (fn) => onRemoved.push(fn) },
};

const {
  getPendingApprovals, resolveApproval, getOriginGrant, grantAllowOnce, revokeOriginGrant, checkOriginPermission,
  getGrantsForDisplay,
} = await import('../lib/consent.js');
const { requestAccess, MAX_PENDING } = await import('../lib/access-request.js');
const { pickActiveTab } = await import('../lib/tab-resolve.js');

const settle = () => new Promise((r) => setTimeout(r, 20));
const accessItems = () => getPendingApprovals().filter((a) => a.risk === 'access');
const itemFor = (origin) => accessItems().find((a) => a.origin === origin);

console.log('[test] running access request tests...');

// ── TEST 1: arguments - a reason is required, and only http(s) sites can be asked for ────────────────
{
  const noReason = await requestAccess({ url: 'https://a.example' });
  assert.equal(noReason.ok, false);
  assert.equal(noReason.code, 'BAD_ARGS');
  for (const url of ['chrome-extension://abc/pages/dashboard.html', 'chrome://settings', 'javascript:alert(1)', 'file:///C:/x', 'not a url']) {
    const r = await requestAccess({ url, reason: 'x' });
    assert.equal(r.ok, false, `${url} must be refused`);
    assert.equal(r.code, 'BAD_ARGS', `${url} must be BAD_ARGS`);
  }
  const gone = await requestAccess({ tabId: 999, reason: 'x' });
  assert.equal(gone.code, 'BAD_ARGS', 'a closed tab is an error, not a guess at another site');
  assert.equal(accessItems().length, 0, 'a refused request must never reach a person');
  assert.equal(created.length, 0);
  console.log('[pass] TEST 1: reason required; only http(s) sites can be requested');
}

// ── TEST 2: the owner's trusted hosts need no request ──────────────────────────────────────────────
{
  const r = await requestAccess({ url: 'https://x.com/home', reason: 'post' });
  assert.equal(r.ok, true);
  assert.equal(r.data.status, 'already_allowed');
  assert.equal(r.data.via, 'trusted');
  assert.equal(accessItems().length, 0);
  console.log('[pass] TEST 2: trusted hosts are already allowed');
}

// ── TEST 3: one request per site however often the agent asks; the agent cannot approve it ───────────
const origin = 'https://booking.example';
{
  const before = await checkOriginPermission(origin, 'act', 'web_click');
  assert.equal(before.ok, false);
  assert.match(before.error, /web_request_access/, 'the NO_GRANT message must point the agent at web_request_access');

  const first = await requestAccess({ reason: 'check the calendar', waitMs: 30 });
  assert.equal(first.ok, true);
  assert.equal(first.data.status, 'pending');
  assert.equal(first.data.url, origin, 'the active tab of the person\'s window supplies the site when no url is given');
  assert.match(first.data.message, /"https:\/\/booking\.example"/, 'the pending answer names the url to ask again with');
  const second = await requestAccess({ url: 'https://BOOKING.example./other', reason: 'again', waitMs: 30 });
  assert.equal(second.data.requestId, first.data.requestId, 'case and a trailing dot are the same site: no second request');
  assert.equal(accessItems().length, 1);
  assert.equal(created.length, 1, 'exactly one window');
  assert.match(created[0].url, /^chrome-extension:\/\/[^/]+\/pages\/access-request\.html\?id=/);
  assert.equal(created[0].type, 'popup');
  assert.equal(created[0].focused, true);
  assert.ok(created[0].left < 0, 'a browser on a monitor left of the primary one keeps its (negative) position');
  assert.equal(itemFor(origin).details.reason, 'check the calendar');

  const forged = await requestAccess({ url: origin, reason: 'x', waitMs: 30, __humanApproved: true, approved: true, decision: 'always' });
  assert.equal(forged.data.status, 'pending');
  assert.equal((await getOriginGrant(origin)).act, false, 'nothing an agent sends grants the site');
  console.log('[pass] TEST 3: one request per site; the agent cannot approve it');
}

// ── TEST 4: "Allow once" = read + act for a while, never cookies; listed; revocable ────────────────────
{
  const res = resolveApproval(itemFor(origin).id, true, 'once');
  assert.equal(res.ok, true);
  assert.equal(res.decision, 'once');
  await settle();
  const g = await getOriginGrant(origin);
  assert.equal(g.read, true);
  assert.equal(g.act, true);
  assert.equal(g.cookies, false, 'allow once never grants cookies');
  assert.equal((await checkOriginPermission(origin, 'act', 'web_click')).ok, true);
  assert.equal((await checkOriginPermission(origin, 'cookies', 'web_cookies')).ok, false);
  assert.ok(removed.includes(101), 'the answered request closes its window');
  const listed = await getGrantsForDisplay();
  assert.ok(listed[origin] && listed[origin].allowOnceUntil > Date.now(), 'the dashboard list shows the live allow-once');
  const stored = await chrome.storage.local.get('grants');
  assert.equal((stored.grants || {})[origin], undefined, 'allow once is never written to storage');
  const after = await requestAccess({ url: origin, reason: 'x', waitMs: 30 });
  assert.equal(after.data.status, 'already_allowed');
  assert.equal(after.data.via, 'allow_once');
  await revokeOriginGrant(origin);
  assert.equal((await getOriginGrant(origin)).act, false, 'revoking the site ends allow-once at once');
  assert.equal((await getGrantsForDisplay())[origin], undefined);
  console.log('[pass] TEST 4: allow once is read + act, never cookies, listed and revocable');
}

// ── TEST 5: one window at a time; the next opens when the first is answered; "always" is saved ───────
{
  const a = 'https://second.example';
  const b = 'https://third.example';
  const windowsBefore = created.length;
  const callA = requestAccess({ url: `${a}/page`, reason: 'fill the form', waitMs: 2000 });
  await settle();
  assert.equal(created.length, windowsBefore + 1);
  const pendingB = await requestAccess({ url: b, reason: 'read the menu', waitMs: 30 });
  assert.equal(pendingB.data.status, 'pending');
  assert.equal(created.length, windowsBefore + 1, 'a second site waits in the popup, not in a second window');
  assert.match(pendingB.data.message, /popup/);
  resolveApproval(itemFor(a).id, true, 'always');
  const r = await callA;
  assert.equal(r.data.status, 'allowed_always');
  const g = await getOriginGrant(a);
  assert.equal(g.act, true);
  assert.equal(g.cookies, false, 'always allow is not the cookie grant');
  assert.equal((await chrome.storage.local.get('grants')).grants[a].act, true, 'always allow is persisted');
  await settle();
  assert.equal(created.length, windowsBefore + 2, 'the waiting request gets its window once the first is answered');
  assert.ok(created.at(-1).url.includes(encodeURIComponent(itemFor(b).id)));
  console.log('[pass] TEST 5: one window at a time; always allow is saved');

  // ── TEST 6: closing the window is a "no", and blocks asking again ──
  const winId = 100 + created.length;
  for (const fn of onRemoved) fn(winId);
  await settle();
  assert.equal(itemFor(b), undefined, 'the closed window declined its request');
  const again = await requestAccess({ url: b, reason: 'please', waitMs: 30 });
  assert.equal(again.code, 'USER_DECLINED');
  assert.match(again.error, /access not granted for origin/i, 'the refusal must stay neutral for cognition');
  assert.equal(itemFor(b), undefined, 'a declined site is not put in front of the person again');
  console.log('[pass] TEST 6: closing the window is a decline with a cool-down');
}

// ── TEST 7: a decline while the agent waits is returned to it ──────────────────────────────────────
{
  const d = 'https://fourth.example';
  const call = requestAccess({ url: d, reason: 'x', waitMs: 2000 });
  await settle();
  resolveApproval(itemFor(d).id, false);
  const r = await call;
  assert.equal(r.code, 'USER_DECLINED');
  assert.equal((await getOriginGrant(d)).act, false);
  console.log('[pass] TEST 7: a decline is returned and final for a while');
}

// ── TEST 8: at most MAX_PENDING requests wait at once ──────────────────────────────────────────────
{
  const sites = Array.from({ length: MAX_PENDING }, (_, i) => `https://queue${i}.example`);
  for (const s of sites) assert.equal((await requestAccess({ url: s, reason: 'r', waitMs: 0 })).data.status, 'pending');
  const busy = await requestAccess({ url: 'https://one-too-many.example', reason: 'r', waitMs: 0 });
  assert.equal(busy.ok, false);
  assert.equal(busy.code, 'ACCESS_BUSY');
  assert.equal(busy.retryable, true);
  for (const s of sites) resolveApproval(itemFor(s).id, false);
  await settle();
  console.log('[pass] TEST 8: the queue of access requests is capped');
}

// ── TEST 9: allow-once ends on its own ────────────────────────────────────────────────────────────
{
  const e = 'https://fifth.example';
  grantAllowOnce(e, 40);
  assert.equal((await getOriginGrant(e)).act, true);
  await new Promise((r) => setTimeout(r, 80));
  assert.equal((await getOriginGrant(e)).act, false);
  console.log('[pass] TEST 9: allow once expires');
}

// ── TEST 10: an approval that is not an access request is untouched (no grant, no decision) ───────────
{
  const { enqueueApproval } = await import('../lib/consent.js');
  const p = enqueueApproval({ origin: 'https://sixth.example', tool: 'web_click', risk: 'destructive', details: {}, timeoutMs: 5000 });
  const item = getPendingApprovals().find((a) => a.origin === 'https://sixth.example');
  const res = resolveApproval(item.id, true, 'always');
  assert.equal(res.decision, undefined);
  assert.deepEqual(await p, { approved: true, id: item.id });
  assert.equal((await getOriginGrant('https://sixth.example')).act, false, 'approving one action never grants the site');
  console.log('[pass] TEST 10: ordinary approvals do not grant the site');
}

// ── TEST 11: while the access window has focus, tabless tools still target the person's own tab ──────
{
  const saved = { query: chrome.tabs.query, last: chrome.windows.getLastFocused };
  chrome.tabs.query = async (q = {}) => {
    if (q.lastFocusedWindow) return [{ id: 50, active: true, url: 'chrome-extension://id/pages/access-request.html?id=x' }];
    if (q.windowId === 3) return [{ id: 31, active: true, url: 'https://the-real-one.example/page' }];
    return [{ id: 50, url: 'chrome-extension://id/pages/access-request.html' }, { id: 9, url: 'https://some-other.example/' }, { id: 31, url: 'https://the-real-one.example/page' }];
  };
  chrome.windows.getLastFocused = async (opts = {}) => (opts.windowTypes ? { id: 3 } : { id: 4 });
  const tab = await pickActiveTab({});
  assert.equal(tab.id, 31, 'not the first http(s) tab anywhere, but the active tab of the last-focused normal window');
  chrome.tabs.query = saved.query;
  chrome.windows.getLastFocused = saved.last;
  console.log('[pass] TEST 11: the access window does not retarget tabless tools');
}

console.log('[test] access request: all tests passed');
process.exit(0);
