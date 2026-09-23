// ScreenSync approval notifications: a request that waits for a person is put where they will see it.
//
// Until now the only signs of a pending approval were the popup's "Waiting for your approval" card and a small
// number on the toolbar icon. Live, nobody noticed, the request lapsed, and the agent was told the hub was down.
// Now, besides those two (unchanged), the request at the head of the queue is also shown as:
//   - an OS notification: title, "<tool> on <host> - flagged: <why>", Approve / Decline buttons, sticky
//     (requireInteraction) and not silent, so the system chime is the bell. Clicking it brings the tab forward;
//   - a dialog on the page itself (approval-dialog.js, closed shadow root, isolated world) with a ringing bell,
//     the reason, a code preview, the real countdown and Approve / Decline.
// One decision, every surface: an answer in any of them (popup, notification, dialog) goes through
// consent.resolveApproval, which settles a request exactly once, and the queue-change event then takes the
// notification and the dialog down everywhere. A lapse shows "timed out" briefly. Several requests never stack:
// one notification and one dialog show the oldest request and "+N more".
//
// Access requests (web_request_access) have their own focused window (access-request.js) and are left to it.
// The dialog is only shown on a tab still on the origin the request is about; where it cannot be injected
// (chrome://, the Web Store, a PDF, a discarded tab) the notification and the popup carry it alone.

import { ACCESS_RISK, getPendingApprovals, normalizeOrigin, onApprovalSettled, onApprovalsChanged, resolveApproval } from './consent.js';
import { getSettings } from './storage.js';
import { ssApprovalDialog } from './approval-dialog.js';
import { clearNotification, notificationIds, showNotification, updateNotification } from './os-notify.js';
import { guardTab, releaseTab } from './approval-guard.js';

export const NOTIFICATION_PREFIX = 'ss-approval:';
export const TIMED_OUT_NOTIFICATION = 'ss-approval-timed-out';
/** The one message type the in-page dialog sends. Checked hard in acceptDialogDecision. */
export const DIALOG_MESSAGE = 'ss-approval-dialog';
const ARM_MS = 1200;
const TIMED_OUT_NOTICE_MS = 6000;

const clip = (value, max) => {
  const s = String(value ?? '').replace(/\s+/g, ' ').trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
};

let shown = null; // the request on screen: { id, tool, tabId, origin, host, nonce, documentId, dialog, more, info }
const outcomes = new Map(); // request id -> how it ended, from consent's settle event
let chain = Promise.resolve();
/** Runs surface updates one at a time, in order: an answer can never overtake the injection it answers. */
const serial = (fn) => { chain = chain.then(fn, fn).catch(() => {}); return chain; };

const MARKER_WORDS = [
  [/destructive_keyword:?/g, 'destructive word'],
  [/destructive_code:?/g, 'page-changing code:'],
  [/catastrophic_intent:([a-z_]+)/g, (_m, what) => `high-risk intent (${what.replace(/_/g, ' ')})`],
  [/mutating_request/g, 'data-changing request'],
  [/declared_irreversible/g, 'marked irreversible'],
];

/** What a person is told about a request, in words; everything is plain text (the UIs never parse markup). */
export function describeApproval(item) {
  const d = item.details || {};
  let host = item.origin;
  try { host = new URL(item.origin).host || host; } catch { /* show the origin as it is */ }
  const markers = Array.isArray(d.hubMarkers) ? d.hubMarkers.filter(Boolean) : [];
  let reason = clip(d.reason, 240) || 'This action needs a person to approve it.';
  if (markers.length) {
    // The hub's reason reads "<tool> looks destructive (<markers and what raised them>) and <domain> has only earned
    // <LEVEL>; ...". Say the same in words.
    const found = /looks destructive \((.*)\) and /.exec(String(d.reason || ''));
    let why = found ? found[1] : markers.join(', ');
    for (const [re, to] of MARKER_WORDS) why = why.replace(re, to);
    reason = clip(`Flagged as possibly destructive: ${why.replace(/\s+/g, ' ').trim()}. The agent has not earned trust on ${host} yet${d.level ? ` (level ${d.level})` : ''}, so a person decides.`, 300);
  }
  return {
    host,
    flagged: markers.length ? markers.join(', ') : clip(d.reason, 70) || 'needs your approval',
    reason,
    preview: clip(d.target, 160),
    typed: d.text ? clip(d.text, 60) : '',
  };
}

function sameOrigin(url, origin) {
  try {
    const u = new URL(String(url));
    return (u.protocol === 'http:' || u.protocol === 'https:') && normalizeOrigin(u.origin) === normalizeOrigin(origin);
  } catch {
    return false;
  }
}

const secondsLeft = (item) => Math.max(1, Math.round((item.expiresAt - Date.now()) / 1000));
const contextLine = (item, more) => `${more ? `+${more} more waiting · ` : ''}Answer within ${secondsLeft(item)}s, or it is declined.`;

function newNonce() {
  try { if (crypto && typeof crypto.randomUUID === 'function') return `${crypto.randomUUID()}${crypto.randomUUID()}`; } catch { /* below */ }
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Runs the dialog function in the page's top frame, in the extension's isolated world. Never throws. */
async function runDialog(tabId, message) {
  if (typeof chrome === 'undefined' || !chrome.scripting || typeof chrome.scripting.executeScript !== 'function') return null;
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId, frameIds: [0] }, world: 'ISOLATED', func: ssApprovalDialog, args: [message],
    });
    return (results && results[0]) || null;
  } catch {
    return null; // chrome://, the Web Store, a PDF viewer, a discarded or closed tab: the notification carries it
  }
}

/** Shows the dialog on the request's tab, if that tab is still on the request's origin. Sets state.dialog. */
async function inject(state, item, { chime }) {
  const fail = () => { state.dialog = false; releaseTab(state.tabId); return false; };
  if (!Number.isInteger(state.tabId) || typeof chrome === 'undefined' || !chrome.tabs) return fail();
  let tab = null;
  try { tab = await chrome.tabs.get(state.tabId); } catch { tab = null; }
  if (!tab || tab.discarded || !sameOrigin(tab.url, state.origin)) return fail();
  state.windowId = tab.windowId;
  state.nonce = newNonce();
  guardTab(state.tabId); // before the dialog exists: no CDP click may race it
  const settings = await getSettings().catch(() => ({}));
  const res = await runDialog(state.tabId, {
    op: 'show', id: state.id, nonce: state.nonce, messageType: DIALOG_MESSAGE, tool: state.tool, host: state.info.host,
    reason: state.info.reason, preview: state.info.preview, typed: state.info.typed, more: state.more,
    remainingMs: Math.max(0, item.expiresAt - Date.now()), armMs: ARM_MS,
    chime: chime && settings.approvalChime !== false, still: settings.reduceMotion === true,
  });
  if (!res || res.result !== true) return fail();
  state.dialog = true;
  state.documentId = res.documentId || null;
  return true;
}

async function present(item, more) {
  const state = {
    id: item.id, tool: item.tool, tabId: Number.isInteger(item.tabId) ? item.tabId : null, windowId: null,
    origin: item.origin, nonce: null, documentId: null, dialog: false, more, info: describeApproval(item),
  };
  shown = state;
  await showNotification(NOTIFICATION_PREFIX + state.id, {
    title: 'ScreenSync needs your approval',
    message: `${state.tool} on ${state.info.host} — flagged: ${state.info.flagged}`,
    contextMessage: contextLine(item, more),
    buttons: [{ title: 'Approve' }, { title: 'Decline' }],
    requireInteraction: true,
    silent: false,
  });
  if (shown === state) await inject(state, item, { chime: true });
}

async function retire(prev, next) {
  const outcome = outcomes.get(prev.id) || 'gone';
  outcomes.delete(prev.id);
  await clearNotification(NOTIFICATION_PREFIX + prev.id);
  // The next request on the same tab replaces the card; otherwise say briefly how this one ended.
  if (prev.dialog && !(next && next.tabId === prev.tabId)) await runDialog(prev.tabId, { op: 'settled', id: prev.id, outcome });
  releaseTab(prev.tabId);
  if (outcome === 'timeout' && !next) {
    const up = await showNotification(TIMED_OUT_NOTIFICATION, {
      title: 'ScreenSync approval timed out',
      message: `${prev.tool} on ${prev.info.host} was not run: nobody answered in time.`,
      requireInteraction: false, silent: true, priority: 0,
    });
    if (up) setTimeout(() => { clearNotification(TIMED_OUT_NOTIFICATION); }, TIMED_OUT_NOTICE_MS);
  }
}

/** Brings the surfaces in line with the queue: the oldest action request is shown, the rest counted. */
async function sync() {
  const actions = getPendingApprovals().filter((a) => a.risk !== ACCESS_RISK);
  const head = actions[0] || null;
  const more = Math.max(0, actions.length - 1);
  if (shown && (!head || head.id !== shown.id)) {
    const prev = shown;
    shown = null;
    await retire(prev, head);
  }
  if (!head) return;
  if (!shown) { await present(head, more); return; }
  if (shown.more === more) return;
  shown.more = more;
  await updateNotification(NOTIFICATION_PREFIX + shown.id, { contextMessage: contextLine(head, more), silent: true });
  if (shown.dialog) await runDialog(shown.tabId, { op: 'update', id: shown.id, more });
}

/**
 * The in-page dialog's answer. It is taken only from the dialog this worker put up: this extension, the tab
 * and top frame it is on, the very document it was injected into, still on the request's origin, with the
 * one-time nonce only that dialog was given. Anything else is refused and changes nothing.
 */
export function acceptDialogDecision(msg, sender) {
  const s = shown;
  const no = (error) => ({ ok: false, error });
  if (!s || !s.dialog) return no('No approval dialog is showing.');
  if (!sender || typeof chrome === 'undefined' || sender.id !== chrome.runtime.id) return no('Not from this extension.');
  if (!sender.tab || sender.tab.id !== s.tabId || sender.frameId !== 0) return no('Not from the tab the dialog is on.');
  if (s.documentId && sender.documentId !== s.documentId) return no('Not from the page the dialog was shown on.');
  if (!sameOrigin(sender.url || sender.origin || '', s.origin)) return no('The page has moved to another site.');
  if (!msg || msg.id !== s.id || typeof msg.nonce !== 'string' || msg.nonce !== s.nonce) return no('Stale or forged answer.');
  if (msg.decision !== 'approve' && msg.decision !== 'decline') return no('Unknown answer.');
  return resolveApproval(s.id, msg.decision === 'approve');
}

const idOf = (notificationId) => (typeof notificationId === 'string' && notificationId.startsWith(NOTIFICATION_PREFIX)
  ? notificationId.slice(NOTIFICATION_PREFIX.length) : null);

/** Approve (button 0) or Decline (button 1) on the OS notification. */
export function onNotificationButton(notificationId, buttonIndex) {
  const id = idOf(notificationId);
  if (id) resolveApproval(id, buttonIndex === 0);
}

/** A click on the notification's body brings the tab the request is about to the front. */
export async function onNotificationClicked(notificationId) {
  const id = idOf(notificationId);
  if (!id) return;
  const item = getPendingApprovals().find((a) => a.id === id);
  const tabId = item && Number.isInteger(item.tabId) ? item.tabId : null;
  try {
    if (tabId != null) {
      const tab = await chrome.tabs.update(tabId, { active: true });
      if (tab && tab.windowId != null) await chrome.windows.update(tab.windowId, { focused: true });
    }
    // No page to show it on (or it could not be shown there): the popup has the queue.
    if ((tabId == null || !(shown && shown.id === id && shown.dialog)) && chrome.action && chrome.action.openPopup) await chrome.action.openPopup();
  } catch { /* the tab is gone, or the popup cannot open here: the badge still points at it */ }
}

function onDialogMessage(msg, sender, sendResponse) {
  if (!msg || msg.type !== DIALOG_MESSAGE) return false; // not ours: other listeners decide
  sendResponse(acceptDialogDecision(msg, sender));
  return false;
}

onApprovalSettled((item, outcome) => { outcomes.set(item.id, outcome); });
onApprovalsChanged(() => { serial(sync); });

if (typeof chrome !== 'undefined') {
  const n = chrome.notifications;
  if (n && n.onButtonClicked && n.onClicked) {
    n.onButtonClicked.addListener(onNotificationButton);
    n.onClicked.addListener(onNotificationClicked);
  }
  if (chrome.runtime && chrome.runtime.onMessage) chrome.runtime.onMessage.addListener(onDialogMessage);
  if (chrome.tabs && chrome.tabs.onRemoved) {
    chrome.tabs.onRemoved.addListener((tabId) => {
      if (shown && shown.tabId === tabId) { shown.dialog = false; releaseTab(tabId); }
    });
  }
  if (chrome.tabs && chrome.tabs.onUpdated) {
    // A reload or a navigation takes the dialog with the old document: put it back while the request waits (only
    // on the same site; the service worker checks that before it shows anything).
    chrome.tabs.onUpdated.addListener((tabId, change) => {
      if (!change || change.status !== 'complete' || !shown || shown.tabId !== tabId) return;
      serial(async () => {
        const item = shown && getPendingApprovals().find((a) => a.id === shown.id);
        if (item && shown.tabId === tabId) await inject(shown, item, { chime: false });
      });
    });
  }
  // Requests live in the worker's memory, so after a restart any of our notifications still up are stale.
  notificationIds().then((ids) => {
    const live = new Set(getPendingApprovals().map((a) => NOTIFICATION_PREFIX + a.id));
    for (const id of ids) if ((id.startsWith(NOTIFICATION_PREFIX) && !live.has(id)) || id === TIMED_OUT_NOTIFICATION) clearNotification(id);
  }).catch(() => {});
}

/** For tests: resolves once every queued surface update, including ones queued meanwhile, has run. */
export async function whenIdle() {
  let seen;
  do { seen = chain; await seen; } while (seen !== chain);
}
