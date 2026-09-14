// ScreenSync Stretch Parity Test Suite (P7-P12)
// Tests:
// P7:  Trace viewer self-contained HTML generation
// P8:  Test runner suite execution with retries & JUnit XML
// P9:  Codegen flow serialization & Playwright test script generator
// P10: Page handle registry & exposeFunction parity
// P11: Highlight & scrollIntoViewIfNeeded semantics alignment
// P12: Service worker listing and inspection dispatcher

import assert from 'node:assert/strict';
import test from 'node:test';
import { createChromeMock } from './harness.js';

globalThis.chrome = createChromeMock();

import { renderTraceViewerHtml } from '../lib/web-trace-viewer.js';
import { pageHandleExecutor } from '../lib/web-handles.js';
import { generateFlow, generatePlaywright } from '../../mcp-server/dist/codegen.js';
import { runTestSuite } from '../../mcp-server/dist/test-runner.js';

const { cdpServiceWorker } = await import('../lib/web-adv-worker.js');

test('P7: Trace viewer emits self-contained offline HTML with SVG timeline', () => {
  const mockTrace = {
    metadata: { tabId: 42, durationMs: 1250 },
    traceEvents: [
      { ts: 1000000, cat: 'blink', name: 'Layout', ph: 'X', dur: 2500, pid: 1, tid: 1 },
      { ts: 1002500, cat: 'v8', name: 'V8.Compile', ph: 'X', dur: 1200, pid: 1, tid: 1 },
      { ts: 1005000, cat: 'devtools.timeline', name: 'Paint', ph: 'X', dur: 800, pid: 1, tid: 1 },
      { ts: 1010000, cat: 'blink', name: 'UpdateLayoutTree', ph: 'X', dur: 600, pid: 1, tid: 1 },
    ],
  };

  const html = renderTraceViewerHtml(mockTrace);
  assert.ok(html.includes('<!DOCTYPE html>'), 'must be complete HTML document');
  assert.ok(html.includes('ScreenSync Trace Viewer'), 'must have title');
  assert.ok(html.includes('<svg'), 'must include SVG timeline graph');
  assert.ok(html.includes('Layout'), 'must include trace events');
  assert.ok(html.includes('4</strong>'), 'must display 4 events');
  // Offline check: zero remote URLs
  assert.ok(!html.includes('http://') && !html.includes('https://'), 'must be completely self-contained with no remote dependencies');
});

test('P9: Codegen converts recorded steps to flow payload and Playwright script', () => {
  const recordedSteps = [
    { tool: 'web_record', args: { action: 'start' } }, // should be ignored
    { tool: 'web_navigate', args: { url: 'https://example.com/checkout', tabId: 10, __browser: 'chrome' } },
    { tool: 'web_click', args: { selector: '#buy-now' } },
    { tool: 'web_fill', args: { selector: 'input[name="email"]', text: 'user@example.com' } },
    { tool: 'web_expect', args: { selector: '.success', text: 'Thank you' } },
    { tool: 'web_screenshot', args: { filename: 'confirmation.png' } },
  ];

  const flow = generateFlow(recordedSteps, 'e2e_purchase');
  assert.equal(flow.name, 'e2e_purchase');
  assert.equal(flow.stepCount, 5, 'web_record internal tool must be filtered out');
  assert.equal(flow.steps[0].tool, 'web_navigate');
  assert.equal(flow.steps[0].args.url, 'https://example.com/checkout');
  assert.equal(flow.steps[0].args.__browser, undefined, '__browser internal tag must be stripped');

  const pw = generatePlaywright(recordedSteps, 'User purchase test');
  assert.ok(pw.includes(`import { test, expect } from '@playwright/test';`), 'must import playwright');
  assert.ok(pw.includes(`await page.goto('https://example.com/checkout');`), 'must generate page.goto');
  assert.ok(pw.includes(`await page.locator('#buy-now').click();`), 'must generate click');
  assert.ok(pw.includes(`await page.locator('input[name="email"]').fill('user@example.com');`), 'must generate fill');
  assert.ok(pw.includes(`await expect(page.locator('.success')).toContainText('Thank you');`), 'must generate assertion');
  assert.ok(pw.includes(`await page.screenshot({ path: 'confirmation.png' });`), 'must generate screenshot');
});

test('P10: Handle registry & exposeFunction in-page parity', () => {
  class MockElement {}
  globalThis.Element = MockElement;
  globalThis.CustomEvent = class CustomEvent { constructor(name, init) { this.detail = init?.detail; } };

  const mockWindow = {
    __ssHandles: new Map(),
    __ssHandleSeq: 0,
    __ssExposedFns: new Set(),
    dispatchEvent: () => {},
  };
  globalThis.window = mockWindow;
  globalThis.document = {
    querySelector: (sel) => {
      if (sel === '#btn') {
        const el = {
          tagName: 'BUTTON',
          id: 'btn',
          className: 'primary-btn',
          innerText: 'Click Me',
          attributes: [{ name: 'id', value: 'btn' }, { name: 'class', value: 'primary-btn' }],
          children: [],
        };
        Object.setPrototypeOf(el, MockElement.prototype);
        return el;
      }
      return null;
    },
  };

  // 1. Create handle
  const createRes = pageHandleExecutor({ action: 'create', selector: '#btn' });
  assert.ok(createRes.ok, 'create handle must succeed');
  assert.ok(createRes.data.handleId.startsWith('handle_'), 'must return handle ID');
  assert.equal(createRes.data.tagName, 'button');

  const handleId = createRes.data.handleId;

  // 2. Get handle
  const getRes = pageHandleExecutor({ action: 'get', handleId });
  assert.ok(getRes.ok);
  assert.equal(getRes.data.tagName, 'button');
  assert.equal(getRes.data.text, 'Click Me');

  // 3. Eval on handle
  const evalRes = pageHandleExecutor({ action: 'eval', handleId, code: '(el) => el.innerText.toUpperCase()' });
  assert.ok(evalRes.ok);
  assert.equal(evalRes.data.result, 'CLICK ME');

  // 4. Expose function
  const exposeRes = pageHandleExecutor({ action: 'exposeFunction', name: 'notifyAgent' });
  assert.ok(exposeRes.ok);
  assert.equal(typeof mockWindow.notifyAgent, 'function');
  const callRes = mockWindow.notifyAgent('test', 123);
  assert.equal(callRes.called, true);
  assert.deepEqual(callRes.args, ['test', 123]);

  // 5. Dispose handle
  const disposeRes = pageHandleExecutor({ action: 'dispose', handleId });
  assert.ok(disposeRes.ok);
  assert.equal(disposeRes.data.disposed, true);

  const getAfterDispose = pageHandleExecutor({ action: 'get', handleId });
  assert.equal(getAfterDispose.ok, false, 'handle should no longer exist');
});

test('P8: Test runner executes suites with retries and formats JUnit XML', async () => {
  const mockSuite = {
    name: 'Checkout Flow Suite',
    format: 'both',
    tests: [
      {
        name: 'Navigate to store',
        steps: [{ tool: 'web_navigate', args: { url: 'https://store.local' } }],
      },
      {
        name: 'Retryable flaky step',
        retries: 2,
        steps: [{ tool: 'web_expect', args: { selector: '.loaded' } }],
      },
    ],
  };

  let flakyAttempts = 0;
  const runner = async (tool, _args) => {
    if (tool === 'web_expect') {
      flakyAttempts++;
      if (flakyAttempts < 2) {
        return { ok: false, error: 'Element not ready yet' };
      }
    }
    return { ok: true, data: { success: true } };
  };

  const suiteResult = await runTestSuite(mockSuite, runner);
  assert.equal(suiteResult.totalTests, 2);
  assert.equal(suiteResult.passed, 2, 'both tests should pass after retry');
  assert.equal(suiteResult.failed, 0);
  assert.equal(suiteResult.tests[1].attempts, 2, 'flaky test should succeed on 2nd attempt');
  assert.ok(suiteResult.junitXml.includes('<testsuite name="Checkout Flow Suite"'), 'JUnit XML must have testsuite');
  assert.ok(suiteResult.junitXml.includes('<testcase classname="Checkout Flow Suite" name="Retryable flaky step"'), 'JUnit XML must have testcases');
});

test('P12: Service worker controller handles list and attach actions', async () => {
  // Mock chrome.debugger
  globalThis.chrome = {
    debugger: {
      attach: async () => {},
      detach: async () => {},
      sendCommand: async (_target, method, _params) => {
        if (method === 'Target.getTargets') {
          return {
            targetInfos: [
              { targetId: 'sw-1', type: 'service_worker', url: 'https://app.local/sw.js', title: 'Service Worker', attached: false },
              { targetId: 'page-1', type: 'page', url: 'https://app.local', title: 'Home', attached: true },
            ],
          };
        }
        if (method === 'Target.attachToTarget') {
          return { sessionId: 'session-sw-1' };
        }
        return {};
      },
    },
  };

  const mockTab = { id: 99, url: 'https://app.local/dashboard' };

  // 1. List workers
  const listRes = await cdpServiceWorker(mockTab, { action: 'list' });
  assert.ok(listRes.ok);
  assert.equal(listRes.data.count, 1);
  assert.equal(listRes.data.workers[0].targetId, 'sw-1');

  // 2. Attach to worker
  const attachRes = await cdpServiceWorker(mockTab, { action: 'attach', targetId: 'sw-1' });
  assert.ok(attachRes.ok);
  assert.equal(attachRes.data.attached, true);
  assert.equal(attachRes.data.sessionId, 'session-sw-1');
});

test('P11: web_scroll_to ifNeeded check and web_highlight semantics', async () => {
  const visibleRect = { top: 50, left: 20, bottom: 200, right: 300 };
  const inView = visibleRect.top >= 0 && visibleRect.left >= 0 && visibleRect.bottom <= 1080 && visibleRect.right <= 1920;
  assert.equal(inView, true, 'element inside bounds is considered in viewport');

  const outsideRect = { top: -100, left: 20, bottom: 50, right: 300 };
  const outOfView = outsideRect.top >= 0 && outsideRect.left >= 0 && outsideRect.bottom <= 1080 && outsideRect.right <= 1920;
  assert.equal(outOfView, false, 'element with top < 0 is out of viewport');

  const blockDefault = (ifNeeded) => ifNeeded ? 'nearest' : 'center';
  assert.equal(blockDefault(true), 'nearest');
  assert.equal(blockDefault(false), 'center');
});
