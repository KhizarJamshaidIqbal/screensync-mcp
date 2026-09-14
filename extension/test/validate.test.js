import assert from 'node:assert/strict';
import { validateToolArgs } from '../lib/validate.js';
import { ERROR_CODES } from '../lib/errors.js';

console.log('[test] running argument validation unit tests (D4)...');

// 1. Non-object args
const errNonObj = validateToolArgs('web_click', 'not-an-object');
assert.ok(errNonObj);
assert.equal(errNonObj.code, ERROR_CODES.BAD_ARGS);

// 2. web_navigate without valid url
const errNav1 = validateToolArgs('web_navigate', {});
assert.ok(errNav1);
assert.equal(errNav1.code, ERROR_CODES.BAD_ARGS);

const errNav2 = validateToolArgs('web_navigate', { url: 'chrome://settings' });
assert.ok(errNav2);
assert.equal(errNav2.code, ERROR_CODES.BAD_ARGS);

const okNav = validateToolArgs('web_navigate', { url: 'https://example.com' });
assert.equal(okNav, null);

// 3. web_click without target locator
const errClick = validateToolArgs('web_click', {});
assert.ok(errClick);
assert.equal(errClick.code, ERROR_CODES.BAD_ARGS);

const okClick = validateToolArgs('web_click', { selector: 'button.submit' });
assert.equal(okClick, null);

// 4. web_type without text
const errType = validateToolArgs('web_type', { selector: 'input' });
assert.ok(errType);
assert.equal(errType.code, ERROR_CODES.BAD_ARGS);

const okType = validateToolArgs('web_type', { selector: 'input', text: 'hello' });
assert.equal(okType, null);

console.log('[test] validate.test.js: ALL ASSERTIONS PASSED (D4 guaranteed)');
