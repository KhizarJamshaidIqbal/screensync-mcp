// ScreenSync Agent Perception Unit — Playwright-grade assertions, snapshots & structured reads
// Self-contained page-side executor for: web_expect, web_aria_snapshot, web_table_extract, web_media_extract, web_actionable

export async function ssWebUnitPerception(args = {}) {
  try {
    if (!window.chrome) window.chrome = { runtime: {} };
  } catch {}

  function visible(el) {
    try {
      const r = el.getBoundingClientRect(), s = window.getComputedStyle(el);
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
    try { const found = root.querySelector(selector); if (found) return found; } catch {}
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
    if (['img', 'nav', 'main', 'header', 'footer', 'table', 'form', 'dialog'].includes(tag)) return tag === 'header' ? 'banner' : tag === 'footer' ? 'contentinfo' : tag === 'nav' ? 'navigation' : tag;
    if (tag === 'ul' || tag === 'ol') return 'list';
    if (tag === 'li') return 'listitem';
    if (['div', 'span', 'p', 'section', 'article', 'aside', 'address', 'figure', 'figcaption'].includes(tag)) return 'generic';
    return tag;
  }

  function nameOf(el) {
    return (el.getAttribute('aria-label') || el.innerText || el.value || el.getAttribute('placeholder') || el.getAttribute('alt') || el.title || '').trim().replace(/\s+/g, ' ').slice(0, 120);
  }

  function pwFind(sel, root = document) {
    if (!sel || typeof sel !== 'string') return null;
    sel = sel.trim();
    if (sel.includes(' >> ')) {
      const parts = sel.split(/\s*>>\s*/);
      let cur = root;
      for (const part of parts) {
        if (!part) continue;
        cur = pwFind(part, cur);
        if (!cur) return null;
      }
      return cur;
    }
    if (sel.startsWith('css=')) sel = sel.slice(4).trim();
    if (sel.includes('>>>')) {
      let cur = root, hit = null;
      for (const part of sel.split(/\s*>>>\s*/)) {
        if (!part) continue;
        hit = (cur.querySelector ? cur.querySelector(part) : null) || findDeep(part, cur);
        if (!hit) return null;
        cur = hit.shadowRoot || hit;
      }
      if (hit) return hit;
    }
    if (sel.startsWith('pierce/')) { const el = findDeep(sel.slice(7).trim(), root); if (el) return el; }
    if (sel.includes(':has-text(')) {
      const m = sel.match(/^([^:]+):has-text\(["']?([^"')]+)["']?\)$/);
      if (m) {
        const pool = root.querySelectorAll ? root.querySelectorAll(m[1].trim()) : [];
        for (const c of pool) {
          if ((c.innerText || '').toLowerCase().includes(m[2].trim().toLowerCase())) return c;
        }
      }
    }
    if (sel.startsWith('xpath=')) sel = sel.slice(6);
    if (sel.startsWith('//') || sel.startsWith('(//') || sel.startsWith('.//')) {
      try {
        const ctx = (root && root.nodeType) ? root : document;
        const expr = (ctx !== document && sel.startsWith('//')) ? '.' + sel : sel;
        const r = document.evaluate(expr, ctx, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
        if (r.singleNodeValue) return r.singleNodeValue;
      } catch {}
      return null;
    }
    if (sel.startsWith('role=')) {
      const m = sel.slice(5).match(/^([a-zA-Z_-]+)(?:\[name=["']([^"']+)["']\])?/);
      if (m) {
        const role = m[1].toLowerCase();
        const want = m[2] ? m[2].toLowerCase() : null;
        const pool = root.querySelectorAll ? root.querySelectorAll('*') : [];
        for (const el of pool) {
          if (roleOf(el) !== role) continue;
          if (!want || nameOf(el).toLowerCase().includes(want)) return el;
        }
      }
      return null;
    }
    if (sel.startsWith('placeholder=')) {
      const ph = sel.slice(12).replace(/^["']|["']$/g, '');
      return root.querySelector ? root.querySelector(`[placeholder="${ph}"], [placeholder*="${ph}" i]`) : null;
    }
    if (sel.startsWith('label=')) {
      const lbl = sel.slice(6).replace(/^["']|["']$/g, '').toLowerCase();
      const aria = root.querySelector ? root.querySelector(`[aria-label="${lbl}" i], [aria-label*="${lbl}" i]`) : null;
      if (aria) return aria;
      const labels = root.querySelectorAll ? root.querySelectorAll('label') : [];
      for (const l of labels) {
        if ((l.innerText || '').toLowerCase().includes(lbl)) {
          if (l.htmlFor) {
            const input = document.getElementById(l.htmlFor);
            if (input && (!root.contains || root.contains(input))) return input;
          }
          const nested = l.querySelector('input, textarea, select');
          if (nested) return nested;
        }
      }
      return null;
    }
    if (sel.startsWith('text=')) {
      const txt = sel.slice(5).replace(/^["']|["']$/g, '').toLowerCase();
      const pool = root.querySelectorAll ? root.querySelectorAll('button, a, span, p, div, label, li, td, th, h1, h2, h3') : [];
      for (const el of pool) {
        if ((el.innerText || '').toLowerCase().trim() === txt) return el;
      }
      for (const el of pool) {
        if ((el.innerText || '').toLowerCase().includes(txt)) return el;
      }
      return null;
    }
    if (sel.startsWith('testid=')) {
      const v = sel.slice(7).replace(/^["']|["']$/g, '');
      return root.querySelector ? root.querySelector(`[data-testid="${v}"], [data-test="${v}"], [data-cy="${v}"]`) : null;
    }
    try { return (root.querySelector ? root.querySelector(sel) : null) || findDeep(sel, root); } catch { return null; }
  }

  function countPwMatches(sel, root = document) {
    if (!sel || typeof sel !== 'string') return 0;
    try {
      if (sel.includes(' >> ')) {
        const parts = sel.split(/\s*>>\s*/);
        let cur = root;
        for (let i = 0; i < parts.length - 1; i++) {
          const hit = pwFind(parts[i], cur);
          if (!hit) return 0;
          cur = hit;
        }
        return countPwMatches(parts[parts.length - 1], cur);
      }
      let raw = sel.trim();
      if (raw.startsWith('css=')) raw = raw.slice(4).trim();
      if (raw.startsWith('testid=')) {
        const v = raw.slice(7).replace(/^["']|["']$/g, '');
        return (root.querySelectorAll ? root.querySelectorAll(`[data-testid="${v}"], [data-test="${v}"], [data-cy="${v}"]`) : []).length;
      }
      if (raw.startsWith('text=')) {
        const txt = raw.slice(5).replace(/^["']|["']$/g, '').toLowerCase();
        let c = 0;
        for (const el of (root.querySelectorAll ? root.querySelectorAll('*') : [])) {
          if ((el.innerText || '').toLowerCase().trim() === txt) c++;
        }
        return c;
      }
      if (!raw.includes('>>>') && !raw.startsWith('pierce/') && !raw.startsWith('xpath=') && !raw.startsWith('role=')) {
        return (root.querySelectorAll ? root.querySelectorAll(raw) : []).length;
      }
    } catch {}
    return 1;
  }

  function checkActionable(el) {
    if (!el || !el.isConnected) return { ok: false, reason: 'Element is not attached to DOM' };
    const r = el.getBoundingClientRect(), s = window.getComputedStyle(el);
    if (r.width <= 0 || r.height <= 0 || s.display === 'none' || s.visibility === 'hidden' || s.opacity === '0') return { ok: false, reason: 'Element is hidden or has zero dimensions' };
    if (el.disabled || el.getAttribute('aria-disabled') === 'true') return { ok: false, reason: 'Element is disabled' };
    const cx = Math.max(0, r.x + r.width / 2), cy = Math.max(0, r.y + r.height / 2);
    try {
      const top = document.elementFromPoint(cx, cy);
      if (top && top !== el && !el.contains(top) && !top.contains(el)) return { ok: false, reason: 'Element is covered by ' + (top.tagName ? top.tagName.toLowerCase() : 'overlay') };
    } catch {}
    return { ok: true, rect: r, cx, cy };
  }

  async function findWithRetry(a, maxWaitMs = 2500) {
    if (a.strict === true && a.selector) {
      const c = countPwMatches(a.selector);
      if (c > 1) return { strictViolation: true, error: `Strict mode violation: selector "${a.selector}" resolved to ${c} elements. Pass strict: false or use a more specific locator or :nth().` };
    }
    const start = Date.now();
    while (Date.now() - start < maxWaitMs) {
      let el = null;
      if (a.selector) el = pwFind(a.selector);
      if (!el && (typeof a.ref === 'number' || typeof a.index === 'number')) el = document.querySelector(`[data-ss-id="${a.ref !== undefined ? a.ref : a.index}"]`);
      if (el) return el;
      await new Promise((r) => setTimeout(r, 100));
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

  // ── web_actionable: Playwright auto-waiting & actionability inspector ────────
  if (args.__tool === 'web_actionable') {
    const timeoutMs = Math.min(Number(args.timeoutMs) || 3000, 15000);
    const start = Date.now();
    let el = null;
    while (Date.now() - start < timeoutMs) {
      el = await findWithRetry(args, 200);
      if (el && el.strictViolation) return { ok: false, code: 'STRICT_MODE_VIOLATION', error: el.error };
      if (el && (checkActionable(el).ok || args.waitForActionable === false)) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    if (!el) return { ok: false, code: 'ELEMENT_NOT_FOUND', error: 'Element not found for actionability check: ' + (args.selector || args.ref) };

    const attached = el.isConnected === true, isVis = visible(el), isEnabled = !el.disabled && el.getAttribute('aria-disabled') !== 'true';
    const r = el.getBoundingClientRect(), cx = Math.max(0, r.x + r.width / 2), cy = Math.max(0, r.y + r.height / 2);
    let receivesEvents = false;
    try {
      const topEl = document.elementFromPoint(cx, cy);
      receivesEvents = topEl === el || el.contains(topEl) || (topEl && topEl.contains(el));
    } catch {}

    const actionable = attached && isVis && isEnabled && receivesEvents;
    return { ok: true, data: { actionable, checks: { attached, visible: isVis, enabled: isEnabled, receivesEvents }, target: targetDesc(el) } };
  }

  // ── web_expect: Playwright expect() — auto-retrying assertion with polling ──
  if (args.__tool === 'web_expect') {
    const condition = String(args.condition || 'visible').toLowerCase();
    const timeoutMs = Math.min(Number(args.timeoutMs) || 5000, 30000);
    const pollMs = Math.max(Number(args.pollMs) || 200, 50);
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
      else if (condition === 'enabled') { passed = !!el && !el.disabled && el.getAttribute('aria-disabled') !== 'true'; actual = el ? (passed ? 'enabled' : 'disabled') : 'not_found'; }
      else if (condition === 'disabled') { passed = !!el && (el.disabled || el.getAttribute('aria-disabled') === 'true'); actual = el ? (passed ? 'disabled' : 'enabled') : 'not_found'; }
      else if (condition === 'focused') { passed = !!el && document.activeElement === el; actual = el ? (passed ? 'focused' : 'not_focused') : 'not_found'; }
      else if (condition === 'empty') { const val = el ? (el.value || el.innerText || '').trim() : ''; passed = !!el && val.length === 0; actual = val.slice(0, 20); }
      else if (condition === 'accessible_name') {
        actual = el ? nameOf(el) : null;
        const want = args.name !== undefined ? String(args.name).toLowerCase() : null;
        passed = el !== null && want !== null && (args.exact === true ? actual.toLowerCase() === want : actual.toLowerCase().includes(want));
        if (want === null) passed = false;
      }
      else if (condition === 'attribute') {
        actual = el && args.attribute ? el.getAttribute(String(args.attribute)) : null;
        const want = args.attrValue !== undefined ? String(args.attrValue) : null;
        passed = actual !== null && (want === null ? true : args.exact === true ? actual === want : actual.toLowerCase().includes(want.toLowerCase()));
        if (!args.attribute) passed = false;
      }
      else if (condition === 'has_class') {
        actual = el ? el.className : null;
        passed = !!el && String(args.className || '').trim() !== '' && el.classList.contains(String(args.className));
        if (!args.className) passed = false;
      }
      else if (condition === 'attached') { passed = !!el; actual = el ? 'attached' : 'not_in_dom'; }
      else if (condition === 'detached') { passed = !el; actual = el ? 'attached' : 'detached'; }
      else return { ok: false, error: 'Unknown expect condition: ' + condition + '. Supported: visible, hidden, text, value, count, url, title, checked, enabled, disabled, focused, empty, accessible_name, attribute, has_class, attached, detached.' };
      if (args.not === true) { if (!passed) break; } else if (passed) break;
      await new Promise((r) => setTimeout(r, pollMs));
    }
    if (args.not === true) passed = !passed;
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

  // ── web_media_extract: enumerate images / videos / audios / links ──
  if (args.__tool === 'web_media_extract') {
    const limit = Math.min(Number(args.limit) || 100, 500);
    const abs = (u) => { try { return new URL(u, location.href).href; } catch { return u; } };
    const images = Array.from(document.querySelectorAll('img')).slice(0, limit)
      .map((el) => ({ src: abs(el.currentSrc || el.src || ''), alt: el.alt || undefined, width: el.naturalWidth || undefined, height: el.naturalHeight || undefined, visible: visible(el) }))
      .filter((i) => i.src && !i.src.startsWith('data:'));
    const videos = Array.from(document.querySelectorAll('video')).slice(0, 30)
      .map((el) => ({ src: abs(el.currentSrc || el.src || ''), poster: el.poster ? abs(el.poster) : undefined, durationSec: el.duration && isFinite(el.duration) ? Math.round(el.duration) : undefined }));
    const audios = Array.from(document.querySelectorAll('audio')).slice(0, 30).map((el) => ({ src: abs(el.currentSrc || el.src || '') })).filter((a) => a.src);
    const links = Array.from(document.querySelectorAll('a[href]')).slice(0, limit).map((el) => ({ href: abs(el.getAttribute('href') || ''), text: (el.innerText || '').trim().slice(0, 120) || undefined })).filter((l) => l.href.startsWith('http'));
    for (const l of links) { try { l.external = new URL(l.href).origin !== location.origin; } catch {} }
    return { ok: true, data: { url: location.href, counts: { images: images.length, videos: videos.length, audios: audios.length, links: links.length }, images, videos, audios, links } };
  }

  return { ok: false, error: 'Unknown perception tool: ' + args.__tool };
}
