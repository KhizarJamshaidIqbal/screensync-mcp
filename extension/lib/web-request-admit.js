// Admission check for a hub web_request before anything runs. Since the SSE client sends Last-Event-ID, a
// reconnect can replay requests: one this service worker already ran (same id) must not run twice, and one
// whose hub-side wait is over must not act on the page after the agent got a TIMEOUT.
//
// Expiry is judged on the hub's RELATIVE `remainingMs` (how long the hub still waits, measured on the hub's own
// clock when it sent the event), never by comparing the hub's absolute `deadlineAt` with this browser's clock:
// a hub on another machine, or under WSL2/Docker, can be tens of seconds off, which would drop every call.
// A hub that sends no remainingMs gets the absolute check only on a replay (a live event is never dropped).

const SEEN_MAX = 256;
const MIN_REMAINING_MS = 1000;
const seen = new Map(); // id -> admittedAt, insertion order = age (LRU of the last SEEN_MAX ids)

/**
 * @param {object} req the web_request event ({ id, tool, args, deadlineAt?, remainingMs?, replayed? })
 * @param {number} [now]
 * @returns {{ ok: true } | { ok: false, reason: 'malformed' | 'duplicate' | 'expired' }}
 */
export function admitWebRequest(req, now = Date.now()) {
  if (!req || typeof req !== 'object') return { ok: false, reason: 'malformed' };
  const { id, tool, args, deadlineAt, remainingMs } = req;
  if (typeof id !== 'string' || !id || typeof tool !== 'string' || !tool) return { ok: false, reason: 'malformed' };
  if (args != null && typeof args !== 'object') return { ok: false, reason: 'malformed' };
  if (deadlineAt != null && !Number.isFinite(deadlineAt)) return { ok: false, reason: 'malformed' };
  if (remainingMs != null && !Number.isFinite(remainingMs)) return { ok: false, reason: 'malformed' };
  if (seen.has(id)) {
    seen.delete(id); // refresh its place: a replay storm keeps it remembered
    seen.set(id, now);
    return { ok: false, reason: 'duplicate' };
  }
  const expired = remainingMs != null
    ? remainingMs < MIN_REMAINING_MS
    : req.replayed === true && deadlineAt != null && deadlineAt - now < MIN_REMAINING_MS;
  if (expired) return { ok: false, reason: 'expired' };
  seen.set(id, now);
  if (seen.size > SEEN_MAX) seen.delete(seen.keys().next().value);
  return { ok: true };
}

/**
 * The request with `deadlineAt` re-based on THIS browser's clock (arrival + the hub's remainingMs), so the
 * approval and access windows that read it are not skewed by a hub clock that runs ahead or behind.
 * Unchanged when the hub sent no remainingMs.
 */
export function localizeDeadline(req, now = Date.now()) {
  if (!req || !Number.isFinite(req.remainingMs)) return req;
  return { ...req, deadlineAt: now + Math.max(0, req.remainingMs) };
}

/** Test hook: forget every admitted id. */
export function resetAdmittedRequests() {
  seen.clear();
}
