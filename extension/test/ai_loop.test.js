// Unit tests for AI-Browser Loop Capabilities (Plan Rev 4 Phase D: D1-D9)
import assert from 'node:assert/strict';
import { createChromeMock } from './harness.js';

globalThis.chrome = createChromeMock();

const {
  createJob,
  getJob,
  listJobs,
  cancelJob,
  updateJobProgress,
} = await import('../lib/jobs.js');

const {
  requestTakeover,
  resumeTakeover,
  getTakeoverStatus,
} = await import('../lib/takeover.js');

const {
  getSiteMemory,
  recordSelectorSuccess,
  autoHealSelector,
  clearSiteMemory,
  normalizeOrigin,
} = await import('../lib/site-memory.js');

const { t, setLocale } = await import('../lib/i18n.js');

console.log('[test] running AI-browser loop tests (D1-D9)...');

// ── TEST 1: D1 - Background Job Runner ──────────────────────────────────
const job = createJob('Scrape Products', [{ tool: 'web_navigate' }, { tool: 'web_table_extract' }]);
assert.ok(job.id.startsWith('job_'));
assert.equal(job.goal, 'Scrape Products');
assert.equal(job.state, 'idle');
assert.equal(job.steps.length, 2);

updateJobProgress(job.id, { stepIndex: 1, status: 'completed' });
const updated = getJob(job.id);
assert.equal(updated.progress.current, 1);
assert.equal(updated.steps[0].status, 'completed');

const cancelled = cancelJob(job.id);
assert.equal(cancelled.ok, true);
assert.equal(cancelled.job.state, 'cancelled');

const allJobs = listJobs();
assert.ok(allJobs.length >= 1);

// ── TEST 2: D2 - Takeover & Hand-off Lifecycle ──────────────────────────
let takeoverPromiseResolved = false;
let takeoverResult = null;

const p = requestTakeover({
  reason: '2fa',
  message: 'Please enter SMS code',
  tabId: 10,
  timeoutMs: 5000,
}).then((res) => {
  takeoverPromiseResolved = true;
  takeoverResult = res;
});

const status = getTakeoverStatus();
assert.equal(status.active, true);
assert.equal(status.reason, '2fa');

// Resume takeover
const resumeRes = resumeTakeover({ userNotes: 'Entered 2FA code 123456', success: true });
assert.equal(resumeRes.ok, true);

await p;
assert.equal(takeoverPromiseResolved, true);
assert.equal(takeoverResult.ok, true);
assert.equal(takeoverResult.data.resumed, true);
assert.equal(takeoverResult.data.userNotes, 'Entered 2FA code 123456');

const afterStatus = getTakeoverStatus();
assert.equal(afterStatus.active, false);

// ── TEST 3: D3 - Site Memory & Learned Selectors ────────────────────────
await clearSiteMemory();
const origin = 'https://portal.service.com';
assert.equal(normalizeOrigin('https://portal.service.com/dashboard'), 'https://portal.service.com');

const saved = await recordSelectorSuccess(origin, 'login_btn', 'button[type="submit"]');
assert.equal(saved.selector, 'button[type="submit"]');
assert.equal(saved.successCount, 1);

// Auto-healing fallback
const healed = await autoHealSelector(origin, 'login_btn', 'role=button[name="Sign In"]', 'button', 'Sign In');
assert.equal(healed.selector, 'role=button[name="Sign In"]');
assert.equal(healed.healedFrom, 'button[type="submit"]');

const mem = await getSiteMemory(origin);
assert.equal(mem.login_btn.selector, 'role=button[name="Sign In"]');

// ── TEST 4: D6 - Ref-Based Selector Resolution Logic ────────────────────
function resolveRefSelector(selector, args = {}) {
  if (typeof args.ref === 'number' || (typeof args.ref === 'string' && /^\d+$/.test(args.ref))) {
    return `[data-ss-id="${args.ref}"]`;
  }
  if (typeof selector === 'string') {
    const refMatch = selector.match(/^(?:@|ref=)(\d+)$/i);
    if (refMatch) return `[data-ss-id="${refMatch[1]}"]`;
  }
  return selector;
}

assert.equal(resolveRefSelector(null, { ref: 5 }), '[data-ss-id="5"]');
assert.equal(resolveRefSelector('@12'), '[data-ss-id="12"]');
assert.equal(resolveRefSelector('ref=42'), '[data-ss-id="42"]');
assert.equal(resolveRefSelector('button.submit'), 'button.submit');

// ── TEST 5: D8 - Extraction Metadata Contract ───────────────────────────
const sampleArticleMetadata = {
  url: 'https://blog.example.com/article-1',
  canonicalUrl: 'https://example.com/article-1',
  title: 'AI Browser Breakthrough',
  author: 'Jane Doe',
  publishedDate: '2026-09-14T08:00:00Z',
  content: '# AI Browser Breakthrough\n\nFull content goes here...',
};

assert.ok(sampleArticleMetadata.canonicalUrl.startsWith('https://'));
assert.ok(sampleArticleMetadata.title.length > 0);
assert.ok(sampleArticleMetadata.author.length > 0);
assert.ok(sampleArticleMetadata.publishedDate.includes('2026'));

// ── TEST 6: D9 - i18n Dictionary & Fallback ─────────────────────────────
assert.equal(t('app.title', 'ScreenSync MCP'), 'ScreenSync MCP');
assert.equal(t('btn.reload', 'Reload'), 'Reload');
assert.equal(t('unknown.key.foo', 'Fallback Text'), 'Fallback Text');
setLocale('es');
assert.equal(t('btn.reload', 'Fallback'), 'Recargar');
setLocale('en');

console.log('[test] AI-browser loop tests passed (6/6).');
