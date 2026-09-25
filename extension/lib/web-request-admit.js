// Admission check for a hub web_request before anything runs. Since the SSE client sends Last-Event-ID, a
// reconnect can replay requests: one this service worker already ran (same id) must not run twice, and one
// whose hub-side wait is over (deadlineAt passed) must not act on the page after the agent got a TIMEOUT.

const SEEN_MAX = 256;
const MIN_REMAINING_MS = 1000;
const seen = new Map(); // id -> admittedAt, insertion order = age (LRU of the last SEEN_MAX ids)

/**
 * @param {object} req the web_request event ({ id, tool, args, deadlineAt? })
 * @param {number} [now]
 * @returns {{ ok: true } | { ok: false, reason: 'malformed' | 'duplicate' | 'expired' }}
 */
export function admitWebRequest(req, now = Date.now()) {
  if (!req || typeof req !== 'object') return { ok: false, reason: 'malformed' };
  const { id, tool, args, deadlineAt } = req;
  if (typeof id !== 'string' || !id || typeof tool !== 'string' || !tool) return { ok: false, reason: 'malformed' };
  if (args != null && typeof args !== 'object') return { ok: false, reason: 'malformed' };
  if (deadlineAt != null && !Number.isFinite(deadlineAt)) return { ok: false, reason: 'malformed' };
  if (seen.has(id)) {
    seen.delete(id); // refresh its place: a replay storm keeps it remembered
    seen.set(id, now);
    return { ok: false, reason: 'duplicate' };
  }
  if (deadlineAt != null && deadlineAt - now < MIN_REMAINING_MS) return { ok: false, reason: 'expired' };
  seen.set(id, now);
  if (seen.size > SEEN_MAX) seen.delete(seen.keys().next().value);
  return { ok: true };
}

/** Test hook: forget every admitted id. */
export function resetAdmittedRequests() {
  seen.clear();
}
