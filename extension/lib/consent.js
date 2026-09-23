// ScreenSync Consent & Approval Gate (Plan Rev 4 §4, §4.1, §4.2, A1)
// Enforces per-origin grants (read/act/cookies), approval queue for destructive actions,
// sliding-window rate limiting, and per-session extraction budget.

import { getSettings, saveSettings } from './storage.js';

// Pending approvals queue: id -> { id, origin, tool, risk, details, tabId, createdAt, expiresAt, resolve, reject, timer }
const pendingApprovals = new Map();
let approvalSeq = 0;

// Told whenever the queue changes (something enqueued, approved, declined or expired). The service worker
// uses it to keep the toolbar badge honest, so a request a person has not seen is a number on the icon.
const approvalListeners = new Set();
// Told how each request ended ('approved' | 'declined' | 'timeout'), just before the queue-change listeners, so a
// surface that showed it (approval-notify.js) can say "timed out" rather than simply vanish.
const settledListeners = new Set();

// Rate limiter: origin -> array of timestamps (ms)
const rateLimits = new Map();
const RATE_LIMIT_MAX_PER_MIN = 120;
const RATE_LIMIT_WINDOW_MS = 60_000;

// Session extraction budget (bytes)
let sessionExtractedBytes = 0;
const DEFAULT_EXTRACTION_BUDGET = 5_000_000; // 5 MB per session

export function normalizeOrigin(input) {
  if (!input) return 'unknown';
  const str = String(input).trim();
  try {
    if (str.startsWith('http://') || str.startsWith('https://')) {
      return new URL(str).origin.toLowerCase();
    }
    return `https://${str.replace(/^\.+/, '')}`.toLowerCase();
  } catch {
    return str.toLowerCase();
  }
}

// Sites the owner trusts with full agent access (read, act, cookies) without a
// per-origin grant. Matched on the HOST - the domain itself or a subdomain of it -
// never as a substring: `o.includes('x.com')` also matched dropbox.com,
// netflix.com and fedex.com, and `o.includes('epsoldev.com')` matched
// epsoldev.com.anything.net. Add a host here only on the owner's instruction.
export const OWNER_TRUSTED_HOSTS = Object.freeze([
  'epsoldev.com',
  'x.com',
  'twitter.com',
  'blog.niagarafallscanadatours.com',
]);

export function isOwnerTrustedOrigin(origin) {
  let host = '';
  try {
    host = new URL(String(origin)).hostname.toLowerCase();
  } catch {
    return false;
  }
  if (!host) return false;
  return OWNER_TRUSTED_HOSTS.some((d) => host === d || host.endsWith(`.${d}`));
}

export function isLoopbackOrTestOrigin(origin) {
  if (!origin) return false;
  const o = origin.toLowerCase();
  return o.includes('localhost') ||
    o.includes('127.0.0.1') ||
    o.endsWith('.test') ||
    o.includes('example.test') ||
    isOwnerTrustedOrigin(o) ||
    o.startsWith('chrome-extension://');
}

export async function getGrants() {
  const settings = await getSettings();
  return settings.grants || {};
}

// ── "Allow once": a short grant a person gave from an access request (access-request.js) ────────────
// Read + act on one origin for ALLOW_ONCE_MS, never cookies. Held in memory on purpose: it ends on its own,
// and an extension reload ends it early, which is the safe direction. Revoking the site ends it too.
export const ACCESS_RISK = 'access';
export const ALLOW_ONCE_MS = 15 * 60_000;
const allowOnceGrants = new Map(); // normalized origin -> expiresAt (ms)

export function grantAllowOnce(origin, ms = ALLOW_ONCE_MS) {
  const until = Date.now() + ms;
  allowOnceGrants.set(normalizeOrigin(origin), until);
  return until;
}

function allowOnceUntil(norm) {
  const until = allowOnceGrants.get(norm) || 0;
  if (until && until <= Date.now()) { allowOnceGrants.delete(norm); return 0; }
  return until;
}

export async function getOriginGrant(origin) {
  const norm = normalizeOrigin(origin);
  if (isLoopbackOrTestOrigin(norm)) {
    return { read: true, act: true, cookies: true, isDefault: true };
  }
  const grants = await getGrants();
  const saved = grants[norm] || { read: false, act: false, cookies: false, isDefault: false };
  const until = allowOnceUntil(norm);
  return until ? { ...saved, read: true, act: true, allowOnceUntil: until } : saved;
}

/** Saved grants plus the live "Allow once" ones, for the dashboard's list. Never written back to storage. */
export async function getGrantsForDisplay() {
  const grants = { ...(await getGrants()) };
  for (const origin of [...allowOnceGrants.keys()]) {
    const until = allowOnceUntil(origin);
    if (until) grants[origin] = { ...(grants[origin] || { cookies: false }), read: true, act: true, allowOnceUntil: until };
  }
  return grants;
}

export async function saveOriginGrant(origin, grant) {
  const norm = normalizeOrigin(origin);
  const grants = await getGrants();
  const existing = grants[norm] || {};
  grants[norm] = {
    read: grant.read !== undefined ? !!grant.read : !!existing.read,
    act: grant.act !== undefined ? !!grant.act : !!existing.act,
    cookies: grant.cookies !== undefined ? !!grant.cookies : !!existing.cookies,
    updatedAt: Date.now(),
  };
  await saveSettings({ grants });
  return grants[norm];
}

export async function revokeOriginGrant(origin) {
  const norm = normalizeOrigin(origin);
  allowOnceGrants.delete(norm); // a revoke means now, not in fifteen minutes
  const grants = await getGrants();
  delete grants[norm];
  await saveSettings({ grants });
  return { revoked: norm };
}

export function checkRateLimit(origin) {
  const norm = normalizeOrigin(origin);
  if (isLoopbackOrTestOrigin(norm)) return { ok: true };
  const now = Date.now();
  const windowStart = now - RATE_LIMIT_WINDOW_MS;
  let timestamps = rateLimits.get(norm) || [];
  timestamps = timestamps.filter((t) => t > windowStart);
  if (timestamps.length >= RATE_LIMIT_MAX_PER_MIN) {
    return { ok: false, error: `Rate limit exceeded for origin ${norm}: maximum ${RATE_LIMIT_MAX_PER_MIN} operations per minute.` };
  }
  timestamps.push(now);
  rateLimits.set(norm, timestamps);
  return { ok: true, count: timestamps.length };
}

export function recordExtraction(origin, byteCount = 0) {
  const bytes = Number(byteCount) || 0;
  sessionExtractedBytes += bytes;
  const isExceeded = sessionExtractedBytes > DEFAULT_EXTRACTION_BUDGET;
  return {
    sessionExtractedBytes,
    budgetMaxBytes: DEFAULT_EXTRACTION_BUDGET,
    isExceeded,
  };
}

export function getExtractionBudget() {
  return {
    sessionExtractedBytes,
    budgetMaxBytes: DEFAULT_EXTRACTION_BUDGET,
    isExceeded: sessionExtractedBytes > DEFAULT_EXTRACTION_BUDGET,
  };
}

/** Subscribe to queue changes. Returns an unsubscribe function. */
export function onApprovalsChanged(fn) {
  approvalListeners.add(fn);
  return () => approvalListeners.delete(fn);
}

function notifyApprovalsChanged() {
  const list = getPendingApprovals();
  for (const fn of approvalListeners) {
    try { fn(list); } catch { /* a listener must never be able to break the queue */ }
  }
}

/** Subscribe to how requests end: fn({ id, origin, tool, risk, tabId }, 'approved' | 'declined' | 'timeout'). */
export function onApprovalSettled(fn) {
  settledListeners.add(fn);
  return () => settledListeners.delete(fn);
}

/**
 * Asks a person. Resolves { approved: true } on their say-so; rejects if they decline
 * (error.code USER_DECLINED) or nobody answers within timeoutMs (APPROVAL_TIMEOUT). Silence is a refusal.
 * `tabId` is the tab the action would run in, so the request can also be shown on that page.
 */
export function enqueueApproval({ origin, tool, risk, details, timeoutMs = 60_000, tabId = null }) {
  const id = `appr_${Date.now()}_${++approvalSeq}`;
  return new Promise((resolve, reject) => {
    const settle = (finish, outcome) => (value) => {
      clearTimeout(timer);
      const item = pendingApprovals.get(id);
      pendingApprovals.delete(id);
      if (item) {
        const ended = { id, origin: item.origin, tool, risk: item.risk, tabId: item.tabId };
        for (const fn of settledListeners) {
          try { fn(ended, outcome); } catch { /* a listener must never be able to break the queue */ }
        }
      }
      notifyApprovalsChanged();
      finish(value);
    };
    const timer = setTimeout(
      () => settle(reject, 'timeout')(Object.assign(new Error(`Approval request ${id} for ${tool} on ${origin} timed out (dismissed by default).`), { code: 'APPROVAL_TIMEOUT' })),
      timeoutMs,
    );

    const createdAt = Date.now();
    pendingApprovals.set(id, {
      id,
      origin: normalizeOrigin(origin),
      tool,
      risk: risk || 'destructive',
      details: details || {},
      tabId: Number.isInteger(tabId) ? tabId : null,
      createdAt,
      expiresAt: createdAt + timeoutMs,
      timer,
      resolve: settle(resolve, 'approved'),
      reject: settle(reject, 'declined'),
    });
    notifyApprovalsChanged();
  });
}

export function getPendingApprovals() {
  const list = [];
  for (const item of pendingApprovals.values()) {
    list.push({
      id: item.id,
      origin: item.origin,
      tool: item.tool,
      risk: item.risk,
      details: item.details,
      tabId: item.tabId,
      createdAt: item.createdAt,
      expiresAt: item.expiresAt,
    });
  }
  return list;
}

/**
 * Settles a request with a person's answer. Only the extension's own pages can reach this (owner-pages.js).
 * For an access request (risk ACCESS_RISK) the grant is applied HERE, where the owner's click lands, so it
 * exists even if the agent that asked has already stopped waiting: `decision` 'always' saves a read + act
 * grant for the site; anything else is "Allow once". The short grant is set first either way, so the site
 * works the instant the person clicks, before the storage write lands.
 */
export function resolveApproval(id, approved = false, decision = '') {
  const item = pendingApprovals.get(id);
  if (!item) return { ok: false, error: `Approval item not found: ${id}` };
  if (approved && item.risk === ACCESS_RISK) {
    const always = decision === 'always';
    grantAllowOnce(item.origin);
    const saved = always
      ? saveOriginGrant(item.origin, { read: true, act: true }).then(() => 'always', () => 'once')
      : Promise.resolve('once');
    saved.then((d) => item.resolve({ approved: true, id, decision: d }));
    return { ok: true, id, approved: true, decision: always ? 'always' : 'once' };
  }
  if (approved) {
    item.resolve({ approved: true, id });
  } else {
    item.reject(Object.assign(new Error(`User declined permission for ${item.tool} on ${item.origin}`), { code: 'USER_DECLINED' }));
  }
  return { ok: true, id, approved };
}

export async function checkOriginPermission(origin, category, tool, _args = {}) {
  const norm = normalizeOrigin(origin);
  // 1. Rate limiting check
  const rl = checkRateLimit(norm);
  if (!rl.ok) return { ok: false, code: 'RATE_LIMIT_EXCEEDED', error: rl.error };

  // 2. Loopback / test origins always pass
  if (isLoopbackOrTestOrigin(norm)) return { ok: true, origin: norm, grant: { read: true, act: true, cookies: true } };

  // 3. Check persistent grant
  const grant = await getOriginGrant(norm);
  if (category === 'read' && !grant.read) {
    // If dryRun or perception query, allow if origin has at least default read or prompt
    return {
      ok: false,
      code: 'PERMISSION_DENIED',
      error: `Read access not granted for origin ${norm}. Grant read permission in extension dashboard, or call web_request_access to ask the user.`,
      origin: norm,
      category: 'read',
    };
  }

  if (category === 'act' && !grant.act) {
    return {
      ok: false,
      code: 'PERMISSION_DENIED',
      error: `Action access not granted for origin ${norm}. Grant action permission in extension dashboard, or call web_request_access to ask the user.`,
      origin: norm,
      category: 'act',
    };
  }

  if (category === 'cookies' && !grant.cookies) {
    return {
      ok: false,
      code: 'PERMISSION_DENIED',
      error: `Cookie access not granted for origin ${norm}. Grant cookie permission in extension dashboard.`,
      origin: norm,
      category: 'cookies',
    };
  }

  return { ok: true, origin: norm, grant };
}
