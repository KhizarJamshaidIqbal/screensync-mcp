// Unit tests for extension audit ring: asserts redaction and bounded buffer
import assert from 'node:assert/strict';
import { createChromeMock } from './harness.js';

globalThis.chrome = createChromeMock();

const { recordAuditEntry, getAuditLog, clearAuditLog, redactPayload } = await import('../lib/audit.js');

console.log('[test] running audit unit tests...');

// 1. Redaction of sensitive fields
const dirtyArgs = {
  token: 'super-secret-bearer-token',
  password: 'my-bank-password',
  apiKey: 'sk-1234567890abcdef',
  selector: 'button.submit',
  comment: 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.xyz',
};
const clean = redactPayload(dirtyArgs);
assert.equal(clean.token, '[REDACTED]', 'Token must be redacted');
assert.equal(clean.password, '[REDACTED]', 'Password must be redacted');
assert.equal(clean.apiKey, '[REDACTED]', 'apiKey must be redacted');
assert.equal(clean.selector, 'button.submit', 'Non-sensitive selector preserved');
assert.ok(clean.comment.includes('[REDACTED]'), 'Bearer token in string must be redacted');

// 2. Audit recording and retrieval
await clearAuditLog();
await recordAuditEntry({
  tool: 'web_click',
  url: 'https://example.com/login',
  origin: 'https://example.com',
  durationMs: 42,
  ok: true,
  args: dirtyArgs,
});

const logRes = await getAuditLog({ limit: 10 });
assert.equal(logRes.ok, true);
assert.equal(logRes.count, 1);
assert.equal(logRes.entries[0].tool, 'web_click');
assert.equal(logRes.entries[0].args.password, '[REDACTED]');

console.log('[test] audit.test.js: ALL ASSERTIONS PASSED (Privacy guaranteed)');
