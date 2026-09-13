// ScreenSync Agent Unit — Playwright-grade assertions, snapshots & structured reads
// Self-contained executor for: web_expect, web_aria_snapshot, web_table_extract,
// web_get_by, web_fill, web_check, web_focus, web_scroll_to, web_run_code, web_media_extract

export async function ssWebUnitAgent(args) {
  try {
    if (navigator.webdriver) Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    if (!window.chrome) window.chrome = { runtime: {} };
  } catch {}

  function visible(el) {
    try {
      const r = el.getBoundingClientRect();
      const s = window.getComputedStyle(el);
      return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden' && s.opacity !== '0';
    } catch { return false; }
  }

  function ripple(x, y, color = '#10B981') {
    try {
      const ring = document.createElement('div');
      ring.setAttribute('data-ss-halo', 'true');
      ring.style.cssText = `position:fixed;left:${x}px;top:${y}px;width:44px;height:44px;margin-left:-22px;margin-top:-22px;border-radius:50%;border:2px solid ${color};box-shadow:0 0 18px ${color};pointer-events:none;z-index:2147483647;transform:scale(0.3);transition:transform 0.65s cubic-bezier(0.1,0.9,0.2,1),opacity 0.65s ease-out;`;
      (document.body || document.documentElement).appendChild(ring);
      requestAnimationFrame(() => { ring.style.transform = 'scale(2.0)'; ring.style.opacity = '0'; });
      setTimeout(() => { try { ring.remove(); } catch {} }, 750);
    } catch {}
  }

  function findDeep(selector, root = document) {
    try {
      const found = root.querySelector(selector);
      if (found) return found;
    } catch {}
    try {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, null);
      while (walker.nextNode()) {
        const el = walker.currentNode;
        if (el && el.shadowRoot) {
          const sf = findDeep(selector, el.shadowRoot);
          if (sf) return sf;
        }
      }
    } catch {}
    return null;
  }

  function roleOf(el) {
    const explicit = el.getAttribute && el.getAttribute('role');
    if (explicit) return explicit.toLowerCase();
    const tag = (el.tagName || '').toLowerCase();
    const type = (el.getAttribute('type') || '').toLowerCase();
    if (el.getAttribute && el.getAttribute('onclick')) return 'button';
    if (tag === 'a' && el.getAttribute('href')) return 'link';
    if (tag === 'button' || (tag === 'input' && ['button', 'submit', 'reset'].includes(type))) return 'button';
    if (tag === 'input' || tag === 'textarea' || el.isContentEditable) return type === 'checkbox' ? 'checkbox' : type === 'radio' ? 'radio' : (type === 'file' ? 'button' : 'textbox');
    if (tag === 'select') return 'combobox';
    if (/^h[1-6]$/.test(tag)) return 'heading';
    if (tag === 'img') return 'img';
    if (tag === 'nav') return 'navigation';
    if (tag === 'main') return 'main';
    if (tag === 'header') return 'banner';
    if (tag === 'footer') return 'contentinfo';
    if (tag === 'ul' || tag === 'ol') return 'list';
    if (tag === 'li') return 'listitem';
    if (tag === 'table') return 'table';
    if (tag === 'form') return 'form';
    if (tag === 'dialog' || (el.getAttribute && el.getAttribute('aria-modal') === 'true')) return 'dialog';
    if (['div', 'span', 'p', 'section', 'article', 'aside', 'address', 'figure', 'figcaption'].includes(tag)) return 'generic';
    return tag;
  }

  function nameOf(el) {
    return (el.getAttribute('aria-label') || el.innerText || el.value || el.getAttribute('placeholder') || el.getAttribute('alt') || el.title || '').trim().replace(/\s+/g, ' ').slice(0, 120);
  }

  function safeJson(v) {
    try { return JSON.parse(JSON.stringify(v)); } catch { return String(v); }
  }

  // Compact Playwright locator resolver: css=, >>>, pierce/, :has-text(), xpath=,
  // role=[name="..."], placeholder=, label=, text=, testid=, bare CSS/text.
  function pwFind(sel, root = document) {
    if (!sel || typeof sel !== 'string') return null;
    sel = sel.trim();
    if (sel.startsWith('css=')) sel = sel.slice(4).trim();
    if (sel.includes('>>>')) {
      let cur = root, hit = null;
      for (const part of sel.split(/\s*>>>\s*/)) {
        if (!part) continue;
        hit = cur.querySelector(part) || findDeep(part, cur);
        if (!hit) return null;
        cur = hit.shadowRoot || hit;
      }
      if (hit) return hit;
    }
    if (sel.startsWith('pierce/')) { const el = findDeep(sel.slice(7).trim(), document); if (el) return el; }
    if (sel.includes(':has-text(')) {
      const m = sel.match(/^([^:]+):has-text\(["']?([^"')]+)["']?\)$/);
      if (m) {
        for (const c of document.querySelectorAll(m[1].trim())) {
          if ((c.innerText || '').toLowerCase().includes(m[2].trim().toLowerCase())) return c;
        }
      }
    }
    if (sel.startsWith('xpath=')) sel = sel.slice(6);
    if (sel.startsWith('//') || sel.startsWith('(//')) {
      try {
        const r = document.evaluate(sel, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
        if (r.singleNodeValue) return r.singleNodeValue;
      } catch {}
      return null;
    }
    if (sel.startsWith('role=')) {
      const m = sel.slice(5).match(/^([a-zA-Z_-]+)(?:\[name=["']([^"']+)["']\])?/);
      if (m) {
        const role = m[1].toLowerCase();
        const want = m[2] ? m[2].toLowerCase() : null;
        for (const el of document.querySelectorAll('*')) {
          if (roleOf(el) !== role) continue;
          if (!want || nameOf(el).toLowerCase().includes(want)) return el;
        }
      }
      return null;
    }
    if (sel.startsWith('placeholder=')) {
      const ph = sel.slice(12).replace(/^["']|["']$/g, '');
      return document.querySelector(`[placeholder="${ph}"], [placeholder*="${ph}" i]`);
    }
    if (sel.startsWith('label=')) {
      const lbl = sel.slice(6).replace(/^["']|["']$/g, '').toLowerCase();
      const aria = document.querySelector(`[aria-label="${lbl}" i], [aria-label*="${lbl}" i]`);
      if (aria) return aria;
      for (const l of document.querySelectorAll('label')) {
        if ((l.innerText || '').toLowerCase().includes(lbl)) {
          if (l.htmlFor && document.getElementById(l.htmlFor)) return document.getElementById(l.htmlFor);
          const nested = l.querySelector('input, textarea, select');
          if (nested) return nested;
        }
      }
      return null;
    }
    if (sel.startsWith('text=')) {
      const txt = sel.slice(5).replace(/^["']|["']$/g, '').toLowerCase();
      for (const el of document.querySelectorAll('button, a, span, p, div, label, li, td, th, h1, h2, h3')) {
        if ((el.innerText || '').toLowerCase().trim() === txt) return el;
      }
      for (const el of document.querySelectorAll('button, a, span, p, div, label, li, td, th, h1, h2, h3')) {
        if ((el.innerText || '').toLowerCase().includes(txt)) return el;
      }
      return null;
    }
    if (sel.startsWith('testid=')) {
      const v = sel.slice(7).replace(/^["']|["']$/g, '');
      return document.querySelector(`[data-testid="${v}"], [data-test="${v}"], [data-cy="${v}"]`);
    }
    try { return root.querySelector(sel) || findDeep(sel, document); } catch { return null; }
  }

  async function findWithRetry(a, maxWaitMs = 2500) {
    const start = Date.now();
    while (Date.now() - start < maxWaitMs) {
      let el = null;
      if (a.selector) el = pwFind(a.selector);
      if (!el && (typeof a.ref === 'number' || typeof a.index === 'number')) {
        el = document.querySelector(`[data-ss-id="${a.ref !== undefined ? a.ref : a.index}"]`);
      }
      if (el) return el;
      await new Promise((r) => setTimeout(r, 150));
    }
    return null;
  }

  function targetDesc(el) {
    const r = el.getBoundingClientRect();
    return {
      tag: el.tagName.toLowerCase(), role: roleOf(el), name: nameOf(el),
      rect: { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) },
      center: { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) },
    };
  }

  // ── web_expect: Playwright expect() — auto-retrying assertion with polling ──
  if (args.__tool === 'web_expect') {
    const condition = String(args.condition || 'visible').toLowerCase();
    const timeoutMs = Math.min(Number(args.timeoutMs) || 5000, 30000);
    const pollMs = Math.max(Number(args.pollMs) || 250, 50);
    const expectedText = args.text !== undefined ? String(args.text).toLowerCase() : null;
    const start = Date.now();
    let attempts = 0, actual = null, passed = false;
    while (Date.now() - start <= timeoutMs) {
      attempts++;
      const el = args.selector ? pwFind(args.selector) : null;
      if (condition === 'visible') { passed = !!el && visible(el); actual = el ? (passed ? 'visible' : 'in_dom_but_hidden') : 'not_found'; }
      else if (condition === 'hidden') { passed = !el || !visible(el); actual = el ? (visible(el) ? 'visible' : 'hidden') : 'not_found'; }
      else if (condition === 'text') {
        const scope = el || document.body;
        const text = ((scope && (scope.innerText || scope.textContent)) || '').toLowerCase();
        actual = text.slice(0, 120);
        passed = expectedText ? text.includes(expectedText) : false;
      } else if (condition === 'value') {
        actual = el ? String(el.value ?? '') : null;
        passed = actual !== null && actual === (args.value !== undefined ? String(args.value) : actual);
        if (args.value === undefined) passed = false;
      } else if (condition === 'count') {
        let n = 0;
        try { n = document.querySelectorAll(args.selector).length; } catch {}
        actual = n;
        passed = n === Number(args.count);
      } else if (condition === 'url') { actual = location.href; passed = expectedText ? actual.toLowerCase().includes(expectedText) : false; }
      else if (condition === 'title') { actual = document.title; passed = expectedText ? actual.toLowerCase().includes(expectedText) : false; }
      else if (condition === 'checked') { passed = !!el && el.checked === true; actual = el ? String(el.checked) : 'not_found'; }
      else return { ok: false, error: 'Unknown expect condition: ' + condition + '. Supported: visible, hidden, text, value, count, url, title, checked.' };
      if (passed) break;
      await new Promise((r) => setTimeout(r, pollMs));
    }
    if (passed && args.selector && (condition === 'visible' || condition === 'text')) {
      const el = pwFind(args.selector);
      if (el && visible(el)) { const r = el.getBoundingClientRect(); ripple(r.x + r.width / 2, r.y + r.height / 2); }
    }
    return { ok: true, data: { condition, passed, actual, selector: args.selector || null, waitedMs: Date.now() - start, attempts } };
  }

  // ── web_aria_snapshot: Playwright ariaSnapshot — YAML ARIA tree for LLM reading ──
  if (args.__tool === 'web_aria_snapshot') {
    const maxNodes = Math.min(Number(args.maxNodes) || 350, 700);
    const skip = new Set(['script', 'style', 'noscript', 'template', 'svg', 'path', 'meta', 'link', 'head', 'br']);
    const lines = [];
    let count = 0, idx = 0;
    function emit(el, depth) {
      const role = roleOf(el);
      const name = nameOf(el);
      const tag = el.tagName.toLowerCase();
      let extra = '';
      const actionable = ['button', 'link', 'textbox', 'checkbox', 'radio', 'combobox', 'menuitem', 'tab', 'switch', 'slider', 'searchbox'].includes(role) || tag === 'select' || el.isContentEditable;
      if (actionable) {
        try { el.setAttribute('data-ss-id', String(idx)); } catch {}
        extra += ' [index=' + idx + ']';
        idx++;
      }
      if (role === 'heading') { const m = tag.match(/^h([1-6])$/); extra += ' [level=' + (m ? m[1] : el.getAttribute('aria-level') || 1) + ']'; }
      if (role === 'checkbox' || role === 'radio') extra += el.checked ? ' [checked]' : ' [unchecked]';
      if (el.getAttribute('aria-expanded') === 'true') extra += ' [expanded]';
      if (el.getAttribute('aria-selected') === 'true') extra += ' [selected]';
      if (el.getAttribute('disabled') !== null || el.getAttribute('aria-disabled') === 'true') extra += ' [disabled]';
      lines.push('  '.repeat(depth) + '- ' + role + (name ? ' "' + name + '"' : '') + extra);
      count++;
      if (el.childElementCount && count < maxNodes) emitChildren(el, depth + 1);
    }
    function emitChildren(node, depth) {
      for (const el of Array.from(node.children)) {
        if (count >= maxNodes) return;
        const tag = el.tagName.toLowerCase();
        if (skip.has(tag) || !visible(el)) continue;
        if (roleOf(el) === 'generic') {
          const ownText = Array.from(el.childNodes).filter((n) => n.nodeType === 3).map((n) => n.textContent.trim()).join(' ').replace(/\s+/g, ' ');
          if (ownText) { lines.push('  '.repeat(depth) + '- text "' + ownText.slice(0, 120) + '"'); count++; }
          if (el.childElementCount && count < maxNodes) emitChildren(el, depth);
          continue;
        }
        emit(el, depth);
      }
    }
    const root = args.selector ? pwFind(args.selector) : document.body;
    if (!root) return { ok: false, error: 'Snapshot root not found: ' + args.selector };
    emitChildren(root, 0);
    return { ok: true, data: { url: location.href, title: document.title, yaml: lines.join('\n'), nodeCount: count } };
  }

  // ── web_table_extract: scrape <table> elements into json / markdown / csv ──
  if (args.__tool === 'web_table_extract') {
    const format = String(args.format || 'all').toLowerCase();
    const limit = Math.min(Number(args.limit) || 200, 1000);
    let nodes = [];
    if (args.index !== undefined && args.index !== null) {
      const t = document.querySelectorAll('table')[Number(args.index)];
      if (t) nodes = [t];
    } else {
      try { nodes = Array.from(document.querySelectorAll(args.selector || 'table')).slice(0, Number(args.tableLimit) || 5); } catch {}
    }
    const tables = [];
    for (const table of nodes) {
      const headerRow = table.querySelector('thead tr') || table.querySelector('tr');
      const headers = headerRow ? Array.from(headerRow.querySelectorAll('th, td')).map((c) => (c.innerText || '').trim().replace(/\s+/g, ' ')) : [];
      const rows = Array.from(table.querySelectorAll('tbody tr, tr')).filter((r) => r !== headerRow).slice(0, limit)
        .map((r) => Array.from(r.querySelectorAll('td, th')).map((c) => (c.innerText || '').trim().replace(/\s+/g, ' ')));
      const t = { rowCount: rows.length, headers, rows };
      if (format === 'json' || format === 'all') t.json = rows.map((r) => Object.fromEntries(headers.map((h, i) => [h || 'col' + i, r[i] ?? null])));
      if (format === 'markdown' || format === 'all') t.markdown = '| ' + headers.join(' | ') + ' |\n| ' + headers.map(() => '---').join(' | ') + ' |\n' + rows.map((r) => '| ' + r.join(' | ') + ' |').join('\n');
      if (format === 'csv' || format === 'all') t.csv = [headers].concat(rows).map((r) => r.map((c) => '"' + String(c).replace(/"/g, '""') + '"').join(',')).join('\n');
      tables.push(t);
    }
    if (!tables.length) return { ok: false, error: 'No <table> elements found' + (args.selector ? ' for selector: ' + args.selector : '') + '.' };
    return { ok: true, data: { tables, count: tables.length } };
  }

  // ── web_get_by: Playwright getBy* unified query with data-ss-id stamping ──
  if (args.__tool === 'web_get_by') {
    const by = String(args.by || 'text').toLowerCase();
    const value = String(args.value ?? '').toLowerCase();
    const exact = args.exact === true;
    const limit = Math.min(Number(args.limit) || 20, 100);
    let matches = [];
    const scan = (list, test) => { for (const el of list) { if (test(el) && visible(el)) { try { el.setAttribute('data-ss-id', String(matches.length)); } catch {} matches.push(el); if (matches.length >= limit) return; } } };
    if (by === 'role') {
      const role = String(args.value || '').toLowerCase();
      const want = args.name ? String(args.name).toLowerCase() : null;
      scan(document.querySelectorAll('*'), (el) => roleOf(el) === role && (!want || (exact ? nameOf(el).toLowerCase() === want : nameOf(el).toLowerCase().includes(want))));
    } else if (by === 'text') {
      scan(document.querySelectorAll('button, a, span, p, div, label, li, td, th, h1, h2, h3, h4, h5, h6'), (el) => { const t = (el.innerText || '').toLowerCase().trim(); return exact ? t === value : t.includes(value); });
    } else if (by === 'label') {
      scan(document.querySelectorAll('[aria-label], [aria-labelledby], label'), (el) => { const t = (el.getAttribute('aria-label') || el.innerText || '').toLowerCase(); return exact ? t === value : t.includes(value); });
    } else if (by === 'placeholder') {
      scan(document.querySelectorAll('[placeholder]'), (el) => { const t = (el.getAttribute('placeholder') || '').toLowerCase(); return exact ? t === value : t.includes(value); });
    } else if (by === 'testid') {
      scan(document.querySelectorAll('[data-testid], [data-test], [data-cy]'), (el) => { const t = (el.getAttribute('data-testid') || el.getAttribute('data-test') || el.getAttribute('data-cy') || '').toLowerCase(); return exact ? t === value : t.includes(value); });
    } else if (by === 'alt') {
      scan(document.querySelectorAll('img[alt], area[alt]'), (el) => { const t = (el.getAttribute('alt') || '').toLowerCase(); return exact ? t === value : t.includes(value); });
    } else if (by === 'title') {
      scan(document.querySelectorAll('[title]'), (el) => { const t = (el.getAttribute('title') || '').toLowerCase(); return exact ? t === value : t.includes(value); });
    } else if (by === 'css') {
      try { scan(document.querySelectorAll(args.value), () => true); } catch { return { ok: false, error: 'Invalid CSS selector: ' + args.value }; }
    } else return { ok: false, error: 'Unknown get_by strategy: ' + by + '. Supported: role, text, label, placeholder, testid, alt, title, css.' };
    let selected = null;
    if (typeof args.nth === 'number' && matches[args.nth < 0 ? matches.length + args.nth : args.nth]) selected = matches[args.nth < 0 ? matches.length + args.nth : args.nth];
    else if (matches.length) selected = matches[0];
    if (selected) { const r = selected.getBoundingClientRect(); ripple(r.x + r.width / 2, r.y + r.height / 2, '#3B82F6'); }
    return {
      ok: true,
      data: {
        by, value: args.value, count: matches.length,
        matches: matches.map((el, i) => ({ index: i, ref: Number(el.getAttribute('data-ss-id')), ...targetDesc(el) })),
        selected: selected ? { ref: Number(selected.getAttribute('data-ss-id')), ...targetDesc(selected) } : null,
      },
    };
  }

  // ── web_fill: Playwright fill() — instant value set with input/change events ──
  if (args.__tool === 'web_fill') {
    const el = await findWithRetry(args);
    if (!el) return { ok: false, error: 'Element not found for fill: ' + (args.selector ?? args.ref ?? args.index) };
    el.scrollIntoView({ block: 'center' });
    const value = String(args.value ?? '');
    try { el.focus(); } catch {}
    if (el.isContentEditable) {
      el.textContent = value;
      el.dispatchEvent(new InputEvent('input', { bubbles: true, data: value, inputType: 'insertText' }));
    } else {
      const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value');
      if (setter && setter.set) setter.set.call(el, value); else el.value = value;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }
    const r = el.getBoundingClientRect();
    ripple(r.x + r.width / 2, r.y + r.height / 2, '#3B82F6');
    return { ok: true, data: { filled: true, value: args.mask === true ? '••••••' : value, ...targetDesc(el) } };
  }

  // ── web_check: Playwright check()/uncheck() for native and ARIA toggles ──
  if (args.__tool === 'web_check') {
    const el = await findWithRetry(args);
    if (!el) return { ok: false, error: 'Element not found for check: ' + (args.selector ?? args.ref ?? args.index) };
    el.scrollIntoView({ block: 'center' });
    const want = args.checked !== false;
    if (el.tagName === 'INPUT' && el.type === 'radio') { if (!el.checked) el.click(); }
    else if (el.tagName === 'INPUT') { if (el.checked !== want) el.click(); }
    else {
      el.click();
      if (el.getAttribute && (el.getAttribute('role') === 'checkbox' || el.getAttribute('aria-checked') !== null)) el.setAttribute('aria-checked', String(want));
    }
    el.dispatchEvent(new Event('change', { bubbles: true }));
    const r = el.getBoundingClientRect();
    ripple(r.x + r.width / 2, r.y + r.height / 2, '#F59E0B');
    return { ok: true, data: { checked: el.checked === true || el.getAttribute('aria-checked') === 'true', ...targetDesc(el) } };
  }

  // ── web_focus: Playwright focus()/blur() ──
  if (args.__tool === 'web_focus') {
    if (args.blur === true) {
      const prev = document.activeElement;
      if (prev && prev.blur) { prev.blur(); return { ok: true, data: { blurred: true, previous: prev.tagName ? prev.tagName.toLowerCase() : null } }; }
      return { ok: true, data: { blurred: false } };
    }
    const el = await findWithRetry(args);
    if (!el) return { ok: false, error: 'Element not found for focus: ' + (args.selector ?? args.ref ?? args.index) };
    el.focus({ preventScroll: args.preventScroll === true });
    const r = el.getBoundingClientRect();
    ripple(r.x + r.width / 2, r.y + r.height / 2, '#8B5CF6');
    return { ok: true, data: { focused: document.activeElement === el, ...targetDesc(el) } };
  }

  // ── web_scroll_to: scrollIntoView with options, or page positions ──
  if (args.__tool === 'web_scroll_to') {
    if (args.selector || typeof args.ref === 'number' || typeof args.index === 'number') {
      const el = await findWithRetry(args);
      if (!el) return { ok: false, error: 'Element not found for scroll_to: ' + (args.selector ?? args.ref ?? args.index) };
      el.scrollIntoView({ behavior: args.behavior || 'smooth', block: args.block || 'center', inline: 'nearest' });
      await new Promise((r2) => setTimeout(r2, args.behavior === 'auto' ? 80 : 450));
      const r = el.getBoundingClientRect();
      return { ok: true, data: { scrolledTo: 'element', inViewport: r.top >= 0 && r.bottom <= window.innerHeight, ...targetDesc(el) } };
    }
    const pos = String(args.position || 'top').toLowerCase();
    const pageH = document.documentElement.scrollHeight;
    const targets = { top: 0, bottom: pageH, middle: Math.max(0, (pageH - window.innerHeight) / 2) };
    if (!(pos in targets)) return { ok: false, error: 'Unknown position: ' + pos + '. Supported: top, middle, bottom, or pass selector.' };
    window.scrollTo({ top: targets[pos], behavior: args.behavior || 'smooth' });
    return { ok: true, data: { scrolledTo: pos, scrollY: window.scrollY, pageHeight: pageH } };
  }

  // ── web_run_code: Playwright run_code — async snippet with a mini page API ──
  if (args.__tool === 'web_run_code') {
    const code = String(args.code || '');
    if (!code.trim()) return { ok: false, error: 'run_code requires code.' };
    const timeoutMs = Math.min(Number(args.timeoutMs) || 8000, 30000);
    const ctx = {
      find: (sel) => pwFind(sel),
      findAll: (sel) => { try { return Array.from(document.querySelectorAll(sel)); } catch { return []; } },
      click: (sel) => { const el = pwFind(sel); if (!el) throw new Error('not found: ' + sel); el.scrollIntoView({ block: 'center' }); el.click(); return true; },
      fill: (sel, text) => { const el = pwFind(sel); if (!el) throw new Error('not found: ' + sel); el.focus(); const p = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; const d = Object.getOwnPropertyDescriptor(p, 'value'); if (d && d.set) d.set.call(el, String(text)); else el.value = String(text); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); return true; },
      text: (sel) => { const el = pwFind(sel); return el ? (el.innerText || el.textContent || '') : null; },
      attr: (sel, name) => { const el = pwFind(sel); return el ? el.getAttribute(name) : null; },
      waitFor: (sel, ms = 3000) => new Promise((resolve, reject) => { const t0 = Date.now(); (function poll() { const el = pwFind(sel); if (el) return resolve(el); if (Date.now() - t0 > ms) return reject(new Error('waitFor timeout: ' + sel)); setTimeout(poll, 120); })(); }),
      url: () => location.href,
      title: () => document.title,
    };
    try {
      const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
      const fn = new AsyncFunction('ctx', '"use strict";\n' + code);
      const result = await Promise.race([
        Promise.resolve(fn(ctx)),
        new Promise((_, reject) => setTimeout(() => reject(new Error('run_code timed out after ' + timeoutMs + 'ms')), timeoutMs)),
      ]);
      return { ok: true, data: { result: result === undefined ? null : safeJson(result) } };
    } catch (e) {
      return { ok: false, error: 'run_code failed: ' + String((e && e.message) || e) };
    }
  }

  // ── web_media_extract: enumerate images / videos / audios / links ──
  if (args.__tool === 'web_media_extract') {
    const limit = Math.min(Number(args.limit) || 100, 500);
    const abs = (u) => { try { return new URL(u, location.href).href; } catch { return u; } };
    const images = Array.from(document.querySelectorAll('img')).slice(0, limit)
      .map((el) => ({ src: abs(el.currentSrc || el.src || ''), alt: el.alt || undefined, width: el.naturalWidth || undefined, height: el.naturalHeight || undefined, visible: visible(el) }))
      .filter((i) => i.src && !i.src.startsWith('data:'));
    const videos = Array.from(document.querySelectorAll('video')).slice(0, 30)
      .map((el) => ({ src: abs(el.currentSrc || el.src || ''), poster: el.poster ? abs(el.poster) : undefined, durationSec: el.duration && isFinite(el.duration) ? Math.round(el.duration) : undefined }));
    const audios = Array.from(document.querySelectorAll('audio')).slice(0, 30)
      .map((el) => ({ src: abs(el.currentSrc || el.src || '') })).filter((a) => a.src);
    const links = Array.from(document.querySelectorAll('a[href]')).slice(0, limit)
      .map((el) => ({ href: abs(el.getAttribute('href') || ''), text: (el.innerText || '').trim().slice(0, 120) || undefined }))
      .filter((l) => l.href.startsWith('http'));
    for (const l of links) { try { l.external = new URL(l.href).origin !== location.origin; } catch {} }
    return { ok: true, data: { url: location.href, counts: { images: images.length, videos: videos.length, audios: audios.length, links: links.length }, images, videos, audios, links } };
  }

  return { ok: false, error: 'Unknown agent tool: ' + args.__tool };
}
