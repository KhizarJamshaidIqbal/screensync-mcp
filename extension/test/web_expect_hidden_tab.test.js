// web_expect {condition:"visible", selector, tabId} on a background tab timed out although the element was
// visible (seen live 2026-09-23 on the CBM admin, Index insights, in the agent window). In a hidden tab:
//   - requestAnimationFrame and IntersectionObserver callbacks never run, and CSS animations do not advance, so
//     an entry fade-in that started in the background stays frozen at opacity 0 and visible() said "hidden";
//   - page timers are throttled (one wake-up a second, later one a minute), so the page-side poll loop slept
//     far past its timeoutMs and the hub gave up first.
// This reproduces that page: the card sits in the scrolled container main.cbm-admin-main, the tab is hidden,
// rAF/IO never fire and page timers never fire either. The check must pass from layout and computed style
// alone, and when it has to wait, the service worker polls (web-expect-poll.js), not the page.
import assert from 'node:assert/strict';
import { El, installLayout } from './layout-mock.js';

const realSetTimeout = globalThis.setTimeout;
let pageTimers = 0;
/** Runs the page unit with the page's timers throttled to "never" (intensive throttling, as good as). */
function inPage(fn, args) {
  const saved = globalThis.setTimeout;
  globalThis.setTimeout = () => { pageTimers++; return 0; };
  try { return fn(args); } finally { globalThis.setTimeout = saved; }
}
/** The page's answer, or 'NO_ANSWER' when it is stuck waiting on a page timer. */
const answer = (promise, ms = 1500) => Promise.race([promise, new Promise((r) => realSetTimeout(() => r('NO_ANSWER'), ms))]);
const sleep = (ms) => new Promise((r) => realSetTimeout(r, ms));

const fadeIn = () => ({ playState: 'pending', effect: { getKeyframes: () => [{ offset: 0, computedOffset: 0, opacity: '0' }, { offset: 1, computedOffset: 1, opacity: '1' }] } });
const fadeOut = () => ({ playState: 'running', effect: { getKeyframes: () => [{ offset: 0, computedOffset: 0, opacity: '1' }, { offset: 1, computedOffset: 1, opacity: '0' }] } });

/** The CBM admin shell: a scrolled main.cbm-admin-main holding the insights card, frozen mid fade-in. */
function cbmAdmin(visibilityState) {
  const env = installLayout({ visibilityState, title: 'Index insights' });
  const main = new El('main', { class: 'cbm-admin-main' });
  main._rect = { x: 220, y: 60, width: 1060, height: 740 };
  main.scrollTop = 1400;
  const card = new El('div', { class: 'cbm-insights-card' }, 'Not indexed: 12 pages');
  card._rect = { x: 240, y: 1600, width: 800, height: 180 }; // on screen once scrolled (y = 200)
  card.style.opacity = '0';
  card.animations = [fadeIn()];
  main.append(card);
  env.body.append(main);
  return { ...env, main, card };
}

const { ssWebUnitPerception } = await import('../lib/web-unit-perception.js');
const { runExpectPolling } = await import('../lib/web-expect-poll.js');
const SEL = 'main.cbm-admin-main .cbm-insights-card';

// 1. The live case: visible element, hidden tab, frozen fade-in. Passes on the first look, no frame, no timer.
{
  const { frameCallbacks } = cbmAdmin('hidden');
  pageTimers = 0;
  const res = await answer(inPage(ssWebUnitPerception, { __tool: 'web_expect', condition: 'visible', selector: SEL, timeoutMs: 5000, __workerPoll: true }));
  assert.notEqual(res, 'NO_ANSWER', 'the page must answer without waiting on a throttled timer');
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.equal(res.data.passed, true, 'a visible card is visible in a hidden tab: ' + JSON.stringify(res.data));
  assert.equal(res.data.actual, 'visible');
  assert.equal(res.data.attempts, 1);
  assert.equal(pageTimers, 0, 'no page timer');
  assert.deepEqual(frameCallbacks, { raf: 0, io: 0 }, 'no requestAnimationFrame / IntersectionObserver in a hidden tab');
  console.log('[test] web_expect_hidden_tab: visible card, hidden tab, frozen fade-in -> passes at once - PASSED');
}

// 2. Same through the worker loop that web-tools.js now uses for web_expect.
{
  cbmAdmin('hidden');
  pageTimers = 0;
  const t0 = Date.now();
  const res = await answer(runExpectPolling((a) => inPage(ssWebUnitPerception, a), { __tool: 'web_expect', condition: 'visible', selector: SEL, timeoutMs: 5000 }, { sleep }));
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.equal(res.data.passed, true);
  assert.equal(res.data.workerPoll, undefined, 'the internal hand-back flag never reaches the caller');
  assert.ok(Date.now() - t0 < 500);
  console.log('[test] web_expect_hidden_tab: through runExpectPolling -> passes at once - PASSED');
}

// 3. The card only renders after a moment: the page hands the wait back instead of sleeping on a throttled
//    timer, and the worker polls until it appears.
{
  const env = cbmAdmin('hidden');
  env.main.childNodes = [];
  pageTimers = 0;
  let injections = 0;
  const res = await answer(runExpectPolling((a) => {
    injections++;
    if (injections === 3) env.main.append(env.card); // the React view renders the card
    return inPage(ssWebUnitPerception, a);
  }, { __tool: 'web_expect', condition: 'visible', selector: SEL, timeoutMs: 5000, pollMs: 50 }, { sleep }), 3000);
  assert.notEqual(res, 'NO_ANSWER');
  assert.equal(res.data.passed, true, JSON.stringify(res));
  assert.equal(res.data.polledBy, 'worker');
  assert.equal(res.data.attempts, 3);
  assert.equal(injections, 3);
  assert.equal(pageTimers, 0, 'the page never waited on its own timer');
  console.log('[test] web_expect_hidden_tab: element appears later -> worker polls, passes - PASSED');
}

// 4. It never appears: the verdict comes back inside timeoutMs (the hub waits timeoutMs + 5 s), not a hub timeout.
{
  const env = cbmAdmin('hidden');
  env.main.childNodes = [];
  const t0 = Date.now();
  const res = await answer(runExpectPolling((a) => inPage(ssWebUnitPerception, a), { __tool: 'web_expect', condition: 'visible', selector: SEL, timeoutMs: 400, pollMs: 100 }, { sleep }), 3000);
  const took = Date.now() - t0;
  assert.equal(res.ok, true);
  assert.equal(res.data.passed, false);
  assert.equal(res.data.actual, 'not_found');
  assert.equal(res.data.polledBy, 'worker');
  assert.ok(took >= 380 && took < 1000, `own verdict inside the budget (took ${took} ms)`);
  console.log('[test] web_expect_hidden_tab: never appears -> own verdict inside timeoutMs - PASSED');
}

// 5. hidden: a toast frozen at the first frame of its fade-out counts as hidden in a hidden tab.
{
  const env = cbmAdmin('hidden');
  const toast = new El('div', { class: 'cbm-toast' }, 'Saved');
  toast.animations = [fadeOut()];
  env.body.append(toast);
  const res = await answer(inPage(ssWebUnitPerception, { __tool: 'web_expect', condition: 'hidden', selector: '.cbm-toast', __workerPoll: true }));
  assert.equal(res.data.passed, true, JSON.stringify(res.data));
  console.log('[test] web_expect_hidden_tab: frozen fade-out -> hidden - PASSED');
}

// 6. A visible tab is unchanged: opacity 0 without an animation is hidden, and the page runs its own loop.
{
  const env = cbmAdmin('visible');
  env.card.animations = [];
  const res = await answer(runExpectPolling((a) => ssWebUnitPerception(a), { __tool: 'web_expect', condition: 'visible', selector: SEL, timeoutMs: 250, pollMs: 50 }, { sleep }), 3000);
  assert.equal(res.data.passed, false);
  assert.equal(res.data.actual, 'in_dom_but_hidden');
  assert.ok(res.data.attempts > 1, 'the page polled itself');
  assert.equal(res.data.polledBy, undefined, 'no worker polling for a visible tab');
  env.card.style.opacity = '1';
  const ok = await ssWebUnitPerception({ __tool: 'web_expect', condition: 'visible', selector: SEL });
  assert.equal(ok.data.passed, true);
  console.log('[test] web_expect_hidden_tab: visible tab keeps the old behaviour - PASSED');
}

// 7. A page that never answers (frozen tab) ends in a TIMEOUT from the worker, before the hub's timeoutMs + 5 s.
{
  const t0 = Date.now();
  const res = await runExpectPolling(() => new Promise(() => {}), { __tool: 'web_expect', condition: 'visible', selector: SEL, timeoutMs: 300 }, { sleep, graceMs: 200 });
  assert.equal(res.ok, false);
  assert.equal(res.code, 'TIMEOUT');
  assert.ok(Date.now() - t0 < 1500);
  console.log('[test] web_expect_hidden_tab: frozen page -> worker TIMEOUT - PASSED');
}

console.log('[test] web_expect_hidden_tab.test.js: ALL ASSERTIONS PASSED');
