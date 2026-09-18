// ScreenSync Consent & Approval Gate (Plan Rev 4 §4, §4.1, §4.2, A1)
// Enforces per-origin grants (read/act/cookies), approval queue for destructive actions,
// sliding-window rate limiting, and per-session extraction budget.

import { getSettings, saveSettings } from './storage.js';

// Pending approvals queue: id -> { id, origin, tool, risk, details, createdAt, resolve, reject, timer }
const pendingApprovals = new Map();
let approvalSeq = 0;

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

export async function getOriginGrant(origin) {
  const norm = normalizeOrigin(origin);
  if (isLoopbackOrTestOrigin(norm)) {
    return { read: true, act: true, cookies: true, isDefault: true };
  }
  const grants = await getGrants();
  return grants[norm] || { read: false, act: false, cookies: false, isDefault: false };
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

export function enqueueApproval({ origin, tool, risk, details, timeoutMs = 60_000 }) {
  const id = `appr_${Date.now()}_${++approvalSeq}`;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingApprovals.delete(id);
      reject(new Error(`Approval request ${id} for ${tool} on ${origin} timed out (dismissed by default).`));
    }, timeoutMs);

    pendingApprovals.set(id, {
      id,
      origin: normalizeOrigin(origin),
      tool,
      risk: risk || 'destructive',
      details: details || {},
      createdAt: Date.now(),
      timer,
      resolve: (data) => {
        clearTimeout(timer);
        pendingApprovals.delete(id);
        resolve(data);
      },
      reject: (err) => {
        clearTimeout(timer);
        pendingApprovals.delete(id);
        reject(err);
      },
    });
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
      createdAt: item.createdAt,
    });
  }
  return list;
}

export function resolveApproval(id, approved = false) {
  const item = pendingApprovals.get(id);
  if (!item) return { ok: false, error: `Approval item not found: ${id}` };
  if (approved) {
    item.resolve({ approved: true, id });
  } else {
    item.reject(new Error(`User declined permission for ${item.tool} on ${item.origin}`));
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
      error: `Read access not granted for origin ${norm}. Grant read permission in extension dashboard.`,
      origin: norm,
      category: 'read',
    };
  }

  if (category === 'act' && !grant.act) {
    return {
      ok: false,
      code: 'PERMISSION_DENIED',
      error: `Action access not granted for origin ${norm}. Grant action permission in extension dashboard.`,
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
