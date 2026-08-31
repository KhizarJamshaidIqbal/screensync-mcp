import { getSettings } from './storage.js';
import { hubFetch } from './api.js';

// Browser-side executor for the hub's web bridge. The hub pushes
// {type:'web_request', id, tool, args} over SSE; we run the tool against the
// user's active tab and POST the result back to /api/web/result.
//
// chrome.scripting.executeScript serializes the injected function, so every
// page-side behaviour lives inside ONE self-contained unit (ssWebUnit) that
// dispatches on args.__tool. No outer-scope references are allowed in it.

function ssWebUnit(args) {
  const SEL = [
    'a[href]', 'button', 'input', 'textarea', 'select',
    '[role="button"]', '[role="link"]', '[role="checkbox"]', '[role="tab"]',
    '[onclick]', '[contenteditable="true"]', '[contenteditable=""]', 'summary',
  ].join(', ');

  function collect() {
    const out = [];
    const seen = new Set();
    for (const el of document.querySelectorAll(SEL)) {
      if (seen.has(el)) continue;
      seen.add(el);
      const style = window.getComputedStyle(el);
      if (style.visibility === 'hidden' || style.display === 'none') continue;
      const rect = el.getBoundingClientRect();
      if (rect.width < 2 && rect.height < 2) continue;
      const label = (el.innerText || el.value || el.placeholder || el.getAttribute('aria-label') || el.getAttribute('alt') || '')
        .replace(/\s+/g, ' ').trim().slice(0, 80);
      let selectorPath = '';
      if (el.id) selectorPath = '#' + (window.CSS && CSS.escape ? CSS.escape(el.id) : el.id);
      else {
        const parts = [];
        let node = el;
        while (node && node !== document.body && parts.length < 6) {
          if (node.id) { parts.unshift('#' + node.id); break; }
          let part = node.tagName.toLowerCase();
          const parent = node.parentElement;
          if (parent) {
            const siblings = Array.from(parent.children).filter((c) => c.tagName === node.tagName);
            if (siblings.length > 1) part += ':nth-of-type(' + (siblings.indexOf(node) + 1) + ')';
          }
          parts.unshift(part);
          node = parent;
        }
        selectorPath = parts.join(' > ');
      }
      out.push({
        index: out.length,
        tag: el.tagName.toLowerCase(),
        type: el.getAttribute('type') || undefined,
        text: label || undefined,
        selector: selectorPath,
        x: Math.round(rect.x + rect.width / 2),
        y: Math.round(rect.y + rect.height / 2),
      });
      if (out.length >= 250) break;
    }
    return out;
  }

  function findBy(a) {
    const list = collect();
    if (typeof a.selector === 'string' && a.selector) {
      const el = document.querySelector(a.selector);
      return el ? { el, via: 'selector' } : null;
    }
    if (typeof a.index === 'number') {
      const meta = list[a.index];
      if (!meta) return null;
      const el = document.querySelector(meta.selector);
      return el ? { el, via: 'index', meta } : null;
    }
    if (typeof a.text === 'string' && a.text) {
      const q = a.text.trim().toLowerCase();
      let best = null;
      for (const meta of list) {
        if (!meta.text) continue;
        const t = meta.text.toLowerCase();
        if (t === q || t.includes(q)) {
          const el = document.querySelector(meta.selector);
          if (!el) continue;
          const r = el.getBoundingClientRect();
          const area = r.width * r.height;
          if (!best || area < best.area) best = { el, via: 'text', meta, area };
        }
      }
      return best ? { el: best.el, via: best.via, meta: best.meta } : null;
    }
    return null;
  }

  if (args.__tool === 'web_hierarchy') {
    return {
      ok: true,
      data: {
        url: location.href,
        title: document.title,
        text: (document.body && document.body.innerText ? document.body.innerText : '').replace(/\n{3,}/g, '\n\n').slice(0, 8000),
        elements: collect(),
      },
    };
  }

  if (args.__tool === 'web_click') {
    const hit = findBy(args);
    if (!hit) return { ok: false, error: 'Element not found. Call web_hierarchy again — the page may have changed.' };
    const el = hit.el;
    el.scrollIntoView({ block: 'center', inline: 'center' });
    el.click();
    const label = (el.innerText || el.value || el.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim().slice(0, 80);
    return { ok: true, data: { clicked: label || el.tagName.toLowerCase(), via: hit.via, url: location.href } };
  }

  if (args.__tool === 'web_type') {
    const hit = findBy(args);
    if (!hit) return { ok: false, error: 'Input not found. Call web_hierarchy again — the page may have changed.' };
    const el = hit.el;
    el.scrollIntoView({ block: 'center' });
    el.focus();
    const text = String(args.text == null ? '' : args.text);
    if (el.isContentEditable) {
      el.textContent = text;
      el.dispatchEvent(new Event('input', { bubbles: true }));
    } else if (el.tagName === 'SELECT') {
      el.value = text;
      el.dispatchEvent(new Event('change', { bubbles: true }));
    } else {
      const proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value') && Object.getOwnPropertyDescriptor(proto, 'value').set;
      if (setter) setter.call(el, text); else el.value = text;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }
    if (args.submit) {
      const form = el.form;
      if (form && typeof form.requestSubmit === 'function') form.requestSubmit();
      else if (form) form.submit();
      else {
        ['keydown', 'keypress', 'keyup'].forEach((type) => {
          el.dispatchEvent(new KeyboardEvent(type, { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
        });
      }
    }
    return { ok: true, data: { typed: text.slice(0, 120), into: el.tagName.toLowerCase(), submitted: !!args.submit, url: location.href } };
  }

  if (args.__tool === 'web_scroll') {
    const amount = Math.min(Math.max(Number(args.amount) || 0.6, 0.1), 1);
    const dx = args.direction === 'left' ? -window.innerWidth * amount : args.direction === 'right' ? window.innerWidth * amount : 0;
    const dy = args.direction === 'up' ? -window.innerHeight * amount : args.direction === 'down' ? window.innerHeight * amount : 0;
    const before = { x: window.scrollX, y: window.scrollY };
    window.scrollBy(dx, dy);
    return { ok: true, data: { direction: args.direction, before, after: { x: window.scrollX, y: window.scrollY }, viewport: { w: window.innerWidth, h: window.innerHeight } } };
  }

  return { ok: false, error: 'Unknown web tool: ' + args.__tool };
}

const RESTRICTED_TAB = /^(chrome|edge|about|view-source|devtools|chrome-extension):/;

async function pickActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tabs.length) throw new Error('No active browser tab found.');
  return tabs[0];
}

async function inject(tab, args) {
  if (RESTRICTED_TAB.test(tab.url || '')) {
    return { ok: false, error: `Cannot run web tools on this tab (${tab.url}). Switch to a normal web page first.` };
  }
  try {
    const results = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: ssWebUnit, args: [args] });
    return (results && results[0] && results[0].result) || { ok: false, error: 'Injection returned no result.' };
  } catch (e) {
    return { ok: false, error: `Cannot access that page: ${String((e && e.message) || e)}` };
  }
}

function waitForTabComplete(tabId, timeoutMs) {
  return new Promise((resolve) => {
    const onUpdated = (id, info) => {
      if (id === tabId && info.status === 'complete') finish();
    };
    const timer = setTimeout(finish, timeoutMs);
    function finish() {
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      resolve();
    }
    chrome.tabs.onUpdated.addListener(onUpdated);
  });
}

async function executeWebTool(tool, args) {
  switch (tool) {
    case 'web_status': {
      const tab = await pickActiveTab();
      return { ok: true, data: { activeTab: { url: tab.url, title: tab.title } } };
    }
    case 'web_screenshot': {
      const tab = await pickActiveTab();
      if (RESTRICTED_TAB.test(tab.url || '')) {
        return { ok: false, error: `Cannot capture this tab (${tab.url}). Switch to a normal web page first.` };
      }
      const imageDataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'jpeg', quality: 85 });
      return { ok: true, data: { imageDataUrl, url: tab.url, title: tab.title } };
    }
    case 'web_navigate': {
      const url = String(args.url || '');
      if (!/^https?:/i.test(url)) return { ok: false, error: 'Only http(s) URLs are supported.' };
      const current = await pickActiveTab();
      const tab = args.newTab ? await chrome.tabs.create({ url }) : await chrome.tabs.update(current.id, { url });
      await waitForTabComplete(tab.id, 20000);
      const after = await chrome.tabs.get(tab.id);
      return { ok: true, data: { tabId: tab.id, url: after.url, title: after.title, status: after.status } };
    }
    case 'web_hierarchy':
    case 'web_click':
    case 'web_type':
    case 'web_scroll': {
      const tab = await pickActiveTab();
      return inject(tab, { ...args, __tool: tool });
    }
    default:
      return { ok: false, error: `Unknown web tool: ${tool}` };
  }
}

// ── Registration / heartbeat ──
export async function registerWebBridge() {
  const s = await getSettings();
  if (!s.onboardingComplete) return;
  let tab = null;
  try {
    const [t] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (t && t.url && !RESTRICTED_TAB.test(t.url)) tab = { url: t.url, title: t.title };
  } catch { /* browser has no usable tab yet */ }
  try {
    await hubFetch('/api/web/register', { method: 'POST', body: { webAccessEnabled: !!s.webAccessEnabled, tab, userAgent: navigator.userAgent } });
  } catch { /* hub offline — presence simply stays stale */ }
}

export async function handleWebRequest(req) {
  const { id, tool, args = {} } = req || {};
  let out;
  try {
    const s = await getSettings();
    if (!s.webAccessEnabled) {
      out = { ok: false, error: 'Web access is disabled. Enable the "Web access for AI agents" toggle in the ScreenSync extension dashboard.' };
    } else {
      out = await executeWebTool(tool, args);
    }
  } catch (e) {
    out = { ok: false, error: String((e && e.message) || e) };
  }
  try {
    await hubFetch('/api/web/result', { method: 'POST', body: { id, ok: !!out.ok, data: out.data, error: out.error } });
  } catch { /* hub gone — nothing to resolve */ }
}
