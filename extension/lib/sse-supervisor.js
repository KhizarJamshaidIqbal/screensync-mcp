// Decides WHEN the SSE client should (re)connect. background.js calls ensure() from many places (15s
// offscreen ping, 30s alarm, tab activation, page loads, settings changes); ensure() is idempotent so that
// spam never interrupts a backoff sleep or a live stream. Only four things start a new connection:
// credentials changed, no loop running, the stream went stale, or a 401 older than SSE_UNAUTHORIZED_RETRY_MS.

import { getSettings as readSettings } from './storage.js';
import { normalizeHubBase, isLoopbackHub } from './api.js';
import { sseCredKey } from './sse-client.js';
import {
  DEFAULT_TOKEN, SSE_UNAUTHORIZED_RETRY_MS, SSE_BACKOFF_MAX_MS, SSE_BACKOFF_MAX_LOOPBACK_MS, SSE_BACKOFF_PROBE_AFTER_MS,
} from './constants.js';

/**
 * @param {import('./sse-client.js').SseClient} client
 * @param {{ getSettings?: () => Promise<object>, getInstanceId?: () => Promise<string>, now?: () => number,
 *           probe?: (hubUrl: string) => Promise<boolean> }} deps
 *   probe: optional cheap reachability check (e.g. GET /health) used to cut a long backoff short.
 */
export function createSseSupervisor(client, {
  getSettings = readSettings, getInstanceId, now = () => Date.now(), probe = null,
} = {}) {
  let probing = false;
  async function credentials() {
    const s = await getSettings();
    const loopback = isLoopbackHub(s.hubUrl);
    const token = s.token || (loopback ? DEFAULT_TOKEN : '');
    if ((!s.onboardingComplete && !loopback) || !token) return null;
    let instanceId = null;
    try { instanceId = getInstanceId ? await getInstanceId() : null; } catch { /* stream stays anonymous */ }
    return { url: normalizeHubBase(s.hubUrl), token, instanceId, loopback };
  }

  /**
   * Returns what it did: 'stopped' | 'start' | 'restart' | 'unauthorized' | 'backoff' | 'woken' | 'ok'.
   * retryUnauthorized: an explicit user action (saving settings) retries a 401 at once, same token or not.
   */
  async function ensure(reason = 'ensure', { retryUnauthorized = false } = {}) {
    const cred = await credentials();
    if (!cred) {
      client.stop('not paired');
      return 'stopped';
    }
    const key = sseCredKey(cred.url, cred.token, cred.instanceId);
    const opts = {
      instanceId: cred.instanceId,
      maxBackoffMs: cred.loopback ? SSE_BACKOFF_MAX_LOOPBACK_MS : SSE_BACKOFF_MAX_MS,
    };
    const cooling = !retryUnauthorized && key === client.credKey && now() - client.since < SSE_UNAUTHORIZED_RETRY_MS;
    if (client.state === 'unauthorized' && cooling) {
      return 'unauthorized'; // same wrong token: don't hammer the hub, a settings change retries at once
    }
    if (key !== client.credKey || !client.active) {
      client.start(cred.url, cred.token, opts);
      return 'start';
    }
    if (client.stale()) {
      console.warn(`[ss] SSE stale (silent past the liveness window) — reconnecting (${reason})`);
      client.restart('stale stream — reconnecting');
      return 'restart';
    }
    if (client.state !== 'backoff') return 'ok';
    // A long backoff sleep would outlast a hub that is already back: probe it (one probe at a time)
    // and retry now if it answers. wake() itself is rate-limited, so this can never cause a storm.
    const waitLeft = (client.nextRetryAt || 0) - now();
    if (probe && !probing && waitLeft > SSE_BACKOFF_PROBE_AFTER_MS) {
      probing = true;
      try {
        if (await probe(cred.url)) {
          client.wake(`hub reachable (${reason})`);
          return 'woken';
        }
      } catch { /* unreachable: keep sleeping */ } finally { probing = false; }
    }
    return 'backoff';
  }

  return {
    ensure,
    /** The hub just answered a health probe: retry now instead of finishing a long backoff sleep. */
    hubReachable: () => client.wake('hub reachable'),
    snapshot: () => client.snapshot(),
    stop: (reason) => client.stop(reason),
  };
}
