// ScreenSync Audit Ring & Redaction (Plan §2.4)
// Preserves privacy by scrubbing tokens, passwords, session cookies, and credit cards
// before appending execution records to a bounded ring buffer in chrome.storage.local.

const AUDIT_STORAGE_KEY = 'ss_audit_log';
const MAX_AUDIT_ENTRIES = 500;

const SENSITIVE_KEY_PATTERN = /^(token|auth|password|secret|pass|cookie|cookies|key|apiKey|cvv|card|credentials)$/i;

/**
 * Redacts potentially sensitive fields from an object or argument map.
 * @param {unknown} value
 * @param {number} [depth=0]
 * @returns {unknown}
 */
export function redactPayload(value, depth = 0) {
  if (depth > 6) return '[TRUNCATED]';
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') {
    if (/bearer\s+[a-zA-Z0-9._~+/-]+=*/i.test(value)) {
      return value.replace(/bearer\s+[^\s]+/gi, 'Bearer [REDACTED]');
    }
    if (value.length > 500) {
      return value.slice(0, 120) + '... [TRUNCATED ' + value.length + ' chars]';
    }
    return value;
  }
  if (typeof value !== 'object') return value;

  if (Array.isArray(value)) {
    return value.slice(0, 50).map((v) => redactPayload(v, depth + 1));
  }

  const clean = {};
  for (const [k, v] of Object.entries(value)) {
    if (SENSITIVE_KEY_PATTERN.test(k)) {
      clean[k] = '[REDACTED]';
    } else {
      clean[k] = redactPayload(v, depth + 1);
    }
  }
  return clean;
}

/**
 * Records an invocation into the audit ring buffer.
 * @param {{
 *   tool: string,
 *   url?: string,
 *   origin?: string,
 *   durationMs: number,
 *   ok: boolean,
 *   code?: string,
 *   error?: string,
 *   args?: Record<string, unknown>
 * }} entry
 */
export async function recordAuditEntry(entry) {
  try {
    const raw = await chrome.storage.local.get([AUDIT_STORAGE_KEY]);
    const list = Array.isArray(raw[AUDIT_STORAGE_KEY]) ? raw[AUDIT_STORAGE_KEY] : [];

    const item = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      timestamp: new Date().toISOString(),
      tool: entry.tool,
      url: entry.url || '',
      origin: entry.origin || '',
      durationMs: Math.round(entry.durationMs || 0),
      ok: Boolean(entry.ok),
      code: entry.code || (entry.ok ? 'OK' : 'ERROR'),
      error: entry.error ? String(entry.error).slice(0, 200) : null,
      args: redactPayload(entry.args || {}),
    };

    list.unshift(item);
    if (list.length > MAX_AUDIT_ENTRIES) {
      list.length = MAX_AUDIT_ENTRIES;
    }

    await chrome.storage.local.set({ [AUDIT_STORAGE_KEY]: list });
  } catch (err) {
    console.error('[ss] audit logging error:', err);
  }
}

/**
 * Retrieves entries from the audit log with optional filtering.
 * @param {{ limit?: number, tool?: string, origin?: string, since?: string }} [filters]
 */
export async function getAuditLog(filters = {}) {
  try {
    const raw = await chrome.storage.local.get([AUDIT_STORAGE_KEY]);
    let list = Array.isArray(raw[AUDIT_STORAGE_KEY]) ? raw[AUDIT_STORAGE_KEY] : [];

    if (filters.tool) {
      const t = String(filters.tool).toLowerCase();
      list = list.filter((e) => e.tool && e.tool.toLowerCase() === t);
    }
    if (filters.origin) {
      const o = String(filters.origin).toLowerCase();
      list = list.filter((e) => e.origin && e.origin.toLowerCase().includes(o));
    }
    if (filters.since) {
      const sinceDate = new Date(filters.since).getTime();
      if (!isNaN(sinceDate)) {
        list = list.filter((e) => new Date(e.timestamp).getTime() >= sinceDate);
      }
    }

    const limit = Math.min(Number(filters.limit) || 50, MAX_AUDIT_ENTRIES);
    return { ok: true, count: list.length, entries: list.slice(0, limit) };
  } catch (err) {
    return { ok: false, error: String(err.message || err) };
  }
}

/**
 * Clears the audit ring.
 */
export async function clearAuditLog() {
  await chrome.storage.local.set({ [AUDIT_STORAGE_KEY]: [] });
  return { ok: true, cleared: true };
}

/**
 * Exports the complete audit log.
 */
export async function exportAuditLog() {
  const raw = await chrome.storage.local.get([AUDIT_STORAGE_KEY]);
  const list = Array.isArray(raw[AUDIT_STORAGE_KEY]) ? raw[AUDIT_STORAGE_KEY] : [];
  return {
    ok: true,
    exportedAt: new Date().toISOString(),
    totalEntries: list.length,
    json: JSON.stringify(list, null, 2),
  };
}
