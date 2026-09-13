import { ssWebUnitInteract, ssWebUnitExtract } from './web-unit.js';

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
  const expr = String(args.expression || args.code || '');
  if (!expr) return { ok: false, error: 'expression or code is required' };
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
    if (action === 'set') {
      if (!args.key) return { ok: false, error: 'key is required for cookie set' };
      document.cookie = `${encodeURIComponent(args.key)}=${encodeURIComponent(args.value ?? '')}; path=/`;
      return { ok: true, data: { set: args.key, type: 'cookie' } };
    }
    if (action === 'clear') {
      const cookies = document.cookie ? document.cookie.split('; ') : [];
      for (const c of cookies) {
        const eq = c.indexOf('=');
        const k = eq > -1 ? c.slice(0, eq) : c;
        document.cookie = `${k}=; max-age=0; path=/`;
      }
      return { ok: true, data: { cleared: 'cookie' } };
    }
    const cookies = document.cookie
      ? document.cookie.split('; ').map((c) => { const i = c.indexOf('='); return { name: c.slice(0, i), value: c.slice(i + 1) }; })
      : [];
    if (args.key) {
      const found = cookies.find((c) => c.name === args.key);
      return { ok: true, data: { key: args.key, value: found ? found.value : null } };
    }
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

const cdpRefCounts = new Map();

export async function attachCdp(tab) {
  const target = { tabId: tab.id };
  const cur = cdpRefCounts.get(tab.id) || 0;
  cdpRefCounts.set(tab.id, cur + 1);
  if (cur > 0) return { ok: true, target };
  try {
    await rawAttach(target);
    return { ok: true, target };
  } catch (e) {
    const msg = String((e && e.message) || e);
    if (/already attached/i.test(msg)) {
      return { ok: true, target };
    }
    cdpRefCounts.set(tab.id, 0);
    return { ok: false, error: `CDP attach failed: ${msg}` };
  }
}

export async function detachCdp(tab) {
  const target = { tabId: tab.id };
  const cur = cdpRefCounts.get(tab.id) || 0;
  const next = Math.max(0, cur - 1);
  cdpRefCounts.set(tab.id, next);
  // Only physically detach when NO long-lived session (mocks, routes, dialogs,
  // websocket buffers, screencasts, coverage, HAR, trace, video, emulation) still
  // needs the debugger on this tab — otherwise a one-off CDP call kills it.
  if (next === 0 && !cdpBusy(target.tabId)) {
    await rawDetach(target);
  }
}

// Raw per-call attach/detach used by one-off CDP executors. rawAttach tolerates
// an existing session; rawDetach refuses to drop the debugger while a
// long-lived session (emulation, mocks, HAR, screencast, …) is active on the tab.
async function rawAttach(target) {
  try {
    await chrome.debugger.attach(target, '1.3');
  } catch (e) {
    if (!/already attached/i.test(String((e && e.message) || e))) throw e;
  }
}

function cdpBusy(tabId) {
  const busy = (m) => m && m.has(tabId);
  return Boolean(busy(activeMocks) || busy(activeRoutes) || busy(activeDialogRules)
    || busy(activeWsBuffers) || busy(activeScreencasts) || busy(activeCoverage)
    || busy(activeHars) || busy(activeTraces) || busy(activeVideoRecs) || busy(activeEmulations));
}

async function rawDetach(target) {
  if (cdpBusy(target.tabId)) return;
  try { await chrome.debugger.detach(target); } catch {}
}

if (chrome.tabs && chrome.tabs.onRemoved) {
  chrome.tabs.onRemoved.addListener((tabId) => {
    cdpRefCounts.delete(tabId);
  });
}

export async function cdpInput(tab, action, params = {}) {
  const target = { tabId: tab.id };
  try {
    await rawAttach(target);
  } catch (e) {
    if (!String((e && e.message) || e).includes('Already attached')) {
      return { ok: false, error: `CDP attach failed: ${String((e && e.message) || e)}` };
    }
  }
  try {
    if (action === 'click') {
      const x = Number(params.x || 0);
      const y = Number(params.y || 0);
      await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
      await new Promise((r) => setTimeout(r, 60));
      await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
      return { ok: true, data: { cdpClicked: { x, y } } };
    }
    if (action === 'type') {
      const text = String(params.text || '');
      for (const char of text) {
        if (char === '\n') {
          await chrome.debugger.sendCommand(target, 'Input.dispatchKeyEvent', { type: 'rawKeyDown', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, macCharCode: 13, unmodifiedText: '\r', text: '\r' });
          await chrome.debugger.sendCommand(target, 'Input.dispatchKeyEvent', { type: 'char', text: '\r', unmodifiedText: '\r' });
          await chrome.debugger.sendCommand(target, 'Input.dispatchKeyEvent', { type: 'keyUp', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, macCharCode: 13, unmodifiedText: '\r', text: '\r' });
        } else {
          await chrome.debugger.sendCommand(target, 'Input.dispatchKeyEvent', { type: 'keyDown', text: char, unmodifiedText: char });
          await chrome.debugger.sendCommand(target, 'Input.dispatchKeyEvent', { type: 'keyUp' });
        }
      }
      return { ok: true, data: { cdpTyped: text.length } };
    }
    return { ok: false, error: `Unknown CDP action: ${action}` };
  } catch (err) {
    return { ok: false, error: `CDP command error: ${String((err && err.message) || err)}` };
  } finally {
    await rawDetach(target);
  }
}

export async function cdpScreenshot(tab, args = {}) {
  const target = { tabId: tab.id };
  let attached = false;
  try {
    await rawAttach(target);
    attached = true;
  } catch (e) {
    if (String((e && e.message) || e).includes('Already attached')) {
      attached = true;
    } else {
      return { ok: false, error: `CDP attach failed: ${String((e && e.message) || e)}` };
    }
  }
  try {
    await chrome.debugger.sendCommand(target, 'Page.enable', {});
    const full = args.fullPage !== false;
    const format = args.format === 'png' ? 'png' : 'jpeg';
    const quality = typeof args.quality === 'number' ? Math.min(100, Math.max(1, args.quality)) : 80;
    
    const captureOpts = { format, captureBeyondViewport: full };
    if (format === 'jpeg') captureOpts.quality = quality;

    const res = await chrome.debugger.sendCommand(target, 'Page.captureScreenshot', captureOpts);
    const mime = format === 'png' ? 'image/png' : 'image/jpeg';
    const dataUrl = `data:${mime};base64,${res.data}`;
    return {
      ok: true,
      data: {
        imageDataUrl: dataUrl,
        fullPage: full,
        format,
        url: tab.url,
        title: tab.title,
      },
    };
  } catch (err) {
    return { ok: false, error: `CDP screenshot error: ${String((err && err.message) || err)}` };
  } finally {
    if (attached) {
      await rawDetach(target);
    }
  }
}

export async function cdpPdf(tab, args = {}) {
  const target = { tabId: tab.id };
  let attached = false;
  try {
    await rawAttach(target);
    attached = true;
  } catch (e) {
    if (String((e && e.message) || e).includes('Already attached')) {
      attached = true;
    } else {
      return { ok: false, error: `CDP attach failed: ${String((e && e.message) || e)}` };
    }
  }
  try {
    await chrome.debugger.sendCommand(target, 'Page.enable', {});
    const printOpts = {
      printBackground: args.printBackground !== false,
      landscape: !!args.landscape,
      paperWidth: args.paperWidth || 8.5,
      paperHeight: args.paperHeight || 11,
      marginTop: args.marginTop || 0.4,
      marginBottom: args.marginBottom || 0.4,
      marginLeft: args.marginLeft || 0.4,
      marginRight: args.marginRight || 0.4,
    };
    const res = await chrome.debugger.sendCommand(target, 'Page.printToPDF', printOpts);
    const dataUrl = `data:application/pdf;base64,${res.data}`;
    return {
      ok: true,
      data: {
        pdfDataUrl: dataUrl,
        url: tab.url,
        title: tab.title,
      },
    };
  } catch (err) {
    return { ok: false, error: `CDP PDF error: ${String((err && err.message) || err)}` };
  } finally {
    if (attached) {
      await rawDetach(target);
    }
  }
}

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

export async function cdpAXTree(tab, args = {}) {
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
    await chrome.debugger.sendCommand(target, 'Accessibility.enable', {});
    const res = await chrome.debugger.sendCommand(target, 'Accessibility.getFullAXTree', {});
    const maxNodes = Math.min(Number(args.maxNodes) || 120, 300);
    const simplified = [];

    for (const node of (res.nodes || [])) {
      if (node.ignored) continue;
      const role = node.role ? (node.role.value || node.role) : '';
      const name = node.name ? (node.name.value || node.name) : '';
      if (!role && !name) continue;
      if (['generic', 'none', 'StaticText', 'InlineTextBox', 'LineBreak'].includes(role) && !name) continue;

      const item = { role, name: String(name).slice(0, 100) };
      if (node.value && node.value.value) item.value = String(node.value.value).slice(0, 100);
      if (node.description && node.description.value) item.description = String(node.description.value).slice(0, 100);
      if (node.disabled && node.disabled.value) item.disabled = true;
      if (node.focused && node.focused.value) item.focused = true;
      if (node.expanded && node.expanded.value) item.expanded = true;

      simplified.push(item);
      if (simplified.length >= maxNodes) break;
    }

    return {
      ok: true,
      data: {
        totalNodes: (res.nodes || []).length,
        nodeCount: simplified.length,
        nodes: simplified,
        url: tab.url,
        title: tab.title,
      },
    };
  } catch (err) {
    return { ok: false, error: `CDP AXTree error: ${String((err && err.message) || err)}` };
  } finally {
    if (attached) {
      await rawDetach(target);
    }
  }
}

export async function cdpStealthCloak(tab, args = {}) {
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
    await chrome.debugger.sendCommand(target, 'Page.enable', {});
    const cloakScript = `
      try {
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined, configurable: true });
        delete Object.getPrototypeOf(navigator).webdriver;
      } catch {}
      try {
        const fakePlugins = [
          { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
          { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai', description: '' },
          { name: 'Native Client', filename: 'internal-nacl-plugin', description: '' }
        ];
        Object.defineProperty(navigator, 'plugins', { get: () => fakePlugins, configurable: true });
        Object.defineProperty(navigator, 'mimeTypes', { get: () => [
          { type: 'application/pdf', suffixes: 'pdf', description: '', enabledPlugin: fakePlugins[0] }
        ], configurable: true });
      } catch {}
      try {
        Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'], configurable: true });
      } catch {}
      try {
        if (!window.chrome) window.chrome = {};
        if (!window.chrome.runtime) {
          window.chrome.runtime = { id: 'nfdhhnbmboahhimbofhihckobhenkoij', connect: function() {}, sendMessage: function() {} };
        }
        if (!window.chrome.loadTimes) {
          window.chrome.loadTimes = function() {
            return {
              requestTime: performance.timeOrigin / 1000,
              startLoadTime: performance.timeOrigin / 1000,
              commitLoadTime: (performance.timeOrigin + 50) / 1000,
              finishDocumentLoadTime: (performance.timeOrigin + 200) / 1000,
              firstPaintTime: (performance.timeOrigin + 120) / 1000,
              finishLoadTime: (performance.timeOrigin + 300) / 1000,
              navigationType: 'Other'
            };
          };
        }
      } catch {}
      try {
        const getParameter = WebGLRenderingContext.prototype.getParameter;
        WebGLRenderingContext.prototype.getParameter = function(parameter) {
          if (parameter === 37445) return 'Google Inc. (NVIDIA)';
          if (parameter === 37446) return 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3080 Direct3D11 vs_5_0 ps_5_0, D3D11)';
          return getParameter.apply(this, arguments);
        };
        if (typeof WebGL2RenderingContext !== 'undefined') {
          const getParameter2 = WebGL2RenderingContext.prototype.getParameter;
          WebGL2RenderingContext.prototype.getParameter = function(parameter) {
            if (parameter === 37445) return 'Google Inc. (NVIDIA)';
            if (parameter === 37446) return 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3080 Direct3D11 vs_5_0 ps_5_0, D3D11)';
            return getParameter2.apply(this, arguments);
          };
        }
      } catch {}
    `;

    const scriptRes = await chrome.debugger.sendCommand(target, 'Page.addScriptToEvaluateOnNewDocument', {
      source: cloakScript,
    });
    await chrome.debugger.sendCommand(target, 'Runtime.evaluate', {
      expression: cloakScript,
      returnByValue: true,
    });

    return {
      ok: true,
      data: {
        stealthCloakActive: true,
        scriptIdentifier: scriptRes.identifier,
        spoofedFeatures: [
          'navigator.webdriver (hidden)',
          'navigator.plugins & mimeTypes (standard Chrome)',
          'navigator.languages (en-US, en)',
          'window.chrome.runtime & loadTimes',
          'WebGL UNMASKED_VENDOR & RENDERER'
        ],
        url: tab.url,
        title: tab.title,
      },
    };
  } catch (err) {
    return { ok: false, error: `Stealth cloak error: ${String((err && err.message) || err)}` };
  } finally {
    if (attached) {
      await rawDetach(target);
    }
  }
}

export async function cdpExportHar(tab, args = {}) {
  await ensureHooks(tab);
  const bufRes = await main(tab, ssReadBuffer, { kind: 'network', clear: !!args.clear });
  const entries = (bufRes && bufRes.data && bufRes.data.entries) || [];
  
  const harEntries = entries.map((e, idx) => {
    const startedDateTime = new Date(e.ts || Date.now()).toISOString();
    const time = e.durationMs || 0;
    return {
      pageref: 'page_1',
      startedDateTime,
      time,
      request: {
        method: e.method || 'GET',
        url: e.url || '',
        httpVersion: 'HTTP/1.1',
        cookies: [],
        headers: [],
        queryString: [],
        headersSize: -1,
        bodySize: -1,
      },
      response: {
        status: e.status || (e.error ? 0 : 200),
        statusText: e.error ? 'Error' : 'OK',
        httpVersion: 'HTTP/1.1',
        cookies: [],
        headers: [],
        content: {
          size: 0,
          mimeType: 'application/json',
          text: e.error || '',
        },
        redirectURL: '',
        headersSize: -1,
        bodySize: -1,
      },
      cache: {},
      timings: { send: 0, wait: time, receive: 0 },
      connection: String(idx + 1),
    };
  });

  const har = {
    log: {
      version: '1.2',
      creator: { name: 'ScreenSync MCP', version: '1.1.0' },
      browser: { name: 'Chrome', version: navigator.userAgent },
      pages: [{ startedDateTime: new Date().toISOString(), id: 'page_1', title: tab.title || '', pageTimings: { onContentLoad: -1, onLoad: -1 } }],
      entries: harEntries,
    },
  };

  return {
    ok: true,
    data: {
      har,
      totalEntries: harEntries.length,
      url: tab.url,
      title: tab.title,
    },
  };
}

export async function cdpHumanMouse(tab, args = {}) {
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
    const targetX = Number(args.x || 0);
    const targetY = Number(args.y || 0);
    const startX = typeof args.startX === 'number' ? args.startX : Math.floor(Math.random() * 200 + 100);
    const startY = typeof args.startY === 'number' ? args.startY : Math.floor(Math.random() * 200 + 100);
    const steps = Math.min(Math.max(Number(args.steps) || 20, 10), 60);
    const action = String(args.action || 'click');

    const dx = targetX - startX;
    const dy = targetY - startY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const nx = -dy / (dist || 1);
    const ny = dx / (dist || 1);
    const arcDeviation = (Math.random() - 0.5) * Math.min(dist * 0.4, 120);

    const cp1x = startX + dx * 0.25 + nx * arcDeviation;
    const cp1y = startY + dy * 0.25 + ny * arcDeviation;
    const cp2x = startX + dx * 0.75 + nx * (arcDeviation * 0.6);
    const cp2y = startY + dy * 0.75 + ny * (arcDeviation * 0.6);

    const trajectory = [];
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const easeT = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
      const u = 1 - easeT;
      const tt = easeT * easeT;
      const uu = u * u;
      const uuu = uu * u;
      const ttt = tt * easeT;

      let x = uuu * startX + 3 * uu * easeT * cp1x + 3 * u * tt * cp2x + ttt * targetX;
      let y = uuu * startY + 3 * uu * easeT * cp1y + 3 * u * tt * cp2y + ttt * targetY;

      if (i > 0 && i < steps) {
        x += (Math.random() - 0.5) * 1.5;
        y += (Math.random() - 0.5) * 1.5;
      }
      trajectory.push({ x: Math.round(x), y: Math.round(y) });
    }

    for (const pt of trajectory) {
      await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', {
        type: 'mouseMoved',
        x: pt.x,
        y: pt.y,
      });
      await new Promise((r) => setTimeout(r, Math.floor(Math.random() * 6 + 4)));
    }

    if (action === 'click') {
      await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', {
        type: 'mousePressed',
        x: targetX,
        y: targetY,
        button: 'left',
        clickCount: 1,
      });
      await new Promise((r) => setTimeout(r, Math.floor(Math.random() * 40 + 50)));
      await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', {
        type: 'mouseReleased',
        x: targetX,
        y: targetY,
        button: 'left',
        clickCount: 1,
      });
    }

    return {
      ok: true,
      data: {
        action,
        start: { x: startX, y: startY },
        target: { x: targetX, y: targetY },
        stepsDispatched: trajectory.length,
        durationEstimatedMs: trajectory.length * 8 + 60,
      },
    };
  } catch (err) {
    return { ok: false, error: `Human mouse dispatch error: ${String((err && err.message) || err)}` };
  } finally {
    if (attached) {
      await rawDetach(target);
    }
  }
}

const activeMocks = new Map();
const activeRoutes = new Map(); // tabId -> Array<{ pattern, mode, response, headers, postData, errorReason }>
const activeDialogRules = new Map(); // tabId -> { rule, promptText }
const activeWsBuffers = new Map(); // tabId -> Array<{ direction, opcode, payload, ts }>
const activeScreencasts = new Map(); // tabId -> Array<{ data, metadata, ts }>
const activeHars = new Map(); // tabId -> { startedAt, pending: Map, entries: [], maxEntries, filter, bodies, bodyBytes }
const activeTraces = new Map(); // tabId -> { startedAt, chunks: [], eventCount, complete, maxEvents }
const activeVideoRecs = new Map(); // tabId -> { startedAt, fps, frameCount }
const activeClocks = new Map(); // tabId -> { scriptId, offsetMs }
export const activeEmulations = new Map(); // tabId -> true while device/UA emulation is live

if (chrome.debugger && chrome.debugger.onEvent) {
  chrome.debugger.onEvent.addListener(async (source, method, params) => {
    if (method === 'Page.javascriptDialogOpening' && source && source.tabId) {
      const rule = activeDialogRules.get(source.tabId);
      if (rule) {
        try {
          await chrome.debugger.sendCommand(source, 'Page.handleJavaScriptDialog', {
            accept: rule.rule !== 'dismiss',
            promptText: rule.promptText || undefined,
          });
        } catch {}
      }
    }

    if ((method === 'Network.webSocketFrameReceived' || method === 'Network.webSocketFrameSent') && source && source.tabId) {
      const buf = activeWsBuffers.get(source.tabId);
      if (buf) {
        buf.push({
          direction: method.includes('Received') ? 'in' : 'out',
          opcode: params.response ? params.response.opcode : undefined,
          payload: params.response ? params.response.payloadData : undefined,
          ts: Date.now(),
        });
        if (buf.length > 200) buf.shift();
      }
    }

    if (method === 'Page.screencastFrame' && source && source.tabId) {
      const screencast = activeScreencasts.get(source.tabId);
      if (screencast) {
        screencast.push({
          data: params.data,
          metadata: params.metadata,
          ts: Date.now(),
        });
        if (screencast.length > 300) screencast.shift();
      }
      const videoRec = activeVideoRecs.get(source.tabId);
      if (videoRec) {
        videoRec.frameCount++;
        try {
          chrome.runtime.sendMessage({
            type: 'video-feed',
            data: params.data,
            width: params.metadata ? params.metadata.offsetWidth : undefined,
            height: params.metadata ? params.metadata.offsetHeight : undefined,
          }).catch(() => {});
        } catch {}
      }
      // ALWAYS ack — Chrome pauses the screencast stream until every frame is
      // acked, even when the only consumer is the video recorder.
      try {
        await chrome.debugger.sendCommand(source, 'Page.screencastFrameAck', { sessionId: params.sessionId });
      } catch {}
    }

    // ── Real CDP HAR capture: Network domain events → HAR 1.2 entries ──
    const harRec = source && source.tabId ? activeHars.get(source.tabId) : null;
    if (harRec) {
      if (method === 'Network.requestWillBeSent' && params.request) {
        const url = params.request.url || '';
        if ((!harRec.filter || url.includes(harRec.filter)) && harRec.entries.length + harRec.pending.size < harRec.maxEntries) {
          let query = [];
          try { query = [...new URL(url).searchParams].map(([name, value]) => ({ name, value })); } catch {}
          harRec.pending.set(params.requestId, {
            startedDateTime: new Date().toISOString(),
            startedMs: Date.now(),
            request: {
              method: params.request.method || 'GET',
              url,
              httpVersion: 'HTTP/1.1',
              headers: Object.entries(params.request.headers || {}).map(([name, value]) => ({ name, value: String(value) })),
              queryString: query,
              cookies: [],
              headersSize: -1,
              bodySize: params.request.postData ? String(params.request.postData).length : 0,
            },
            response: null,
            remoteIp: null,
            resourceType: params.type || undefined,
          });
        }
      } else if (method === 'Network.responseReceived' && params.response) {
        const entry = harRec.pending.get(params.requestId);
        if (entry) {
          entry.respondedMs = Date.now();
          entry.remoteIp = params.response.remoteIPAddress || null;
          entry.response = {
            status: params.response.status || 0,
            statusText: params.response.statusText || '',
            httpVersion: params.response.protocol || 'HTTP/1.1',
            headers: Object.entries(params.response.headers || {}).map(([name, value]) => ({ name, value: String(value) })),
            cookies: [],
            content: { size: params.response.encodedDataLength || 0, mimeType: params.response.mimeType || '', compression: 0 },
            redirectURL: params.response.location || '',
            headersSize: -1,
            bodySize: -1,
          };
        }
      } else if (method === 'Network.loadingFinished' || method === 'Network.loadingFailed') {
        const entry = harRec.pending.get(params.requestId);
        if (entry) {
          harRec.pending.delete(params.requestId);
          const now = Date.now();
          const wait = entry.respondedMs ? entry.respondedMs - entry.startedMs : now - entry.startedMs;
          const receive = method === 'Network.loadingFinished' ? Math.max(0, now - (entry.respondedMs || entry.startedMs)) : 0;
          if (!entry.response) {
            entry.response = {
              status: 0,
              statusText: params.errorText || (method === 'Network.loadingFailed' ? 'failed' : 'no response'),
              httpVersion: 'HTTP/1.1',
              headers: [], cookies: [],
              content: { size: 0, mimeType: '', compression: 0 },
              redirectURL: '', headersSize: -1, bodySize: -1,
            };
          } else if (method === 'Network.loadingFinished' && params.encodedDataLength != null) {
            entry.response.content.size = params.encodedDataLength;
          }
          // bodies:true — pull small response bodies into the HAR content block.
          if (harRec.bodies && method === 'Network.loadingFinished' && entry.response.status >= 200
            && entry.response.status < 300 && harRec.bodyBytes < 4194304
            && entry.response.content.size > 0 && entry.response.content.size <= 262144) {
            chrome.debugger.sendCommand(source, 'Network.getResponseBody', { requestId: params.requestId })
              .then((bodyRes) => {
                if (bodyRes && bodyRes.body) {
                  harRec.bodyBytes += entry.response.content.size;
                  entry.response.content.text = bodyRes.body;
                  entry.response.content.encoding = bodyRes.base64Encoded ? 'base64' : 'text';
                }
              })
              .catch((err) => {
                if (!harRec.bodyErrors) harRec.bodyErrors = [];
                if (harRec.bodyErrors.length < 3) harRec.bodyErrors.push(String((err && err.message) || err).slice(0, 120));
              });
          }
          harRec.entries.push({
            startedDateTime: entry.startedDateTime,
            time: now - entry.startedMs,
            request: entry.request,
            response: entry.response,
            cache: {},
            timings: { blocked: -1, dns: -1, connect: -1, ssl: -1, send: 0, wait, receive },
            _resourceType: entry.resourceType,
            _serverIPAddress: entry.remoteIp,
          });
        }
      }
    }

    // ── CDP Tracing collector: Tracing domain events → Chrome trace JSON ──
    const traceRec = source && source.tabId ? activeTraces.get(source.tabId) : null;
    if (traceRec) {
      if (method === 'Tracing.dataCollected' && Array.isArray(params.value)) {
        for (const ev of params.value) {
          if (traceRec.eventCount >= traceRec.maxEvents) break;
          traceRec.chunks.push(ev);
          traceRec.eventCount++;
        }
      } else if (method === 'Tracing.tracingComplete') {
        traceRec.complete = true;
      }
    }

    if (method === 'Fetch.requestPaused' && source && source.tabId) {
      const routes = activeRoutes.get(source.tabId);
      if (routes && routes.length > 0) {
        const reqUrl = params.request ? params.request.url : '';
        const matched = routes.find((r) => {
          if (r.pattern === '*' || !r.pattern) return true;
          return reqUrl.includes(r.pattern);
        });
        if (matched) {
          if (matched.mode === 'abort') {
            try {
              await chrome.debugger.sendCommand(source, 'Fetch.failRequest', {
                requestId: params.requestId,
                errorReason: matched.errorReason || 'Failed',
              });
            } catch {}
            return;
          }
          if (matched.mode === 'fulfill') {
            try {
              const bodyStr = typeof matched.response?.body === 'string'
                ? matched.response.body
                : JSON.stringify(matched.response?.body || { mocked: true });
              const bodyBase64 = btoa(unescape(encodeURIComponent(bodyStr)));
              await chrome.debugger.sendCommand(source, 'Fetch.fulfillRequest', {
                requestId: params.requestId,
                responseCode: matched.response?.status || 200,
                responseHeaders: matched.response?.headers || [{ name: 'Content-Type', value: 'application/json' }],
                body: bodyBase64,
              });
            } catch {}
            return;
          }
          if (matched.mode === 'continue') {
            try {
              const continueParams = { requestId: params.requestId };
              if (matched.headers) continueParams.headers = matched.headers;
              if (matched.postData) continueParams.postData = btoa(unescape(encodeURIComponent(matched.postData)));
              await chrome.debugger.sendCommand(source, 'Fetch.continueRequest', continueParams);
            } catch {}
            return;
          }
        }
      }

      const config = activeMocks.get(source.tabId);
      if (!config) {
        try { await chrome.debugger.sendCommand(source, 'Fetch.continueRequest', { requestId: params.requestId }); } catch {}
        return;
      }
      if (config.action === 'fail_request') {
        try {
          await chrome.debugger.sendCommand(source, 'Fetch.failRequest', {
            requestId: params.requestId,
            errorReason: config.errorReason || 'Failed',
          });
        } catch {}
      } else {
        try {
          const bodyStr = config.body || '{"mocked": true}';
          const bodyBase64 = btoa(unescape(encodeURIComponent(bodyStr)));
          await chrome.debugger.sendCommand(source, 'Fetch.fulfillRequest', {
            requestId: params.requestId,
            responseCode: config.status || 200,
            responseHeaders: config.headers || [{ name: 'Content-Type', value: 'application/json' }],
            body: bodyBase64,
          });
        } catch {}
      }
    }
  });
}

if (chrome.tabs && chrome.tabs.onRemoved) {
  chrome.tabs.onRemoved.addListener((tabId) => {
    activeMocks.delete(tabId);
    activeRoutes.delete(tabId);
    activeDialogRules.delete(tabId);
    activeWsBuffers.delete(tabId);
    activeScreencasts.delete(tabId);
    activeHars.delete(tabId);
    activeTraces.delete(tabId);
    activeVideoRecs.delete(tabId);
    activeClocks.delete(tabId);
    activeEmulations.delete(tabId);
  });
}

export async function cdpNetworkMock(tab, args = {}) {
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
    const action = String(args.action || 'mock_response');
    if (action === 'disable') {
      activeMocks.delete(tab.id);
      await chrome.debugger.sendCommand(target, 'Fetch.disable', {}).catch(() => {});
      return { ok: true, data: { networkMockDisabled: true } };
    }

    const patterns = Array.isArray(args.patterns) ? args.patterns : [{ urlPattern: args.urlPattern || '*' }];
    await chrome.debugger.sendCommand(target, 'Fetch.enable', { patterns });

    const mockStatus = Number(args.status) || 200;
    const mockHeaders = Array.isArray(args.headers) ? args.headers : [{ name: 'Content-Type', value: 'application/json' }];
    const mockBody = typeof args.body === 'object' ? JSON.stringify(args.body) : String(args.body || '{"mocked": true}');

    activeMocks.set(tab.id, {
      action,
      status: mockStatus,
      headers: mockHeaders,
      body: mockBody,
      errorReason: args.errorReason || 'Failed',
    });

    return {
      ok: true,
      data: {
        action,
        fetchInterceptionEnabled: true,
        patterns,
        mockResponseConfig: action === 'fail_request' ? undefined : {
          responseCode: mockStatus,
          responseHeaders: mockHeaders,
          bodyLength: mockBody.length,
        },
        faultInjectionConfig: action === 'fail_request' ? {
          errorReason: args.errorReason || 'Failed',
        } : undefined,
      },
    };
  } catch (err) {
    if (attached) {
      await rawDetach(target);
    }
    return { ok: false, error: `CDP network mock error: ${String((err && err.message) || err)}` };
  } finally {
    if (args.action === 'disable' && attached) {
      await rawDetach(target);
    }
  }
}

export async function cdpElementScreenshot(tab, args = {}) {
  let bounds = null;
  try {
    const bRes = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: ssWebUnitExtract,
      args: [{ ...args, __tool: 'web_element_bounds' }],
    });
    if (bRes && bRes[0] && bRes[0].result && bRes[0].result.ok) {
      bounds = bRes[0].result.data;
    }
  } catch {}
  if (!bounds) {
    return { ok: false, error: 'Could not calculate bounds for element screenshot. Make sure element is visible on page.' };
  }

  const padding = Number(args.padding) || 4;
  const clip = {
    x: Math.max(0, bounds.x - padding),
    y: Math.max(0, bounds.y - padding),
    width: bounds.width + padding * 2,
    height: bounds.height + padding * 2,
    scale: 1,
  };

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
    await chrome.debugger.sendCommand(target, 'Page.enable', {});
    const format = args.format === 'png' ? 'png' : 'jpeg';
    const quality = typeof args.quality === 'number' ? Math.min(100, Math.max(1, args.quality)) : 85;
    const captureOpts = { format, clip };
    if (format === 'jpeg') captureOpts.quality = quality;

    const res = await chrome.debugger.sendCommand(target, 'Page.captureScreenshot', captureOpts);
    const mime = format === 'png' ? 'image/png' : 'image/jpeg';
    return {
      ok: true,
      data: {
        imageDataUrl: `data:${mime};base64,${res.data}`,
        format,
        clip,
        bounds,
        url: tab.url,
      },
    };
  } catch (err) {
    return { ok: false, error: `CDP element screenshot error: ${String((err && err.message) || err)}` };
  } finally {
    if (attached) {
      await rawDetach(target);
    }
  }
}

export async function cdpEmulate(tab, args = {}) {
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
    const applied = {};
    if (args.width && args.height) {
      await chrome.debugger.sendCommand(target, 'Emulation.setDeviceMetricsOverride', {
        width: Number(args.width),
        height: Number(args.height),
        deviceScaleFactor: Number(args.deviceScaleFactor) || 1,
        mobile: Boolean(args.mobile),
      });
      applied.viewport = { width: args.width, height: args.height, mobile: Boolean(args.mobile) };
    }
    if (args.colorScheme) {
      await chrome.debugger.sendCommand(target, 'Emulation.setEmulatedMedia', {
        media: 'screen',
        features: [{ name: 'prefers-color-scheme', value: args.colorScheme }],
      });
      applied.colorScheme = args.colorScheme;
    }
    if (args.latitude !== undefined && args.longitude !== undefined) {
      await chrome.debugger.sendCommand(target, 'Emulation.setGeolocationOverride', {
        latitude: Number(args.latitude),
        longitude: Number(args.longitude),
        accuracy: Number(args.accuracy) || 100,
      });
      applied.geolocation = { latitude: args.latitude, longitude: args.longitude };
    }
    if (args.offline !== undefined || args.networkType) {
      await chrome.debugger.sendCommand(target, 'Network.enable', {});
      let latency = 0;
      let download = -1;
      let upload = -1;
      const net = String(args.networkType || '').toLowerCase();
      if (args.offline || net === 'offline') {
        latency = 0; download = 0; upload = 0;
      } else if (net === 'slow3g') {
        latency = 400; download = ((400 * 1024) / 8); upload = ((400 * 1024) / 8);
      } else if (net === 'fast3g') {
        latency = 100; download = ((1.6 * 1024 * 1024) / 8); upload = ((750 * 1024) / 8);
      } else if (net === '4g') {
        latency = 20; download = ((20 * 1024 * 1024) / 8); upload = ((10 * 1024 * 1024) / 8);
      }
      await chrome.debugger.sendCommand(target, 'Network.emulateNetworkConditions', {
        offline: Boolean(args.offline || net === 'offline'),
        latency,
        downloadThroughput: download,
        uploadThroughput: upload,
      });
      applied.network = { offline: Boolean(args.offline || net === 'offline'), type: net || 'custom' };
    }
    return { ok: true, data: { emulated: true, applied, url: tab.url } };
  } catch (err) {
    return { ok: false, error: `CDP emulation error: ${String((err && err.message) || err)}` };
  } finally {
    if (attached) {
      await rawDetach(target);
    }
  }
}

export async function cdpUploadFile(tab, args = {}) {
  // If base64 data was supplied, use DOM injection via ssWebUnit directly
  if (args.base64Data) {
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: ssWebUnitInteract,
        args: [{ ...args, __tool: 'web_upload_file' }],
      });
      return (results && results[0] && results[0].result) || { ok: false, error: 'File upload script returned no result.' };
    } catch (e) {
      return { ok: false, error: `File injection error: ${String((e && e.message) || e)}` };
    }
  }

  // Otherwise, use CDP DOM.setFileInputFiles for native absolute file paths on disk
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
    await chrome.debugger.sendCommand(target, 'DOM.enable', {});
    const doc = await chrome.debugger.sendCommand(target, 'DOM.getDocument', {});
    const selector = String(args.selector || 'input[type="file"]');
    const nodeRes = await chrome.debugger.sendCommand(target, 'DOM.querySelector', {
      nodeId: doc.root.nodeId,
      selector,
    });
    if (!nodeRes || !nodeRes.nodeId) {
      return { ok: false, error: `File input element matching selector "${selector}" not found in DOM.` };
    }
    const files = Array.isArray(args.files) ? args.files : [String(args.filePath || args.file || '')];
    await chrome.debugger.sendCommand(target, 'DOM.setFileInputFiles', {
      nodeId: nodeRes.nodeId,
      files,
    });
    return { ok: true, data: { uploadedFiles: files, selector, nodeId: nodeRes.nodeId } };
  } catch (err) {
    return { ok: false, error: `CDP file upload error: ${String((err && err.message) || err)}` };
  } finally {
    if (attached) {
      await rawDetach(target);
    }
  }
}

export async function cdpWaitNetworkIdle(tab, timeoutMs = 15000, idleMs = 500) {
  const target = { tabId: tab.id };
  let attached = false;
  try {
    await rawAttach(target);
    attached = true;
  } catch (e) {
    if (String((e && e.message) || e).includes('Already attached')) attached = true;
    else return { ok: false, error: `CDP attach failed: ${String((e && e.message) || e)}` };
  }

  return new Promise((resolve) => {
    let inflight = 0;
    let timer = null;
    const t0 = Date.now();

    const cleanup = async () => {
      clearTimeout(maxTimer);
      if (timer) clearTimeout(timer);
      chrome.debugger.onEvent.removeListener(onEvent);
      try { await chrome.debugger.sendCommand(target, 'Network.disable', {}); } catch {}
      if (attached) {
        await rawDetach(target);
      }
    };

    const done = async (ok, err) => {
      await cleanup();
      resolve(ok ? { ok: true, data: { state: 'networkidle', elapsedMs: Date.now() - t0 } } : { ok: false, error: err });
    };

    const checkIdle = () => {
      if (inflight <= 0) {
        inflight = 0;
        if (!timer) {
          timer = setTimeout(() => done(true), idleMs);
        }
      } else if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    };

    const onEvent = (source, method) => {
      if (source.tabId !== tab.id) return;
      if (method === 'Network.requestWillBeSent') {
        inflight++;
        checkIdle();
      } else if (method === 'Network.loadingFinished' || method === 'Network.loadingFailed') {
        inflight = Math.max(0, inflight - 1);
        checkIdle();
      }
    };

    const maxTimer = setTimeout(() => done(false, `Timeout of ${timeoutMs}ms exceeded waiting for networkidle`), timeoutMs);

    chrome.debugger.onEvent.addListener(onEvent);
    chrome.debugger.sendCommand(target, 'Network.enable', {}).then(() => {
      checkIdle();
    }).catch((e) => {
      done(false, String(e));
    });
  });
}

export async function cdpKeyCombo(tab, args = {}) {
  const target = { tabId: tab.id };
  try { await rawAttach(target); } catch (e) {
    if (!String((e && e.message) || e).includes('Already attached')) return { ok: false, error: `CDP attach: ${e.message || e}` };
  }
  try {
    const combo = String(args.combo || args.key || '');
    if (!combo) return { ok: false, error: 'combo is required (e.g. "Control+A", "Shift+Tab").' };
    const parts = combo.split('+');
    const modifiers = { Control: 1, Alt: 2, Shift: 8, Meta: 4 };
    let modBitmask = 0;
    const mainKey = parts[parts.length - 1];
    for (let i = 0; i < parts.length - 1; i++) {
      const m = parts[i].charAt(0).toUpperCase() + parts[i].slice(1).toLowerCase();
      if (modifiers[m]) modBitmask |= modifiers[m];
      await chrome.debugger.sendCommand(target, 'Input.dispatchKeyEvent', { type: 'rawKeyDown', key: m, modifiers: modBitmask });
    }
    await chrome.debugger.sendCommand(target, 'Input.dispatchKeyEvent', { type: 'rawKeyDown', key: mainKey, modifiers: modBitmask });
    await chrome.debugger.sendCommand(target, 'Input.dispatchKeyEvent', { type: 'keyUp', key: mainKey, modifiers: modBitmask });
    for (let i = parts.length - 2; i >= 0; i--) {
      const m = parts[i].charAt(0).toUpperCase() + parts[i].slice(1).toLowerCase();
      modBitmask &= ~(modifiers[m] || 0);
      await chrome.debugger.sendCommand(target, 'Input.dispatchKeyEvent', { type: 'keyUp', key: m, modifiers: modBitmask });
    }
    return { ok: true, data: { combo, pressed: true } };
  } finally {
    await rawDetach(target);
  }
}

export async function cdpMouse(tab, args = {}) {
  const target = { tabId: tab.id };
  try { await rawAttach(target); } catch (e) {
    if (!String((e && e.message) || e).includes('Already attached')) return { ok: false, error: `CDP attach: ${e.message || e}` };
  }
  try {
    const action = String(args.action || 'click');
    const x = Number(args.x || 100);
    const y = Number(args.y || 100);
    const button = args.button || 'left';

    if (action === 'move') {
      await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
      return { ok: true, data: { action: 'move', x, y } };
    }
    if (action === 'down') {
      await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button, clickCount: 1 });
      return { ok: true, data: { action: 'down', x, y, button } };
    }
    if (action === 'up') {
      await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button, clickCount: 1 });
      return { ok: true, data: { action: 'up', x, y, button } };
    }
    if (action === 'dblclick') {
      await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
      await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
      await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 2 });
      await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 2 });
      return { ok: true, data: { action: 'dblclick', x, y } };
    }
    if (action === 'wheel') {
      const deltaX = Math.round(Number(args.deltaX || 0));
      const deltaY = Math.round(Number(args.deltaY || 120));
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: (dx, dy) => { window.scrollBy({ left: dx, top: dy, behavior: 'smooth' }); },
        args: [deltaX, deltaY],
      }).catch(() => {});
      return { ok: true, data: { action: 'wheel', x, y, deltaX, deltaY } };
    }
    if (action === 'contextmenu' || action === 'right-click') {
      await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'right', clickCount: 1 });
      await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'right', clickCount: 1 });
      return { ok: true, data: { action: 'contextmenu', x, y } };
    }
    // default click
    await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button, clickCount: 1 });
    await new Promise((r) => setTimeout(r, 50));
    await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button, clickCount: 1 });
    return { ok: true, data: { action: 'click', x, y, button } };
  } catch (err) {
    return { ok: false, error: `CDP mouse error: ${String((err && err.message) || err)}` };
  } finally {
    await rawDetach(target);
  }
}

export async function cdpTouch(tab, args = {}) {
  const action = String(args.action || 'tap');
  const x = Number(args.x || 100);
  const y = Number(args.y || 100);

  if (action === 'tap') {
    const res = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: (tx, ty) => {
        const el = document.elementFromPoint(tx, ty) || document.body;
        el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        try {
          const touch = new Touch({ identifier: Date.now(), target: el, clientX: tx, clientY: ty, screenX: tx, screenY: ty, pageX: tx + window.scrollX, pageY: ty + window.scrollY });
          el.dispatchEvent(new TouchEvent('touchstart', { touches: [touch], targetTouches: [touch], changedTouches: [touch], bubbles: true, cancelable: true }));
          el.dispatchEvent(new TouchEvent('touchend', { touches: [], targetTouches: [], changedTouches: [touch], bubbles: true, cancelable: true }));
        } catch {}
        el.dispatchEvent(new PointerEvent('pointerdown', { clientX: tx, clientY: ty, pointerType: 'touch', bubbles: true }));
        el.dispatchEvent(new PointerEvent('pointerup', { clientX: tx, clientY: ty, pointerType: 'touch', bubbles: true }));
        el.click();
        return { tag: el.tagName.toLowerCase(), text: (el.innerText || el.textContent || '').trim().slice(0, 50) };
      },
      args: [x, y],
    });
    return { ok: true, data: { action: 'tap', x, y, target: res && res[0] && res[0].result } };
  }
  if (action === 'swipe') {
    const endX = Number(args.endX || x);
    const endY = Number(args.endY || (y - 150));
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: (sx, sy, ex, ey) => {
        const el = document.elementFromPoint(sx, sy) || document.body;
        try {
          const t1 = new Touch({ identifier: Date.now(), target: el, clientX: sx, clientY: sy });
          el.dispatchEvent(new TouchEvent('touchstart', { touches: [t1], targetTouches: [t1], changedTouches: [t1], bubbles: true, cancelable: true }));
          const t2 = new Touch({ identifier: Date.now(), target: el, clientX: ex, clientY: ey });
          el.dispatchEvent(new TouchEvent('touchmove', { touches: [t2], targetTouches: [t2], changedTouches: [t2], bubbles: true, cancelable: true }));
          el.dispatchEvent(new TouchEvent('touchend', { touches: [], targetTouches: [], changedTouches: [t2], bubbles: true, cancelable: true }));
        } catch {}
        window.scrollBy({ left: sx - ex, top: sy - ey, behavior: 'smooth' });
      },
      args: [x, y, endX, endY],
    });
    return { ok: true, data: { action: 'swipe', from: { x, y }, to: { x: endX, y: endY } } };
  }
  return { ok: false, error: `Unknown touch action: ${action}. Supported: tap, swipe.` };
}

export async function cdpGrantPermissions(tab, args = {}) {
  const permissions = Array.isArray(args.permissions) ? args.permissions : [args.permission || 'geolocation'];
  const origin = args.origin || (tab.url ? new URL(tab.url).origin : undefined);

  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    world: 'MAIN',
    func: (perms) => {
      const origQuery = navigator.permissions && navigator.permissions.query;
      if (origQuery) {
        navigator.permissions.query = function (param) {
          if (param && perms.includes(param.name)) {
            return Promise.resolve({ state: 'granted', onchange: null });
          }
          return origQuery.call(this, param);
        };
      }
    },
    args: [permissions],
  }).catch(() => {});

  if (permissions.includes('geolocation')) {
    const target = { tabId: tab.id };
    try {
      await rawAttach(target);
    } catch (e) {
      if (!/already attached/i.test(String((e && e.message) || e))) {
        // ignore
      }
    }
    try {
      await chrome.debugger.sendCommand(target, 'Emulation.setGeolocationOverride', {
        latitude: Number(args.latitude) || 31.5204,
        longitude: Number(args.longitude) || 74.3587,
        accuracy: 100,
      });
    } catch {}
  }

  return { ok: true, data: { granted: permissions, origin: origin || 'activeTab' } };
}

export async function cdpSetTimezone(tab, args = {}) {
  const target = { tabId: tab.id };
  let newlyAttached = false;
  try {
    await rawAttach(target);
    newlyAttached = true;
  } catch (e) {
    if (!/already attached/i.test(String((e && e.message) || e))) {
      return { ok: false, error: `CDP attach: ${e.message || e}` };
    }
  }
  try {
    const timezoneId = String(args.timezoneId || args.timezone || 'Asia/Karachi');
    await chrome.debugger.sendCommand(target, 'Emulation.setTimezoneOverride', { timezoneId });
    return { ok: true, data: { timezoneId } };
  } catch (err) {
    return { ok: false, error: `CDP timezone error: ${String((err && err.message) || err)}` };
  } finally {
    if (newlyAttached) {
      await rawDetach(target);
    }
  }
}

export async function cdpRoute(tab, args = {}) {
  const target = { tabId: tab.id };
  const action = String(args.action || 'route').toLowerCase();

  if (action === 'clear' || action === 'unroute') {
    activeRoutes.delete(tab.id);
    try { await chrome.debugger.sendCommand(target, 'Fetch.disable'); } catch {}
    await detachCdp(tab);
    return { ok: true, data: { cleared: true, tabId: tab.id } };
  }

  if (action === 'list') {
    return { ok: true, data: { routes: activeRoutes.get(tab.id) || [] } };
  }

  const pattern = String(args.urlPattern || args.pattern || '*');
  const mode = String(args.mode || 'fulfill').toLowerCase();

  const attachRes = await attachCdp(tab);
  if (!attachRes.ok) return attachRes;

  try {
    await chrome.debugger.sendCommand(target, 'Fetch.enable', {
      patterns: [{ urlPattern: pattern, requestStage: 'Request' }],
    });

    const routeConfig = {
      pattern,
      mode,
      headers: args.headers || null,
      postData: args.postData || null,
      response: args.response || null,
      errorReason: args.errorReason || 'Failed',
    };

    let routes = activeRoutes.get(tab.id);
    if (!routes) {
      routes = [];
      activeRoutes.set(tab.id, routes);
    }
    routes.push(routeConfig);

    return { ok: true, data: { routed: pattern, mode, totalActiveRoutes: routes.length } };
  } catch (err) {
    await detachCdp(tab);
    return { ok: false, error: `CDP route error: ${String((err && err.message) || err)}` };
  }
}

export async function cdpDialogRule(tab, args = {}) {
  const target = { tabId: tab.id };
  const action = String(args.action || args.rule || 'accept').toLowerCase();
  if (action === 'clear') {
    activeDialogRules.delete(tab.id);
    await detachCdp(tab);
    return { ok: true, data: { dialogRule: 'cleared', tabId: tab.id } };
  }
  const attachRes = await attachCdp(tab);
  if (!attachRes.ok) return attachRes;
  try {
    await chrome.debugger.sendCommand(target, 'Page.enable');
    activeDialogRules.set(tab.id, {
      rule: action,
      promptText: args.promptText || '',
    });
    return { ok: true, data: { dialogRule: action, promptText: args.promptText || null } };
  } catch (err) {
    await detachCdp(tab);
    return { ok: false, error: `CDP dialog rule error: ${String((err && err.message) || err)}` };
  }
}

const activeCoverage = new Map();

export async function cdpCoverage(tab, args = {}) {
  const target = { tabId: tab.id };
  const action = String(args.action || 'start').toLowerCase();

  if (action === 'start') {
    const attachRes = await attachCdp(tab);
    if (!attachRes.ok) return attachRes;
    try {
      await chrome.debugger.sendCommand(target, 'Profiler.enable');
      await chrome.debugger.sendCommand(target, 'Profiler.startPreciseCoverage', { callCount: false, detailed: true });
      await chrome.debugger.sendCommand(target, 'CSS.enable').catch(() => {});
      await chrome.debugger.sendCommand(target, 'CSS.startRuleUsageTracking').catch(() => {});
      activeCoverage.set(tab.id, true);
      return { ok: true, data: { action: 'start', tracking: true } };
    } catch (err) {
      await detachCdp(tab);
      return { ok: false, error: `CDP coverage start error: ${String((err && err.message) || err)}` };
    }
  }

  if (action === 'stop' || action === 'get') {
    if (!activeCoverage.get(tab.id)) {
      return { ok: false, error: 'Coverage tracking is not active on this tab. Call action: "start" first.' };
    }
    try {
      const profRes = await chrome.debugger.sendCommand(target, 'Profiler.takePreciseCoverage').catch(() => ({ result: [] }));
      const cssRes = await chrome.debugger.sendCommand(target, 'CSS.stopRuleUsageTracking').catch(() => ({ ruleUsage: [] }));
      await chrome.debugger.sendCommand(target, 'Profiler.stopPreciseCoverage').catch(() => {});
      await chrome.debugger.sendCommand(target, 'Profiler.disable').catch(() => {});
      await chrome.debugger.sendCommand(target, 'CSS.disable').catch(() => {});
      activeCoverage.delete(tab.id);
      await detachCdp(tab);

      let totalJsBytes = 0;
      let usedJsBytes = 0;
      const scripts = (profRes.result || []).map((s) => {
        let scriptTotal = 0;
        let scriptUsed = 0;
        for (const func of s.functions || []) {
          for (const range of func.ranges || []) {
            const bytes = range.endOffset - range.startOffset;
            scriptTotal += bytes;
            if (range.count > 0) scriptUsed += bytes;
          }
        }
        totalJsBytes += scriptTotal;
        usedJsBytes += scriptUsed;
        return { url: s.url, totalBytes: scriptTotal, usedBytes: scriptUsed };
      }).filter((s) => s.totalBytes > 0);

      const jsPct = totalJsBytes > 0 ? Math.round((usedJsBytes / totalJsBytes) * 100) : 100;

      return {
        ok: true,
        data: {
          jsCoverage: {
            totalBytes: totalJsBytes,
            usedBytes: usedJsBytes,
            unusedBytes: totalJsBytes - usedJsBytes,
            percentUsed: jsPct,
            scriptsSample: scripts.slice(0, 10),
          },
          cssRulesTracked: (cssRes.ruleUsage || []).length,
        },
      };
    } catch (err) {
      await detachCdp(tab);
      return { ok: false, error: `CDP coverage stop error: ${String((err && err.message) || err)}` };
    }
  }

  return { ok: false, error: `Unknown web_coverage action: ${action}. Supported: start, stop.` };
}

export async function cdpSetGeolocation(tab, args = {}) {
  const target = { tabId: tab.id };
  const attached = await attachCdp(tab);
  if (!attached.ok) return attached;
  try {
    if (args.clear) {
      await chrome.debugger.sendCommand(target, 'Emulation.clearGeolocationOverride', {});
      await detachCdp(tab);
      return { ok: true, data: { cleared: true } };
    }
    const latitude = Number(args.latitude ?? 37.7749);
    const longitude = Number(args.longitude ?? -122.4194);
    const accuracy = Number(args.accuracy ?? 100);
    await chrome.debugger.sendCommand(target, 'Emulation.setGeolocationOverride', {
      latitude,
      longitude,
      accuracy,
    });
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: 'MAIN',
      func: (lat, lng, acc) => {
        if (navigator.geolocation) {
          navigator.geolocation.getCurrentPosition = (success) => {
            if (success) success({
              coords: { latitude: lat, longitude: lng, accuracy: acc, altitude: null, altitudeAccuracy: null, heading: null, speed: null },
              timestamp: Date.now(),
            });
          };
        }
      },
      args: [latitude, longitude, accuracy],
    }).catch(() => {});
    await detachCdp(tab);
    return { ok: true, data: { latitude, longitude, accuracy } };
  } catch (err) {
    await detachCdp(tab);
    return { ok: false, error: `CDP setGeolocation error: ${String((err && err.message) || err)}` };
  }
}

export async function cdpThrottleNetwork(tab, args = {}) {
  const target = { tabId: tab.id };
  const attached = await attachCdp(tab);
  if (!attached.ok) return attached;
  try {
    await chrome.debugger.sendCommand(target, 'Network.enable', {});
    const preset = String(args.preset || args.condition || '').toLowerCase();
    let offline = !!args.offline;
    let latency = Number(args.latency ?? 0);
    let downloadThroughput = Number(args.downloadThroughput ?? -1);
    let uploadThroughput = Number(args.uploadThroughput ?? -1);

    if (preset === 'offline') {
      offline = true;
      latency = 0;
      downloadThroughput = 0;
      uploadThroughput = 0;
    } else if (preset === 'slow3g' || preset === 'slow_3g') {
      offline = false;
      latency = 400;
      downloadThroughput = (400 * 1024) / 8;
      uploadThroughput = (400 * 1024) / 8;
    } else if (preset === 'fast3g' || preset === 'fast_3g') {
      offline = false;
      latency = 150;
      downloadThroughput = (1.6 * 1024 * 1024) / 8;
      uploadThroughput = (750 * 1024) / 8;
    } else if (preset === 'none' || preset === 'online' || preset === 'clear') {
      offline = false;
      latency = 0;
      downloadThroughput = -1;
      uploadThroughput = -1;
    }

    await chrome.debugger.sendCommand(target, 'Network.emulateNetworkConditions', {
      offline,
      latency,
      downloadThroughput,
      uploadThroughput,
    });
    await detachCdp(tab);
    return {
      ok: true,
      data: {
        preset: preset || 'custom',
        offline,
        latencyMs: latency,
        downloadThroughputKbps: downloadThroughput > 0 ? Math.round((downloadThroughput * 8) / 1024) : 'unlimited',
        uploadThroughputKbps: uploadThroughput > 0 ? Math.round((uploadThroughput * 8) / 1024) : 'unlimited',
      },
    };
  } catch (err) {
    await detachCdp(tab);
    return { ok: false, error: `CDP throttleNetwork error: ${String((err && err.message) || err)}` };
  }
}

export async function cdpSetColorScheme(tab, args = {}) {
  const target = { tabId: tab.id };
  const attached = await attachCdp(tab);
  if (!attached.ok) return attached;
  try {
    const colorScheme = String(args.colorScheme || args.scheme || 'dark').toLowerCase();
    const valid = ['dark', 'light', 'no-preference'];
    const chosen = valid.includes(colorScheme) ? colorScheme : 'dark';
    await chrome.debugger.sendCommand(target, 'Emulation.setEmulatedMedia', {
      media: '',
      features: [{ name: 'prefers-color-scheme', value: chosen }],
    });
    await detachCdp(tab);
    return { ok: true, data: { colorScheme: chosen } };
  } catch (err) {
    await detachCdp(tab);
    return { ok: false, error: `CDP setColorScheme error: ${String((err && err.message) || err)}` };
  }
}

export async function cdpClipboard(tab, args = {}) {
  const action = String(args.action || 'read').toLowerCase();

  try {
    const offscreenRes = await chrome.runtime.sendMessage({
      type: action === 'write' ? 'clipboard-write' : 'clipboard-read',
      text: args.text,
    });
    if (offscreenRes && offscreenRes.ok) {
      return { ok: true, data: { action, ...offscreenRes, via: 'offscreen' } };
    }
  } catch {}

  if (action === 'write') {
    const text = String(args.text || '');
    try {
      const res = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: async (val) => {
          try {
            await navigator.clipboard.writeText(val);
            return { ok: true, length: val.length };
          } catch (e) {
            const ta = document.createElement('textarea');
            ta.value = val;
            ta.style.position = 'fixed';
            ta.style.opacity = '0';
            document.body.appendChild(ta);
            ta.focus();
            ta.select();
            const copied = document.execCommand('copy');
            ta.remove();
            return { ok: copied, length: val.length, via: 'execCommand' };
          }
        },
        args: [text],
      });
      return { ok: true, data: { action: 'write', text: text.slice(0, 100), length: text.length, result: res && res[0] && res[0].result } };
    } catch (err) {
      return { ok: false, error: `Clipboard write error: ${String((err && err.message) || err)}` };
    }
  }

  if (action === 'read') {
    try {
      const res = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: async () => {
          try {
            const text = await navigator.clipboard.readText();
            return { ok: true, text };
          } catch (e) {
            return { ok: false, error: String(e.message || e) };
          }
        },
      });
      const result = res && res[0] && res[0].result;
      if (result && result.ok) {
        return { ok: true, data: { action: 'read', text: result.text, length: result.text.length } };
      }
      return { ok: false, error: result ? result.error : 'Failed to read clipboard.' };
    } catch (err) {
      return { ok: false, error: `Clipboard read error: ${String((err && err.message) || err)}` };
    }
  }

  return { ok: false, error: `Unknown clipboard action: ${action}. Supported: read, write.` };
}

export async function cdpWaitForResponse(tab, args = {}) {
  const target = { tabId: tab.id };
  const pattern = String(args.urlPattern || args.url || '*');
  const expectedStatus = args.status !== undefined ? Number(args.status) : null;
  const expectedMethod = args.method ? String(args.method).toUpperCase() : null;
  const timeoutMs = Math.min(Number(args.timeoutMs) || 15000, 60000);

  const attached = await attachCdp(tab);
  if (!attached.ok) return attached;

  return new Promise((resolve) => {
    let timer = null;
    let resolved = false;

    const cleanup = async () => {
      if (timer) clearTimeout(timer);
      chrome.debugger.onEvent.removeListener(onEvent);
      await detachCdp(tab);
    };

    const isMatch = (url, method, status) => {
      if (expectedMethod && method && method.toUpperCase() !== expectedMethod) return false;
      if (expectedStatus !== null && status !== expectedStatus) return false;
      if (pattern === '*' || !pattern) return true;
      if (pattern.startsWith('/') && pattern.endsWith('/')) {
        try { return new RegExp(pattern.slice(1, -1)).test(url); } catch {}
      }
      return url.includes(pattern);
    };

    const onEvent = async (source, method, params) => {
      if (source.tabId !== tab.id) return;
      if (method === 'Network.responseReceived') {
        const resp = params.response;
        if (resp && isMatch(resp.url, resp.requestHeaders?.[':method'] || 'GET', resp.status)) {
          resolved = true;
          let body = null;
          let base64Encoded = false;
          try {
            const bodyRes = await chrome.debugger.sendCommand(target, 'Network.getResponseBody', { requestId: params.requestId });
            body = bodyRes.body;
            base64Encoded = !!bodyRes.base64Encoded;
          } catch (e) {
            body = `[Response body unavailable: ${e.message}]`;
          }

          let parsedJson = null;
          if (!base64Encoded && typeof body === 'string' && (resp.mimeType?.includes('json') || body.trim().startsWith('{') || body.trim().startsWith('['))) {
            try { parsedJson = JSON.parse(body); } catch {}
          }

          await cleanup();
          resolve({
            ok: true,
            data: {
              url: resp.url,
              status: resp.status,
              statusText: resp.statusText,
              headers: resp.headers,
              mimeType: resp.mimeType,
              body: parsedJson !== null ? parsedJson : body,
              base64Encoded,
            },
          });
        }
      }
    };

    timer = setTimeout(async () => {
      if (!resolved) {
        await cleanup();
        resolve({ ok: false, error: `Timeout of ${timeoutMs}ms waiting for network response matching "${pattern}"` });
      }
    }, timeoutMs);

    chrome.debugger.onEvent.addListener(onEvent);
    chrome.debugger.sendCommand(target, 'Network.enable', {}).catch(async (err) => {
      await cleanup();
      resolve({ ok: false, error: `Failed to enable CDP Network: ${err.message}` });
    });
  });
}

export async function cdpWaitForRequest(tab, args = {}) {
  const target = { tabId: tab.id };
  const pattern = String(args.urlPattern || args.url || '*');
  const expectedMethod = args.method ? String(args.method).toUpperCase() : null;
  const timeoutMs = Math.min(Number(args.timeoutMs) || 15000, 60000);

  const attached = await attachCdp(tab);
  if (!attached.ok) return attached;

  return new Promise((resolve) => {
    let timer = null;
    let resolved = false;

    const cleanup = async () => {
      if (timer) clearTimeout(timer);
      chrome.debugger.onEvent.removeListener(onEvent);
      await detachCdp(tab);
    };

    const isMatch = (url, method) => {
      if (expectedMethod && method && method.toUpperCase() !== expectedMethod) return false;
      if (pattern === '*' || !pattern) return true;
      return url.includes(pattern);
    };

    const onEvent = async (source, method, params) => {
      if (source.tabId !== tab.id) return;
      if (method === 'Network.requestWillBeSent') {
        const req = params.request;
        if (req && isMatch(req.url, req.method)) {
          resolved = true;
          await cleanup();
          resolve({
            ok: true,
            data: {
              url: req.url,
              method: req.method,
              headers: req.headers,
              postData: req.postData || null,
              hasPostData: req.hasPostData || false,
            },
          });
        }
      }
    };

    timer = setTimeout(async () => {
      if (!resolved) {
        await cleanup();
        resolve({ ok: false, error: `Timeout of ${timeoutMs}ms waiting for request matching "${pattern}"` });
      }
    }, timeoutMs);

    chrome.debugger.onEvent.addListener(onEvent);
    chrome.debugger.sendCommand(target, 'Network.enable', {}).catch(async (err) => {
      await cleanup();
      resolve({ ok: false, error: `Failed to enable CDP Network: ${err.message}` });
    });
  });
}

export async function cdpWebSocketTraffic(tab, args = {}) {
  const target = { tabId: tab.id };
  const action = String(args.action || 'get').toLowerCase();

  if (action === 'start') {
    const attached = await attachCdp(tab);
    if (!attached.ok) return attached;
    try {
      await chrome.debugger.sendCommand(target, 'Network.enable', {});
      activeWsBuffers.set(tab.id, []);
      return { ok: true, data: { action: 'start', tracking: true, tabId: tab.id } };
    } catch (err) {
      await detachCdp(tab);
      return { ok: false, error: `Failed to start WebSocket tracking: ${err.message}` };
    }
  }

  if (action === 'get' || action === 'stop') {
    const frames = activeWsBuffers.get(tab.id) || [];
    if (action === 'stop') {
      activeWsBuffers.delete(tab.id);
      await detachCdp(tab);
    }
    return { ok: true, data: { tabId: tab.id, frameCount: frames.length, frames: frames.slice(-50) } };
  }

  return { ok: false, error: `Unknown web_websocket_traffic action: ${action}. Supported: start, get, stop.` };
}

export async function cdpHumanType(tab, args = {}) {
  const target = { tabId: tab.id };
  const text = String(args.text || '');
  if (!text) return { ok: false, error: 'text is required for human typing' };

  const attached = await attachCdp(tab);
  if (!attached.ok) return attached;

  try {
    if (args.selector) {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: (sel) => {
          const el = document.querySelector(sel);
          if (el) { el.focus(); el.scrollIntoView({ block: 'center', inline: 'center' }); }
        },
        args: [args.selector],
      }).catch(() => {});
      await new Promise((r) => setTimeout(r, 100));
    }

    const wpm = Number(args.wpm) || 75;
    const baseDelay = Math.round(60000 / (wpm * 5)); // ~160ms

    function gaussian(mean, stdev) {
      let u = 1 - Math.random();
      let v = Math.random();
      let z = Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
      return Math.max(25, Math.round(mean + z * stdev));
    }

    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      const charDelay = gaussian(baseDelay, baseDelay * 0.3);

      if (char === '\n') {
        await chrome.debugger.sendCommand(target, 'Input.dispatchKeyEvent', { type: 'rawKeyDown', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, macCharCode: 13, text: '\r', unmodifiedText: '\r' });
        await new Promise((r) => setTimeout(r, 20));
        await chrome.debugger.sendCommand(target, 'Input.dispatchKeyEvent', { type: 'char', text: '\r', unmodifiedText: '\r' });
        await new Promise((r) => setTimeout(r, 20));
        await chrome.debugger.sendCommand(target, 'Input.dispatchKeyEvent', { type: 'keyUp', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, macCharCode: 13, text: '\r', unmodifiedText: '\r' });
      } else {
        await chrome.debugger.sendCommand(target, 'Input.dispatchKeyEvent', { type: 'keyDown', text: char, unmodifiedText: char });
        await new Promise((r) => setTimeout(r, Math.max(15, Math.round(charDelay * 0.25))));
        await chrome.debugger.sendCommand(target, 'Input.dispatchKeyEvent', { type: 'keyUp', text: char, unmodifiedText: char });
      }

      if (/[.,!?;:\n]/.test(char)) {
        await new Promise((r) => setTimeout(r, gaussian(300, 70)));
      } else if (char === ' ') {
        await new Promise((r) => setTimeout(r, gaussian(150, 35)));
      } else {
        await new Promise((r) => setTimeout(r, charDelay));
      }
    }

    await detachCdp(tab);
    return { ok: true, data: { typedLength: text.length, cadence: 'human_gaussian', estimatedWpm: wpm } };
  } catch (err) {
    await detachCdp(tab);
    return { ok: false, error: `Human typing error: ${err.message}` };
  }
}

export async function cdpHumanScroll(tab, args = {}) {
  const target = { tabId: tab.id };
  const totalDeltaY = Number(args.deltaY ?? 400);
  const totalDeltaX = Number(args.deltaX ?? 0);
  const durationMs = Math.min(Number(args.durationMs) || 500, 3000);
  const steps = Math.max(10, Math.round(durationMs / 25));

  const attached = await attachCdp(tab);
  if (!attached.ok) return attached;

  try {
    const startX = Number(args.x || 400);
    const startY = Number(args.y || 400);

    let scrolledY = 0;
    let scrolledX = 0;

    for (let step = 1; step <= steps; step++) {
      const progress = step / steps;
      const easedProgress = 1 - Math.pow(1 - progress, 3);
      const targetY = Math.round(totalDeltaY * easedProgress);
      const targetX = Math.round(totalDeltaX * easedProgress);

      const dy = targetY - scrolledY;
      const dx = targetX - scrolledX;
      scrolledY = targetY;
      scrolledX = targetX;

      await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', {
        type: 'mouseWheel',
        x: startX + Math.round((Math.random() - 0.5) * 2),
        y: startY + Math.round((Math.random() - 0.5) * 2),
        deltaX: dx,
        deltaY: dy,
      });

      await new Promise((r) => setTimeout(r, Math.round(durationMs / steps)));
    }

    await detachCdp(tab);
    return { ok: true, data: { scrolledX, scrolledY, durationMs, steps, easing: 'cubic_bezier_ease_out' } };
  } catch (err) {
    await detachCdp(tab);
    return { ok: false, error: `Human scroll error: ${err.message}` };
  }
}

export async function cdpScreencast(tab, args = {}) {
  const target = { tabId: tab.id };
  const action = String(args.action || 'start').toLowerCase();

  if (action === 'start') {
    const attached = await attachCdp(tab);
    if (!attached.ok) return attached;
    try {
      await chrome.debugger.sendCommand(target, 'Page.enable', {});
      activeScreencasts.set(tab.id, []);
      const format = args.format === 'png' ? 'png' : 'jpeg';
      const quality = Math.min(100, Math.max(1, Number(args.quality) || 75));
      const everyNthFrame = Math.max(1, Number(args.everyNthFrame) || 2);

      await chrome.debugger.sendCommand(target, 'Page.startScreencast', {
        format,
        quality,
        maxWidth: 1024,
        maxHeight: 768,
        everyNthFrame,
      });

      return { ok: true, data: { action: 'start', recording: true, format, quality, tabId: tab.id } };
    } catch (err) {
      await detachCdp(tab);
      return { ok: false, error: `Failed to start screencast: ${err.message}` };
    }
  }

  if (action === 'stop' || action === 'get') {
    const frames = activeScreencasts.get(tab.id) || [];
    if (action === 'stop') {
      try { await chrome.debugger.sendCommand(target, 'Page.stopScreencast', {}); } catch {}
      activeScreencasts.delete(tab.id);
      await detachCdp(tab);
    }
    return {
      ok: true,
      data: {
        tabId: tab.id,
        frameCount: frames.length,
        durationMs: frames.length > 1 ? frames[frames.length - 1].ts - frames[0].ts : 0,
        sampleFrames: frames.slice(0, 5).map((f) => ({ ts: f.ts, metadata: f.metadata, preview: f.data ? f.data.slice(0, 80) + '...' : '' })),
      },
    };
  }

  return { ok: false, error: `Unknown web_screencast action: ${action}. Supported: start, get, stop.` };
}

// ── web_har_record: real CDP Network capture assembled into HAR 1.2 ────────
export async function cdpHarRecord(tab, args) {
  const action = String(args.action || 'start').toLowerCase();
  if (action === 'start') {
    if (activeHars.has(tab.id)) return { ok: false, error: 'HAR recording is already active on this tab — stop it first.' };
    const attached = await attachCdp(tab);
    if (!attached.ok) return attached;
    try {
      await chrome.debugger.sendCommand({ tabId: tab.id }, 'Network.enable');
    } catch (e) {
      await detachCdp(tab);
      return { ok: false, error: `Network.enable failed: ${String((e && e.message) || e)}` };
    }
    activeHars.set(tab.id, {
      startedAt: Date.now(),
      pending: new Map(),
      entries: [],
      maxEntries: Math.min(Number(args.maxEntries) || 500, 2000),
      filter: args.filter ? String(args.filter) : '',
      bodies: args.bodies === true,
      bodyBytes: 0,
    });
    const rec = activeHars.get(tab.id);
    return { ok: true, data: { recording: true, filter: rec.filter || null, maxEntries: rec.maxEntries, bodies: rec.bodies, startedAt: new Date().toISOString(), note: 'Navigate or interact with the page; stop to assemble the HAR.' } };
  }
  if (action === 'get') {
    const rec = activeHars.get(tab.id);
    if (!rec) return { ok: false, error: 'No HAR recording is active on this tab. Start one first.' };
    return { ok: true, data: { recording: true, elapsedMs: Date.now() - rec.startedAt, captured: rec.entries.length, inFlight: rec.pending.size } };
  }
  if (action === 'stop') {
    const rec = activeHars.get(tab.id);
    if (!rec) return { ok: false, error: 'No HAR recording is active on this tab.' };
    try { await chrome.debugger.sendCommand({ tabId: tab.id }, 'Network.disable'); } catch {}
    activeHars.delete(tab.id);
    await detachCdp(tab);
    const har = {
      log: {
        version: '1.2',
        creator: { name: 'ScreenSync MCP Extension', version: (chrome.runtime && chrome.runtime.getManifest) ? chrome.runtime.getManifest().version : '1.2.0' },
        entries: rec.entries,
      },
    };
    const out = { entryCount: rec.entries.length, elapsedMs: Date.now() - rec.startedAt, droppedInFlight: rec.pending.size, bodyBytes: rec.bodyBytes || 0, bodiesWithText: rec.entries.filter((e) => e.response.content && e.response.content.text).length, bodyErrors: rec.bodyErrors || [] };
    if (args.download === true) {
      try {
        const b64 = btoa(unescape(encodeURIComponent(JSON.stringify(har))));
        await chrome.downloads.download({ url: 'data:application/json;base64,' + b64, filename: args.filename || ('screensync-har-' + Date.now() + '.har'), saveAs: false });
        out.downloaded = true;
      } catch (e) { out.downloadError = String((e && e.message) || e); }
    }
    out.har = har;
    return { ok: true, data: out };
  }
  return { ok: false, error: 'Unknown web_har_record action: ' + action + '. Supported: start, get, stop.' };
}

// ── web_video_record: screencast frames → offscreen MediaRecorder → WebM ───
export async function cdpVideoRecord(tab, args) {
  const action = String(args.action || 'start').toLowerCase();
    if (action === 'start') {
    if (activeVideoRecs.has(tab.id)) return { ok: false, error: 'Already recording this tab — call web_video_record {action:"stop"} first.' };
    const attached = await attachCdp(tab);
    if (!attached.ok) return attached;
    // Register BEFORE startScreencast so the initial frame(s) are captured —
    // a screencast only emits frames on page paints.
    activeVideoRecs.set(tab.id, { startedAt: Date.now(), fps: Math.min(Math.max(Number(args.fps) || 15, 5), 30), frameCount: 0 });
    try { await chrome.debugger.sendCommand({ tabId: tab.id }, 'Page.enable'); } catch {}
    const fps = Math.min(Math.max(Number(args.fps) || 15, 5), 30);
    const maxWidth = Math.min(Number(args.maxWidth) || 1280, 1920);
    const maxHeight = Math.min(Number(args.maxHeight) || 800, 1080);
    try {
      await chrome.debugger.sendCommand({ tabId: tab.id }, 'Page.startScreencast', { format: 'jpeg', quality: 60, maxWidth, maxHeight, everyNthFrame: 1 });
    } catch (e) {
      activeVideoRecs.delete(tab.id);
      await detachCdp(tab);
      return { ok: false, error: `Screencast start failed: ${String((e && e.message) || e)}` };
    }
    let off = null;
    try { off = await chrome.runtime.sendMessage({ type: 'video-start', fps, width: maxWidth, height: maxHeight }); } catch (e) { off = { ok: false, error: String((e && e.message) || e) }; }
    if (!off || !off.ok) {
      try { await chrome.debugger.sendCommand({ tabId: tab.id }, 'Page.stopScreencast'); } catch {}
      activeVideoRecs.delete(tab.id);
      await detachCdp(tab);
      return { ok: false, error: 'Offscreen video engine failed to start: ' + ((off && off.error) || 'no response') };
    }
    return { ok: true, data: { recording: true, fps, maxWidth, maxHeight, mimeType: off.mimeType || 'video/webm', startedAt: new Date().toISOString(), note: 'Frames are streaming to the recorder. Stop within 60s.' } };
  }
  if (action === 'stop') {
    const rec = activeVideoRecs.get(tab.id);
    if (!rec) return { ok: false, error: 'No active recording on this tab.' };
    try { await chrome.debugger.sendCommand({ tabId: tab.id }, 'Page.stopScreencast'); } catch {}
    let res = null;
    try { res = await chrome.runtime.sendMessage({ type: 'video-stop' }); } catch (e) { res = { ok: false, error: String((e && e.message) || e) }; }
    activeVideoRecs.delete(tab.id);
    await detachCdp(tab);
    if (!res || !res.ok) return { ok: false, error: 'Offscreen video assembly failed: ' + ((res && res.error) || 'no response') };
    const out = {
      durationMs: res.durationMs || (Date.now() - rec.startedAt),
      frameCount: res.frameCount != null ? res.frameCount : rec.frameCount,
      bytes: res.bytes || 0,
      mimeType: 'video/webm',
    };
    if (args.download === true && res.webmBase64) {
      try {
        await chrome.downloads.download({ url: 'data:video/webm;base64,' + res.webmBase64, filename: args.filename || ('screensync-video-' + Date.now() + '.webm'), saveAs: false });
        out.downloaded = true;
      } catch (e) { out.downloadError = String((e && e.message) || e); }
    }
    if (args.returnData === true || (res.webmBase64 && res.webmBase64.length < 3000000)) {
      out.webmBase64 = res.webmBase64;
    } else {
      out.preview = (res.webmBase64 || '').slice(0, 64) + '... (use download:true or returnData:true to receive the full WebM)';
    }
    return { ok: true, data: out };
  }
  return { ok: false, error: 'Unknown web_video_record action: ' + action + '. Supported: start, stop.' };
}

// ── web_clock_set / web_clock_clear: Playwright clock parity ───────────────
function clockScriptSource(offsetMs) {
  return `(function(){const O=${Number(offsetMs) | 0};if(!window.__ssOriginalDate)window.__ssOriginalDate=window.Date;const D=window.__ssOriginalDate;function SSD(...a){return a.length===0?new D(D.now()+O):new D(...a);}SSD.now=function(){return D.now()+O;};SSD.parse=D.parse;SSD.UTC=D.UTC;SSD.prototype=D.prototype;window.Date=SSD;})();`;
}

export async function cdpClockSet(tab, args) {
  const offsetMs = Math.round(Number(args.offsetMs) || 0);
  const effective = args.iso ? (Date.parse(String(args.iso)) - Date.now()) : offsetMs;
  if (!Number.isFinite(effective)) return { ok: false, error: 'web_clock_set requires a finite offsetMs or a valid ISO timestamp.' };
  const target = { tabId: tab.id };
  let attachedHere = false;
  try {
    try {
      await rawAttach(target);
      attachedHere = true;
    } catch (e) {
      if (!/already attached/i.test(String((e && e.message) || e))) throw e;
    }
    const src = clockScriptSource(effective);
    const res = await chrome.debugger.sendCommand(target, 'Page.addScriptToEvaluateOnNewDocument', { source: src, runImmediately: true });
    const prev = activeClocks.get(tab.id);
    if (prev && prev.scriptId) {
      try { await chrome.debugger.sendCommand(target, 'Page.removeScriptToEvaluateOnNewDocument', { identifier: prev.scriptId }); } catch {}
    }
    activeClocks.set(tab.id, { scriptId: res.identifier, offsetMs: effective });
    try { await chrome.debugger.sendCommand(target, 'Runtime.evaluate', { expression: src }); } catch {}
    return { ok: true, data: { clockShifted: true, offsetMs: effective, fixedAt: args.iso || undefined, pageNowIso: new Date(Date.now() + effective).toISOString(), persistsAcrossNavigations: true } };
  } catch (e) {
    return { ok: false, error: `web_clock_set failed: ${String((e && e.message) || e)}` };
  } finally {
    if (attachedHere) { await rawDetach(target); }
  }
}

export async function cdpClockClear(tab) {
  const target = { tabId: tab.id };
  const rec = activeClocks.get(tab.id);
  let attachedHere = false;
  try {
    try {
      await rawAttach(target);
      attachedHere = true;
    } catch (e) {
      if (!/already attached/i.test(String((e && e.message) || e))) throw e;
    }
    if (rec && rec.scriptId) {
      try { await chrome.debugger.sendCommand(target, 'Page.removeScriptToEvaluateOnNewDocument', { identifier: rec.scriptId }); } catch {}
    }
    try {
      await chrome.debugger.sendCommand(target, 'Runtime.evaluate', { expression: 'if(window.__ssOriginalDate){window.Date=window.__ssOriginalDate;delete window.__ssOriginalDate;}' });
    } catch {}
    activeClocks.delete(tab.id);
    return { ok: true, data: { clockRestored: true } };
  } catch (e) {
    return { ok: false, error: `web_clock_clear failed: ${String((e && e.message) || e)}` };
  } finally {
    if (attachedHere) { await rawDetach(target); }
  }
}

// ── web_run_code: Playwright run_code — CDP Runtime.evaluate with the user
// code inlined (no inner eval), so it works on pages whose CSP forbids eval ──
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
const TRACE_CATEGORIES = [
  'devtools.timeline',
  'v8.execute',
  'disabled-by-default-devtools.timeline',
  'disabled-by-default-devtools.timeline.frame',
  'toplevel',
  'javascript',
];

export async function cdpTraceRecord(tab, args) {
  const action = String(args.action || 'start').toLowerCase();
  if (action === 'start') {
    if (activeTraces.has(tab.id)) return { ok: false, error: 'A trace is already being recorded on this tab — stop it first.' };
    const attached = await attachCdp(tab);
    if (!attached.ok) return attached;
    const categories = Array.isArray(args.categories) && args.categories.length
      ? args.categories.map(String)
      : TRACE_CATEGORIES;
    try {
      await chrome.debugger.sendCommand({ tabId: tab.id }, 'Tracing.start', {
        traceConfig: { recordMode: args.recordMode || 'recordContinuously', categories: { included: categories, excluded: [] } },
      });
    } catch (e) {
      await detachCdp(tab);
      return { ok: false, error: `Tracing.start failed: ${String((e && e.message) || e)}` };
    }
    activeTraces.set(tab.id, {
      startedAt: Date.now(),
      chunks: [],
      eventCount: 0,
      complete: false,
      maxEvents: Math.min(Number(args.maxEvents) || 20000, 100000),
    });
    return { ok: true, data: { recording: true, categories, maxEvents: activeTraces.get(tab.id).maxEvents, startedAt: new Date().toISOString(), note: 'Trace is capturing timeline/v8 events. Stop to assemble the Chrome trace JSON.' } };
  }
  if (action === 'get') {
    const rec = activeTraces.get(tab.id);
    if (!rec) return { ok: false, error: 'No trace recording active on this tab. Start one first.' };
    return { ok: true, data: { recording: true, elapsedMs: Date.now() - rec.startedAt, eventCount: rec.eventCount, complete: rec.complete } };
  }
  if (action === 'stop') {
    const rec = activeTraces.get(tab.id);
    if (!rec) return { ok: false, error: 'No trace recording active on this tab.' };
    try { await chrome.debugger.sendCommand({ tabId: tab.id }, 'Tracing.end'); } catch {}
    // Tracing delivers the remaining chunks before tracingComplete fires.
    const deadline = Date.now() + 6000;
    while (!rec.complete && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 150));
    }
    activeTraces.delete(tab.id);
    await detachCdp(tab);
    const trace = { traceEvents: rec.chunks, metadata: { tabId: tab.id, recordedBy: 'ScreenSync MCP Extension', durationMs: Date.now() - rec.startedAt } };
    const out = { eventCount: rec.eventCount, durationMs: Date.now() - rec.startedAt, complete: rec.complete, truncated: rec.eventCount >= rec.maxEvents };
    if (args.download === true) {
      try {
        const b64 = btoa(unescape(encodeURIComponent(JSON.stringify(trace))));
        await chrome.downloads.download({ url: 'data:application/json;base64,' + b64, filename: args.filename || ('screensync-trace-' + Date.now() + '.json'), saveAs: false });
        out.downloaded = true;
      } catch (e) { out.downloadError = String((e && e.message) || e); }
    }
    if (args.returnData === true || JSON.stringify(trace).length < 3000000) {
      out.trace = trace;
    } else {
      out.trace = undefined;
      out.preview = 'trace too large to inline — use download:true (saved as Chrome trace JSON, openable in chrome://tracing / DevTools Performance)';
    }
    return { ok: true, data: out };
  }
  return { ok: false, error: 'Unknown web_trace_record action: ' + action + '. Supported: start, get, stop.' };
}

export async function execAdvTool(tool, tab, args) {
  switch (tool) {
    case 'web_eval': {
      const res = await main(tab, ssEval, args);
      if (!res.ok && res.error && (res.error.includes('Content Security Policy') || res.error.includes('violates the following'))) {
        return cdpEval(tab, args);
      }
      return res;
    }
    case 'web_console': await ensureHooks(tab); return main(tab, ssReadBuffer, { ...args, kind: 'console' });
    case 'web_network': await ensureHooks(tab); return main(tab, ssReadBuffer, { ...args, kind: 'network' });
    case 'web_dialog': await ensureHooks(tab); return main(tab, ssReadBuffer, { ...args, kind: 'dialog' });
    case 'web_storage': return main(tab, ssStorage, args);
    case 'web_perf': return main(tab, ssPerf, args);
    case 'web_wait_for': return isolated(tab, ssWaitFor, args);
    case 'web_key': return isolated(tab, ssKey, args);
    case 'web_hover': return isolated(tab, ssHover, args);
    case 'web_select': return isolated(tab, ssSelect, args);
    case 'web_cdp_click': return cdpInput(tab, 'click', args);
    case 'web_cdp_type': return cdpInput(tab, 'type', args);
    case 'web_full_screenshot': return cdpScreenshot(tab, args);
    case 'web_pdf': return cdpPdf(tab, args);
    case 'web_cdp_eval': return cdpEval(tab, args);
    case 'web_a11y_tree': return cdpAXTree(tab, args);
    case 'web_stealth_cloak': return cdpStealthCloak(tab, args);
    case 'web_export_har': return cdpExportHar(tab, args);
    case 'web_human_mouse': return cdpHumanMouse(tab, args);
    case 'web_network_mock': return cdpNetworkMock(tab, args);
    case 'web_element_screenshot': return cdpElementScreenshot(tab, args);
    case 'web_emulate': return cdpEmulate(tab, args);
    case 'web_upload_file': return cdpUploadFile(tab, args);
    case 'web_key_combo': return cdpKeyCombo(tab, args);
    case 'web_mouse': return cdpMouse(tab, args);
    case 'web_touch': return cdpTouch(tab, args);
    case 'web_grant_permissions': return cdpGrantPermissions(tab, args);
    case 'web_set_timezone': return cdpSetTimezone(tab, args);
    case 'web_route': return cdpRoute(tab, args);
    case 'web_dialog_rule': return cdpDialogRule(tab, args);
    case 'web_coverage': return cdpCoverage(tab, args);
    case 'web_set_geolocation': return cdpSetGeolocation(tab, args);
    case 'web_throttle_network': return cdpThrottleNetwork(tab, args);
    case 'web_set_color_scheme': return cdpSetColorScheme(tab, args);
    case 'web_clipboard': return cdpClipboard(tab, args);
    case 'web_wait_for_response': return cdpWaitForResponse(tab, args);
    case 'web_wait_for_request': return cdpWaitForRequest(tab, args);
    case 'web_websocket_traffic': return cdpWebSocketTraffic(tab, args);
    case 'web_human_type': return cdpHumanType(tab, args);
    case 'web_human_scroll': return cdpHumanScroll(tab, args);
    case 'web_screencast': return cdpScreencast(tab, args);
    case 'web_run_code': return cdpRunCode(tab, args);
    case 'web_har_record': return cdpHarRecord(tab, args);
    case 'web_trace_record': return cdpTraceRecord(tab, args);
    case 'web_video_record': return cdpVideoRecord(tab, args);
    case 'web_clock_set': return cdpClockSet(tab, args);
    case 'web_clock_clear': return cdpClockClear(tab, args);
    default: return { ok: false, error: `Unknown advanced tool: ${tool}` };
  }
}
