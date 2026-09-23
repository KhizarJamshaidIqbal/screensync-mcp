// ScreenSync in-page approval dialog: a card on the page an agent wants to act on, with Approve / Decline.
//
// Injected by approval-notify.js with chrome.scripting.executeScript into the extension's ISOLATED world (never
// the page's MAIN world), so it is SELF-CONTAINED (AGENTS.md section 3): no outer variables, no imports.
//
// The page may be hostile, and it must not be able to approve the very action waiting on it:
//   - the card lives in a CLOSED shadow root on a plain <div> built here, so page script cannot reach the
//     buttons (host.shadowRoot is null) and page CSS cannot restyle it (`:host { all: initial !important }`
//     beats anything the page sets on the host: important declarations from the inner tree win);
//   - its state and listeners live in this world, which page script cannot see;
//   - Approve counts only a trusted pointer click (isTrusted, detail > 0), made after the buttons have been on
//     screen for `armMs`, while the card is actually visible (IntersectionObserver v2 `isVisible`: nothing drawn
//     over it). A synthetic click(), a dispatched event or a keypress does nothing;
//   - the decision goes to the service worker with a one-time nonce, which checks the tab, frame, document and
//     origin it came from (approval-notify.js). CDP input to this tab is refused meanwhile (approval-guard.js);
//   - everything shown came from an agent, so it is set as text (textContent), never as markup.
// The card is position: fixed in the top layer (a manual popover) at the top right, so it never moves the page.
//
// msg.op: 'show' (replaces any card), 'update' ({ more }), 'settled' ({ outcome }: approved | declined | timeout |
// gone, shown briefly, then removed), 'remove'. Returns true when it acted.

export function ssApprovalDialog(msg) {
  const KEY = '__screensyncApprovalDialog';
  const store = globalThis;
  const current = store[KEY] || null;
  const op = msg && msg.op;
  if (op === 'remove') { if (current) current.destroy(); return true; }
  if (op === 'update') { if (!current || current.id !== msg.id) return false; current.setMore(msg.more); return true; }
  if (op === 'settled') { if (current && current.id === msg.id) current.settle(msg.outcome); return true; }
  if (op !== 'show' || !document.documentElement) return false;
  if (current) current.destroy();

  const doc = document;
  const now = () => Date.now();
  const armMs = Math.max(0, Number(msg.armMs) || 1200);
  const total = Math.max(0, Number(msg.remainingMs) || 0);
  const deadline = now() + total;
  const make = (tag, cls, text) => {
    const n = doc.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = String(text);
    return n;
  };

  const CSS = `
:host { all: initial !important; position: fixed !important; inset: 16px 16px auto auto !important;
  z-index: 2147483647 !important; display: block !important; margin: 0 !important; padding: 0 !important;
  border: 0 !important; background: transparent !important; width: auto !important; height: auto !important;
  max-width: none !important; overflow: visible !important; opacity: 1 !important; visibility: visible !important;
  transform: none !important; filter: none !important; pointer-events: auto !important; color-scheme: dark !important; }
.card { box-sizing: border-box; width: min(380px, calc(100vw - 32px)); padding: 14px 14px 12px; border-radius: 14px;
  background: #150E27; color: #F4F0FF; border: 1px solid rgba(139, 92, 246, .5);
  box-shadow: 0 16px 48px rgba(0, 0, 0, .5), 0 0 24px rgba(124, 58, 237, .25);
  font: 13px/1.45 system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; text-align: left;
  animation: ss-in .18s ease-out both; }
.head { display: flex; gap: 10px; align-items: flex-start; }
.bell { flex: none; width: 34px; height: 34px; border-radius: 10px; display: grid; place-items: center;
  background: rgba(124, 58, 237, .2); color: #C4B5FD; }
.bell svg { width: 20px; height: 20px; transform-origin: 50% 3px; animation: ss-ring .9s ease-in-out 2; }
.titles { flex: 1; min-width: 0; }
.title { font-weight: 700; font-size: 14px; color: #FFFFFF; }
.sub { margin-top: 2px; color: #DDD6F0; overflow-wrap: anywhere; }
.sub b { color: #FFFFFF; font-weight: 600; }
.left { flex: none; padding: 5px 8px; border-radius: 999px; background: rgba(245, 158, 11, .15); color: #FBBF24;
  font: 600 12px/1 ui-monospace, 'Cascadia Code', Consolas, monospace; }
.reason { margin-top: 10px; color: #DDD6F0; overflow-wrap: anywhere; }
.preview { margin: 8px 0 0; padding: 8px 10px; max-height: 88px; overflow: hidden; border-radius: 8px;
  background: rgba(0, 0, 0, .35); border: 1px solid rgba(80, 60, 130, .5); color: #C4B5FD;
  font: 12px/1.45 ui-monospace, 'Cascadia Code', Consolas, monospace; white-space: pre-wrap; overflow-wrap: anywhere; }
.more { margin-top: 8px; color: #9B8FC4; font-size: 12px; }
.note { margin-top: 8px; color: #FCA5A5; font-size: 12px; }
.status { margin-top: 10px; font-weight: 600; color: #FFFFFF; }
.actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 12px; }
button { all: unset; box-sizing: border-box; cursor: pointer; padding: 9px 16px; border-radius: 9px;
  font: 600 13px/1 system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; }
.decline { color: #DDD6F0; border: 1px solid rgba(155, 143, 196, .5); }
.decline:hover { background: rgba(255, 255, 255, .07); }
.approve { background: #7C3AED; color: #FFFFFF; }
.approve:hover { background: #8B5CF6; }
button[disabled] { opacity: .45; cursor: default; }
.bar { margin-top: 12px; height: 3px; border-radius: 3px; overflow: hidden; background: rgba(255, 255, 255, .08); }
.fill { height: 100%; width: 100%; background: linear-gradient(90deg, #6D28D9, #8B5CF6); }
@keyframes ss-in { from { opacity: 0; transform: translateY(-6px); } to { opacity: 1; transform: none; } }
@keyframes ss-ring { 0%, 100% { transform: rotate(0); } 15% { transform: rotate(14deg); } 30% { transform: rotate(-12deg); }
  45% { transform: rotate(9deg); } 60% { transform: rotate(-6deg); } 75% { transform: rotate(3deg); } }
@media (prefers-reduced-motion: reduce) { .card, .bell svg { animation: none !important; } }
.still .card, .still .bell svg { animation: none !important; }
`;

  const host = doc.createElement('div');
  const root = host.attachShadow({ mode: 'closed' });
  let styled = false;
  try {
    const sheet = new CSSStyleSheet(); // not subject to the page's CSP, unlike a <style> element
    sheet.replaceSync(CSS);
    root.adoptedStyleSheets = [sheet];
    styled = true;
  } catch { /* fall back to a style element */ }
  if (!styled) root.appendChild(make('style', null, CSS));

  const frame = make('div', msg.still ? 'still' : null);
  const card = make('div', 'card');
  card.setAttribute('role', 'alertdialog');
  card.setAttribute('aria-label', 'ScreenSync needs your approval');
  const NS = 'http://www.w3.org/2000/svg';
  const svg = doc.createElementNS(NS, 'svg');
  for (const [k, v] of [['viewBox', '0 0 24 24'], ['fill', 'none'], ['stroke', 'currentColor'], ['stroke-width', '2'],
    ['stroke-linecap', 'round'], ['stroke-linejoin', 'round'], ['aria-hidden', 'true']]) svg.setAttribute(k, v);
  for (const d of ['M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9', 'M10.3 21a1.94 1.94 0 0 0 3.4 0']) {
    const p = doc.createElementNS(NS, 'path');
    p.setAttribute('d', d);
    svg.appendChild(p);
  }
  const bell = make('div', 'bell');
  bell.appendChild(svg);
  const sub = make('div', 'sub');
  sub.append('An AI agent wants to run ', make('b', null, msg.tool || 'an action'), ' on ', make('b', null, msg.host || 'this page'), '.');
  const titles = make('div', 'titles');
  titles.append(make('div', 'title', 'ScreenSync needs your approval'), sub);
  const left = make('span', 'left', '');
  const head = make('div', 'head');
  head.append(bell, titles, left);
  card.append(head, make('div', 'reason', msg.reason || 'This action needs a person to approve it.'));
  if (msg.preview) card.appendChild(make('pre', 'preview', msg.preview));
  if (msg.typed) card.appendChild(make('div', 'more', `Text: ${msg.typed}`));
  const more = make('div', 'more');
  const note = make('div', 'note');
  note.style.display = 'none';
  const status = make('div', 'status');
  status.style.display = 'none';
  const decline = make('button', 'decline', 'Decline');
  const approve = make('button', 'approve', 'Approve');
  for (const b of [decline, approve]) { b.setAttribute('type', 'button'); b.setAttribute('tabindex', '-1'); }
  approve.disabled = true;
  const actions = make('div', 'actions');
  actions.append(decline, approve);
  const fill = make('div', 'fill');
  const bar = make('div', 'bar');
  bar.appendChild(fill);
  card.append(more, note, status, actions, bar);
  frame.appendChild(card);
  root.appendChild(frame);

  let decided = false;
  let over = false;
  let destroyed = false;
  let armedAt = Infinity;
  let armTimer = null;
  const later = [];
  const after = (fn, ms) => { later.push(setTimeout(fn, ms)); };
  const say = (el, text) => { el.textContent = text; el.style.display = text ? '' : 'none'; };
  const setMore = (n) => say(more, Number(n) > 0 ? `+${Number(n)} more waiting in the ScreenSync toolbar popup.` : '');
  setMore(msg.more);

  const arm = () => {
    approve.disabled = true;
    armedAt = Infinity;
    say(note, '');
    clearTimeout(armTimer);
    armTimer = setTimeout(() => {
      if (decided || over || doc.visibilityState !== 'visible') return;
      approve.disabled = false;
      armedAt = now();
    }, armMs);
  };
  const onVisibility = () => { if (doc.visibilityState === 'visible') arm(); else { approve.disabled = true; armedAt = Infinity; } };
  // The window coming back to the front re-arms too, so the click that brought it forward cannot be an approval.
  const onWindowFocus = (ev) => { if (ev.target === window) arm(); };

  // IntersectionObserver v2: isVisible is false while anything is drawn over the button or it is faded out.
  let visible = false;
  let io = null;
  try {
    io = new IntersectionObserver((entries) => {
      for (const e of entries) visible = typeof e.isVisible === 'boolean' ? e.isVisible : e.isIntersecting;
    }, { threshold: [0, 1], trackVisibility: true, delay: 100 });
    io.observe(approve);
  } catch { visible = true; io = null; }

  let timer = null;
  const tick = () => {
    const ms = deadline - now();
    left.textContent = `${Math.max(0, Math.ceil(ms / 1000))}s`;
    fill.style.width = total ? `${Math.max(0, Math.min(100, (ms / total) * 100))}%` : '0%';
    if (ms <= 0 && !over && !decided) { approve.disabled = true; say(status, 'Timing out…'); }
    if (ms < -8000) destroy(); // the service worker never said how it ended (it may have restarted)
  };

  const TEXT = {
    approved: 'Approved. The agent is running it now.',
    declined: 'Declined. Nothing was run.',
    timeout: 'Timed out. Nothing was run.',
    gone: 'Answered in ScreenSync.',
  };
  const settle = (outcome) => {
    if (over) return;
    over = true;
    decided = true;
    approve.disabled = true;
    decline.disabled = true;
    actions.style.display = 'none';
    say(note, '');
    left.textContent = '';
    clearInterval(timer);
    say(status, TEXT[outcome] || TEXT.gone);
    after(destroy, outcome === 'timeout' ? 2500 : 1500);
  };

  const decide = (decision) => {
    decided = true;
    approve.disabled = true;
    decline.disabled = true;
    say(status, decision === 'approve' ? 'Approving…' : 'Declining…');
    const failed = (text, ms) => { say(status, text); actions.style.display = 'none'; after(destroy, ms); };
    let sent;
    try {
      sent = chrome.runtime.sendMessage({ type: msg.messageType, id: msg.id, nonce: msg.nonce, decision });
    } catch {
      sent = Promise.reject(new Error('extension context gone'));
    }
    Promise.resolve(sent).then((res) => {
      if (res && res.ok === true) settle(decision === 'approve' ? 'approved' : 'declined');
      else failed('This request is no longer waiting.', 2500);
    }, () => failed('ScreenSync restarted. Answer in its toolbar popup.', 4000));
  };

  // A real pointer click on a real button: trusted, from a mouse, pen or touch (a keypress has detail 0).
  const pointerClick = (ev) => {
    try { return ev instanceof MouseEvent && ev.isTrusted === true && ev.detail > 0; } catch { return false; }
  };
  const keepFocus = (ev) => { ev.preventDefault(); }; // the buttons never take the keyboard focus
  const onApprove = (ev) => {
    ev.stopPropagation();
    if (!pointerClick(ev) || decided || over || approve.disabled || now() < armedAt) return;
    if (!visible) {
      say(note, 'Approve did not count: this box must be fully visible, with nothing covering it. Try again, or approve from the ScreenSync toolbar popup or the notification.');
      return;
    }
    decide('approve');
  };
  const onDecline = (ev) => {
    ev.stopPropagation();
    if (!(ev && ev.isTrusted === true) || decided || over) return;
    decide('decline');
  };
  approve.addEventListener('mousedown', keepFocus);
  decline.addEventListener('mousedown', keepFocus);
  approve.addEventListener('click', onApprove);
  decline.addEventListener('click', onDecline);
  doc.addEventListener('visibilitychange', onVisibility, true);
  window.addEventListener('focus', onWindowFocus);

  const chime = () => {
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      const ctx = new AC();
      const play = () => {
        const t0 = ctx.currentTime + 0.02;
        for (const [freq, dt] of [[880, 0], [1318.5, 0.16]]) {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = 'sine';
          osc.frequency.value = freq;
          gain.gain.setValueAtTime(0.0001, t0 + dt);
          gain.gain.exponentialRampToValueAtTime(0.16, t0 + dt + 0.015);
          gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dt + 0.7);
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.start(t0 + dt);
          osc.stop(t0 + dt + 0.75);
        }
        after(() => { try { ctx.close(); } catch { /* already closed */ } }, 1500);
      };
      // Autoplay rules may keep the context suspended on a page nobody has clicked: then there is no chime, only
      // the OS notification's. Never wait for a later click to play it late.
      if (ctx.state === 'running') { play(); return; }
      const giveUp = setTimeout(() => { try { ctx.close(); } catch { /* already closed */ } }, 400);
      ctx.onstatechange = () => { if (ctx.state === 'running') { clearTimeout(giveUp); ctx.onstatechange = null; play(); } };
    } catch { /* no sound: the dialog works without it */ }
  };

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    over = true;
    clearInterval(timer);
    clearTimeout(armTimer);
    for (const t of later) clearTimeout(t);
    try { if (io) io.disconnect(); } catch { /* gone */ }
    doc.removeEventListener('visibilitychange', onVisibility, true);
    window.removeEventListener('focus', onWindowFocus);
    try { if (host.matches(':popover-open')) host.hidePopover(); } catch { /* not a popover */ }
    host.remove();
    if (store[KEY] === api) delete store[KEY];
  }

  const api = { id: msg.id, destroy, settle, setMore };
  store[KEY] = api;
  doc.documentElement.appendChild(host);
  try {
    host.setAttribute('popover', 'manual');
    host.showPopover(); // the top layer: above every z-index, and out of reach of the page's transforms and filters
  } catch {
    try { host.removeAttribute('popover'); } catch { /* fixed + max z-index still applies */ }
  }
  timer = setInterval(tick, 250);
  tick();
  arm();
  if (msg.chime) chime();
  return true;
}
