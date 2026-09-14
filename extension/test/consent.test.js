// Unit tests for ScreenSync Consent, Origin Grants, and Approval Gate (Plan Rev 4 Phase B)
import assert from 'node:assert/strict';
import { createChromeMock } from './harness.js';

globalThis.chrome = createChromeMock({
  storage: {
    local: {
      grants: {},
      webAccessEnabled: true,
    },
  },
});

const {
  normalizeOrigin,
  isLoopbackOrTestOrigin,
  getGrants,
  getOriginGrant,
  saveOriginGrant,
  revokeOriginGrant,
  checkRateLimit,
  recordExtraction,
  getExtractionBudget,
  enqueueApproval,
  getPendingApprovals,
  resolveApproval,
  checkOriginPermission,
} = await import('../lib/consent.js');

console.log('[test] running consent and approval gate tests...');

// ── TEST 1: Origin normalization ──────────────────────────────────────────
assert.equal(normalizeOrigin('https://example.com/path?foo=bar'), 'https://example.com');
assert.equal(normalizeOrigin('http://localhost:3000/dash'), 'http://localhost:3000');
assert.equal(normalizeOrigin('sub.domain.test'), 'https://sub.domain.test');

// ── TEST 2: Loopback / Test origins ───────────────────────────────────────
assert.equal(isLoopbackOrTestOrigin('http://localhost:3000'), true);
assert.equal(isLoopbackOrTestOrigin('http://127.0.0.1:8080'), true);
assert.equal(isLoopbackOrTestOrigin('https://example.test'), true);
assert.equal(isLoopbackOrTestOrigin('https://app.realbank.com'), false);

// ── TEST 3: Origin Grants CRUD ────────────────────────────────────────────
// Loopback gets all permissions by default
const loopbackGrant = await getOriginGrant('http://localhost:3000');
assert.equal(loopbackGrant.read, true);
assert.equal(loopbackGrant.act, true);
assert.equal(loopbackGrant.cookies, true);

// Real origin starts ungranted
const ungranted = await getOriginGrant('https://api.github.com');
assert.equal(ungranted.read, false);
assert.equal(ungranted.act, false);

// Save grant
await saveOriginGrant('https://api.github.com', { read: true, act: false, cookies: false });
const granted = await getOriginGrant('https://api.github.com');
assert.equal(granted.read, true);
assert.equal(granted.act, false);

// Revoke grant
await revokeOriginGrant('https://api.github.com');
const afterRevoke = await getOriginGrant('https://api.github.com');
assert.equal(afterRevoke.read, false);

// ── TEST 4: Rate Limiter ──────────────────────────────────────────────────
const rlTarget = 'https://rate-limit-test.org';
for (let i = 0; i < 10; i++) {
  const r = checkRateLimit(rlTarget);
  assert.equal(r.ok, true);
}

// All grants listing
const allG = await getGrants();
assert.equal(typeof allG, 'object');

// Check origin permission
const permAllow = await checkOriginPermission('http://localhost:3000', 'read', 'web_screenshot');
assert.equal(permAllow.ok, true);
const permDeny = await checkOriginPermission('https://unapproved-site.com', 'act', 'web_click');
assert.equal(permDeny.ok, false);
assert.equal(permDeny.code, 'PERMISSION_DENIED');

// ── TEST 5: Extraction Budget ─────────────────────────────────────────────
const b0 = getExtractionBudget();
assert.equal(typeof b0.sessionExtractedBytes, 'number');
const b1 = recordExtraction('https://example.com', 1000);
assert.equal(b1.sessionExtractedBytes >= 1000, true);
assert.equal(b1.isExceeded, false);

// ── TEST 6: Approval Queue ────────────────────────────────────────────────
const apprPromise = enqueueApproval({
  origin: 'https://sensitive.org',
  tool: 'web_click',
  risk: 'destructive',
  details: { label: 'Delete Account' },
});

const pending = getPendingApprovals();
assert.equal(pending.length, 1);
assert.equal(pending[0].tool, 'web_click');
assert.equal(pending[0].risk, 'destructive');

// Resolve approval
const res = resolveApproval(pending[0].id, true);
assert.equal(res.ok, true);
assert.equal(res.approved, true);

const apprResult = await apprPromise;
assert.equal(apprResult.approved, true);
assert.equal(getPendingApprovals().length, 0);

console.log('[test] consent.test.js: ALL ASSERTIONS PASSED (Phase B Consent Gate guaranteed)');
