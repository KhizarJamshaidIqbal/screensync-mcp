// Every place that used to believe an agent's own `confirmed` / `force`.
//
// approval_gate.test.js proves the queue and the flag plumbing; locators.test.js proves the three page-side
// checks (click, type, fill). This covers the rest: authenticated fetches, storage writes, cookie edits,
// permission grants and geolocation overrides. Each one must refuse an agent that insists it is confirmed,
// and each must accept the approval flag that only the extension can set.

import assert from 'node:assert/strict';
import { createChromeMock } from './harness.js';

globalThis.chrome = createChromeMock();

let tabUrl = 'https://shop.example/cart';
chrome.tabs.query = async () => [{ id: 7, active: true, url: tabUrl, title: 't', status: 'complete' }];
chrome.tabs.get = async () => ({ id: 7, active: true, url: tabUrl, title: 't', status: 'complete' });
const cookieWrites = [];
chrome.cookies = { getAll: async () => [], set: async (c) => { cookieWrites.push(c); }, remove: async (c) => { cookieWrites.push({ removed: c }); } };

let fetched = 0;
globalThis.fetch = async () => {
  fetched += 1;
  return { ok: true, status: 200, statusText: 'OK', url: 'https://x', headers: new Headers({ 'content-type': 'application/json' }), text: async () => '{}', json: async () => ({}), arrayBuffer: async () => new ArrayBuffer(0) };
};
globalThis.localStorage = { setItem() {}, removeItem() {}, clear() {}, getItem: () => null, length: 0, key: () => null };
globalThis.sessionStorage = globalThis.localStorage;

const { saveOriginGrant } = await import('../lib/consent.js');
const { apiFetch } = await import('../lib/web-api-fetch.js');
const { ssStorage } = await import('../lib/web-adv-units.js');
const { cdpGrantPermissions, cdpSetGeolocation } = await import('../lib/web-adv-emulate.js');
const { executeWebTool } = await import('../lib/web-tools.js');

console.log('[test] running confirmation-site tests...');

const CONFIRM = 'USER_CONFIRMATION_REQUIRED';
/** Runs `fn`; a throw AFTER the confirmation check (the mock cannot perform the whole action) still counts as having passed it. */
const attempt = async (fn) => { try { return await fn(); } catch (e) { return { thrownAfterTheCheck: String((e && e.message) || e) }; } };
const insist = { confirmed: true, force: true };

// ── web_api_fetch: an authenticated write to an origin nobody granted ──
{
  fetched = 0;
  const refused = await apiFetch({ url: 'https://api.shop.example/orders', method: 'POST', body: '{}', ...insist });
  assert.equal(refused.code, CONFIRM, 'confirmed/force must not send an authenticated POST with the user\'s session');
  assert.equal(fetched, 0, 'and nothing left the browser');

  const approved = await attempt(() => apiFetch({ url: 'https://api.shop.example/orders', method: 'POST', body: '{}', __humanApproved: true }));
  assert.notEqual(approved.code, CONFIRM);
  assert.equal(fetched, 1, 'a person approved it, so it was sent');

  fetched = 0;
  const trusted = await attempt(() => apiFetch({ url: 'https://x.com/i/api/thing', method: 'POST', body: '{}' }));
  assert.notEqual(trusted.code, CONFIRM, 'the owner trusts x.com: no approval needed there, as before');
  assert.equal(fetched, 1);

  await saveOriginGrant('https://granted.example', { read: true, act: true, cookies: true });
  fetched = 0;
  const granted = await attempt(() => apiFetch({ url: 'https://granted.example/api', method: 'DELETE' }));
  assert.notEqual(granted.code, CONFIRM, 'an origin the owner granted act on needs no per-call approval for a fetch');
  assert.equal(fetched, 1);
}

// ── web_storage (runs in the page): a write needs the owner's act grant or a person ──
{
  const insisted = ssStorage({ action: 'set', type: 'local', key: 'k', value: 'v', ...insist });
  assert.equal(insisted.code, CONFIRM, 'confirmed/force must not write page storage');
  assert.equal(ssStorage({ action: 'set', type: 'local', key: 'k', value: 'v', __actGranted: true }).code, undefined, 'the owner\'s act grant is enough');
  assert.equal(ssStorage({ action: 'set', type: 'local', key: 'k', value: 'v', __humanApproved: true }).code, undefined, 'and so is a person\'s approval');
  assert.notEqual(ssStorage({ action: 'get', type: 'local', key: 'k' }).code, CONFIRM, 'reading is never held up');
}

// ── web_grant_permissions / web_set_geolocation: they change what the page may do ──
{
  const tab = { id: 7, url: 'https://shop.example/cart' };
  assert.equal((await cdpGrantPermissions(tab, { permissions: ['geolocation'], ...insist })).code, CONFIRM, 'confirmed/force must not grant page permissions');
  assert.equal((await cdpSetGeolocation(tab, { latitude: 1, longitude: 2, ...insist })).code, CONFIRM, 'confirmed/force must not override geolocation');
  assert.notEqual((await attempt(() => cdpGrantPermissions(tab, { permissions: ['geolocation'], __humanApproved: true }))).code, CONFIRM);
  assert.notEqual((await attempt(() => cdpSetGeolocation(tab, { latitude: 1, longitude: 2, __humanApproved: true }))).code, CONFIRM);
  assert.notEqual((await attempt(() => cdpSetGeolocation(tab, { clear: true }))).code, CONFIRM, 'clearing an override needs nothing');
}

// ── web_cookies set/remove: even with the owner's act grant, editing cookies needs a person ──
{
  tabUrl = 'https://granted.example/app';
  cookieWrites.length = 0;
  const insisted = await executeWebTool('web_cookies', { action: 'set', name: 'sid', value: 'x', domain: 'granted.example', ...insist });
  assert.equal(insisted.code, CONFIRM, 'confirmed/force must not edit cookies');
  assert.equal(cookieWrites.length, 0);
  const approved = await executeWebTool('web_cookies', { action: 'set', name: 'sid', value: 'x', domain: 'granted.example', __humanApproved: true });
  assert.equal(approved.ok, true);
  assert.equal(cookieWrites.length, 1, 'approved: the cookie was written');

  tabUrl = 'https://ungranted.example/app';
  const noGrant = await executeWebTool('web_cookies', { action: 'set', name: 'sid', value: 'x', domain: 'ungranted.example', __humanApproved: true });
  assert.equal(noGrant.code, 'NO_GRANT', 'an approval is not a grant: the owner\'s act grant is still required');
}

console.log('[test] approval_sites.test.js: ALL ASSERTIONS PASSED (no agent-typed flag runs anything)');
