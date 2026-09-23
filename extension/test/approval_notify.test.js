// Approval notifications (lib/approval-notify.js): every pending approval reaches the person as an OS notification
// and as a dialog on the page itself, one decision settles it everywhere, and the page cannot answer for them.
//
// The live incident: a gated web_eval waited in the popup behind a small red "1" on the toolbar icon, nobody
// noticed, and the request lapsed. The popup queue and the badge are unchanged (approval_gate.test.js); this pins
// what was added on top of them.

import assert from 'node:assert/strict';
import { mock } from 'node:test';
import { createChromeMock } from './harness.js';

globalThis.chrome = createChromeMock();
const tabs = new Map([
  [7, { id: 7, windowId: 70, url: 'https://shop.example/cart', title: 'Cart', status: 'complete' }],
  [8, { id: 8, windowId: 80, url: 'chrome://settings/', title: 'Settings', status: 'complete' }],
  [9, { id: 9, windowId: 90, url: 'https://docs.example/a.pdf', title: 'PDF', status: 'complete' }],
]);
chrome.tabs.get = async (id) => { const t = tabs.get(Number(id)); if (!t) throw new Error(`No tab with id: ${id}`); return { ...t }; };
const focused = [];
chrome.tabs.update = async (id, props) => { focused.push(['tab', id, props]); return { ...tabs.get(id) }; };
chrome.windows = { update: async (id, props) => { focused.push(['window', id, props]); return { id }; } };
chrome.action = { setBadgeText: async () => {}, setBadgeBackgroundColor: async () => {}, setTitle: async () => {}, openPopup: async () => { focused.push(['popup']); } };
const updated = [];
chrome.tabs.onUpdated = { addListener: (fn) => updated.push(fn), removeListener() {} };
const onMessage = [];
chrome.runtime.onMessage = { addListener: (fn) => onMessage.push(fn) };

// chrome.notifications, callback style, as Chrome has it.
const note = { up: new Map(), created: [], updates: [], cleared: [], button: null, click: null };
chrome.notifications = {
  create(id, opts, cb) { note.up.set(id, opts); note.created.push({ id, opts }); cb(id); },
  update(id, opts, cb) { const had = note.up.has(id); if (had) note.up.set(id, { ...note.up.get(id), ...opts }); note.updates.push({ id, opts }); cb(had); },
  clear(id, cb) { const had = note.up.delete(id); note.cleared.push(id); cb(had); },
  getAll(cb) { cb(Object.fromEntries([...note.up.keys()].map((k) => [k, true]))); },
  onButtonClicked: { addListener: (fn) => { note.button = fn; } },
  onClicked: { addListener: (fn) => { note.click = fn; } },
};

// chrome.scripting: record every injection; a page may refuse it.
const injected = [];
let docSeq = 0;
let refuse = () => false;
chrome.scripting = {
  async executeScript(details) {
    injected.push(details);
    if (refuse(details)) throw new Error('Cannot access contents of the page.');
    return [{ frameId: 0, documentId: `doc-${details.target.tabId}-${++docSeq}`, result: true }];
  },
};

const { enqueueApproval, getPendingApprovals, resolveApproval, ACCESS_RISK } = await import('../lib/consent.js');
const notify = await import('../lib/approval-notify.js');
const { ssApprovalDialog } = await import('../lib/approval-dialog.js');
const { isTabGuarded, trustedInputRefusal } = await import('../lib/approval-guard.js');
const { execAdvTool } = await import('../lib/web-adv.js');
const { whenIdle, NOTIFICATION_PREFIX, DIALOG_MESSAGE } = notify;

console.log('[test] running approval notification tests...');

const GATED = {
  target: "document.querySelector('form#checkout').submit()",
  reason: 'web_eval looks destructive (destructive_code: form submit) and shop.example has only earned NOVICE; COMPETENT is needed to act on it unsupervised.',
  hubMarkers: ['destructive_code'], hubRisk: 0.35, level: 'NOVICE',
};
const ask = (over = {}) => {
  const p = enqueueApproval({ origin: 'https://shop.example', tool: 'web_eval', risk: 'destructive', details: GATED, timeoutMs: 60_000, tabId: 7, ...over });
  const outcome = p.then(() => 'approved', (e) => e.code);
  return { outcome, id: getPendingApprovals().slice(-1)[0].id };
};
const shows = () => injected.filter((d) => d.args[0].op === 'show');
const lastOp = (op) => injected.filter((d) => d.args[0].op === op).slice(-1)[0];
const reset = () => { note.created.length = 0; note.updates.length = 0; note.cleared.length = 0; injected.length = 0; focused.length = 0; refuse = () => false; };
const fromDialog = (msg, sender = {}) => {
  const answers = [];
  const s = { id: chrome.runtime.id, tab: { id: 7 }, frameId: 0, url: 'https://shop.example/cart', ...sender };
  const handled = onMessage.map((fn) => fn({ type: DIALOG_MESSAGE, ...msg }, s, (r) => answers.push(r)));
  return { handled, answer: answers[0] };
};

// ── TEST 1: a pending approval raises an OS notification and a dialog on its page, in the isolated world ──
{
  reset();
  const { outcome, id } = ask();
  await whenIdle();
  assert.equal(note.created.length, 1);
  const { id: nid, opts } = note.created[0];
  assert.equal(nid, NOTIFICATION_PREFIX + id);
  assert.equal(opts.title, 'ScreenSync needs your approval');
  assert.equal(opts.message, 'web_eval on shop.example — flagged: destructive_code');
  assert.equal(opts.requireInteraction, true, 'it stays until answered');
  assert.equal(opts.silent, false, 'the OS chime is the bell');
  assert.deepEqual(opts.buttons, [{ title: 'Approve' }, { title: 'Decline' }]);
  assert.match(opts.iconUrl, /icons\/icon128\.png$/);
  assert.match(opts.contextMessage, /Answer within \d+s/);

  assert.equal(shows().length, 1);
  const d = shows()[0];
  assert.deepEqual(d.target, { tabId: 7, frameIds: [0] }, 'the top frame of the tab the action would run in');
  assert.equal(d.world, 'ISOLATED', 'never the page\'s MAIN world');
  assert.equal(d.func, ssApprovalDialog);
  const m = d.args[0];
  assert.equal(m.id, id);
  assert.ok(typeof m.nonce === 'string' && m.nonce.length >= 32, 'a one-time nonce only this dialog knows');
  assert.equal(m.messageType, DIALOG_MESSAGE);
  assert.ok(m.remainingMs > 55_000 && m.remainingMs <= 60_000, 'the real approval window');
  assert.equal(m.chime, true, 'the in-page chime is on by default');
  assert.match(m.reason, /page-changing code: form submit/);
  assert.match(m.reason, /level NOVICE/);
  assert.equal(m.preview, GATED.target);

  // ── TEST 2: meanwhile the agent's trusted (CDP) input to that tab is refused ──
  assert.equal(isTabGuarded(7), true);
  const refused = await execAdvTool('web_cdp_click', tabs.get(7), { x: 1100, y: 40 });
  assert.equal(refused.code, 'APPROVAL_PENDING');
  assert.equal((await execAdvTool('web_mouse', tabs.get(7), { action: 'click', x: 1, y: 1 })).code, 'APPROVAL_PENDING');
  assert.equal(trustedInputRefusal('web_cdp_click', 9), null, 'other tabs are not affected');
  assert.equal(trustedInputRefusal('web_click', 7), null, 'untrusted input cannot approve anything and is left alone');

  // ── TEST 3: what a page, or anything that is not that dialog, cannot do: answer it ──
  const nonce = m.nonce;
  const docId = `doc-7-${docSeq}`;
  const forged = [
    [{ id, nonce: 'guess', decision: 'approve' }, { documentId: docId }],
    [{ id, decision: 'approve' }, { documentId: docId }],
    [{ id, nonce, decision: 'approve' }, { documentId: docId, frameId: 3 }],
    [{ id, nonce, decision: 'approve' }, { documentId: docId, tab: { id: 9 } }],
    [{ id, nonce, decision: 'approve' }, { documentId: 'doc-other' }],
    [{ id, nonce, decision: 'approve' }, { documentId: docId, url: 'https://evil.example/' }],
    [{ id, nonce, decision: 'approve' }, { documentId: docId, id: 'another-extension' }],
    [{ id: 'appr_other', nonce, decision: 'approve' }, { documentId: docId }],
    [{ id, nonce, decision: 'always' }, { documentId: docId }],
  ];
  for (const [msg, sender] of forged) {
    const { answer } = fromDialog(msg, sender);
    assert.equal(answer.ok, false, `refused: ${JSON.stringify({ msg, sender })}`);
  }
  assert.equal(getPendingApprovals().length, 1, 'still waiting for a person');
  assert.deepEqual(onMessage.map((fn) => fn({ type: 'resolve-approval', id, approved: true }, { id: chrome.runtime.id, tab: { id: 7 }, frameId: 0 }, () => {})), [false],
    'and the listener ignores every other message type');

  // ── TEST 4: the dialog's own answer settles it once; the notification and the dialog go everywhere ──
  const first = fromDialog({ id, nonce, decision: 'approve' }, { documentId: docId });
  assert.equal(first.answer.ok, true);
  assert.equal(await outcome, 'approved');
  await whenIdle();
  assert.deepEqual(note.cleared, [NOTIFICATION_PREFIX + id], 'the notification is taken down');
  assert.deepEqual(lastOp('settled').args[0], { op: 'settled', id, outcome: 'approved' }, 'the dialog says so, then goes');
  assert.equal(isTabGuarded(7), false, 'CDP input to the tab is back');
  assert.equal(fromDialog({ id, nonce, decision: 'approve' }, { documentId: docId }).answer.ok, false, 'a second answer changes nothing');
  note.button(NOTIFICATION_PREFIX + id, 1);
  assert.equal(resolveApproval(id, false).ok, false, 'nor a late notification button or popup click');
}

// ── TEST 5: Decline on the OS notification ──
{
  reset();
  const { outcome, id } = ask();
  await whenIdle();
  note.button(NOTIFICATION_PREFIX + id, 1);
  assert.equal(await outcome, 'USER_DECLINED');
  await whenIdle();
  assert.deepEqual(note.cleared, [NOTIFICATION_PREFIX + id]);
  assert.equal(lastOp('settled').args[0].outcome, 'declined');
  note.button(NOTIFICATION_PREFIX + id, 0);
  assert.equal(getPendingApprovals().length, 0, 'answered exactly once');
}

// ── TEST 6: Approve on the OS notification; and from the popup (consent.resolveApproval, as the popup calls it) ──
{
  reset();
  const a = ask();
  await whenIdle();
  note.button(NOTIFICATION_PREFIX + a.id, 0);
  assert.equal(await a.outcome, 'approved');
  await whenIdle();
  assert.equal(lastOp('settled').args[0].outcome, 'approved');

  reset();
  const b = ask();
  await whenIdle();
  assert.equal(resolveApproval(b.id, true).ok, true, 'the popup answers it');
  assert.equal(await b.outcome, 'approved');
  await whenIdle();
  assert.deepEqual(note.cleared, [NOTIFICATION_PREFIX + b.id], 'and the notification goes');
  assert.equal(lastOp('settled').args[0].outcome, 'approved', 'and so does the dialog');
}

// ── TEST 7: nobody answers: everything comes down, "timed out" is shown briefly ──
{
  reset();
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const { outcome, id } = ask({ timeoutMs: 5_000 });
    await whenIdle();
    mock.timers.tick(5_000);
    assert.equal(await outcome, 'APPROVAL_TIMEOUT');
    await whenIdle();
    assert.ok(note.cleared.includes(NOTIFICATION_PREFIX + id));
    assert.equal(lastOp('settled').args[0].outcome, 'timeout', 'the dialog says "timed out", then removes itself');
    const notice = note.created.find((c) => c.id === notify.TIMED_OUT_NOTIFICATION);
    assert.ok(notice, 'a brief "timed out" notification');
    assert.equal(notice.opts.silent, true);
    assert.equal(notice.opts.requireInteraction, false);
    mock.timers.tick(6_000);
    assert.ok(note.cleared.includes(notify.TIMED_OUT_NOTIFICATION), 'which clears itself');
  } finally {
    mock.timers.reset();
  }
}

// ── TEST 8: where no dialog can be injected, the notification and the popup carry it ──
{
  reset();
  refuse = () => true; // a Web Store page, a PDF viewer, a discarded tab...
  const a = ask({ tabId: 9, origin: 'https://docs.example' });
  await whenIdle();
  assert.equal(note.created.length, 1, 'the notification still shows');
  assert.equal(shows().length, 1, 'one attempt');
  assert.equal(isTabGuarded(9), false, 'no dialog, so nothing to guard');
  assert.equal(fromDialog({ id: a.id, nonce: 'x', decision: 'approve' }, { tab: { id: 9 }, url: 'https://docs.example/a.pdf' }).answer.ok, false);
  await note.click(NOTIFICATION_PREFIX + a.id);
  assert.deepEqual(focused.slice(0, 2), [['tab', 9, { active: true }], ['window', 90, { focused: true }]], 'clicking it brings the tab forward');
  assert.deepEqual(focused[2], ['popup'], 'and, with no dialog there, opens the popup');
  note.button(NOTIFICATION_PREFIX + a.id, 1);
  await a.outcome;
  await whenIdle();

  reset();
  const b = ask({ tabId: 8, origin: 'https://shop.example' }); // the tab is now on chrome://settings
  await whenIdle();
  assert.equal(shows().length, 0, 'never injected into a restricted page, or onto another site than the request is about');
  assert.equal(note.created.length, 1);
  resolveApproval(b.id, false);
  await b.outcome;
  await whenIdle();
}

// ── TEST 9: several requests: ONE notification and ONE dialog, with "+N more", never a stack ──
{
  reset();
  const a = ask();
  const b = ask();
  const c = ask();
  await whenIdle();
  assert.equal(note.created.length, 1, 'one notification');
  assert.equal(shows().length, 1, 'one dialog');
  assert.equal(shows()[0].args[0].id, a.id, 'showing the oldest');
  assert.equal(shows()[0].args[0].more, 2, 'with "+2 more"');
  assert.match(note.created[0].opts.contextMessage, /^\+2 more waiting/);

  const d = ask(); // one more arrives while the card is up: the count changes, nothing new pops up
  await whenIdle();
  assert.equal(note.created.length, 1);
  assert.equal(shows().length, 1);
  assert.deepEqual(lastOp('update').args[0], { op: 'update', id: a.id, more: 3 });
  const last = note.updates[note.updates.length - 1];
  assert.match(last.opts.contextMessage, /^\+3 more waiting/);
  assert.equal(last.opts.silent, true, 'a count change does not ring again');

  resolveApproval(a.id, true);
  await a.outcome;
  await whenIdle();
  assert.equal(note.created.length, 2, 'the next one gets its notification');
  assert.equal(shows().length, 2);
  assert.equal(shows()[1].args[0].id, b.id);
  assert.equal(shows()[1].args[0].more, 2);
  assert.equal(injected.filter((x) => x.args[0].op === 'settled').length, 0, 'on the same tab the next card replaces the old one');
  for (const r of [b, c, d]) resolveApproval(r.id, false);
  await Promise.allSettled([b.outcome, c.outcome, d.outcome]);
  await whenIdle();
  assert.equal(note.up.size, 0, 'nothing left up');
}

// ── TEST 10: a reload takes the dialog with it: it comes back (silently), with a new nonce ──
{
  reset();
  const a = ask();
  await whenIdle();
  const firstNonce = shows()[0].args[0].nonce;
  updated.forEach((fn) => fn(7, { status: 'complete' }));
  await whenIdle();
  assert.equal(shows().length, 2);
  const again = shows()[1].args[0];
  assert.notEqual(again.nonce, firstNonce);
  assert.equal(again.chime, false, 'no second chime');
  assert.equal(fromDialog({ id: a.id, nonce: firstNonce, decision: 'approve' }, { documentId: `doc-7-${docSeq}` }).answer.ok, false, 'the old nonce is dead');
  assert.equal(fromDialog({ id: a.id, nonce: again.nonce, decision: 'decline' }, { documentId: `doc-7-${docSeq}` }).answer.ok, true);
  assert.equal(await a.outcome, 'USER_DECLINED');
  await whenIdle();
}

// ── TEST 11: an access request keeps its own window; it gets neither of these ──
{
  reset();
  const p = enqueueApproval({ origin: 'https://shop.example', tool: 'web_request_access', risk: ACCESS_RISK, details: { kind: 'access' }, timeoutMs: 60_000, tabId: 7 });
  await whenIdle();
  assert.equal(note.created.length, 0);
  assert.equal(injected.length, 0);
  resolveApproval(getPendingApprovals()[0].id, false);
  await p.catch(() => {});
}

// ── TEST 12: the in-page chime can be switched off ──
{
  reset();
  await chrome.storage.sync.set({ approvalChime: false });
  const a = ask();
  await whenIdle();
  assert.equal(shows()[0].args[0].chime, false);
  resolveApproval(a.id, false);
  await a.outcome;
  await whenIdle();
}

console.log('[test] approval_notify.test.js: ALL ASSERTIONS PASSED (seen everywhere, answered once, never by the page)');
