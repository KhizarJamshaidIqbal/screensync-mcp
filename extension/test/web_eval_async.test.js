// Regression test for web_eval's async/Promise/await handling (Bug: a returned Promise used to
// serialize to "{}", a top-level `await` threw a SyntaxError, and the CDP path never actually
// awaited anything). Exercises cdpEvalExpression (web-adv-eval.js), the function web-adv.js's
// `web_eval` case now calls as its primary evaluator, through a fake CDP transport that runs the
// wrapped expression with real Node `eval` so Promise/await semantics are genuine, not simulated.
import assert from 'node:assert/strict';
import { createChromeMock } from './harness.js';

globalThis.chrome = createChromeMock();
globalThis.chrome.debugger = {
  attach: async () => {},
  detach: async () => {},
  sendCommand: async (_target, method, params = {}) => {
    if (method === 'Target.setAutoAttach' || method === 'Page.enable' || method === 'Page.setInterceptFileChooserDialog') {
      return {};
    }
    if (method === 'Runtime.evaluate') {
      try {
        // Test-only stand-in for the real CDP Runtime.evaluate.
        let value = (0, eval)(params.expression);
        if (params.awaitPromise) value = await value;
        return { result: { value, type: typeof value } };
      } catch (e) {
        return { exceptionDetails: { text: 'Uncaught ' + ((e && e.name) || 'Error') + ': ' + ((e && e.message) || String(e)) } };
      }
    }
    throw new Error('Unhandled chrome.debugger.sendCommand method: ' + method);
  },
};

const { cdpEvalExpression } = await import('../lib/web-adv-eval.js');
const tab = { id: 1 };

// 1. A Promise-returning expression resolves to its actual value, not "{}".
{
  const res = await cdpEvalExpression(tab, 'Promise.resolve(42)');
  assert.equal(res.ok, true, 'promise expression should succeed: ' + res.error);
  assert.equal(res.data.result, 42, 'promise result must be the resolved value, not {}');
}

// 2. A top-level `await` works (previously a SyntaxError in both `new Function` attempts).
{
  const res = await cdpEvalExpression(tab, "await Promise.resolve('async-ok')");
  assert.equal(res.ok, true, 'top-level await should succeed: ' + res.error);
  assert.equal(res.data.result, 'async-ok');
}

// 3. Multi-statement code with `const` declarations and an explicit `return` at the end.
{
  const res = await cdpEvalExpression(tab, 'const a = 1; const b = 2; return a + b;');
  assert.equal(res.ok, true, 'multi-statement code with explicit return should succeed: ' + res.error);
  assert.equal(res.data.result, 3);
}

// Backward compatibility: a plain single expression (the common case today) keeps working.
{
  const res = await cdpEvalExpression(tab, '1 + 1');
  assert.equal(res.ok, true, 'plain expression should still succeed: ' + res.error);
  assert.equal(res.data.result, 2);
}

// A genuine runtime error (not a wrapping-syntax mismatch) must surface, not be swallowed by the
// expression/statement-body retry.
{
  const res = await cdpEvalExpression(tab, 'thisVariableDoesNotExist');
  assert.equal(res.ok, false, 'a reference error must not be reported as success');
  assert.match(res.error, /ReferenceError/i);
}

console.log('[test] web_eval_async.test.js: ALL ASSERTIONS PASSED');
