// Automated test suite for Playwright locator engine, strict mode, actionability & dryRun
import assert from 'node:assert/strict';
import { createChromeMock } from './harness.js';

// Setup minimal browser DOM environment for Node testing
globalThis.chrome = createChromeMock();

class MockElement {
  constructor(tag, attrs = {}, text = '') {
    this.tagName = tag.toUpperCase();
    this.attrs = { ...attrs };
    this.innerText = text;
    this.textContent = text;
    this.value = attrs.value || '';
    this.disabled = Boolean(attrs.disabled);
    this.checked = Boolean(attrs.checked);
    this.children = [];
    this.parentElement = null;
    this.isConnected = true;
    this.nodeType = 1;
    this.style = { display: attrs.display || 'block', visibility: 'visible', opacity: '1' };
  }

  getAttribute(name) {
    if (name === 'role') return this.attrs.role || null;
    if (name === 'data-testid') return this.attrs['data-testid'] || null;
    if (name === 'data-ss-id') return this.attrs['data-ss-id'] || null;
    if (name === 'aria-label') return this.attrs['aria-label'] || null;
    if (name === 'aria-disabled') return this.attrs['aria-disabled'] || null;
    if (name === 'placeholder') return this.attrs.placeholder || null;
    if (name === 'type') return this.attrs.type || null;
    return this.attrs[name] || null;
  }

  setAttribute(name, val) { this.attrs[name] = String(val); }

  getBoundingClientRect() {
    if (this.style.display === 'none') return { x: 0, y: 0, width: 0, height: 0, top: 0, bottom: 0, left: 0, right: 0 };
    return this._rect || { x: 10, y: 10, width: 100, height: 30, top: 10, bottom: 40, left: 10, right: 110 };
  }

  scrollIntoView() {}
  focus() { globalThis.document.activeElement = this; }
  blur() { if (globalThis.document.activeElement === this) globalThis.document.activeElement = null; }
  dispatchEvent() { return true; }
  click() { if (this.onclick) this.onclick(); }
  closest(sel) {
    let cur = this;
    while (cur) {
      if (cur.matches && cur.matches(sel)) return cur;
      cur = cur.parentElement;
    }
    return null;
  }
  contains(el) {
    if (!el) return false;
    if (el === this) return true;
    return this.children.some((c) => c.contains(el));
  }

  matches(sel) {
    if (!sel) return false;
    if (sel.includes(',')) {
      return sel.split(/\s*,\s*/).some((s) => this.matches(s));
    }
    if (sel === '*') return true;
    const tag = this.tagName.toLowerCase();
    if (sel.toLowerCase() === tag) return true;
    if (sel.startsWith('#') && this.attrs.id === sel.slice(1)) return true;
    if (sel.startsWith('.') && this.attrs.class && this.attrs.class.split(/\s+/).includes(sel.slice(1))) return true;
    const attrMatch = sel.match(/^\[([a-zA-Z0-9_-]+)(?:([*^$]?=)["']?([^"']*)["']?)?\]$/);
    if (attrMatch) {
      const [, name, op, val] = attrMatch;
      const attrVal = this.getAttribute(name);
      if (attrVal === undefined || attrVal === null) return false;
      if (!op) return true;
      if (op === '=') return attrVal === val;
      if (op === '*=') return attrVal.includes(val);
      if (op === '^=') return attrVal.startsWith(val);
      if (op === '$=') return attrVal.endsWith(val);
    }
    return false;
  }


  querySelector(sel) {
    const list = this.querySelectorAll(sel);
    return list.length > 0 ? list[0] : null;
  }

  querySelectorAll(sel) {
    const results = [];
    const check = (node) => {
      for (const child of node.children) {
        if (child.matches && child.matches(sel)) results.push(child);
        check(child);
      }
    };
    check(this);
    return results;
  }

  appendChild(child) {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }
}

const mockDoc = {
  nodeType: 9,
  body: new MockElement('body'),
  documentElement: new MockElement('html'),
  activeElement: null,
  title: 'ScreenSync Test Page',
  querySelector(sel) {
    if (sel === 'body') return this.body;
    return this.body.querySelector(sel);
  },
  querySelectorAll(sel) {
    return this.body.querySelectorAll(sel);
  },
  elementFromPoint(x, y) {
    const findDeepest = (node) => {
      for (const child of node.children) {
        const found = findDeepest(child);
        if (found) return found;
      }
      const r = node.getBoundingClientRect();
      if (x >= r.x && x <= r.x + r.width && y >= r.y && y <= r.y + r.height && node.style.display !== 'none') {
        return node;
      }
      return null;
    };
    return findDeepest(this.body) || this.body;
  },
  createElement(tag) {
    return new MockElement(tag);
  },
};
mockDoc.documentElement.appendChild(mockDoc.body);

globalThis.document = mockDoc;
globalThis.window = {
  getComputedStyle: (el) => el.style || { display: 'block', visibility: 'visible', opacity: '1' },
  innerWidth: 1280,
  innerHeight: 800,
};
globalThis.location = { href: 'https://example.test/app' };
globalThis.requestAnimationFrame = (cb) => setTimeout(cb, 0);

console.log('[test] running Playwright locator & strict mode tests...');

const { ssWebUnitInteract } = await import('../lib/web-unit-interact.js');
const { ssWebUnitAgent } = await import('../lib/web-unit-agent.js');
const { ssWebUnitExtract } = await import('../lib/web-unit-extract.js');

const nav = new MockElement('div', { id: 'nav' });
nav._rect = { x: 0, y: 0, width: 500, height: 50, top: 0, bottom: 50, left: 0, right: 500 };
const navBtn = new MockElement('button', { id: 'nav-btn' }, 'Home');
navBtn._rect = { x: 10, y: 10, width: 80, height: 30, top: 10, bottom: 40, left: 10, right: 90 };
nav.appendChild(navBtn);

const modal = new MockElement('div', { id: 'modal', class: 'modal' });
modal._rect = { x: 100, y: 100, width: 400, height: 300, top: 100, bottom: 400, left: 100, right: 500 };
const modalBtn = new MockElement('button', { id: 'modal-btn', 'data-testid': 'confirm-btn' }, 'Confirm');
modalBtn._rect = { x: 120, y: 120, width: 90, height: 35, top: 120, bottom: 155, left: 120, right: 210 };
const dangerBtn = new MockElement('button', { id: 'danger-btn', class: 'danger' }, 'Delete Account');
dangerBtn._rect = { x: 220, y: 120, width: 130, height: 35, top: 120, bottom: 155, left: 220, right: 350 };
modal.appendChild(modalBtn);
modal.appendChild(dangerBtn);

const form = new MockElement('div', { id: 'form' });
form._rect = { x: 0, y: 450, width: 500, height: 200, top: 450, bottom: 650, left: 0, right: 500 };
const emailInput = new MockElement('input', { id: 'email', placeholder: 'Enter email' });
emailInput._rect = { x: 20, y: 470, width: 200, height: 30, top: 470, bottom: 500, left: 20, right: 220 };
const disabledInput = new MockElement('input', { id: 'disabled-input', disabled: true, 'aria-disabled': 'true' });
disabledInput._rect = { x: 20, y: 520, width: 200, height: 30, top: 520, bottom: 550, left: 20, right: 220 };
form.appendChild(emailInput);
form.appendChild(disabledInput);

mockDoc.body.children = [];
mockDoc.body.appendChild(nav);
mockDoc.body.appendChild(modal);
mockDoc.body.appendChild(form);


// ── TEST 1: Scoped >> Chaining in web-unit-interact ───────────────────────
const chainClick = await ssWebUnitInteract({
  __tool: 'web_click',
  selector: '#modal >> button',
  timeoutMs: 100,
  dryRun: true,
});
console.log('chainClick result:', chainClick);
assert.equal(chainClick.ok, true, 'Scoped >> chaining must succeed');
assert.equal(chainClick.data.dryRun, true);
assert.equal(chainClick.data.target, 'Confirm', 'Chaining #modal >> button MUST find the modal button, NOT nav button');

// ── TEST 2: testid= locator support in web-unit-interact ──────────────────
const testidClick = await ssWebUnitInteract({
  __tool: 'web_click',
  selector: 'testid=confirm-btn',
  timeoutMs: 100,
  dryRun: true,
});
assert.equal(testidClick.ok, true, 'testid= locator must resolve');
assert.equal(testidClick.data.target, 'Confirm');

// ── TEST 3: Strict mode violation in web-unit-interact ────────────────────
const strictClick = await ssWebUnitInteract({
  __tool: 'web_click',
  selector: 'button',
  strict: true,
  timeoutMs: 100,
});
assert.equal(strictClick.ok, false, 'Strict mode must fail when multiple buttons match');
assert.equal(strictClick.code, 'STRICT_MODE_VIOLATION');

// ── TEST 4: Destructive keyword confirmation ──────────────────────────────
const confirmDestructiveRes = await ssWebUnitInteract({
  __tool: 'web_click',
  selector: '#danger-btn',
  confirmDestructive: true,
  timeoutMs: 100,
});
assert.equal(confirmDestructiveRes.ok, false);
assert.equal(confirmDestructiveRes.code, 'USER_CONFIRMATION_REQUIRED');
assert.equal(confirmDestructiveRes.risk, 'destructive');

// ── TEST 4b: `confirmed` and `force` are the AGENT's own words, so they do not run a destructive action ──
// Only the flag the extension itself sets after a person approves does (approval-gate.js).
const dangerInput = new MockElement('input', { id: 'danger-input', 'aria-label': 'Delete everything' });
dangerInput._rect = { x: 20, y: 570, width: 200, height: 30, top: 570, bottom: 600, left: 20, right: 220 };
form.appendChild(dangerInput);
const { ssWebUnitAction } = await import('../lib/web-unit-action.js');

const clickInsists = await ssWebUnitInteract({ __tool: 'web_click', selector: '#danger-btn', confirmed: true, force: true, timeoutMs: 100 });
assert.equal(clickInsists.code, 'USER_CONFIRMATION_REQUIRED', 'confirmed/force must not run a destructive click');
const typeInsists = await ssWebUnitInteract({ __tool: 'web_type', selector: '#danger-input', text: 'x', confirmed: true, force: true, timeoutMs: 100 });
assert.equal(typeInsists.code, 'USER_CONFIRMATION_REQUIRED', 'confirmed/force must not run a destructive type');
const fillInsists = await ssWebUnitAction({ __tool: 'web_fill', selector: '#danger-input', value: 'x', confirmed: true, force: true, timeoutMs: 100 });
assert.equal(fillInsists.code, 'USER_CONFIRMATION_REQUIRED', 'confirmed/force must not run a destructive fill');

// With the approval flag the destructive check is passed. What happens next is the action itself, which the
// mock DOM cannot fully perform, so a throw AFTER the check counts as having passed it.
for (const [unit, args] of [
  [ssWebUnitInteract, { __tool: 'web_click', selector: '#danger-btn' }],
  [ssWebUnitInteract, { __tool: 'web_type', selector: '#danger-input', text: 'x' }],
  [ssWebUnitAction, { __tool: 'web_fill', selector: '#danger-input', value: 'x' }],
]) {
  let approved;
  try { approved = await unit({ ...args, __humanApproved: true, timeoutMs: 100 }); } catch (e) { approved = { thrownAfterTheCheck: String(e) }; }
  assert.notEqual(approved.code, 'USER_CONFIRMATION_REQUIRED', `${args.__tool}: an approved action must get past the destructive check`);
}

// ── TEST 5: Actionability check on disabled element ───────────────────────
const disabledActionRes = await ssWebUnitInteract({
  __tool: 'web_type',
  selector: '#disabled-input',
  text: 'test',
  timeoutMs: 100,
});
assert.equal(disabledActionRes.ok, false);
assert.equal(disabledActionRes.code, 'NOT_ACTIONABLE');

// ── TEST 6: Strict mode in web-unit-extract (web_find) ────────────────────
const strictFind = await ssWebUnitExtract({
  __tool: 'web_find',
  selector: 'button',
  strict: true,
});
assert.equal(strictFind.ok, false);
assert.equal(strictFind.code, 'STRICT_MODE_VIOLATION');

// ── TEST 7: Scoped >> Chaining in web-unit-agent (web_actionable) ─────────
const actionableRes = await ssWebUnitAgent({
  __tool: 'web_actionable',
  selector: '#modal >> testid=confirm-btn',
  timeoutMs: 100,
});
assert.equal(actionableRes.ok, true);
assert.equal(actionableRes.data.actionable, true);

// ── TEST 8: Strict mode in web_fill ───────────────────────────────────────
const strictFill = await ssWebUnitAgent({
  __tool: 'web_fill',
  selector: 'input',
  value: 'test',
  strict: true,
  timeoutMs: 100,
});
assert.equal(strictFill.ok, false);
assert.equal(strictFill.code, 'STRICT_MODE_VIOLATION');

// ── TEST 9: Dry-run in web_fill ───────────────────────────────────────────
const dryFill = await ssWebUnitAgent({
  __tool: 'web_fill',
  selector: '#email',
  value: 'alice@example.test',
  dryRun: true,
  timeoutMs: 100,
});
assert.equal(dryFill.ok, true);
assert.equal(dryFill.data.dryRun, true);
assert.equal(dryFill.data.value, 'alice@example.test');

console.log('[test] locators.test.js: ALL 9 PLAYWRIGHT LOCATOR & ACTIONABILITY ASSERTIONS PASSED!');
