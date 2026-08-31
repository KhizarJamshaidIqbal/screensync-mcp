// Advanced Playwright-grade web tools. Page-side units are fully
// self-contained (chrome.scripting.executeScript serializes them, so no
// outer-scope references); MAIN-world units install idempotent hooks that
// buffer console/network/dialog activity on window globals, read back by a
// second MAIN-world injection. SW-side executors are exported for the
// executeWebTool dispatch in web-tools.js.

// ── Page-side units (MAIN world) ──

function ssInstallHooks() {
  if (window.__ssHooksInstalled) return { ok: true, data: { already: true } };
  window.__ssHooksInstalled = true;
  window.__ssConsoleBuffer = [];
  window.__ssNetworkBuffer = [];
  window.__ssDialogBuffer = [];
  window.__ssSeq = { console: 0, network: 0, dialog: 0 };
  const cap = (a) => { while (a.length > 200) a.shift(); };
  const text = (v) => {
    if (typeof v === 'string') return v.slice(0, 500);
    try { return JSON.stringify(v).slice(0, 500); } catch { return String(v).slice(0, 500); }
  };
  ['log', 'info', 'warn', 'error', 'debug'].forEach((level) => {
    const orig = console[level] ? console[level].bind(console) : null;
    console[level] = (...a) => {
      window.__ssConsoleBuffer.push({ id: ++window.__ssSeq.console, level, ts: Date.now(), text: a.map(text).join(' ') });
      cap(window.__ssConsoleBuffer);
      if (orig) orig(...a);
    };
  });
  window.addEventListener('error', (e) => {
    window.__ssConsoleBuffer.push({ id: ++window.__ssSeq.console, level: 'pageerror', ts: Date.now(), text: `${e.message} @ ${(e.filename || '').split('/').pop()}:${e.lineno}` });
    cap(window.__ssConsoleBuffer);
  });
  window.addEventListener('unhandledrejection', (e) => {
    window.__ssConsoleBuffer.push({ id: ++window.__ssSeq.console, level: 'pageerror', ts: Date.now(), text: 'unhandledrejection: ' + text(e.reason) });
    cap(window.__ssConsoleBuffer);
  });
  const of = window.fetch ? window.fetch.bind(window) : null;
  if (of) {
    window.fetch = async (...a) => {
      const t0 = Date.now();
      const r0 = a[0];
      const rec = {
        id: 0,
        method: String(((typeof a[1] === 'object' && a[1] && a[1].method) || (typeof r0 === 'object' && r0 && r0.method) || 'GET')).toUpperCase(),
        url: String(typeof r0 === 'string' ? r0 : (r0 && r0.url) || String(r0)).slice(0, 300),
        status: 0, durationMs: 0, ts: t0,
      };
      try {
        const res = await of(...a);
        rec.id = ++window.__ssSeq.network; rec.status = res.status; rec.durationMs = Date.now() - t0;
        window.__ssNetworkBuffer.push(rec); cap(window.__ssNetworkBuffer);
        return res;
      } catch (err) {
        rec.id = ++window.__ssSeq.network; rec.error = String((err && err.message) || err).slice(0, 200); rec.durationMs = Date.now() - t0;
        window.__ssNetworkBuffer.push(rec); cap(window.__ssNetworkBuffer);
        throw err;
      }
    };
  }
  if (window.XMLHttpRequest) {
    const oo = XMLHttpRequest.prototype.open;
    const os = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function (m, u, ...rest) {
      this.__ssRec = { method: String(m || 'GET').toUpperCase(), url: String(u || '').slice(0, 300) };
      return oo.call(this, m, u, ...rest);
    };
    XMLHttpRequest.prototype.send = function (...a) {
      const t0 = Date.now();
      const rec = this.__ssRec || { method: 'GET', url: '' };
      rec.ts = t0; rec.status = 0;
      this.addEventListener('loadend', () => {
        rec.id = ++window.__ssSeq.network; rec.status = this.status; rec.durationMs = Date.now() - t0;
        window.__ssNetworkBuffer.push(rec); cap(window.__ssNetworkBuffer);
      });
      return os.apply(this, a);
    };
  }
  // Dialogs are intercepted and auto-handled so pages never block on a human.
  window.alert = (m) => {
    window.__ssDialogBuffer.push({ id: ++window.__ssSeq.dialog, type: 'alert', message: String(m).slice(0, 300), result: 'dismissed', ts: Date.now() });
    cap(window.__ssDialogBuffer);
  };
  window.confirm = (m) => {
    window.__ssDialogBuffer.push({ id: ++window.__ssSeq.dialog, type: 'confirm', message: String(m).slice(0, 300), result: true, ts: Date.now() });
    cap(window.__ssDialogBuffer);
    return true;
  };
  window.prompt = (m, d) => {
    window.__ssDialogBuffer.push({ id: ++window.__ssSeq.dialog, type: 'prompt', message: String(m).slice(0, 300), result: d || '', ts: Date.now() });
    cap(window.__ssDialogBuffer);
    return d || '';
  };
  return { ok: true, data: { installed: true } };
}

function ssReadBuffer(args) {
  const kind = args.kind === 'network' ? 'Network' : args.kind === 'dialog' ? 'Dialog' : 'Console';
  const buf = window['__ss' + kind + 'Buffer'] || [];
  const since = Number(args.sinceCursor) || 0;
  let entries = buf.filter((e) => e.id > since);
  if (args.level && kind === 'Console') entries = entries.filter((e) => e.level === args.level);
  const cursor = buf.length ? buf[buf.length - 1].id : since;
  if (args.clear) buf.length = 0;
  return { ok: true, data: { entries, cursor, buffered: buf.length } };
}

function ssEval(args) {
  // Trust boundary: compiling the expression IS the feature (the user-approved
  // agent's page.evaluate, like Playwright's). The string arrives only via the
  // authenticated hub SSE channel gated by the webAccessEnabled toggle — never
  // from page content — so there is no injection amplification path here.
  const expr = String(args.expression || '');
  if (!expr) return { ok: false, error: 'expression is required' };
  let v;
  try {
    v = new Function('return (' + expr + ')')();
  } catch {
    try { v = new Function(expr)(); } catch (e2) {
      return { ok: false, error: 'eval error: ' + String((e2 && e2.message) || e2) };
    }
  }
  let safe;
  try { safe = JSON.parse(JSON.stringify(v)); } catch { safe = String(v); }
  return { ok: true, data: { result: safe, type: typeof v } };
}

function ssStorage(args) {
  const action = args.action || 'get';
  const type = args.type || 'local';
  if (type === 'cookie') {
    const cookies = document.cookie
      ? document.cookie.split('; ').map((c) => { const i = c.indexOf('='); return { name: c.slice(0, i), value: c.slice(i + 1) }; })
      : [];
    return { ok: true, data: { cookies, note: 'httpOnly cookies are not visible to page scripts' } };
  }
  const store = type === 'session' ? sessionStorage : localStorage;
  if (action === 'set') {
    if (!args.key) return { ok: false, error: 'key is required' };
    store.setItem(args.key, String(args.value ?? ''));
    return { ok: true, data: { set: args.key } };
  }
  if (action === 'clear') { store.clear(); return { ok: true, data: { cleared: type } }; }
  if (args.key) return { ok: true, data: { key: args.key, value: store.getItem(args.key) } };
  const values = {};
  Object.keys(store).slice(0, 100).forEach((k) => { values[k] = String(store.getItem(k)).slice(0, 500); });
  return { ok: true, data: { values, count: Object.keys(store).length } };
}

function ssPerf() {
  const g = (t) => performance.getEntriesByType(t) || [];
  const nav = g('navigation')[0];
  const paint = g('paint');
  const lcp = g('largest-contentful-paint');
  const shifts = g('layout-shift').filter((s) => !s.hadRecentInput);
  const fcp = paint.find((p) => p.name === 'first-contentful-paint');
  const r = (x) => (x ? Math.round(x) : null);
  return {
    ok: true,
    data: {
      domContentLoadedMs: r(nav && nav.domContentLoadedEventEnd),
      loadMs: r(nav && nav.loadEventEnd),
      fcpMs: r(fcp && fcp.startTime),
      lcpMs: r(lcp.length ? lcp[lcp.length - 1].startTime : null),
      cls: +shifts.reduce((s, e) => s + e.value, 0).toFixed(4),
      resourceCount: g('resource').length,
      slowestResources: g('resource').sort((a, b) => b.duration - a.duration).slice(0, 5)
        .map((e) => ({ url: String(e.name).slice(0, 120), ms: Math.round(e.duration) })),
    },
  };
}

// ── Page-side units (ISOLATED world) ──

function ssWaitFor(args) {
  const timeoutMs = Math.min(Number(args.timeoutMs) || 5000, 15000);
  const t0 = Date.now();
  const found = () => {
    if (args.selector) return !!document.querySelector(args.selector);
    if (args.text) return ((document.body && document.body.innerText) || '').includes(args.text);
    return false;
  };
  return new Promise((resolve) => {
    const tick = () => {
      if (found()) { resolve({ ok: true, data: { found: true, waitedMs: Date.now() - t0 } }); return; }
      if (Date.now() - t0 >= timeoutMs) { resolve({ ok: false, error: `Timed out after ${timeoutMs}ms waiting for ${args.selector || args.text || 'condition'}` }); return; }
      setTimeout(tick, 100);
    };
    tick();
  });
}

function ssKey(args) {
  const key = String(args.key || '');
  if (!key) return { ok: false, error: 'key is required' };
  const el = (document.activeElement && document.activeElement !== document.body)
    ? document.activeElement
    : (document.querySelector('input,textarea,select,[contenteditable]') || document.body);
  const codes = { Enter: 13, Tab: 9, Escape: 27, Backspace: 8, ArrowUp: 38, ArrowDown: 40, ArrowLeft: 37, ArrowRight: 39, Space: 32 };
  const kc = codes[key] || (key.length === 1 ? key.charCodeAt(0) : 0);
  const init = { key, keyCode: kc, which: kc, bubbles: true, cancelable: true };
  el.dispatchEvent(new KeyboardEvent('keydown', init));
  el.dispatchEvent(new KeyboardEvent('keyup', init));
  let submitted = false;
  if (key === 'Enter' && el.form) {
    try { el.form.requestSubmit(); submitted = true; } catch {
      try { el.form.submit(); submitted = true; } catch { /* unsubmitable */ }
    }
  }
  return { ok: true, data: { key, target: el.tagName, submitted } };
}

function ssHover(args) {
  let el = null;
  if (args.selector) el = document.querySelector(args.selector);
  else if (args.text) {
    const all = [...document.querySelectorAll('a,button,[role="button"],span,div,li,label')];
    el = all.find((n) => ((n.textContent || '').trim().toLowerCase().includes(String(args.text).toLowerCase()))) || null;
  } else if (typeof args.index === 'number') {
    el = [...document.querySelectorAll('a,button,input,select,textarea,[role="button"]')][args.index] || null;
  }
  if (!el) return { ok: false, error: 'No element matched for hover' };
  el.scrollIntoView({ block: 'center' });
  const r = el.getBoundingClientRect();
  const opts = { bubbles: true, cancelable: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 };
  el.dispatchEvent(new MouseEvent('mouseover', opts));
  el.dispatchEvent(new MouseEvent('mouseenter', Object.assign({}, opts, { bubbles: false })));
  el.dispatchEvent(new MouseEvent('mousemove', opts));
  return { ok: true, data: { hovered: true, tag: el.tagName, text: (el.textContent || '').trim().slice(0, 60) } };
}

function ssSelect(args) {
  const el = args.selector ? document.querySelector(args.selector) : document.querySelector('select');
  if (!el || el.tagName !== 'SELECT') return { ok: false, error: 'No <select> matched' };
  const want = String(args.value ?? '');
  const opt = [...el.options].find((o) => o.value === want)
    || [...el.options].find((o) => (o.textContent || '').trim().toLowerCase() === want.toLowerCase());
  if (!opt) return { ok: false, error: `No option matches "${want}"` };
  el.value = opt.value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  return { ok: true, data: { selected: (opt.textContent || '').trim(), value: opt.value } };
}

// ── SW-side executors ──

async function runScript(tab, func, args, world) {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id }, func, args: [args], ...(world ? { world } : {}),
    });
    return (results && results[0] && results[0].result) || { ok: false, error: 'Injection returned no result.' };
  } catch (e) {
    return { ok: false, error: `Cannot access that page: ${String((e && e.message) || e)}` };
  }
}

const main = (tab, func, args) => runScript(tab, func, args, 'MAIN');
const isolated = (tab, func, args) => runScript(tab, func, args, null);

export function ensureHooks(tab) { return main(tab, ssInstallHooks, {}); }

export async function execAdvTool(tool, tab, args) {
  switch (tool) {
    case 'web_eval': return main(tab, ssEval, args);
    case 'web_console': await ensureHooks(tab); return main(tab, ssReadBuffer, { ...args, kind: 'console' });
    case 'web_network': await ensureHooks(tab); return main(tab, ssReadBuffer, { ...args, kind: 'network' });
    case 'web_dialog': await ensureHooks(tab); return main(tab, ssReadBuffer, { ...args, kind: 'dialog' });
    case 'web_storage': return main(tab, ssStorage, args);
    case 'web_perf': return main(tab, ssPerf, args);
    case 'web_wait_for': return isolated(tab, ssWaitFor, args);
    case 'web_key': return isolated(tab, ssKey, args);
    case 'web_hover': return isolated(tab, ssHover, args);
    case 'web_select': return isolated(tab, ssSelect, args);
    default: return { ok: false, error: `Unknown advanced tool: ${tool}` };
  }
}
