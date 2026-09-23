// ScreenSync DOM Interaction Unit
// Self-contained executor for interactive web tools (click, type, clear, highlight, scroll, upload, drag)

export async function ssWebUnitInteract(args) {
  function escapeHtml(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  try {
    if (!window.chrome) window.chrome = { runtime: {} };
  } catch {}

  async function findByWithRetry(a, maxWaitMs = 2500) {
    const start = Date.now();
    while (Date.now() - start < maxWaitMs) {
      const hit = findBy(a);
      if (hit) return hit;
      await new Promise((r) => setTimeout(r, 150));
    }
    return null;
  }

  function showActionRipple(x, y, label, color = '#00E5FF') {
    try {
      const ring = document.createElement('div');
      ring.setAttribute('data-ss-halo', 'true');
      ring.style.cssText = `
        position: fixed; left: ${x}px; top: ${y}px; width: 44px; height: 44px;
        margin-left: -22px; margin-top: -22px; border-radius: 50%;
        border: 2px solid ${color}; box-shadow: 0 0 18px ${color}, inset 0 0 10px ${color};
        pointer-events: none; z-index: 2147483647; transform: scale(0.3); opacity: 1;
        transition: transform 0.65s cubic-bezier(0.1, 0.9, 0.2, 1), opacity 0.65s ease-out;
      `;
      const tag = document.createElement('div');
      tag.style.cssText = `
        position: absolute; top: -24px; left: 50%; transform: translateX(-50%);
        background: rgba(15, 23, 42, 0.92); color: #fff; font-family: ui-monospace, monospace;
        font-size: 11px; font-weight: 600; padding: 2px 7px; border-radius: 4px;
        border: 1px solid ${color}; white-space: nowrap; pointer-events: none;
      `;
      tag.textContent = label || 'AI Action';
      ring.appendChild(tag);
      (document.body || document.documentElement).appendChild(ring);
      requestAnimationFrame(() => {
        ring.style.transform = 'scale(2.0)';
        ring.style.opacity = '0';
      });
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
          const shadowFound = findDeep(selector, el.shadowRoot);
          if (shadowFound) return shadowFound;
        }
      }
    } catch {}
    return null;
  }

  function resolvePiercingSelector(sel, root = document) {
    if (!sel || typeof sel !== 'string') return null;
    const parts = sel.split(/\s*>>>\s*/);
    let currentRoot = root;
    let target = null;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i].trim();
      if (!part) continue;
      target = currentRoot.querySelector(part) || findDeep(part, currentRoot);
      if (!target) return null;
      if (i < parts.length - 1) {
        currentRoot = target.shadowRoot || target;
      }
    }
    return target ? { el: target, via: 'playwright_pierce_shadow' } : null;
  }

  function resolvePlaywrightLocator(sel, root = document) {
    if (!sel || typeof sel !== 'string') return null;
    sel = sel.trim();
    if (sel.startsWith('@')) {
      const ref = sel.slice(1).trim();
      const el = root.querySelector ? root.querySelector(`[data-ss-som-ref="${ref}"], [data-ss-id="${ref}"]`) : null;
      return el ? { el, via: 'playwright_som_ref' } : null;
    }
    if (sel.startsWith('ref=')) {
      const ref = sel.slice(4).trim();
      const el = root.querySelector ? root.querySelector(`[data-ss-som-ref="${ref}"], [data-ss-id="${ref}"]`) : null;
      return el ? { el, via: 'playwright_som_ref' } : null;
    }
    if (sel.includes(' >> nth=')) {
      const parts = sel.split(/\s*>>\s*nth=\s*/);
      const all = resolveAllPlaywrightLocators(parts[0].trim(), root);
      const n = parseInt(parts[1].trim(), 10) || 0;
      const el = all[n < 0 ? all.length + n : n];
      return el ? { el, via: 'playwright_nth' } : null;
    }
    const nthMatch = sel.match(/^(.+?)(?:\.nth\((\d+)\)|:nth\((\d+)\)|:first|\.first|:last|\.last)$/);
    if (nthMatch) {
      const base = nthMatch[1].trim();
      const all = resolveAllPlaywrightLocators(base, root);
      if (sel.endsWith(':first') || sel.endsWith('.first')) return all[0] ? { el: all[0], via: 'playwright_first' } : null;
      if (sel.endsWith(':last') || sel.endsWith('.last')) return all[all.length - 1] ? { el: all[all.length - 1], via: 'playwright_last' } : null;
      const n = parseInt(nthMatch[2] ?? nthMatch[3], 10) || 0;
      const el = all[n < 0 ? all.length + n : n];
      return el ? { el, via: 'playwright_nth' } : null;
    }
    if (sel.includes(' >> ')) {
      const parts = sel.split(/\s*>>\s*/);
      let cur = root;
      let lastHit = null;
      for (const part of parts) {
        if (!part) continue;
        lastHit = resolvePlaywrightLocator(part, cur);
        if (!lastHit || !lastHit.el) return null;
        cur = lastHit.el;
      }
      return lastHit;
    }
    if (sel.startsWith('css=')) sel = sel.slice(4).trim();
    if (sel.includes('>>>')) {
      const pierced = resolvePiercingSelector(sel, root);
      if (pierced) return pierced;
    }
    if (sel.startsWith('pierce/')) {
      const raw = sel.slice(7).trim();
      const el = findDeep(raw, root);
      if (el) return { el, via: 'playwright_pierce' };
    }
    if (sel.includes(':has-text(')) {
      const match = sel.match(/^([^:]+):has-text\(["']?([^"'\)]+)["']?\)$/);
      if (match) {
        const baseSel = match[1].trim();
        const textTarget = match[2].trim().toLowerCase();
        const pool = root.querySelectorAll ? root.querySelectorAll(baseSel) : [];
        for (const c of pool) {
          if ((c.innerText || '').toLowerCase().includes(textTarget)) {
            return { el: c, via: 'playwright_has_text' };
          }
        }
      }
    }
    if (sel.startsWith('xpath=')) sel = sel.slice(6);
    if (sel.startsWith('//') || sel.startsWith('(//') || sel.startsWith('.//')) {
      try {
        const ctx = (root && root.nodeType) ? root : document;
        const expr = (ctx !== document && sel.startsWith('//')) ? '.' + sel : sel;
        const res = document.evaluate(expr, ctx, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
        if (res.singleNodeValue) return { el: res.singleNodeValue, via: 'playwright_xpath' };
      } catch {}
      return null;
    }
    if (sel.startsWith('role=')) {
      const roleStr = sel.slice(5).trim();
      const nameMatch = roleStr.match(/^([a-zA-Z_-]+)(?:\[name=["']([^"']+)["']\])?/);
      if (nameMatch) {
        const role = nameMatch[1].toLowerCase();
        const expectedName = nameMatch[2] ? nameMatch[2].toLowerCase() : null;
        const q = `[role="${role}"], ${role === 'button' ? 'button, [type="button"], [type="submit"]' : role === 'link' ? 'a[href]' : role === 'textbox' ? 'input:not([type="button"]):not([type="submit"]):not([type="checkbox"]):not([type="radio"]), textarea, [contenteditable="true"]' : ''}`;
        const candidates = root.querySelectorAll ? root.querySelectorAll(q) : [];
        for (const el of candidates) {
          if (!expectedName) return { el, via: 'playwright_role:' + role };
          const text = (el.innerText || el.getAttribute('aria-label') || el.value || '').toLowerCase();
          if (text.includes(expectedName)) return { el, via: 'playwright_role:' + role };
        }
      }
      return null;
    }
    if (sel.startsWith('placeholder=')) {
      const ph = sel.slice(12).replace(/^["']|["']$/g, '');
      const el = root.querySelector ? root.querySelector(`[placeholder="${ph}"], [placeholder*="${ph}" i]`) : null;
      if (el) return { el, via: 'playwright_placeholder' };
      return null;
    }
    if (sel.startsWith('label=')) {
      const lbl = sel.slice(6).replace(/^["']|["']$/g, '').toLowerCase();
      const ariaEl = root.querySelector ? root.querySelector(`[aria-label="${lbl}" i], [aria-label*="${lbl}" i]`) : null;
      if (ariaEl) return { el: ariaEl, via: 'playwright_aria_label' };
      const labels = root.querySelectorAll ? root.querySelectorAll('label') : [];
      for (const l of labels) {
        if ((l.innerText || '').toLowerCase().includes(lbl)) {
          if (l.htmlFor) {
            const input = document.getElementById(l.htmlFor);
            if (input && (!root.contains || root.contains(input))) return { el: input, via: 'playwright_label' };
          }
          const nested = l.querySelector('input, textarea, select');
          if (nested) return { el: nested, via: 'playwright_label' };
        }
      }
      return null;
    }
    if (sel.startsWith('text=')) {
      const txt = sel.slice(5).replace(/^["']|["']$/g, '').toLowerCase();
      const pool = root.querySelectorAll ? root.querySelectorAll('button, a, span, p, div, label, li, td, th, h1, h2, h3') : [];
      for (const el of pool) {
        if ((el.innerText || '').toLowerCase().trim() === txt) return { el, via: 'playwright_text_exact' };
      }
      for (const el of pool) {
        if ((el.innerText || '').toLowerCase().includes(txt)) return { el, via: 'playwright_text_contains' };
      }
      return null;
    }
    if (sel.startsWith('testid=')) {
      const v = sel.slice(7).replace(/^["']|["']$/g, '');
      const el = root.querySelector ? root.querySelector(`[data-testid="${v}"], [data-test="${v}"], [data-cy="${v}"]`) : null;
      if (el) return { el, via: 'playwright_testid' };
      return null;
    }
    try {
      const bare = (root.querySelector ? root.querySelector(sel) : null) || findDeep(sel, root);
      if (bare) return { el: bare, via: 'css' };
    } catch {}
    return null;
  }

  function resolveAllPlaywrightLocators(sel, root = document) {
    if (!sel || typeof sel !== 'string') return [];
    sel = sel.trim();
    if (sel.startsWith('css=')) sel = sel.slice(4).trim();
    if (sel.startsWith('testid=')) {
      const v = sel.slice(7).replace(/^["']|["']$/g, '');
      return Array.from(root.querySelectorAll ? root.querySelectorAll(`[data-testid="${v}"], [data-test="${v}"], [data-cy="${v}"]`) : []);
    }
    if (sel.startsWith('text=')) {
      const txt = sel.slice(5).replace(/^["']|["']$/g, '').toLowerCase();
      return Array.from(root.querySelectorAll ? root.querySelectorAll('*') : []).filter((el) => (el.innerText || el.textContent || '').toLowerCase().trim().includes(txt));
    }
    try {
      const list = Array.from(root.querySelectorAll ? root.querySelectorAll(sel) : []);
      if (list.length > 0) return list;
    } catch {}
    const single = resolvePlaywrightLocator(sel, root);
    return single && single.el ? [single.el] : [];
  }

  function countMatches(sel, root = document) {
    if (!sel || typeof sel !== 'string') return 0;
    try {
      if (sel.includes(' >> ')) {
        const parts = sel.split(/\s*>>\s*/);
        let cur = root;
        for (let i = 0; i < parts.length - 1; i++) {
          const hit = resolvePlaywrightLocator(parts[i], cur);
          if (!hit || !hit.el) return 0;
          cur = hit.el;
        }
        return countMatches(parts[parts.length - 1], cur);
      }
      return resolveAllPlaywrightLocators(sel, root).length;
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
    if (!document.hidden && typeof requestAnimationFrame === 'function') {
      await new Promise((res) => { const t = setTimeout(res, 50); requestAnimationFrame(() => requestAnimationFrame(() => { clearTimeout(t); res(); })); });
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

  function findBy(a) {
    if (a.strict === true && typeof a.selector === 'string' && a.selector) {
      const c = countMatches(a.selector);
      if (c > 1) {
        return { code: 'STRICT_MODE_VIOLATION', error: `Strict mode violation: selector "${a.selector}" resolved to ${c} elements. Pass strict: false or use a more specific locator or :nth().` };
      }
    }
    if (typeof a.x === 'number' && typeof a.y === 'number') {
      const el = document.elementFromPoint(a.x, a.y);
      if (el) return { el, via: 'coordinates' };
    }
    if (typeof a.selector === 'string' && a.selector) {
      const pwHit = resolvePlaywrightLocator(a.selector);
      if (pwHit) return pwHit;
      try {
        const dialog = document.querySelector('div[role="dialog"], [aria-modal="true"], .modal, .share-creation-state');
        if (dialog) {
          const el = dialog.querySelector(a.selector);
          if (el) return { el, via: 'dialog_selector' };
        }
        const el = document.querySelector(a.selector) || findDeep(a.selector, document);
        if (el) return { el, via: 'selector' };
      } catch {}
    }
    if (typeof a.xpath === 'string' && a.xpath) {
      const xHit = resolvePlaywrightLocator(a.xpath);
      if (xHit) return xHit;
    }
    if (typeof a.ref === 'number' || typeof a.ref === 'string' || typeof a.index === 'number') {
      const refVal = a.ref !== undefined ? a.ref : a.index;
      const el = document.querySelector(`[data-ss-som-ref="${refVal}"], [data-ss-id="${refVal}"]`);
      if (el) return { el, via: 'som_ref' };
      return null;
    }
    if (typeof a.text === 'string' && a.text) {
      const q = a.text.trim().toLowerCase();
      for (const el of document.querySelectorAll('button, a, input, [role="button"], [contenteditable="true"]')) {
        const t = (el.innerText || el.value || el.getAttribute('aria-label') || '').toLowerCase().trim();
        if (t === q || t.includes(q)) return { el, via: 'text' };
      }
    }
    if (a.__tool === 'web_type' || a.__tool === 'web_paste') {
      const active = document.activeElement;
      if (active && (active.isContentEditable || active.tagName === 'TEXTAREA' || active.tagName === 'INPUT')) {
        return { el: active, via: 'activeElement' };
      }
      const anyEditable = document.querySelector('div[role="dialog"] [contenteditable="true"]')
        || document.querySelector('[contenteditable="true"]')
        || document.querySelector('div[role="textbox"]');
      if (anyEditable) return { el: anyEditable, via: 'fallback_editable' };
    }
    return null;
  }


  // Action Dispatches
  if (args.__tool === 'web_click') {
    const hit = await findByWithRetry(args, Number(args.timeoutMs) || 2500);
    if (!hit) return { ok: false, code: 'ELEMENT_NOT_FOUND', error: 'Element not found to click.' };
    if (hit.code === 'STRICT_MODE_VIOLATION') return { ok: false, code: 'STRICT_MODE_VIOLATION', error: hit.error };
    const target = hit.el.closest('button, a, [role="button"], [tabindex="0"], div.share-box-feed-entry__trigger, .artdeco-button')
      || hit.el.querySelector('button, a, [role="button"], [tabindex="0"]')
      || hit.el;

    if (isDestructiveAction(target) && !args.__humanApproved && args.dryRun !== true) {
      return { ok: false, code: 'USER_CONFIRMATION_REQUIRED', risk: 'destructive', error: 'Action involves destructive keyword. User confirmation required.' };
    }

    try { target.scrollIntoView({ block: 'center', inline: 'center' }); } catch {}

    const actionCheck = await checkActionable(target);
    if (!actionCheck.ok && args.skipActionability !== true) {
      return { ok: false, code: 'NOT_ACTIONABLE', error: 'Element not actionable: ' + actionCheck.reason, retryable: true };
    }

    const label = (target.innerText || target.value || target.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim().slice(0, 80);

    if (args.dryRun === true) {
      return { ok: true, data: { dryRun: true, plannedAction: 'click', target: label || target.tagName.toLowerCase(), actionable: true, risk: isDestructiveAction(target) ? 'destructive' : 'normal' } };
    }

    try { target.focus(); } catch {}
    const rect = target.getBoundingClientRect();
    const cx = Math.max(0, rect.x + rect.width / 2);
    const cy = Math.max(0, rect.y + rect.height / 2);
    const mouseOpts = { bubbles: true, cancelable: true, view: window, clientX: cx, clientY: cy, button: 0, buttons: 1 };
    showActionRipple(cx, cy, `Click: ${(target.innerText || target.value || target.tagName).slice(0, 18)}`, '#00E5FF');
    target.dispatchEvent(new PointerEvent('pointerdown', mouseOpts));
    target.dispatchEvent(new MouseEvent('mousedown', mouseOpts));
    target.dispatchEvent(new PointerEvent('pointerup', mouseOpts));
    target.dispatchEvent(new MouseEvent('mouseup', mouseOpts));
    try { target.click(); } catch {}
    return { ok: true, data: { clicked: label || target.tagName.toLowerCase(), via: hit.via, url: location.href } };
  }

  if (args.__tool === 'web_type' || args.__tool === 'web_paste') {
    const hit = await findByWithRetry(args, Number(args.timeoutMs) || 2500);
    if (!hit) return { ok: false, code: 'ELEMENT_NOT_FOUND', error: 'Target input or contenteditable not found.' };
    if (hit.code === 'STRICT_MODE_VIOLATION') return { ok: false, code: 'STRICT_MODE_VIOLATION', error: hit.error };
    let el = hit.el;
    const editable = (el.isContentEditable || el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') ? el
      : (el.closest('[contenteditable="true"], [role="textbox"], .ql-editor, textarea, input')
      || el.querySelector('[contenteditable="true"], [role="textbox"], .ql-editor, textarea, input')
      || el);
    el = editable;

    if (isDestructiveAction(el) && !args.__humanApproved && args.dryRun !== true) {
      return { ok: false, code: 'USER_CONFIRMATION_REQUIRED', risk: 'destructive', error: 'Action involves destructive keyword. User confirmation required.' };
    }

    const actionCheck = await checkActionable(el);
    if (!actionCheck.ok && args.skipActionability !== true) {
      return { ok: false, code: 'NOT_ACTIONABLE', error: 'Element not actionable: ' + actionCheck.reason, retryable: true };
    }

    if (args.dryRun === true) {
      return { ok: true, data: { dryRun: true, plannedAction: args.__tool, text: args.mask === true ? '••••••' : String(args.text ?? ''), target: (el.innerText || el.value || el.tagName).slice(0, 50), actionable: true } };
    }

    el = editable;
    try { el.scrollIntoView({ block: 'center' }); } catch {}
    try { el.focus(); } catch {}
    const text = String(args.text == null ? '' : args.text);
    const typeRect = el.getBoundingClientRect();
    showActionRipple(Math.max(0, typeRect.x + 20), Math.max(0, typeRect.y + typeRect.height / 2), `Type: ${text.slice(0, 15)}`, '#A855F7');

    const isRich = el.isContentEditable || el.getAttribute('contenteditable') === 'true' || el.getAttribute('role') === 'textbox';
    if (isRich) {
      try {
        const innerP = el.querySelector('p') || el;
        innerP.focus();
        const range = document.createRange();
        range.selectNodeContents(innerP);
        if (args.clear !== false) {
          try { document.execCommand('selectAll', false, null); } catch {}
        } else {
          range.collapse(false);
        }
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
      } catch {}
      const textSample = text.trim().slice(0, 12);
      let inserted = false;
      try {
        const dt = new DataTransfer();
        dt.setData('text/plain', text);
        const ev = new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dt });
        const prevented = !el.dispatchEvent(ev);
        if (prevented || (textSample && el.textContent && el.textContent.includes(textSample))) inserted = true;
      } catch {}
      if (!inserted) {
        try {
          el.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType: 'insertText', data: text }));
          document.execCommand('insertText', false, text);
          if (textSample && el.textContent && el.textContent.includes(textSample)) inserted = true;
        } catch {}
      }
      if (!inserted) {
        try {
          const paras = text.split('\n\n').filter(Boolean);
          if (paras.length > 0) {
            el.innerHTML = paras.map((p) => '<p>' + p.split('\n').map((l) => l ? escapeHtml(l) : '<br>').join('<br>') + '</p>').join('');
          } else {
            el.textContent = text;
          }
        } catch {}
      }
      try { el.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true, inputType: 'insertText', data: text })); } catch {}
      try { el.dispatchEvent(new Event('input', { bubbles: true })); } catch {}
      try { el.dispatchEvent(new Event('change', { bubbles: true })); } catch {}
    } else if (el.tagName === 'SELECT') {
      el.value = text;
      el.dispatchEvent(new Event('input', { bubbles: true }));
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
    return { ok: true, data: { typed: text.slice(0, 120), into: el.tagName.toLowerCase(), via: hit.via, submitted: !!args.submit, url: location.href } };
  }

  if (args.__tool === 'web_clear') {
    const hit = findBy(args);
    if (!hit) return { ok: false, error: 'Target element not found to clear.' };
    const el = hit.el;
    el.focus();
    if (el.isContentEditable || el.getAttribute('contenteditable') === 'true') {
      try {
        document.execCommand('selectAll', false, null);
        document.execCommand('delete', false, null);
      } catch { el.innerHTML = ''; }
      el.dispatchEvent(new Event('input', { bubbles: true }));
    } else {
      el.value = '';
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }
    return { ok: true, data: { cleared: true, via: hit.via } };
  }

  if (args.__tool === 'web_highlight') {
    const hit = findBy(args);
    if (!hit) return { ok: false, error: 'Element not found to highlight.' };
    const el = hit.el;
    const color = args.color || '#8B5CF6';
    const r0 = el.getBoundingClientRect();
    const inView = r0.top >= 0 && r0.left >= 0 && r0.bottom <= window.innerHeight && r0.right <= window.innerWidth;
    if (!args.noScroll && !inView) el.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
    const prevOut = el.style.outline; const prevShadow = el.style.boxShadow;
    el.style.outline = `3px solid ${color}`; el.style.boxShadow = `0 0 16px ${color}`;
    setTimeout(() => { el.style.outline = prevOut; el.style.boxShadow = prevShadow; }, Number(args.durationMs) || 2500);
    const r = el.getBoundingClientRect();
    return { ok: true, data: { highlighted: true, via: hit.via, color, scrollX: window.scrollX, scrollY: window.scrollY, box: { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) } } };
  }

  if (args.__tool === 'web_scroll') {
    const dir = String(args.direction || 'down').toLowerCase();
    const amount = Number(args.amount) || 0.6;
    const targetEl = args.selector ? document.querySelector(args.selector) : null;
    const winW = window.innerWidth;
    const winH = window.innerHeight;
    let dx = 0;
    let dy = 0;
    if (dir === 'down') dy = winH * amount;
    else if (dir === 'up') dy = -winH * amount;
    else if (dir === 'right') dx = winW * amount;
    else if (dir === 'left') dx = -winW * amount;

    if (targetEl) {
      targetEl.scrollBy({ left: dx, top: dy, behavior: 'smooth' });
      return { ok: true, data: { scrolled: dir, amount, container: args.selector, scrollLeft: targetEl.scrollLeft, scrollTop: targetEl.scrollTop } };
    } else {
      window.scrollBy({ left: dx, top: dy, behavior: 'smooth' });
      return { ok: true, data: { scrolled: dir, amount, scrollX: Math.round(window.scrollX), scrollY: Math.round(window.scrollY), viewport: { width: winW, height: winH } } };
    }
  }

  if (args.__tool === 'web_upload_file') {
    const hit = await findByWithRetry(args);
    if (!hit) return { ok: false, error: 'File input or dropzone element not found.' };
    const el = hit.el;
    const input = (el.tagName === 'INPUT' && el.type === 'file') ? el : el.querySelector('input[type="file"]') || el;
    const fileName = String(args.fileName || 'upload.png');
    const mimeType = String(args.mimeType || 'image/png');
    const base64Data = String(args.base64Data || '');
    if (base64Data) {
      try {
        const raw = base64Data.includes(',') ? base64Data.split(',')[1] : base64Data;
        const byteCharacters = atob(raw);
        const byteNumbers = new Array(byteCharacters.length);
        for (let i = 0; i < byteCharacters.length; i++) byteNumbers[i] = byteCharacters.charCodeAt(i);
        const byteArray = new Uint8Array(byteNumbers);
        const file = new File([byteArray], fileName, { type: mimeType });
        const dt = new DataTransfer();
        dt.items.add(file);
        if (input.tagName === 'INPUT' && input.type === 'file') {
          input.files = dt.files;
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
        } else {
          input.dispatchEvent(new DragEvent('dragenter', { bubbles: true, cancelable: true, dataTransfer: dt }));
          input.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }));
          input.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
        }
        return { ok: true, data: { uploaded: true, fileName, mimeType, via: hit.via } };
      } catch (err) {
        return { ok: false, error: `File injection failed: ${String(err.message || err)}` };
      }
    }
    return { ok: true, data: { fileInputFound: true, selector: hit.via } };
  }

  if (args.__tool === 'web_drag_and_drop') {
    const sourceHit = await findByWithRetry({ selector: args.sourceSelector || args.source, text: args.sourceText, x: args.sourceX, y: args.sourceY });
    if (!sourceHit) return { ok: false, error: 'Source drag element not found.' };
    const targetHit = await findByWithRetry({ selector: args.targetSelector || args.target, text: args.targetText, x: args.targetX, y: args.targetY });
    if (!targetHit) return { ok: false, error: 'Target drop element not found.' };

    const sRect = sourceHit.el.getBoundingClientRect();
    const tRect = targetHit.el.getBoundingClientRect();
    const sx = sRect.x + sRect.width / 2;
    const sy = sRect.y + sRect.height / 2;
    const tx = tRect.x + tRect.width / 2;
    const ty = tRect.y + tRect.height / 2;

    const dt = new DataTransfer();
    sourceHit.el.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: sx, clientY: sy }));
    targetHit.el.dispatchEvent(new DragEvent('dragenter', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: tx, clientY: ty }));
    targetHit.el.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: tx, clientY: ty }));
    targetHit.el.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: tx, clientY: ty }));
    sourceHit.el.dispatchEvent(new DragEvent('dragend', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: tx, clientY: ty }));

    showActionRipple(tx, ty, 'Drop Action', '#10B981');
    return { ok: true, data: { dragged: true, source: { x: sx, y: sy, via: sourceHit.via }, target: { x: tx, y: ty, via: targetHit.via } } };
  }

  return { ok: false, error: 'Unknown interaction tool: ' + args.__tool };
}
