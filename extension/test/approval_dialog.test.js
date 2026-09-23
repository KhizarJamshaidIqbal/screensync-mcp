// The in-page approval dialog (lib/approval-dialog.js): what it shows, and that the page it sits on cannot use it.
//
// The dialog runs inside a page that may be hostile, on the very page whose action waits for approval. These
// tests pin that page script can neither reach its buttons nor fake a click on them, that only a real pointer
// click on a visible, armed button counts, that nothing the agent sent is ever parsed as markup, and that it
// cleans up after itself. The function is run the way chrome.scripting.executeScript runs it: rebuilt from its
// source text, so a reference to anything outside it would fail here too.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { mock } from 'node:test';
import { fileURLToPath } from 'node:url';
import { FakeMouseEvent, installDom, trustedClick, trustedEvent } from './dom-mock.js';

const dom = installDom();
const sent = [];
let reply = { ok: true };
globalThis.chrome = { runtime: { sendMessage: async (m) => { sent.push(m); return reply; } } };

const { ssApprovalDialog } = await import('../lib/approval-dialog.js');
// Serialised and rebuilt, exactly as executeScript does: no outer variables survive this.
const dialog = new Function('msg', `return (${ssApprovalDialog.toString()})(msg);`);

console.log('[test] running in-page approval dialog tests...');

const EVIL = '<img src=x onerror="alert(document.cookie)">document.forms[0].submit()';
const show = (over = {}) => dialog({
  op: 'show', id: 'appr_1', nonce: 'n'.repeat(64), messageType: 'ss-approval-dialog', tool: 'web_eval',
  host: 'citytourinbarcelona.com', reason: 'Flagged as possibly destructive: page-changing code: form submit.',
  preview: EVIL, typed: '', more: 2, remainingMs: 60_000, armMs: 1200, chime: false, still: false, ...over,
});
const hostEl = () => dom.html.childNodes.find((n) => n.internalShadowRoot);
const inside = () => hostEl().internalShadowRoot.descendants();
const button = (cls) => inside().find((e) => e.tagName === 'BUTTON' && e.className === cls);
const text = () => hostEl().internalShadowRoot.textContent;

mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: 1_000_000 });
try {
  // ── TEST 1: shown in a CLOSED shadow root, in the top layer, styled so page CSS cannot restyle it ──
  assert.equal(show(), true);
  const host = hostEl();
  assert.ok(host, 'the card was added to the page');
  assert.equal(host.tagName, 'DIV', 'a plain element, never a custom element name the page could have defined');
  assert.equal(host.internalShadowRoot.mode, 'closed');
  assert.equal(host.shadowRoot, null, 'page script gets null for host.shadowRoot');
  assert.equal(host.popoverOpen, true, 'it sits in the top layer (manual popover), above any z-index');
  const css = host.internalShadowRoot.adoptedStyleSheets[0].cssText;
  assert.match(css, /:host \{ all: initial !important; position: fixed !important; inset: 16px 16px auto auto !important;/);
  assert.match(css, /z-index: 2147483647 !important/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{ \.card, \.bell svg \{ animation: none !important; \} \}/);
  assert.match(css, /\.approve \{ background: #7C3AED;/, 'the popup\'s purple Approve');

  // ── TEST 2: what it says, all as text: the agent's code shows as code, never becomes markup ──
  for (const s of ['ScreenSync needs your approval', 'web_eval', 'citytourinbarcelona.com', 'page-changing code: form submit', '60s', '+2 more waiting']) {
    assert.ok(text().includes(s), `shows "${s}"`);
  }
  assert.ok(text().includes(EVIL), 'the preview is the literal text');
  assert.equal(inside().filter((e) => e.tagName === 'IMG').length, 0, 'no element was made from it');
  assert.ok(inside().some((e) => e.tagName === 'SVG'), 'the bell icon');
  assert.equal(button('approve').getAttribute('tabindex'), '-1', 'Approve never takes the keyboard focus');

  // ── TEST 3: the page cannot find the buttons, and cannot click them even if it could ──
  assert.deepEqual(document.querySelectorAll('button'), [], 'querySelectorAll does not reach into the closed root');
  mock.timers.tick(1300); // armed
  dom.setVisible(true);
  const approve = button('approve');
  assert.equal(approve.disabled, false, 'armed after armMs');
  approve.click();
  approve.dispatchEvent(new FakeMouseEvent('click', { detail: 1 }));
  approve.dispatchEvent(Object.assign(new FakeMouseEvent('click', { detail: 1 }), { forged: true }));
  assert.equal(sent.length, 0, 'a synthetic .click() or dispatchEvent from the page approves nothing');

  // ── TEST 4: a keypress-made click (detail 0) does not count either ──
  approve.dispatchEvent(trustedClick(0));
  assert.equal(sent.length, 0);

  // ── TEST 5: covered by something the page drew over it: refused, and the person is told ──
  dom.setVisible(false);
  approve.dispatchEvent(trustedClick());
  assert.equal(sent.length, 0);
  assert.match(text(), /Approve did not count/);

  // ── TEST 6: bringing the window forward re-arms, so that click cannot approve ──
  dom.setVisible(true);
  dom.win.dispatchEvent(trustedEvent('focus'));
  assert.equal(approve.disabled, true, 're-armed');
  approve.dispatchEvent(trustedClick());
  assert.equal(sent.length, 0, 'a disabled button gets no click');
  mock.timers.tick(1300);

  // ── TEST 7: the countdown follows the real window ──
  mock.timers.tick(10_000); // 12.6s since it was shown
  assert.ok(text().includes('48s'), text());

  // ── TEST 8: a person's click, armed and visible: exactly one answer, with the nonce ──
  approve.dispatchEvent(trustedClick());
  approve.dispatchEvent(trustedClick());
  button('decline').dispatchEvent(trustedClick());
  assert.equal(sent.length, 1, 'answered once');
  assert.deepEqual(sent[0], { type: 'ss-approval-dialog', id: 'appr_1', nonce: 'n'.repeat(64), decision: 'approve' });
  await Promise.resolve(); await Promise.resolve();
  assert.match(text(), /Approved/);
  mock.timers.tick(1600);
  assert.equal(hostEl(), undefined, 'gone shortly after');
  assert.equal(dom.docEvents.listenerCount(), 0, 'and it left no listener on the page');
  assert.equal(dom.win.listenerCount(), 0);
  assert.ok(dom.observers.every((o) => o.disconnected), 'nor an observer');

  // ── TEST 9: Decline needs a trusted click too ──
  sent.length = 0;
  show({ id: 'appr_2', more: 0 });
  assert.ok(!text().includes('more waiting'), 'no "+N more" when nothing else waits');
  button('decline').click();
  assert.equal(sent.length, 0);
  button('decline').dispatchEvent(trustedClick());
  assert.deepEqual(sent.map((m) => m.decision), ['decline']);
  await Promise.resolve(); await Promise.resolve();
  mock.timers.tick(1600);

  // ── TEST 10: updates, a timeout, a second show replacing the first (never two cards) ──
  sent.length = 0;
  show({ id: 'appr_3', more: 0 });
  show({ id: 'appr_4', more: 0 });
  assert.equal(dom.html.childNodes.filter((n) => n.internalShadowRoot).length, 1, 'one card, never a stack');
  assert.equal(dialog({ op: 'update', id: 'appr_3', more: 5 }), false, 'an update for a card that is gone does nothing');
  assert.equal(dialog({ op: 'update', id: 'appr_4', more: 3 }), true);
  assert.match(text(), /\+3 more waiting/);
  dialog({ op: 'settled', id: 'appr_4', outcome: 'timeout' });
  assert.match(text(), /Timed out\. Nothing was run\./);
  assert.equal(inside().filter((e) => e.tagName === 'BUTTON' && e.parentNode.style.display !== 'none').length, 0, 'no buttons once it has ended');
  mock.timers.tick(2600);
  assert.equal(hostEl(), undefined, 'removed after showing "timed out"');

  // ── TEST 11: an answer the service worker refuses (answered elsewhere) is said, not assumed ──
  reply = { ok: false, error: 'Stale or forged answer.' };
  show({ id: 'appr_5' });
  mock.timers.tick(1300);
  dom.setVisible(true);
  button('approve').dispatchEvent(trustedClick());
  await Promise.resolve(); await Promise.resolve();
  assert.match(text(), /no longer waiting/);
  mock.timers.tick(2600);
  assert.equal(hostEl(), undefined);
  reply = { ok: true };

  // ── TEST 12: left alone past its deadline (the service worker died): it removes itself ──
  show({ id: 'appr_6', remainingMs: 5_000 });
  mock.timers.tick(5_500);
  assert.match(text(), /Timing out/);
  mock.timers.tick(9_000);
  assert.equal(hostEl(), undefined);

  // ── TEST 13: reduced motion from the extension setting, and a chime that may not play never breaks it ──
  globalThis.window.AudioContext = class { constructor() { throw new Error('NotAllowedError'); } };
  assert.equal(show({ id: 'appr_7', still: true, chime: true }), true, 'a blocked chime does not stop the dialog');
  assert.ok(inside().some((e) => e.className === 'still'), 'the still class turns the animations off');
  const started = [];
  globalThis.window.AudioContext = class {
    constructor() { this.state = 'running'; this.currentTime = 0; this.destination = {}; }
    createOscillator() { return { frequency: {}, connect() {}, start: (t) => started.push(t), stop() {} }; }
    createGain() { return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} }; }
    close() {}
  };
  show({ id: 'appr_8', chime: true });
  assert.equal(started.length, 2, 'a two-note chime when the page may play audio');
  globalThis.window.AudioContext = class { constructor() { this.state = 'suspended'; } close() { this.closed = true; } };
  assert.equal(show({ id: 'appr_9', chime: true }), true, 'autoplay-blocked: silent, still shown');
  dialog({ op: 'remove' });
  assert.equal(hostEl(), undefined);
} finally {
  mock.timers.reset();
}

// ── TEST 14: the source never builds markup from strings and never asks for the page's world ──
const src = fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'lib', 'approval-dialog.js'), 'utf8');
const code = src.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
assert.doesNotMatch(code, /innerHTML|outerHTML|insertAdjacentHTML|document\.write|DOMParser|createContextualFragment/);
assert.match(code, /attachShadow\(\{ mode: 'closed' \}\)/);

console.log('[test] approval_dialog.test.js: ALL ASSERTIONS PASSED (only a person\'s click on a visible dialog answers)');
