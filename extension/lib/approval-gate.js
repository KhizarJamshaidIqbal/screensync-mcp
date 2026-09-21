// ScreenSync Approval Gate - a person's decision, not the agent's.
//
// The extension has long refused destructive-looking actions with USER_CONFIRMATION_REQUIRED, but the
// refusal was an honour system: the agent got the error and simply called again with `confirmed:true`,
// an argument IT supplies. Nothing ever asked a human, and the approval queue below had no caller.
//
// This wires the queue in. When an action needs a person and the page is not one the owner has already
// trusted, the request waits in the queue (toolbar badge + popup + dashboard) for up to a minute:
//   approved  -> the action runs, with an internal flag that only this module can set;
//   declined  -> USER_DECLINED; nobody answered -> APPROVAL_TIMEOUT. Silence is a refusal.
//
// Two ways in. The page-side and grant checks report USER_CONFIRMATION_REQUIRED after the fact; and the
// hub, whose cognitive gate judges a domain that has not earned trust, can mark a request as needing a
// human up front (`__gate`). Either way an agent's own `confirmed` / `force` no longer count, except on
// the owner's trusted hosts, where they behave exactly as before.

import { checkOriginPermission, enqueueApproval, getOriginGrant, isLoopbackOrTestOrigin, onApprovalsChanged } from './consent.js';
import { hubFetch } from './api.js';
import { pickActiveTab } from './tab-resolve.js';
import { ERROR_CODES, makeError } from './errors.js';

/** How long a person has to answer. The hub is told, so it keeps waiting at least this long too. */
export const APPROVAL_WINDOW_MS = 60_000;
/** Room left for an approved action to run before the hub gives up on the request. */
const RUN_HEADROOM_MS = 8_000;
const MIN_WINDOW_MS = 5_000;
/** Used when neither the hub's deadline nor an extension of it is known (a very old hub). */
const UNKNOWN_DEADLINE_WINDOW_MS = 30_000;
const MAX_SCRUB_DEPTH = 8;

/** Flags only THIS extension may set. Whatever an agent sends under these names is discarded. */
const INTERNAL_KEYS = new Set(['__humanApproved', '__actGranted', '__gate']);

const clip = (value, max) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

/** A copy of `value` with every internal key removed, at any depth (web_in_frame nests its args). */
function scrub(value, depth = 0) {
  if (depth > MAX_SCRUB_DEPTH || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((v) => scrub(v, depth + 1));
  const out = {};
  for (const [key, inner] of Object.entries(value)) {
    if (!INTERNAL_KEYS.has(key)) out[key] = scrub(inner, depth + 1);
  }
  return out;
}

/**
 * Separates what the caller sent from what only the hub or this extension may say. Returns the arguments
 * with every internal key removed, and the hub's request for a human (`__gate`), if it made one and it is
 * well formed. A forged `__gate` can only ask for MORE scrutiny, so it is harmless; a forged
 * `__humanApproved` or `__actGranted` would ask for less, which is why those are stripped.
 */
export function stripInternalArgs(rawArgs) {
  const source = rawArgs && typeof rawArgs === 'object' ? rawArgs : {};
  const g = source.__gate;
  const gate = g && typeof g === 'object' && g.needsHuman === true
    ? {
      reason: clip(g.reason, 300),
      riskScore: Number.isFinite(Number(g.riskScore)) ? Number(g.riskScore) : 0,
      markers: Array.isArray(g.markers) ? g.markers.slice(0, 6).map((m) => clip(m, 60)) : [],
      domain: clip(g.domain, 120),
      level: clip(g.level, 40),
    }
    : null;
  return { args: scrub(source), gate };
}

/** The origin an action lands on: the URL a fetch will call, else the tab it targets. */
export async function originOf(tool, args) {
  try {
    if (tool === 'web_api_fetch' && args.url) return new URL(String(args.url)).origin;
    const tab = await pickActiveTab(args);
    return tab && tab.url ? new URL(tab.url).origin : 'unknown';
  } catch {
    return 'unknown';
  }
}

/** What the person is shown. Short, escaped by the UI, and never the full text of a typed secret. */
export function summarizeAction(tool, args, reason, gate) {
  const target = clip(args.selector ?? args.ref ?? args.name ?? args.label ?? args.url ?? args.expression ?? args.code ?? '', 120);
  const typed = args.mask === true ? '(hidden)' : clip(args.value ?? args.text ?? '', 60);
  return {
    target,
    ...(typed ? { text: typed } : {}),
    reason: clip(reason, 240),
    ...(gate ? { hubMarkers: gate.markers, hubRisk: gate.riskScore, level: gate.level } : {}),
  };
}

/**
 * Puts one request in front of a person. Resolves { approved: true } or { approved: false, error } where
 * error is the result to hand back to the agent.
 */
export async function askHuman({ origin, tool, args, reason, risk = 'destructive', req = {}, gate = null }) {
  let windowMs = APPROVAL_WINDOW_MS;
  // Tell the hub a human is being asked, so it keeps waiting (an older hub has no such route).
  const extended = req.id
    ? await hubFetch('/api/web/awaiting', { method: 'POST', body: { id: req.id, ms: windowMs }, timeoutMs: 4_000 })
      .then((r) => Boolean(r && r.success === true))
      .catch(() => false)
    : false;
  if (!extended) {
    // The hub will not wait for us, so we must not outlive it: an action approved after the hub has
    // reported a timeout would run while the agent believes it never did.
    windowMs = Number.isFinite(req.deadlineAt)
      ? Math.max(MIN_WINDOW_MS, Math.min(windowMs, req.deadlineAt - Date.now() - RUN_HEADROOM_MS))
      : UNKNOWN_DEADLINE_WINDOW_MS;
  }

  try {
    await enqueueApproval({ origin, tool, risk, details: summarizeAction(tool, args, reason, gate), timeoutMs: windowMs });
    return { approved: true };
  } catch (e) {
    const declined = Boolean(e && e.code === 'USER_DECLINED');
    return {
      approved: false,
      error: declined
        ? makeError(ERROR_CODES.USER_DECLINED, `The user declined the approval request for ${tool} on ${origin}. Do not retry it; ask the user what they want instead.`)
        : makeError(ERROR_CODES.APPROVAL_TIMEOUT, `No answer to the approval request for ${tool} on ${origin} within ${Math.round(windowMs / 1000)}s, so it was declined by default. Ask the user to approve it, then try again.`, true),
    };
  }
}

/**
 * What a tool may assume about the page it lands on, worked out from the origin and the owner's grant.
 *   __actGranted   the origin is trusted, or the owner granted `act` on it;
 *   __humanApproved  the origin is one the owner trusts and the agent passed `confirmed`/`force`, which is what
 *                    those arguments have always meant there. Nowhere else can they set it.
 */
async function situation(tool, args) {
  const origin = await originOf(tool, args);
  const trusted = isLoopbackOrTestOrigin(origin);
  const grant = await getOriginGrant(origin).catch(() => ({}));
  const granted = { ...args, __actGranted: Boolean(trusted || grant.act) };
  const base = trusted && (args.confirmed || args.force) ? { ...granted, __humanApproved: true } : granted;
  return { origin, trusted, base };
}

/**
 * Runs a tool call under the approval policy. `execute(tool, args)` is the dispatcher; `isActTool(tool)`
 * says which tools need the owner's `act` grant (web-tools.js knows, this module should not have to).
 * The internal flags are set HERE and nowhere else: see `situation`, and the person's yes below.
 */
export async function runWithApproval(tool, rawArgs, req, execute, { isActTool = () => false } = {}) {
  const { args, gate } = stripInternalArgs(rawArgs);
  const { origin, trusted, base } = await situation(tool, args);

  // Asks a person, then runs the call, but only if it still lands where they were asked about.
  const askThenRun = async (reason, risk, hub) => {
    const decision = await askHuman({ origin, tool, args, reason, risk, req, gate: hub });
    if (!decision.approved) return decision.error;
    // Up to a minute has passed: another tab may have come to the front, the page may have navigated, the
    // owner may have revoked the grant. An approval for one page must not carry over to another, so look again.
    const now = await situation(tool, args);
    if (now.origin !== origin) {
      return makeError(ERROR_CODES.USER_CONFIRMATION_REQUIRED, `The target changed from ${origin} to ${now.origin} while waiting for approval, so nothing was run. Ask again to be approved for the new page.`, true);
    }
    return execute(tool, { ...now.base, __humanApproved: true });
  };

  // The hub judged this call to need a person (a destructive-looking action on a domain that has not
  // earned trust). A dry run only plans, so it is never held up.
  if (gate && !trusted && args.dryRun !== true) {
    // An approval is not a grant. Where the owner has not granted `act`, the action would fail with NO_GRANT
    // the moment it was approved, so say that first instead of asking a person for something that cannot help.
    if (isActTool(tool)) {
      const perm = await checkOriginPermission(origin, 'act', tool, args);
      if (!perm.ok) return makeError(ERROR_CODES.NO_GRANT, perm.error);
    }
    return askThenRun(gate.reason, 'destructive', gate);
  }

  const out = await execute(tool, base);
  if (out && out.code === ERROR_CODES.USER_CONFIRMATION_REQUIRED && !trusted && !base.__humanApproved) {
    return askThenRun(out.error, out.risk || 'destructive', null);
  }
  return out;
}

// ── the toolbar badge: a request nobody has seen is a number on the icon ───────────────────────────

const swallow = (p) => { if (p && typeof p.catch === 'function') p.catch(() => {}); };

function updateBadge(list) {
  try {
    if (typeof chrome === 'undefined' || !chrome.action) return;
    const n = list.length;
    swallow(chrome.action.setBadgeText({ text: n ? String(n) : '' }));
    if (n) swallow(chrome.action.setBadgeBackgroundColor({ color: '#D93025' }));
    const name = (chrome.runtime && chrome.runtime.getManifest && chrome.runtime.getManifest().name) || 'ScreenSync MCP';
    swallow(chrome.action.setTitle({ title: n ? `${name}: ${n} agent action${n === 1 ? '' : 's'} waiting for your approval` : name }));
  } catch { /* the badge is a courtesy: the queue works without it */ }
}

onApprovalsChanged(updateBadge);
