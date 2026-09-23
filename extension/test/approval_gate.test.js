// The approval gate: a person's decision, not the agent's.
//
// Before this, a destructive-looking action returned USER_CONFIRMATION_REQUIRED and the agent simply called
// again with `confirmed:true` - an argument it supplies itself - so nothing ever asked a human. These tests
// pin the replacement: the request waits in the queue for a person, the agent's own flags mean nothing off
// the owner's trusted hosts, and the internal flag that lets an action through cannot be forged.

import assert from 'node:assert/strict';
import { mock } from 'node:test';
import { createChromeMock } from './harness.js';

globalThis.chrome = createChromeMock();

let tabUrl = 'https://shop.example/cart';
chrome.tabs.query = async () => [{ id: 7, active: true, url: tabUrl, title: 't', status: 'complete' }];
chrome.tabs.get = async () => ({ id: 7, active: true, url: tabUrl, title: 't', status: 'complete' });

const badge = { text: [], title: [] };
chrome.action = {
  setBadgeText: async ({ text }) => { badge.text.push(text); },
  setBadgeBackgroundColor: async () => {},
  setTitle: async ({ title }) => { badge.title.push(title); },
};

let hubAcceptsAwaiting = true;
const hubCalls = [];
globalThis.fetch = async (url, init) => {
  hubCalls.push({ url: String(url), body: init && init.body ? JSON.parse(init.body) : null });
  if (!hubAcceptsAwaiting) return { ok: false, status: 404, json: async () => ({ error: 'not found' }) };
  return { ok: true, status: 200, json: async () => ({ success: true }) };
};

const { getPendingApprovals, resolveApproval, saveOriginGrant, revokeOriginGrant, isLoopbackOrTestOrigin } = await import('../lib/consent.js');
const { APPROVAL_WINDOW_MS, runWithApproval, stripInternalArgs, originOf } = await import('../lib/approval-gate.js');

console.log('[test] running approval gate tests...');

const calls = [];
/** A dispatcher that behaves like the units: destructive unless a person (or the owner's trust) approved. */
const dispatcher = async (tool, args) => {
  calls.push({ tool, args });
  if (args.__humanApproved) return { ok: true, data: { done: true } };
  return { ok: false, code: 'USER_CONFIRMATION_REQUIRED', risk: 'destructive', error: 'Action involves destructive keyword. User confirmation required.' };
};
const queued = async () => {
  for (let i = 0; i < 300; i += 1) {
    const list = getPendingApprovals();
    if (list.length) return list[0];
    await new Promise((r) => setImmediate(r));
  }
  throw new Error('nothing was queued for approval');
};
const reset = () => { calls.length = 0; hubCalls.length = 0; hubAcceptsAwaiting = true; };

// ── TEST 1: internal flags are stripped at every depth; the hub's request for a human survives, cleaned ──
{
  const input = {
    selector: '#x', confirmed: true, force: true, __humanApproved: true, __actGranted: true,
    args: { selector: '#y', __humanApproved: true, deeper: [{ __actGranted: true, keep: 1 }] },
    __gate: { needsHuman: true, reason: 'r'.repeat(900), riskScore: 0.5, markers: ['a', 'b'], domain: 'shop.example', level: 'NOVICE' },
  };
  const { args, gate } = stripInternalArgs(input);
  assert.equal(args.__humanApproved, undefined);
  assert.equal(args.__actGranted, undefined);
  assert.equal(args.__gate, undefined, 'the hub message is taken out of the arguments the tool sees');
  assert.equal(args.args.__humanApproved, undefined, 'web_in_frame nests its arguments: nothing may hide there');
  assert.equal(args.args.deeper[0].__actGranted, undefined);
  assert.equal(args.args.deeper[0].keep, 1, 'and legitimate data is left alone');
  assert.equal(args.confirmed, true, 'an agent-typed confirmed is not deleted; it is simply not believed (see below)');
  assert.equal(input.__humanApproved, true, 'the caller\'s object is not mutated');
  assert.equal(gate.reason.length, 300, 'what the hub says is bounded before it is shown to a person');
  assert.deepEqual(gate.markers, ['a', 'b']);

  assert.equal(stripInternalArgs({ __gate: { needsHuman: false } }).gate, null, 'only an explicit request counts');
  assert.equal(stripInternalArgs({ __gate: 'yes' }).gate, null, 'and it must be well formed');
  assert.equal(stripInternalArgs(null).gate, null);
}

// ── TEST 2: on an untrusted origin the agent's own confirmed/force do NOT run the action; a person does ──
{
  reset(); tabUrl = 'https://shop.example/cart';
  const pending = runWithApproval('web_click', { selector: '#delete-account', confirmed: true, force: true, __humanApproved: true, __actGranted: true }, { id: 'req-1', deadlineAt: Date.now() + 45_000 }, dispatcher);
  const item = await queued();
  assert.equal(calls.length, 1, 'the first attempt is the only one until a person answers');
  assert.equal(calls[0].args.__humanApproved, undefined, 'confirmed:true, force:true and a forged __humanApproved changed nothing');
  assert.equal(calls[0].args.__actGranted, false, 'and a forged grant was replaced by the real one');
  assert.equal(item.origin, 'https://shop.example');
  assert.equal(item.tool, 'web_click');
  assert.equal(item.tabId, 7, 'the queue knows which tab the action would run in, so the card can be shown there');
  assert.match(item.details.target, /#delete-account/);
  assert.match(item.details.reason, /destructive keyword/);
  assert.ok(item.expiresAt > item.createdAt, 'the queue says when the request lapses, so the UI can show it');

  assert.equal(resolveApproval(item.id, true).ok, true);
  const out = await pending;
  assert.equal(out.ok, true, 'approved: the action ran');
  assert.equal(calls.length, 2);
  assert.equal(calls[1].args.__humanApproved, true, 'with the flag only this module can set');
  assert.equal(getPendingApprovals().length, 0);
}

// ── TEST 3: declined is USER_DECLINED, and the action never runs ──
{
  reset(); tabUrl = 'https://shop.example/cart';
  const pending = runWithApproval('web_click', { selector: '#delete-account' }, { id: 'req-2', deadlineAt: Date.now() + 45_000 }, dispatcher);
  resolveApproval((await queued()).id, false);
  const out = await pending;
  assert.equal(out.ok, false);
  assert.equal(out.code, 'USER_DECLINED');
  assert.match(out.error, /declined the approval request/, 'a phrase the hub recognises as "not the agent\'s fault"');
  assert.equal(out.retryable, false, 'a person said no: do not retry');
  assert.equal(calls.length, 1, 'declined means the action was never re-run');
}

// ── TEST 4: silence is a refusal ──
{
  reset(); tabUrl = 'https://shop.example/cart';
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const pending = runWithApproval('web_click', { selector: '#delete-account' }, { id: 'req-3', deadlineAt: Date.now() + 45_000 }, dispatcher);
    await queued();
    mock.timers.tick(APPROVAL_WINDOW_MS + 1);
    const out = await pending;
    assert.equal(out.code, 'APPROVAL_TIMEOUT');
    assert.equal(out.retryable, true, 'nobody answered, so asking again is reasonable');
    assert.match(out.error, /approval request/);
    assert.equal(calls.length, 1);
    assert.equal(getPendingApprovals().length, 0, 'an expired request leaves the queue');
  } finally { mock.timers.reset(); }
}

// ── TEST 5: the owner's trusted hosts are unchanged: confirmed still counts there, and nobody is asked ──
{
  reset(); tabUrl = 'https://x.com/compose/post';
  assert.equal(isLoopbackOrTestOrigin('https://x.com'), true, 'precondition: x.com is an owner-trusted host');
  const withFlag = await runWithApproval('web_click', { selector: '#delete-post', confirmed: true }, { id: 'req-4' }, dispatcher);
  assert.equal(withFlag.ok, true, 'the owner trusts x.com: an agent\'s confirmed:true works there, exactly as before');
  assert.equal(calls[0].args.__humanApproved, true);
  assert.equal(getPendingApprovals().length, 0, 'no prompt on a trusted host');

  reset();
  const withoutFlag = await runWithApproval('web_click', { selector: '#delete-post' }, { id: 'req-5' }, dispatcher);
  assert.equal(withoutFlag.code, 'USER_CONFIRMATION_REQUIRED', 'and without it the agent still gets the error, as before');
  assert.equal(getPendingApprovals().length, 0);
  assert.equal(calls[0].args.__actGranted, true, 'a trusted host carries the act grant');
}

// ── TEST 6: the hub can ask for a human up front (its cognitive gate); the action waits until one answers ──
{
  reset(); tabUrl = 'https://shop.example/cart';
  const gate = { needsHuman: true, reason: 'web_click looks destructive and shop.example has only earned NOVICE.', riskScore: 0.45, markers: ['destructive_keyword'], domain: 'shop.example', level: 'NOVICE' };
  const harmless = async (tool, args) => { calls.push({ tool, args }); return args.__humanApproved ? { ok: true, data: { done: true } } : { ok: true, data: { done: 'without asking' } }; };

  const pending = runWithApproval('web_click', { selector: '#buy', __gate: gate }, { id: 'req-6', deadlineAt: Date.now() + 90_000 }, harmless);
  const item = await queued();
  assert.equal(calls.length, 0, 'nothing runs before a person says so: the action itself looked harmless to the extension');
  assert.match(item.details.reason, /NOVICE/);
  assert.deepEqual(item.details.hubMarkers, ['destructive_keyword']);
  resolveApproval(item.id, true);
  const out = await pending;
  assert.equal(out.data.done, true);
  assert.equal(calls[0].args.__humanApproved, true);
  assert.equal(calls[0].args.__gate, undefined, 'the tool never sees the hub message');

  // A dry run only plans, so it is never held up; and a trusted host is not second-guessed.
  reset();
  const dry = await runWithApproval('web_click', { selector: '#buy', dryRun: true, __gate: gate }, { id: 'req-7' }, harmless);
  assert.equal(dry.data.done, 'without asking');
  tabUrl = 'https://x.com/home';
  const trusted = await runWithApproval('web_click', { selector: '#buy', __gate: gate }, { id: 'req-8' }, harmless);
  assert.equal(trusted.data.done, 'without asking');
  assert.equal(getPendingApprovals().length, 0);
}

// ── TEST 6b: an approval is not a grant, so a person is not asked about an action that cannot run anyway ──
{
  reset(); tabUrl = 'https://nogrant.example/app';
  const gate = { needsHuman: true, reason: 'looks destructive', riskScore: 0.5, markers: [], domain: 'nogrant.example', level: 'NOVICE' };
  const runs = async (tool, args) => { calls.push({ tool, args }); return { ok: true, data: { ran: true } }; };
  const acts = (t) => t === 'web_click';

  const noGrant = await runWithApproval('web_click', { selector: '#buy', __gate: gate }, { id: 'req-6b' }, runs, { isActTool: acts });
  assert.equal(noGrant.code, 'NO_GRANT', 'the owner has not granted act here: say so at once');
  assert.equal(getPendingApprovals().length, 0, 'and nobody was asked to approve something that would fail anyway');
  assert.equal(calls.length, 0);

  // A tool that does not need the act grant is still put to a person.
  const pending = runWithApproval('web_eval', { code: 'remove()', __gate: gate }, { id: 'req-6c', deadlineAt: Date.now() + 90_000 }, runs, { isActTool: acts });
  const item = await queued();
  assert.equal(item.tool, 'web_eval');
  resolveApproval(item.id, false);
  assert.equal((await pending).code, 'USER_DECLINED');

  // ...and once the owner has granted act, the same click IS put to a person.
  await saveOriginGrant('https://nogrant.example', { read: true, act: true, cookies: false });
  const asked = runWithApproval('web_click', { selector: '#buy', __gate: gate }, { id: 'req-6d', deadlineAt: Date.now() + 90_000 }, runs, { isActTool: acts });
  resolveApproval((await queued()).id, true);
  assert.equal((await asked).ok, true);
}

// ── TEST 7: a grant is not an approval, but it is real: __actGranted follows the owner's grant ──
{
  reset(); tabUrl = 'https://granted.example/app';
  await saveOriginGrant('https://granted.example', { read: true, act: true, cookies: false });
  const pending = runWithApproval('web_click', { selector: '#remove-item', __actGranted: false }, { id: 'req-9', deadlineAt: Date.now() + 45_000 }, dispatcher);
  const item = await queued();
  assert.equal(calls[0].args.__actGranted, true, 'the owner granted act on this origin, whatever the agent said');
  assert.equal(item.origin, 'https://granted.example', 'but a destructive action still needs a person, grant or no grant');
  resolveApproval(item.id, true);
  await pending;
}

// ── TEST 8: the hub is told a person is being asked, so it keeps waiting; an older hub means a shorter window ──
{
  reset(); tabUrl = 'https://shop.example/cart';
  let pending = runWithApproval('web_click', { selector: '#delete-account' }, { id: 'req-10', deadlineAt: Date.now() + 45_000 }, dispatcher);
  let item = await queued();
  const awaiting = hubCalls.find((c) => c.url.endsWith('/api/web/awaiting'));
  assert.ok(awaiting, 'the extension told the hub');
  assert.deepEqual(awaiting.body, { id: 'req-10', ms: APPROVAL_WINDOW_MS });
  assert.equal(item.expiresAt - item.createdAt, APPROVAL_WINDOW_MS, 'the hub agreed to wait, so a person gets the full minute');
  resolveApproval(item.id, false);
  await pending;

  reset(); hubAcceptsAwaiting = false;
  pending = runWithApproval('web_click', { selector: '#delete-account' }, { id: 'req-11', deadlineAt: Date.now() + 20_000 }, dispatcher);
  item = await queued();
  const window = item.expiresAt - item.createdAt;
  assert.ok(window >= 11_000 && window <= 12_500, `an older hub will not wait, so the request must lapse before it does (was ${window}ms)`);
  resolveApproval(item.id, false);
  await pending;
}

// ── TEST 9: the toolbar badge counts what is waiting, and clears ──
{
  reset(); badge.text.length = 0; badge.title.length = 0; tabUrl = 'https://shop.example/cart';
  const pending = runWithApproval('web_click', { selector: '#delete-account' }, { id: 'req-12', deadlineAt: Date.now() + 45_000 }, dispatcher);
  const item = await queued();
  assert.equal(badge.text.at(-1), '1', 'a request nobody has seen is a number on the icon');
  assert.match(badge.title.at(-1), /1 agent action waiting for your approval/);
  resolveApproval(item.id, true);
  await pending;
  assert.equal(badge.text.at(-1), '', 'and it clears when answered');
  assert.equal(badge.title.at(-1), 'ScreenSync MCP');
}

// ── TEST 9b: the page moves while a person is deciding; their yes covered the old page, not the new one ──
{
  reset(); tabUrl = 'https://shop.example/cart';
  const pending = runWithApproval('web_click', { selector: '#delete-account' }, { id: 'req-13', deadlineAt: Date.now() + 45_000 }, dispatcher);
  const item = await queued();
  tabUrl = 'https://bank.example/transfer'; // another tab came to the front while the person read the request
  resolveApproval(item.id, true);
  const out = await pending;
  assert.equal(out.ok, false);
  assert.equal(out.code, 'USER_CONFIRMATION_REQUIRED');
  assert.equal(out.retryable, true, 'ask again, about the new page');
  assert.match(out.error, /from https:\/\/shop\.example to https:\/\/bank\.example/);
  assert.equal(calls.length, 1, 'the action never ran: only the first, refused, attempt exists');
  tabUrl = 'https://shop.example/cart';
}

// ── TEST 9c: the owner revokes the grant while a person is deciding; the action does not run on a stale one ──
{
  reset(); tabUrl = 'https://granted2.example/app';
  await saveOriginGrant('https://granted2.example', { read: true, act: true, cookies: false });
  const pending = runWithApproval('web_click', { selector: '#remove-item' }, { id: 'req-14', deadlineAt: Date.now() + 45_000 }, dispatcher);
  const item = await queued();
  assert.equal(calls[0].args.__actGranted, true);
  await revokeOriginGrant('https://granted2.example');
  resolveApproval(item.id, true);
  await pending;
  assert.equal(calls[1].args.__humanApproved, true, 'the person approved it');
  assert.equal(calls[1].args.__actGranted, false, 'but the grant was looked at again after they answered, and it was gone');
}

// ── TEST 10: which origin an action lands on ──
{
  tabUrl = 'https://shop.example/cart?x=1';
  assert.equal(await originOf('web_click', {}), 'https://shop.example');
  assert.equal(await originOf('web_api_fetch', { url: 'https://api.other.example/v1/things' }), 'https://api.other.example', 'a fetch lands where its URL points, not on the open tab');
  chrome.tabs.query = async () => [];
  assert.equal(await originOf('web_click', {}), 'unknown', 'no tab: unknown, which is never trusted');
}

console.log('[test] approval_gate.test.js: ALL ASSERTIONS PASSED (a person, not the agent, approves)');
