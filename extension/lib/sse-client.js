import { SSE_LIVENESS_MS } from './constants.js';

// MV3 service workers have no EventSource — parse text/event-stream over
// fetch + ReadableStream instead. The hub emits `data: {json}\n\n` events
// plus `: keepalive` comments every 30s.
export class SseClient {
  constructor({ onEvent, onStatus }) {
    this.onEvent = onEvent;
    this.onStatus = onStatus;
    this.abort = null;
    this.livenessTimer = null;
    this.stopped = true;
    this.backoff = 1000;
  }

  start(url, token) {
    this.stop();
    this._stoppedByUser = false;
    this.stopped = false;
    this.url = url;
    this.token = token;
    this._loop();
  }

  stop() {
    this.stopped = true;
    this._stoppedByUser = true;
    if (this.abort) this.abort.abort();
    this.abort = null;
    clearTimeout(this.livenessTimer);
  }

  get connected() {
    return !this.stopped && this.abort !== null;
  }

  // Zombie detection: the hub sends a keepalive every 30s. If we believe we
  // are connected but no bytes arrived within 90s, the stream is dead
  // (e.g. the hub restarted) — the caller should force a reconnect.
  stale() {
    return this.connected && (!this.lastDataAt || Date.now() - this.lastDataAt > 90_000);
  }

  _status(s, detail) {
    this.onStatus && this.onStatus(s, detail);
  }

  async _loop() {
    while (!this.stopped) {
      this.abort = new AbortController();
      try {
        this._status('connecting');
        const res = await fetch(this.url.replace(/\/$/, '') + '/api/events', {
          headers: {
            Authorization: `Bearer ${this.token}`,
            Accept: 'text/event-stream',
          },
          cache: 'no-store',
          signal: this.abort.signal,
        });
        if (res.status === 401) {
          this._status('error', '401 — wrong pairing token');
          this.stop();
          return;
        }
        if (res.status === 429) {
          this._status('error', '429 — too many connections, retrying...');
          await new Promise((r) => setTimeout(r, 3000));
          continue;
        }
        if (!res.ok) throw new Error(`SSE ${res.status}`);

        this.backoff = 1000;
        this._status('connected');
        this._armLiveness();
        this.lastDataAt = Date.now();

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          this._armLiveness();
          this.lastDataAt = Date.now();
          buffer += decoder.decode(value, { stream: true });
          const parts = buffer.split('\n\n');
          buffer = parts.pop();
          for (const part of parts) {
            const line = part.split('\n').find((l) => l.startsWith('data:'));
            if (!line) continue; // keepalive comment
            try {
              this.onEvent && this.onEvent(JSON.parse(line.slice(5).trim()));
            } catch { /* malformed event */ }
          }
        }
      } catch (e) {
        // A liveness-timeout abort (silent TCP death, e.g. hub restart) must
        // RECONNECT, not break — that AbortError previously killed the client
        // permanently, leaving a zombie: heartbeat alive, events never delivered.
        if (this.stopped) break;
        if (e && e.name === 'AbortError' && !this._stoppedByUser) {
          this._status('reconnecting', 'liveness timeout — forcing reconnect');
        } else if (e && e.name === 'AbortError') {
          break;
        } else {
          this._status('reconnecting', String(e.message || e));
        }
      }
      this.abort = null;
      if (this.stopped) break;
      await new Promise((r) => setTimeout(r, this.backoff));
      this.backoff = Math.min(this.backoff * 2, 30000);
    }
    if (this.stopped) this._status('stopped');
  }

  _armLiveness() {
    clearTimeout(this.livenessTimer);
    this.livenessTimer = setTimeout(() => {
      if (!this.stopped && this.abort) this.abort.abort();
    }, SSE_LIVENESS_MS);
  }
}
