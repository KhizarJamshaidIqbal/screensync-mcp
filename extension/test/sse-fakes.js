// Deterministic fakes for the SSE client tests: a manual clock whose timers only fire on advance(), and a
// fetch that returns a real Response(ReadableStream) the test feeds chunk by chunk and that honours abort.

const enc = new TextEncoder();

/** Lets promise chains (fetch, reader.read, the client's loop) settle between steps. */
export async function settle(rounds = 30) {
  for (let i = 0; i < rounds; i++) await new Promise((r) => setImmediate(r));
}

export function createClock(start = 1_000_000) {
  let t = start;
  let seq = 0;
  const timers = new Map();
  const clock = {
    now: () => t,
    setTimer: (fn, ms) => {
      const id = ++seq;
      timers.set(id, { at: t + Math.max(0, Number(ms) || 0), fn });
      return id;
    },
    clearTimer: (id) => { timers.delete(id); },
    pending: () => timers.size,
    /** Jumps the wall clock WITHOUT firing timers (a frozen/suspended worker). */
    jump: (ms) => { t += ms; },
    /** Runs every timer due within `ms`, in order, letting async work settle after each. */
    async advance(ms) {
      const end = t + ms;
      await settle();
      for (;;) {
        let nextId = null;
        let next = null;
        for (const [id, tm] of timers) if (tm.at <= end && (!next || tm.at < next.at)) { next = tm; nextId = id; }
        if (!next) break;
        timers.delete(nextId);
        t = next.at;
        next.fn();
        await settle();
      }
      t = end;
      await settle();
    },
  };
  return clock;
}

function abortError() {
  const e = new Error('The operation was aborted.');
  e.name = 'AbortError';
  return e;
}

/** An open event stream the test controls. */
function makeStream(signal, status = 200) {
  const s = { cancelled: false, closed: false };
  const body = new ReadableStream({
    start(c) { s.ctl = c; },
    cancel() { s.cancelled = true; },
  });
  signal.addEventListener('abort', () => {
    if (s.closed) return;
    s.closed = true;
    try { s.ctl.error(abortError()); } catch { /* already closed */ }
  });
  s.res = new Response(body, { status, headers: { 'content-type': 'text/event-stream' } });
  s.push = (text) => s.ctl.enqueue(typeof text === 'string' ? enc.encode(text) : text);
  s.end = () => { if (!s.closed) { s.closed = true; s.ctl.close(); } };
  return s;
}

/**
 * fetch fake. Queue per-call behaviours with next(kind): 'open' (200 stream), a number (that HTTP status with
 * a cancellable body), 'hang' (never answers until aborted) or 'down' (network error). Unqueued calls use
 * the fallback (default 'down'). Every call is recorded with its url, headers and stream.
 */
export function createFetch() {
  const calls = [];
  const queue = [];
  let fallback = 'down';
  const fetchImpl = (url, init = {}) => {
    const call = { url: String(url), headers: { ...(init.headers || {}) }, signal: init.signal, stream: null };
    calls.push(call);
    const kind = queue.length ? queue.shift() : fallback;
    return new Promise((resolve, reject) => {
      if (init.signal && init.signal.aborted) return reject(abortError());
      if (kind === 'down') return reject(new TypeError('fetch failed'));
      if (kind === 'hang') {
        init.signal.addEventListener('abort', () => reject(abortError()));
        return undefined;
      }
      call.stream = makeStream(init.signal, kind === 'open' ? 200 : kind);
      return resolve(call.stream.res);
    });
  };
  fetchImpl.calls = calls;
  fetchImpl.next = (...kinds) => { queue.push(...kinds); };
  fetchImpl.setFallback = (kind) => { fallback = kind; };
  fetchImpl.last = () => calls[calls.length - 1];
  return fetchImpl;
}

export const encode = (text) => enc.encode(text);
