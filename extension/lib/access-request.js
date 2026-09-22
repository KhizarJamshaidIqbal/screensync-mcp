// ScreenSync Access Requests - the agent ASKS for a site, a person decides.
//
// Before this, an agent that hit "Action access not granted for origin X" was stuck until the owner found the
// Web Access tab and added a grant by hand. `web_request_access` lets the agent ask instead. The request is put
// in front of the person three ways at once: a focused extension window in the middle of the screen, the toolbar
// badge, and the queue in the popup / dashboard. They answer Deny, Allow once (read + act for ALLOW_ONCE_MS) or
// Always allow this site (a saved read + act grant, the same one the dashboard's Add Grant makes).
//
// What keeps the agent from approving itself:
//   - the decision is applied in consent.resolveApproval, reachable only from the extension's own pages
//     (owner-pages.js); there is no hub route and no argument that grants anything;
//   - the window is an extension page, which every web_* tool refuses to read, click, type or script;
//   - on that page the Allow buttons wake up only after a pause, never take the keyboard focus, and ignore
//     keyboard presses: a person's pointer click, not an Enter sent by OS automation, is what counts;
//   - only http(s) sites can be requested, so an agent cannot ask for the extension's own pages or chrome://.
//
// What keeps it from wearing the person down: one window at a time (other requests wait on the badge and in
// the popup, and the next window opens when the current one is answered), at most MAX_PENDING open requests,
// and a cool-down per site after a decline, after closing the window unanswered (that is a "no"), and after a
// request lapses unanswered.

import {
  ACCESS_RISK, ALLOW_ONCE_MS, enqueueApproval, getOriginGrant, getPendingApprovals, isLoopbackOrTestOrigin,
  normalizeOrigin, onApprovalsChanged, resolveApproval,
} from './consent.js';
import { activeTabOfLastNormalWindow } from './tab-resolve.js';
import { ERROR_CODES, makeError } from './errors.js';

export const REQUEST_TTL_MS = 5 * 60_000;
export const DENY_COOLDOWN_MS = 10 * 60_000;
export const UNANSWERED_COOLDOWN_MS = 5 * 60_000;
export const MAX_PENDING = 3;
/** How long one call waits for the answer before it returns `pending` (the hub gives up on a call at ~45s). */
const MAX_WAIT_MS = 30_000;
const HUB_HEADROOM_MS = 5_000;
const WINDOW_W = 480;
const WINDOW_H = 640;

const pendingByOrigin = new Map(); // origin -> { id, promise, expiresAt }
const cooldowns = new Map(); // origin -> { until, why: 'declined' | 'unanswered' }
const windowsById = new Map(); // approval id -> chrome window id

const clip = (value, max) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const until = (ms) => new Date(ms).toISOString();

/** `https://Host.:443` -> `https://host` : one spelling per site, so a cool-down cannot be dodged by a dot. */
function canonicalOrigin(url) {
  const host = url.hostname.replace(/\.+$/, '');
  return normalizeOrigin(`${url.protocol}//${host}${url.port ? `:${url.port}` : ''}`);
}

/**
 * The http(s) site being asked for: `url`/`origin` if given, else the tab named by `tabId`, else the active tab
 * of the window the person was using. Never the "first tab anywhere" fallback other tools use: while the access
 * window itself has focus that would name an unrelated site.
 */
async function targetOrigin(args) {
  let raw = args.url || args.origin ? String(args.url || args.origin) : '';
  if (!raw && args.tabId != null) {
    const tab = await chrome.tabs.get(Number(args.tabId)).catch(() => null);
    if (!tab) return { error: `Tab ${args.tabId} is not open. Pass the site's url instead.` };
    raw = tab.url || '';
  }
  if (!raw) {
    const tab = await activeTabOfLastNormalWindow();
    if (!tab) return { error: 'No ordinary browser tab is in front. Pass the site\'s url.' };
    raw = tab.url;
  }
  let url;
  try { url = new URL(raw); } catch { return { error: `Not a site address: ${clip(raw, 120)}` }; }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return { error: `Only http(s) sites can be requested, not ${url.protocol}//. Pass the site's url.` };
  }
  return { origin: canonicalOrigin(url) };
}

async function openWindow(id) {
  if (typeof chrome === 'undefined' || !chrome.windows || !chrome.runtime) return;
  // Reserve the single slot before the first await: enqueueApproval's change event and ask() both call
  // showNextWindow() in the same tick, and each must see the slot taken or two windows open.
  windowsById.set(id, null);
  try {
    const place = {};
    try {
      const w = await chrome.windows.getLastFocused({ windowTypes: ['normal'] });
      if (w && w.state !== 'minimized' && Number.isFinite(w.left) && Number.isFinite(w.width)) {
        // Centred on the browser the person is using. No clamp to 0: a monitor left of or above the primary
        // one has negative coordinates, and Chrome keeps the bounds on a visible display by itself.
        place.left = Math.round(w.left + (w.width - WINDOW_W) / 2);
        place.top = Math.round(w.top + Math.max(24, (w.height - WINDOW_H) / 4));
      }
    } catch { /* centred by Chrome instead */ }
    const win = await chrome.windows.create({
      url: chrome.runtime.getURL(`pages/access-request.html?id=${encodeURIComponent(id)}`),
      type: 'popup', width: WINDOW_W, height: WINDOW_H, focused: true, ...place,
    });
    if (win && win.id != null && windowsById.has(id)) windowsById.set(id, win.id);
    else if (win && win.id != null) removeWindow(win.id); // answered while the window was opening
  } catch {
    windowsById.delete(id); // the badge and the popup queue still show the request
  }
}

function removeWindow(winId) {
  try { const p = chrome.windows.remove(winId); if (p && p.catch) p.catch(() => {}); } catch { /* already gone */ }
}

const accessItems = () => getPendingApprovals().filter((a) => a.risk === ACCESS_RISK);

/** At most one window: when none is open, show the oldest access request that is still waiting. */
function showNextWindow() {
  if (windowsById.size) return;
  const next = accessItems()[0];
  if (next) openWindow(next.id);
}

if (typeof chrome !== 'undefined' && chrome.windows && chrome.windows.onRemoved) {
  // The person closed the window without answering: that is a "no" (and starts the cool-down), never a yes.
  chrome.windows.onRemoved.addListener((winId) => {
    for (const [id, w] of windowsById) {
      if (w !== winId) continue;
      windowsById.delete(id);
      resolveApproval(id, false);
    }
  });
}

// Close a request's window once it is answered anywhere (window, popup or dashboard) or has lapsed, then
// bring the next waiting request forward.
onApprovalsChanged((list) => {
  const live = new Set(list.map((a) => a.id));
  for (const [id, winId] of windowsById) {
    if (live.has(id)) continue;
    windowsById.delete(id);
    if (winId != null) removeWindow(winId);
  }
  showNextWindow();
});

function ask(origin, reason, tool) {
  const expiresAt = Date.now() + REQUEST_TTL_MS;
  const promise = enqueueApproval({
    origin, tool, risk: ACCESS_RISK, timeoutMs: REQUEST_TTL_MS,
    details: { kind: 'access', reason: clip(reason, 240), allowOnceMinutes: Math.round(ALLOW_ONCE_MS / 60_000) },
  });
  const entry = { id: null, promise, expiresAt };
  pendingByOrigin.set(origin, entry);
  // Whether or not the agent is still waiting, a "no" or silence starts the cool-down and frees the slot.
  promise.then(
    () => { if (pendingByOrigin.get(origin) === entry) pendingByOrigin.delete(origin); },
    (e) => {
      if (pendingByOrigin.get(origin) === entry) pendingByOrigin.delete(origin);
      const declined = Boolean(e && e.code === 'USER_DECLINED');
      cooldowns.set(origin, {
        until: Date.now() + (declined ? DENY_COOLDOWN_MS : UNANSWERED_COOLDOWN_MS),
        why: declined ? 'declined' : 'unanswered',
      });
    },
  );
  // enqueueApproval files the item synchronously; the newest access item for this origin is the one just made.
  const item = accessItems().filter((a) => a.origin === origin && a.tool === tool).pop();
  entry.id = item ? item.id : null;
  showNextWindow();
  return entry;
}

/** The `web_request_access` tool. Never touches a page: its whole job is to ask a person. */
export async function requestAccess(args = {}, req = {}) {
  const tool = 'web_request_access';
  const reason = clip(args.reason, 240);
  if (!reason) return makeError(ERROR_CODES.BAD_ARGS, 'reason is required: one sentence the person will read, saying what you need the site for.');
  const target = await targetOrigin(args);
  if (target.error) return makeError(ERROR_CODES.BAD_ARGS, target.error);
  const { origin } = target;

  if (isLoopbackOrTestOrigin(origin)) return { ok: true, data: { status: 'already_allowed', url: origin, via: 'trusted' } };
  const grant = await getOriginGrant(origin);
  if (grant.read && grant.act) {
    return { ok: true, data: { status: 'already_allowed', url: origin, via: grant.allowOnceUntil ? 'allow_once' : 'grant', ...(grant.allowOnceUntil ? { until: until(grant.allowOnceUntil) } : {}) } };
  }
  const cool = cooldowns.get(origin);
  if (cool && cool.until > Date.now()) {
    return cool.why === 'declined'
      ? makeError(ERROR_CODES.USER_DECLINED, `The user declined the access request for ${origin} (access not granted for origin ${origin}). Do not ask again before ${until(cool.until)}; ask the user in chat what they want instead.`)
      : makeError(ERROR_CODES.APPROVAL_TIMEOUT, `Nobody answered the last access request for ${origin} (approval request unanswered). Ask the user in chat to look at their screen, then ask again after ${until(cool.until)}.`);
  }

  let entry = pendingByOrigin.get(origin);
  if (!entry) {
    if (accessItems().length >= MAX_PENDING) {
      return makeError('ACCESS_BUSY', `${MAX_PENDING} access requests are already waiting for the user (approval request queue full). Wait for them to answer before asking for another site.`, true);
    }
    entry = ask(origin, reason, tool);
  }
  const deadline = Number.isFinite(req.deadlineAt) ? req.deadlineAt - HUB_HEADROOM_MS - Date.now() : MAX_WAIT_MS;
  const waitMs = Math.max(0, Math.min(MAX_WAIT_MS, Number.isFinite(Number(args.waitMs)) ? Number(args.waitMs) : MAX_WAIT_MS, deadline));

  let timer;
  const outcome = await Promise.race([
    entry.promise.then((v) => ({ v }), (e) => ({ e })),
    new Promise((r) => { timer = setTimeout(() => r({ pending: true }), waitMs); }),
  ]);
  clearTimeout(timer);

  if (outcome.pending) {
    const onScreen = windowsById.has(entry.id);
    return {
      ok: true,
      data: {
        status: 'pending', url: origin, requestId: entry.id, expiresAt: until(entry.expiresAt),
        message: onScreen
          ? `The request is in a window on the user's screen, waiting for their answer. Call web_request_access again with url "${origin}" to check; it will not open a second request.`
          : `The request is waiting in the ScreenSync popup (toolbar badge) behind another one; its window opens when that is answered. Call web_request_access again with url "${origin}" to check.`,
      },
    };
  }
  if (outcome.v) {
    const decision = outcome.v.decision === 'always' ? 'allowed_always' : 'allowed_once';
    const g = await getOriginGrant(origin);
    return { ok: true, data: { status: decision, url: origin, ...(decision === 'allowed_once' && g.allowOnceUntil ? { until: until(g.allowOnceUntil) } : {}) } };
  }
  if (outcome.e && outcome.e.code === 'USER_DECLINED') {
    return makeError(ERROR_CODES.USER_DECLINED, `The user declined the access request for ${origin} (access not granted for origin ${origin}). Do not retry it; ask the user in chat what they want instead.`);
  }
  return makeError(ERROR_CODES.APPROVAL_TIMEOUT, `Nobody answered the access request for ${origin} before it expired (approval request timed out). Ask the user in chat to look at their screen before asking again.`, true);
}
