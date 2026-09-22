// The access-request window (opened by lib/access-request.js).
//
// It shows ONE pending request and sends the person's answer to the service worker. It adds no
// chrome.runtime.onMessage listener (owner_pages.test.js pins which files may): it only calls
// chrome.runtime.sendMessage, and the service worker answers it because this is one of the extension's own
// pages (owner-pages.js). Everything shown came from an agent, so it is set as text, never as markup.
//
// The Allow buttons are deliberately hard to press by accident or by automation: they start disabled and wake
// up ARM_MS after the window is shown (and again after it regains focus), they are not in the tab order, and a
// keyboard-activated click (event.detail === 0) is ignored. Deny holds the focus, so a stray Enter declines.

const ARM_MS = 1200;
const POLL_MS = 1000;

const id = new URL(location.href).searchParams.get('id') || '';
const $ = (sel) => document.getElementById(sel);
const send = (msg) => chrome.runtime.sendMessage(msg);
const allowButtons = [$('once'), $('always')];

let item = null;
let decided = false;
let armTimer = null;

function arm() {
  clearTimeout(armTimer);
  for (const b of allowButtons) b.disabled = true;
  armTimer = setTimeout(() => {
    if (!decided && item && document.visibilityState === 'visible') for (const b of allowButtons) b.disabled = false;
  }, ARM_MS);
}

function finish(text, closeAfterMs = 900) {
  decided = true;
  clearTimeout(armTimer);
  const done = document.createElement('div');
  done.className = 'ar-done';
  done.textContent = text;
  $('actions').replaceChildren(done);
  $('left').textContent = '';
  setTimeout(() => window.close(), closeAfterMs);
}

function render() {
  if (!item) return;
  let host = item.origin;
  try { host = new URL(item.origin).host; } catch { /* show the origin as it is */ }
  $('host').textContent = host;
  $('origin').textContent = item.origin;
  const d = item.details || {};
  $('reason').textContent = d.reason || '(no reason given)';
  if (d.allowOnceMinutes) $('once-sub').textContent = `for the next ${d.allowOnceMinutes} minutes`;
  document.title = `ScreenSync - ${host} is asking for access`;
}

function tick() {
  if (!item || decided) return;
  const s = Math.max(0, Math.round((item.expiresAt - Date.now()) / 1000));
  $('left').textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')} left`;
}

async function refresh() {
  if (decided) return;
  let list = [];
  try { list = ((await send({ type: 'get-approvals' })) || {}).approvals || []; } catch { list = []; }
  const found = list.find((a) => a.id === id && a.risk === 'access');
  if (!found) {
    if (item) finish('This request was answered elsewhere or has expired.', 2500);
    else finish('This request is no longer waiting.', 2500);
    return;
  }
  const first = !item;
  item = found;
  render();
  tick();
  if (first) arm();
}

async function decide(approved, decision) {
  if (decided) return;
  decided = true;
  for (const b of [$('deny'), ...allowButtons]) b.disabled = true;
  let res = null;
  try { res = await send({ type: 'resolve-approval', id, approved, decision }); } catch { res = null; }
  if (!res || res.ok !== true) { finish('This request is no longer waiting.', 2500); return; }
  if (!approved) finish('Denied. The agent has been told not to ask again for a while.');
  else if (res.decision === 'always') finish('Allowed. This site stays allowed until you remove it.');
  else finish('Allowed once, for the next few minutes.');
}

$('deny').addEventListener('click', () => decide(false, ''));
for (const b of allowButtons) {
  b.addEventListener('click', (ev) => {
    // A real pointer click only: keyboard activation reports detail 0, a synthetic event is not trusted.
    if (!ev.isTrusted || ev.detail === 0 || b.disabled) return;
    decide(true, b.getAttribute('data-allow'));
  });
}
window.addEventListener('focus', () => { if (item && !decided) arm(); });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && item && !decided) arm(); });

setInterval(tick, 1000);
setInterval(refresh, POLL_MS);
refresh();
