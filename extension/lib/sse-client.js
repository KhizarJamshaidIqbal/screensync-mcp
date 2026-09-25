import {
  SSE_LIVENESS_MS, SSE_STALE_MS, SSE_CONNECT_TIMEOUT_MS, SSE_BACKOFF_BASE_MS, SSE_BACKOFF_MAX_MS,
  SSE_STABLE_MS, SSE_WAKE_MIN_GAP_MS,
} from './constants.js';
import { parseSseChunk } from './sse-parse.js';

// MV3 service workers have no EventSource, so text/event-stream is read over fetch + ReadableStream.
// The hub sends `id: <seq>\ndata: {json}\n\n` events and a `: keepalive` comment every 30s.
//
// One state machine, one loop per generation (every start/restart/stop bumps `gen`; a stale loop, timer
// or read notices and exits without touching the new one):
//   idle          status 'stopped'      (emitted synchronously by stop())
//   connecting    status 'connecting'   (handshake, aborted after SSE_CONNECT_TIMEOUT_MS)
//   open          status 'connected'    (the stream is really open: the only state the UI calls "live")
//   backoff       status 'reconnecting' (network / stream end / liveness) or 'error' (404/429/5xx)
//   unauthorized  status 'error'        ('401 — wrong pairing token'; the loop ends, the supervisor decides)

const HTTP_DETAIL = {
  404: '404 — hub endpoint /api/events not found (possible port conflict or outdated hub)',
  429: '429 — too many connections, retrying...',
};

/** Identity of a connection: same key + active client = nothing to do. */
export function sseCredKey(url, token, instanceId) {
  return `${String(url || '').replace(/\/+$/, '')}|${token || ''}|${instanceId || ''}`;
}

function abortWith(ctrl, reason) {
  if (!ctrl || ctrl.signal.aborted) return;
  ctrl.ssReason = reason;
  try { ctrl.abort(); } catch { /* already aborted */ }
}

function cancelBody(res) {
  try { Promise.resolve(res && res.body && res.body.cancel()).catch(() => {}); } catch { /* locked/absent */ }
}

export class SseClient {
  constructor({ onEvent, onStatus, fetchImpl, now, setTimer, clearTimer, random } = {}) {
    this.onEvent = onEvent;
    this.onStatus = onStatus;
    this._fetch = fetchImpl || ((url, init) => fetch(url, init));
    this._now = now || (() => Date.now());
    this._setTimer = setTimer || ((fn, ms) => setTimeout(fn, ms));
    this._clearTimer = clearTimer || ((t) => clearTimeout(t));
    this._random = random || Math.random;
    this.state = 'idle';
    this.detail = null;
    this.since = this._now();
    this.url = null;
    this.token = null;
    this.instanceId = null;
    this.credKey = null;
    this.gen = 0;
    this.ctrl = null;
    this.openedAt = null;
    this.lastDataAt = null;
    this.lastEventId = null;
    this.attempt = 0; // consecutive failed attempts since the stream was last open
    this.reconnects = 0; // connection loops begun after the first one (lifetime of this client)
    this.backoffMs = 0;
    this.nextRetryAt = null;
    this._baseDelay = 0;
    this._liveness = null;
    this._connectTimer = null;
    this._wake = null;
    this._lastWakeAt = -Infinity;
    this._started = false;
  }

  /** connecting | open | backoff: a loop is running (supervisor only). */
  get active() { return this.state === 'connecting' || this.state === 'open' || this.state === 'backoff'; }

  /** The stream is open right now (UI truth). */
  get open() { return this.state === 'open'; }

  start(url, token, { instanceId = null } = {}) {
    const base = String(url || '').replace(/\/+$/, '');
    const key = sseCredKey(base, token, instanceId);
    if (this.active && key === this.credKey) return false;
    if (base !== this.url) this.lastEventId = null; // another hub's sequence numbers mean nothing here
    this.url = base;
    this.token = token;
    this.instanceId = instanceId || null;
    this.credKey = key;
    this.attempt = 0;
    this._baseDelay = 0;
    this._begin();
    return true;
  }

  /** Tear down and reconnect now with the same credentials (e.g. the stream went stale). */
  restart(reason) {
    if (!this.url) return false;
    this._begin(reason);
    return true;
  }

  stop(reason) {
    if (this.state === 'idle') return;
    this.gen += 1;
    this._teardown('stopped');
    this._set('idle', 'stopped', reason || null);
  }

  /** Cut a backoff sleep short (e.g. the health probe just reached the hub). Rate-limited. */
  wake(_reason) {
    if (this.state !== 'backoff' || !this._wake) return false;
    const t = this._now();
    if (t - this._lastWakeAt < SSE_WAKE_MIN_GAP_MS) return false;
    this._lastWakeAt = t;
    this._wake();
    return true;
  }

  /** Open but silent for longer than the liveness watchdog should ever allow (e.g. timers were frozen). */
  stale(now = this._now()) {
    return this.state === 'open' && this.lastDataAt != null && now - this.lastDataAt > SSE_STALE_MS;
  }

  snapshot() {
    return {
      state: this.state,
      open: this.open,
      active: this.active,
      detail: this.detail,
      since: this.since,
      openedAt: this.openedAt,
      lastDataAt: this.lastDataAt,
      lastEventId: this.lastEventId,
      attempt: this.attempt,
      reconnects: this.reconnects,
      backoffMs: this.backoffMs,
      nextRetryAt: this.nextRetryAt,
      hubUrl: this.url,
    };
  }

  _begin(reason) {
    this.gen += 1;
    this._teardown(reason || 'restarted');
    if (this._started) this.reconnects += 1;
    this._started = true;
    this._loop(this.gen, reason || null);
  }

  _teardown(reason) {
    this._clearTimer(this._liveness);
    this._clearTimer(this._connectTimer);
    this._liveness = null;
    this._connectTimer = null;
    abortWith(this.ctrl, reason);
    this.ctrl = null;
    this.nextRetryAt = null;
    if (this._wake) this._wake(); // release a backoff sleep so its (now stale) loop exits
  }

  _set(state, status, detail) {
    this.state = state;
    this.detail = detail ?? null;
    this.since = this._now();
    try { this.onStatus && this.onStatus(status, this.detail); } catch (e) { console.warn('[ss] sse onStatus failed:', e); }
  }

  /** `meta.silenceMs`: how long the stream was silent before this event's bytes began arriving (see _attempt). */
  _dispatch(data, meta) {
    let ev;
    try { ev = JSON.parse(data); } catch { return; } // malformed event
    try { this.onEvent && this.onEvent(ev, meta); } catch (e) { console.warn('[ss] sse onEvent failed:', e); }
  }

  async _loop(gen, firstDetail) {
    let detail = firstDetail;
    while (gen === this.gen) {
      const ctrl = new AbortController();
      this.ctrl = ctrl;
      this._set('connecting', 'connecting', detail);
      detail = null;
      let out;
      try {
        out = await this._attempt(gen, ctrl);
      } catch (e) {
        out = { status: 'reconnecting', detail: ctrl.ssReason || String((e && e.message) || e) };
      } finally {
        if (gen === this.gen) {
          this._clearTimer(this._liveness);
          this._clearTimer(this._connectTimer);
          this._liveness = null;
          this._connectTimer = null;
          this.ctrl = null;
        }
      }
      if (gen !== this.gen || !out) return;
      if (out.unauthorized) {
        this._set('unauthorized', 'error', '401 — wrong pairing token');
        return;
      }
      this._scheduleBackoff(out.openedFor || 0);
      this._set('backoff', out.status, out.detail);
      await this._sleep(gen, this.backoffMs);
    }
  }

  // Exponential backoff with +-20% jitter; it only resets after a stream that stayed open long enough.
  _scheduleBackoff(openedFor) {
    if (openedFor >= SSE_STABLE_MS || !this._baseDelay) this._baseDelay = SSE_BACKOFF_BASE_MS;
    else this._baseDelay = Math.min(this._baseDelay * 2, SSE_BACKOFF_MAX_MS);
    this.attempt += 1;
    this.backoffMs = Math.round(this._baseDelay * (0.8 + 0.4 * this._random()));
  }

  _sleep(gen, ms) {
    this.nextRetryAt = this._now() + ms;
    return new Promise((resolve) => {
      let timer = null;
      const done = () => {
        this._clearTimer(timer);
        if (this._wake === done) this._wake = null;
        if (gen === this.gen) this.nextRetryAt = null;
        resolve();
      };
      this._wake = done;
      timer = this._setTimer(done, ms);
    });
  }

  _armLiveness(gen, ctrl) {
    this._clearTimer(this._liveness);
    this._liveness = this._setTimer(() => {
      if (gen !== this.gen || this.state !== 'open' || this.ctrl !== ctrl) return;
      abortWith(ctrl, `liveness timeout — no data for ${Math.round(SSE_LIVENESS_MS / 1000)}s`);
    }, SSE_LIVENESS_MS);
  }

  async _attempt(gen, ctrl) {
    const q = new URLSearchParams({ client: 'extension' });
    if (this.instanceId) q.set('instanceId', this.instanceId);
    const headers = { Authorization: `Bearer ${this.token}`, Accept: 'text/event-stream' };
    if (this.lastEventId != null) headers['Last-Event-ID'] = this.lastEventId;
    this._connectTimer = this._setTimer(() => {
      if (gen === this.gen && this.state === 'connecting' && this.ctrl === ctrl) {
        abortWith(ctrl, `connect timeout after ${Math.round(SSE_CONNECT_TIMEOUT_MS / 1000)}s`);
      }
    }, SSE_CONNECT_TIMEOUT_MS);
    const res = await this._fetch(`${this.url}/api/events?${q}`, { headers, cache: 'no-store', signal: ctrl.signal });
    this._clearTimer(this._connectTimer);
    this._connectTimer = null;
    if (gen !== this.gen) { cancelBody(res); return null; }
    if (res.status === 401) { cancelBody(res); return { unauthorized: true }; }
    if (!res.ok) {
      cancelBody(res);
      return { status: 'error', detail: HTTP_DETAIL[res.status] || `${res.status} — hub refused the event stream, retrying...` };
    }
    if (!res.body) return { status: 'reconnecting', detail: 'hub sent no stream body' };

    const openedAt = this._now();
    this.openedAt = openedAt;
    this.lastDataAt = openedAt;
    this.attempt = 0;
    this.backoffMs = 0;
    this._set('open', 'connected', null);
    this._armLiveness(gen, ctrl);

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    // How long the stream was silent before the bytes now in the buffer began to arrive. An event cannot have
    // been sent before the data ahead of it arrived, so this bounds how late it is (a network stall, a sleeping
    // machine): web-bridge.js asks the hub whether a request that may have outlived its wait is still pending.
    let silenceMs = 0;
    const deliver = (text) => {
      const { events, rest } = parseSseChunk(text);
      const meta = { silenceMs };
      for (const ev of events) {
        if (gen !== this.gen) return rest; // stopped/restarted by an earlier event's handler
        if (ev.id != null) this.lastEventId = ev.id;
        this._dispatch(ev.data, meta);
      }
      return rest;
    };
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (gen !== this.gen) return null;
        if (done) {
          deliver(buffer + decoder.decode()); // flush a multi-byte char held back by the decoder
          return { status: 'reconnecting', detail: 'stream ended by hub', openedFor: this._now() - openedAt };
        }
        const at = this._now();
        silenceMs = (buffer ? silenceMs : 0) + Math.max(0, at - this.lastDataAt);
        this.lastDataAt = at;
        this._armLiveness(gen, ctrl);
        buffer = deliver(buffer + decoder.decode(value, { stream: true }));
      }
    } catch (e) {
      if (gen !== this.gen) return null;
      return { status: 'reconnecting', detail: ctrl.ssReason || String((e && e.message) || e), openedFor: this._now() - openedAt };
    } finally {
      try { reader.releaseLock(); } catch { /* nothing to release */ }
    }
  }
}
