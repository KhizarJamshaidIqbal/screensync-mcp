// Threat breaker read path for the dashboard panel (Architecture 12.0, subsystem 3).
//
// The breaker is owned by the HUB: /api/web/tool answers web_amygdala_threat_inoculation
// itself and never relays it to this extension. Reading a copy held in the service
// worker would therefore show an empty, permanently "armed" panel however many
// challenges the hub had seen. So the panel asks the hub, read-only (action:'state').
//
// An unreachable hub is reported as an ERROR, never as an empty list. "No domain has
// tripped" and "we cannot tell" are different facts, and in a defensive feature the
// second must not be shown as the first.

import { api } from './api.js';

/**
 * @param {string} [domain] one domain, or omit for every tracked domain
 * @param {(tool: string, args: object) => Promise<any>} [call] injectable for tests
 * @returns {Promise<{ok: true, threats: object[]} | {ok: false, error: string}>}
 */
export async function fetchThreatState(domain, call = api.webTool) {
  try {
    const args = { action: 'state' };
    if (domain) args.domain = domain;
    const res = await call('web_amygdala_threat_inoculation', args);
    if (!res || res.ok !== true) {
      const detail = res && res.data && res.data.error;
      return { ok: false, error: detail || 'Hub did not return threat state.' };
    }
    const threats = res.data && Array.isArray(res.data.threats) ? res.data.threats : null;
    if (!threats) return { ok: false, error: 'Hub returned a malformed threat state.' };
    return { ok: true, threats };
  } catch (e) {
    return { ok: false, error: (e && e.message) || String(e) };
  }
}
