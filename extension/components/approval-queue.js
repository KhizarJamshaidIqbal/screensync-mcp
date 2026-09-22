// Pending approvals: what an agent wants to do, where, and Approve / Decline.
//
// Shared by the toolbar popup (the badge on the icon sends you there) and the dashboard's Web Access tab.
// A request lapses on its own (the extension declines it), so the list refreshes quickly and shows how long
// is left. Everything shown here came from an agent or the hub, so it is set as text and never as markup.

const REFRESH_MS = 1500;
/** An access row's Allow buttons wake up this long after it appears or moves, as in the access window. */
const ARM_MS = 1200;

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'style') node.style.cssText = v;
    else if (k === 'className') node.className = v;
    else node.setAttribute(k, v);
  }
  for (const child of children) if (child != null) node.append(child);
  return node;
}

const secondsLeft = (a) => Math.max(0, Math.round(((a.expiresAt || 0) - Date.now()) / 1000));

function row(a, armed = true) {
  const d = a.details || {};
  const lines = [];
  if (d.target) lines.push(el('div', { className: 'dim', style: 'font-size:11px;word-break:break-all' }, `on ${d.target}`));
  if (d.text) lines.push(el('div', { className: 'dim', style: 'font-size:11px;word-break:break-all' }, `text: ${d.text}`));
  const access = a.risk === 'access';
  if (d.reason) lines.push(el('div', { className: 'dim', style: 'font-size:11px' }, access ? `agent's reason (not checked): ${d.reason}` : d.reason));
  if (Array.isArray(d.hubMarkers) && d.hubMarkers.length) {
    lines.push(el('div', { className: 'dim', style: 'font-size:11px' }, `hub flagged: ${d.hubMarkers.join(', ')}${d.level ? ` (domain level ${d.level})` : ''}`));
  }
  const left = el('span', { className: 'dim', style: 'font-size:11px', 'data-left': a.id }, `${secondsLeft(a)}s left`);
  // An access request (lib/access-request.js) asks for a site, not for one action, so it gets its own answers.
  const wake = armed ? {} : { disabled: '' };
  const buttons = access
    ? [
      el('button', { className: 'btn btn-sm btn-primary', 'data-appr': a.id, 'data-action': 'approve', 'data-decision': 'once', tabindex: '-1', ...wake }, 'Allow once'),
      el('button', { className: 'btn btn-sm btn-primary', 'data-appr': a.id, 'data-action': 'approve', 'data-decision': 'always', tabindex: '-1', ...wake }, 'Always allow'),
      el('button', { className: 'btn btn-sm btn-ghost', 'data-appr': a.id, 'data-action': 'decline' }, 'Deny')]
    : [
      el('button', { className: 'btn btn-sm btn-primary', 'data-appr': a.id, 'data-action': 'approve' }, 'Approve'),
      el('button', { className: 'btn btn-sm btn-ghost', 'data-appr': a.id, 'data-action': 'decline' }, 'Decline')];
  return el('div', { className: 'card', style: 'padding:8px 10px;border-left:3px solid var(--crit);display:flex;flex-direction:column;gap:6px' },
    el('div', { className: 'row spread' },
      el('div', {}, el('strong', {}, access ? 'Site access' : a.tool), ' on ', el('code', {}, a.origin)),
      left),
    ...(access ? [el('div', { className: 'dim', style: 'font-size:11px' }, 'Read its pages, click and type, and send requests to it signed in as you. Not the cookie tools.')] : []),
    ...lines,
    el('div', { className: 'row', style: 'gap:6px' }, ...buttons));
}

/**
 * Mounts the queue into `host`. The host hides itself when nothing is waiting. `send` is the extension's
 * message function. Returns { refresh } so a caller can force an update.
 */
export function mountApprovalQueue(host, send) {
  host.replaceChildren();
  const count = el('span', { className: 'pill warn' }, '0');
  const list = el('div', { style: 'display:flex;flex-direction:column;gap:8px' });
  host.append(
    el('div', { className: 'row spread', style: 'margin-bottom:8px' },
      el('strong', { style: 'color:var(--crit);font-size:var(--text-sm)' }, 'Waiting for your approval'),
      count),
    list);
  host.style.display = 'none';

  let items = [];
  const wakeAt = new Map(); // access id -> when its Allow buttons wake up
  const shownAt = new Map(); // access id -> its position last time it was drawn
  function render() {
    host.style.display = items.length ? '' : 'none';
    count.textContent = String(items.length);
    const now = Date.now();
    // A row that is new, or has moved because one above it lapsed, is re-armed: a click aimed at the row
    // that used to be there must never land on an Allow button.
    items.forEach((a, i) => {
      if (a.risk !== 'access') return;
      if (shownAt.get(a.id) !== i) { wakeAt.set(a.id, now + ARM_MS); setTimeout(render, ARM_MS + 50); }
      shownAt.set(a.id, i);
    });
    list.replaceChildren(...items.map((a) => row(a, !(wakeAt.get(a.id) > now))));
  }

  async function refresh() {
    try {
      const res = await send({ type: 'get-approvals' });
      items = (res && res.approvals) || [];
    } catch { items = []; }
    render();
  }

  list.addEventListener('click', async (ev) => {
    const btn = ev.target.closest('button[data-appr]');
    if (!btn) return;
    const decision = btn.getAttribute('data-decision');
    // Granting a site takes a real pointer click, as in the access-request window: not a keypress.
    if (decision && (!ev.isTrusted || ev.detail === 0)) return;
    btn.disabled = true;
    await send({ type: 'resolve-approval', id: btn.getAttribute('data-appr'), approved: btn.getAttribute('data-action') === 'approve', decision: decision || '' });
    await refresh();
  });

  // The countdown ticks locally; the list itself is re-read from the service worker.
  setInterval(() => {
    for (const a of items) {
      const label = list.querySelector(`[data-left="${a.id}"]`);
      if (label) label.textContent = `${secondsLeft(a)}s left`;
    }
  }, 1000);
  setInterval(() => { if (document.visibilityState !== 'hidden') refresh(); }, REFRESH_MS);
  refresh();
  return { refresh };
}
