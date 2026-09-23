// ScreenSync Agent Action Unit — Playwright-grade interactions & selectors
// Self-contained page-side executor for: web_get_by, web_fill, web_check, web_focus, web_scroll_to, web_run_code

export async function ssWebUnitAction(args = {}) {
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

  function safeJson(v) {
    try { return JSON.parse(JSON.stringify(v)); } catch { return String(v); }
  }

  function pwFind(sel, root = document) {
    if (!sel || typeof sel !== 'string') return null;
    sel = sel.trim();
    if (sel.startsWith('@')) {
      const ref = sel.slice(1).trim();
      return (root.querySelector ? root.querySelector(`[data-ss-som-ref="${ref}"], [data-ss-id="${ref}"]`) : null);
    }
    if (sel.startsWith('ref=')) {
      const ref = sel.slice(4).trim();
      return (root.querySelector ? root.querySelector(`[data-ss-som-ref="${ref}"], [data-ss-id="${ref}"]`) : null);
    }
    if (sel.includes(' >> nth=')) {
      const parts = sel.split(/\s*>>\s*nth=\s*/);
      const all = pwFindAll(parts[0].trim(), root);
      const n = parseInt(parts[1].trim(), 10) || 0;
      return all[n < 0 ? all.length + n : n] || null;
    }
    const nthMatch = sel.match(/^(.+?)(?:\.nth\((\d+)\)|:nth\((\d+)\)|:first|\.first|:last|\.last)$/);
    if (nthMatch) {
      const base = nthMatch[1].trim();
      const all = pwFindAll(base, root);
      if (sel.endsWith(':first') || sel.endsWith('.first')) return all[0] || null;
      if (sel.endsWith(':last') || sel.endsWith('.last')) return all[all.length - 1] || null;
      const n = parseInt(nthMatch[2] ?? nthMatch[3], 10) || 0;
      return all[n < 0 ? all.length + n : n] || null;
    }
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

  function pwFindAll(sel, root = document) {
    if (!sel || typeof sel !== 'string') return [];
    sel = sel.trim();
    if (sel.startsWith('css=')) sel = sel.slice(4).trim();
    if (sel.startsWith('testid=')) {
      const v = sel.slice(7).replace(/^["']|["']$/g, '');
      return Array.from(root.querySelectorAll ? root.querySelectorAll(`[data-testid="${v}"], [data-test="${v}"], [data-cy="${v}"]`) : []);
    }
    if (sel.startsWith('text=')) {
      const txt = sel.slice(5).replace(/^["']|["']$/g, '').toLowerCase();
      const pool = Array.from(root.querySelectorAll ? root.querySelectorAll('*') : []);
      return pool.filter((el) => (el.innerText || el.textContent || '').toLowerCase().trim().includes(txt));
    }
    try {
      const list = Array.from(root.querySelectorAll ? root.querySelectorAll(sel) : []);
      if (list.length > 0) return list;
    } catch {}
    const single = pwFind(sel, root);
    return single ? [single] : [];
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
      return pwFindAll(sel, root).length;
    } catch {}
    return 1;
  }

  async function checkActionable(el) {
    if (!el || !el.isConnected) return { ok: false, reason: 'Element is not attached to DOM' };
    const r = el.getBoundingClientRect(), s = window.getComputedStyle(el);
    if (r.width <= 0 || r.height <= 0 || s.display === 'none' || s.visibility === 'hidden' || s.opacity === '0') return { ok: false, reason: 'Element is hidden or has zero dimensions' };
    if (el.disabled || el.getAttribute('aria-disabled') === 'true') return { ok: false, reason: 'Element is disabled' };
    const cx = Math.max(0, r.x + r.width / 2), cy = Math.max(0, r.y + r.height / 2);
    try {
      const top = document.elementFromPoint(cx, cy);
      if (top && top !== el && !el.contains(top) && !top.contains(el)) return { ok: false, reason: 'Element is covered by ' + (top.tagName ? top.tagName.toLowerCase() : 'overlay') };
    } catch {}

    // P2: Actionability "stable" check (two-frame comparison across animation frames)
    if (typeof requestAnimationFrame === 'function') {
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const r2 = el.getBoundingClientRect();
      const diff = Math.abs(r.x - r2.x) + Math.abs(r.y - r2.y) + Math.abs(r.width - r2.width) + Math.abs(r.height - r2.height);
      if (diff > 1) return { ok: false, reason: 'Element is moving or animating (not stable)' };
    }
    return { ok: true, rect: r, cx, cy };
  }

  function isDestructiveAction(el) { // whole words only, same list as mcp-server/destructive-vocab.ts ('Dropdown', 'Display' are not destructive)
    const words = String(el.innerText || el.value || el.getAttribute('aria-label') || '').replace(/remove(?:All)?(?:Event)?Listeners?|drop[\s_-]?shadow/gi, ' ').replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2').toLowerCase().split(/[^a-z0-9]+/);
    return words.some((w, i) => /^(?:delet(?:e|es|ing|ion|ions)|remov(?:e|es|ing|al)|destroy(?:s|ing)?|destruction|terminat(?:e|es|ing|ion)|drop(?:s|ping)?|pay(?:s|ing|ment|ments|now|pal)?|purchas(?:e|es|ing)|buy(?:s|ing|now)?|charg(?:e|es|ing))$/.test(w) || (w === 'cancel' && /^subscriptions?$/.test(words[i + 1] || '')));
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
      if (!el && (typeof a.ref === 'number' || typeof a.index === 'number' || typeof a.ref === 'string')) {
        const refVal = a.ref !== undefined ? a.ref : a.index;
        el = document.querySelector(`[data-ss-som-ref="${refVal}"], [data-ss-id="${refVal}"]`);
      }
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
    if (args.strict === true && matches.length > 1) {
      return { ok: false, code: 'STRICT_MODE_VIOLATION', error: `Strict mode violation: get_by strategy "${by}" value "${args.value}" resolved to ${matches.length} elements. Pass strict: false or use :nth().` };
    }
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
    const el = await findWithRetry(args, Number(args.timeoutMs) || 2500);
    if (!el) return { ok: false, code: 'ELEMENT_NOT_FOUND', error: 'Element not found for fill: ' + (args.selector ?? args.ref ?? args.index) };
    if (el.strictViolation) return { ok: false, code: 'STRICT_MODE_VIOLATION', error: el.error };

    if (isDestructiveAction(el) && !args.__humanApproved && args.dryRun !== true) {
      return { ok: false, code: 'USER_CONFIRMATION_REQUIRED', risk: 'destructive', error: 'Action involves destructive keyword. User confirmation required.' };
    }

    const actionCheck = await checkActionable(el);
    if (!actionCheck.ok && args.skipActionability !== true) {
      return { ok: false, code: 'NOT_ACTIONABLE', error: 'Element not actionable: ' + actionCheck.reason, retryable: true };
    }

    const value = String(args.value ?? '');
    if (args.dryRun === true) {
      return { ok: true, data: { dryRun: true, plannedAction: 'fill', value: args.mask === true ? '••••••' : value, actionable: true, ...targetDesc(el) } };
    }

    el.scrollIntoView({ block: 'center' });
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
    const el = await findWithRetry(args, Number(args.timeoutMs) || 2500);
    if (!el) return { ok: false, code: 'ELEMENT_NOT_FOUND', error: 'Element not found for check: ' + (args.selector ?? args.ref ?? args.index) };
    if (el.strictViolation) return { ok: false, code: 'STRICT_MODE_VIOLATION', error: el.error };

    const actionCheck = await checkActionable(el);
    if (!actionCheck.ok && args.skipActionability !== true) {
      return { ok: false, code: 'NOT_ACTIONABLE', error: 'Element not actionable: ' + actionCheck.reason, retryable: true };
    }

    const want = args.checked !== false;
    if (args.dryRun === true) {
      return { ok: true, data: { dryRun: true, plannedAction: 'check', wantChecked: want, actionable: true, ...targetDesc(el) } };
    }

    el.scrollIntoView({ block: 'center' });
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
    // Only an explicit 'smooth' request gets a smooth animation. Passing anything else through
    // as 'auto' used to let the PAGE's own `scroll-behavior: smooth` CSS silently govern the
    // scroll instead of the browser's default instant jump — and on a hidden/background tab,
    // smooth-scroll animation is throttled or paused entirely, so it could still be mid-animation
    // (or never started) when the fixed wait below elapsed. 'instant' always forces an immediate
    // jump regardless of the page's own CSS.
    const behavior = args.behavior === 'smooth' ? 'smooth' : 'instant';
    const waitMs = behavior === 'smooth' ? 450 : 80;
    if (args.selector || typeof args.ref === 'number' || typeof args.index === 'number') {
      const el = await findWithRetry(args);
      if (!el) return { ok: false, error: 'Element not found for scroll_to: ' + (args.selector ?? args.ref ?? args.index) };
      const r0 = el.getBoundingClientRect();
      const inView0 = r0.top >= 0 && r0.left >= 0 && r0.bottom <= window.innerHeight && r0.right <= window.innerWidth;
      if (args.ifNeeded && inView0) {
        return { ok: true, data: { scrolledTo: 'element', alreadyInView: true, inViewport: true, scrollX: window.scrollX, scrollY: window.scrollY, ...targetDesc(el) } };
      }
      const scrollYBefore = window.scrollY;
      const scrollXBefore = window.scrollX;
      el.scrollIntoView({ behavior, block: args.block || (args.ifNeeded ? 'nearest' : 'center'), inline: args.inline || 'nearest' });
      await new Promise((r2) => setTimeout(r2, waitMs));
      const r = el.getBoundingClientRect();
      const inViewport = r.top >= 0 && r.left >= 0 && r.bottom <= window.innerHeight && r.right <= window.innerWidth;
      const moved = window.scrollY !== scrollYBefore || window.scrollX !== scrollXBefore;
      // Only claim success when the element actually ended up in view, or the page genuinely
      // scrolled (an oversized element can't fully fit the viewport but a real scroll still
      // happened) — not unconditionally, which used to report ok:true even when the scroll had
      // no effect at all (e.g. a hidden tab where the animation never ran).
      const ok = inViewport || moved || inView0;
      return {
        ok,
        ...(ok ? {} : { noop: true, error: 'Scroll had no effect: the element is still out of view.' }),
        data: { scrolledTo: 'element', inViewport, scrollX: window.scrollX, scrollY: window.scrollY, ...targetDesc(el) },
      };
    }
    const pos = String(args.position || 'top').toLowerCase();
    const pageH = document.documentElement.scrollHeight;
    const targets = { top: 0, bottom: pageH, middle: Math.max(0, (pageH - window.innerHeight) / 2) };
    if (!(pos in targets)) return { ok: false, error: 'Unknown position: ' + pos + '. Supported: top, middle, bottom, or pass selector.' };
    const target = targets[pos];
    const scrollYBefore = window.scrollY;
    window.scrollTo({ top: target, behavior });
    await new Promise((r2) => setTimeout(r2, waitMs));
    // The page may already be clamped at this position (e.g. already at the top/bottom), which
    // is still success — only flag noop when neither the target was already reached nor did the
    // scroll position change at all.
    const reached = Math.abs(window.scrollY - target) < 2;
    const alreadyThere = Math.abs(scrollYBefore - target) < 2;
    const moved = window.scrollY !== scrollYBefore;
    const ok = reached || alreadyThere || moved;
    return {
      ok,
      ...(ok ? {} : { noop: true, error: 'Scroll had no effect: scroll position did not change.' }),
      data: { scrolledTo: pos, scrollX: window.scrollX, scrollY: window.scrollY, pageHeight: pageH },
    };
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
      const result = await Promise.race([Promise.resolve(fn(ctx)), new Promise((_, reject) => setTimeout(() => reject(new Error('run_code timed out after ' + timeoutMs + 'ms')), timeoutMs))]);
      return { ok: true, data: { result: result === undefined ? null : safeJson(result) } };
    } catch (e) {
      return { ok: false, error: 'run_code failed: ' + String((e && e.message) || e) };
    }
  }

  return { ok: false, error: 'Unknown action tool: ' + args.__tool };
}
