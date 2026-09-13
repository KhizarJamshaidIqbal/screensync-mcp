// ScreenSync CDP evaluation executors — cdpEval fallback and the CSP-proof
// web_run_code (Runtime.evaluate with inlined user code).
import { rawAttach, rawDetach } from './web-adv-core.js';
export async function cdpEval(tab, args = {}) {
  const target = { tabId: tab.id };
  let attached = false;
  try {
    await rawAttach(target);
    attached = true;
  } catch (e) {
    if (String((e && e.message) || e).includes('Already attached')) attached = true;
    else return { ok: false, error: `CDP attach failed: ${String((e && e.message) || e)}` };
  }
  try {
    const expression = String(args.expression || args.script || '');
    const res = await chrome.debugger.sendCommand(target, 'Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
      userGesture: true,
    });
    if (res.exceptionDetails) {
      return { ok: false, error: res.exceptionDetails.text || (res.exceptionDetails.exception && res.exceptionDetails.exception.description) || 'Execution exception' };
    }
    return { ok: true, data: { result: res.result ? res.result.value : null, type: res.result ? res.result.type : 'undefined' } };
  } catch (err) {
    return { ok: false, error: `CDP evaluate error: ${String((err && err.message) || err)}` };
  } finally {
    if (attached) {
      await rawDetach(target);
    }
  }
}


export async function cdpRunCode(tab, args) {
  const code = String(args.code || '');
  if (!code.trim()) return { ok: false, error: 'run_code requires code.' };
  const timeoutMs = Math.min(Number(args.timeoutMs) || 8000, 30000);
  const expression = `(async () => {
    const ctx = {
      find: (sel) => document.querySelector(sel),
      findAll: (sel) => { try { return Array.from(document.querySelectorAll(sel)); } catch { return []; } },
      click: (sel) => { const el = document.querySelector(sel); if (!el) throw new Error('not found: ' + sel); el.scrollIntoView({ block: 'center' }); el.click(); return true; },
      fill: (sel, text) => { const el = document.querySelector(sel); if (!el) throw new Error('not found: ' + sel); el.focus(); const p = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; const d = Object.getOwnPropertyDescriptor(p, 'value'); if (d && d.set) d.set.call(el, String(text)); else el.value = String(text); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); return true; },
      text: (sel) => { const el = document.querySelector(sel); return el ? (el.innerText || el.textContent || '') : null; },
      attr: (sel, name) => { const el = document.querySelector(sel); return el ? el.getAttribute(name) : null; },
      waitFor: (sel, ms = 3000) => new Promise((resolve, reject) => { const t0 = Date.now(); (function poll() { const el = document.querySelector(sel); if (el) return resolve(el); if (Date.now() - t0 > ms) return reject(new Error('waitFor timeout: ' + sel)); setTimeout(poll, 120); })(); }),
      url: () => location.href,
      title: () => document.title,
    };
    "use strict";
    ${code}
  })()`;
  const target = { tabId: tab.id };
  let attachedHere = false;
  try {
    try {
      await rawAttach(target);
      attachedHere = true;
    } catch (e) {
      if (!/already attached/i.test(String((e && e.message) || e))) throw e;
    }
    const evalRes = await Promise.race([
      chrome.debugger.sendCommand(target, 'Runtime.evaluate', {
        expression,
        awaitPromise: true,
        returnByValue: true,
        userGesture: true,
      }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('run_code timed out after ' + timeoutMs + 'ms')), timeoutMs)),
    ]);
    if (evalRes && evalRes.exceptionDetails) {
      const d = evalRes.exceptionDetails;
      const msg = (d.exception && (d.exception.description || d.exception.value)) || d.text || 'Unknown error';
      return { ok: false, error: 'run_code failed: ' + String(msg).split('\n')[0] };
    }
    const value = evalRes && evalRes.result ? evalRes.result.value : undefined;
    let safe = value;
    try { safe = JSON.parse(JSON.stringify(value === undefined ? null : value)); } catch { safe = String(value); }
    return { ok: true, data: { result: safe } };
  } catch (e) {
    return { ok: false, error: 'run_code failed: ' + String((e && e.message) || e) };
  } finally {
    if (attachedHere) { await rawDetach(target); }
  }
}

// ── web_trace_record: CDP Tracing — real Chrome performance trace ──────────
