// web_expect on a background tab. Seen live on the CBM admin in the agent window: the element was visible and
// the call still timed out. Chrome throttles a hidden page's timers to one wake-up a second, and after a few
// minutes hidden to one a minute, so the page-side poll loop could sleep far past its own timeoutMs and the hub
// gave up first. The service worker's timers are not throttled: when the page reports that it is hidden
// (data.workerPoll), the worker does the polling, one page evaluation per poll, and the tool answers with its
// own verdict inside its budget. A visible page keeps its own loop, exactly as before.
import { makeError, ERROR_CODES } from './errors.js';

const sleepFor = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Resolves to the promise's value, or to null when it has not settled within `ms`. */
function bounded(promise, ms) {
  let timer;
  return Promise.race([promise, new Promise((resolve) => { timer = setTimeout(() => resolve(null), ms); })])
    .finally(() => clearTimeout(timer));
}

/**
 * @param {(args: Record<string, unknown>) => Promise<any>} injectOnce runs ssWebUnitPerception in the tab
 * @param {Record<string, unknown>} args the web_expect arguments (with __tool)
 * @param {{ sleep?: (ms: number) => Promise<void>, graceMs?: number }} [opts]
 */
export async function runExpectPolling(injectOnce, args = {}, opts = {}) {
  const sleep = opts.sleep || sleepFor;
  const graceMs = Number(opts.graceMs) >= 0 ? Number(opts.graceMs) : 2500;
  const timeoutMs = Math.min(Number(args.timeoutMs) || 5000, 30000);
  const pollMs = Math.max(Number(args.pollMs) || 200, 50);
  const start = Date.now();
  const deadline = start + timeoutMs;
  let attempts = 0;
  let workerPolled = false;
  for (;;) {
    const remaining = Math.max(1, deadline - Date.now());
    const res = await bounded(injectOnce({ ...args, timeoutMs: remaining, __workerPoll: true }), remaining + graceMs);
    if (!res) {
      return makeError(ERROR_CODES.TIMEOUT, `The page did not answer web_expect within ${Math.round((remaining + graceMs) / 1000)} s. Chrome may have frozen or discarded the background tab; web_status shows its state.`, true);
    }
    if (!res.ok || !res.data || typeof res.data !== 'object') return res;
    attempts += Number(res.data.attempts) || 1;
    const handBack = res.data.workerPoll === true;
    delete res.data.workerPoll;
    if (handBack) workerPolled = true;
    if (!handBack || res.data.passed || Date.now() >= deadline) {
      if (workerPolled) Object.assign(res.data, { attempts, waitedMs: Date.now() - start, polledBy: 'worker' });
      return res;
    }
    await sleep(Math.min(pollMs, Math.max(0, deadline - Date.now())));
  }
}
