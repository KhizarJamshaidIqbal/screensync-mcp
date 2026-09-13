// ScreenSync DOM Extraction, Inspection & Assertion Unit (Under 500 lines)
// Self-contained executor for extraction tools (hierarchy, find, schema, diff, bounds, som, assert, markdown)

export async function ssWebUnitExtract(args) {
  try {
    if (navigator.webdriver) Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    if (!window.chrome) window.chrome = { runtime: {} };
  } catch {}

  const SEL = [
    'a[href]', 'button', 'input', 'textarea', 'select',
    '[role="button"]', '[role="link"]', '[role="checkbox"]', '[role="tab"]', '[role="textbox"]',
    '[onclick]', '[contenteditable="true"]', '[contenteditable=""]', '[contenteditable]',
    '[data-testid*="tweetTextarea"]', '[data-testid*="tweetButton"]', '[aria-label*="Post text"]',
    '[aria-label*="Tweet"]', '[aria-label*="Post"]', 'summary',
  ].join(', ');

  function showActionRipple(x, y, label, color = '#10B981') {
    try {
      const ring = document.createElement('div');
      ring.setAttribute('data-ss-halo', 'true');
      ring.style.cssText = `
        position: fixed; left: ${x}px; top: ${y}px; width: 44px; height: 44px;
        margin-left: -22px; margin-top: -22px; border-radius: 50%;
        border: 2px solid ${color}; box-shadow: 0 0 18px ${color};
        pointer-events: none; z-index: 2147483647; transform: scale(0.3); opacity: 1;
        transition: transform 0.65s cubic-bezier(0.1, 0.9, 0.2, 1), opacity 0.65s ease-out;
      `;
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
      if (i < parts.length - 1) currentRoot = target.shadowRoot || target;
    }
    return target ? { el: target, via: 'playwright_pierce_shadow' } : null;
  }

  function resolvePlaywrightLocator(sel) {
    if (!sel || typeof sel !== 'string') return null;
    sel = sel.trim();
    if (sel.startsWith('css=')) sel = sel.slice(4).trim();
    if (sel.includes('>>>')) {
      const pierced = resolvePiercingSelector(sel);
      if (pierced) return pierced;
    }
    if (sel.startsWith('pierce/')) {
      const el = findDeep(sel.slice(7).trim(), document);
      if (el) return { el, via: 'playwright_pierce' };
    }
    if (sel.includes(':has-text(')) {
      const match = sel.match(/^([^:]+):has-text\(["']?([^"'\)]+)["']?\)$/);
      if (match) {
        const baseSel = match[1].trim();
        const textTarget = match[2].trim().toLowerCase();
        for (const c of document.querySelectorAll(baseSel)) {
          if ((c.innerText || '').toLowerCase().includes(textTarget)) return { el: c, via: 'playwright_has_text' };
        }
      }
    }
    if (sel.startsWith('xpath=')) sel = sel.slice(6);
    if (sel.startsWith('//') || sel.startsWith('(//')) {
      try {
        const res = document.evaluate(sel, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
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
        const candidates = document.querySelectorAll(`[role="${role}"], ${role === 'button' ? 'button, [type="button"], [type="submit"]' : role === 'link' ? 'a[href]' : role === 'textbox' ? 'input:not([type="button"]):not([type="submit"]):not([type="checkbox"]):not([type="radio"]), textarea, [contenteditable="true"]' : ''}`);
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
      const el = document.querySelector(`[placeholder="${ph}"], [placeholder*="${ph}" i]`);
      if (el) return { el, via: 'playwright_placeholder' };
      return null;
    }
    if (sel.startsWith('label=')) {
      const lbl = sel.slice(6).replace(/^["']|["']$/g, '').toLowerCase();
      const ariaEl = document.querySelector(`[aria-label="${lbl}" i], [aria-label*="${lbl}" i]`);
      if (ariaEl) return { el: ariaEl, via: 'playwright_aria_label' };
      for (const l of document.querySelectorAll('label')) {
        if ((l.innerText || '').toLowerCase().includes(lbl)) {
          if (l.htmlFor) {
            const input = document.getElementById(l.htmlFor);
            if (input) return { el: input, via: 'playwright_label' };
          }
          const nested = l.querySelector('input, textarea, select');
          if (nested) return { el: nested, via: 'playwright_label' };
        }
      }
      return null;
    }
    if (sel.startsWith('text=')) {
      const txt = sel.slice(5).replace(/^["']|["']$/g, '').toLowerCase();
      for (const el of document.querySelectorAll('button, a, span, p, div, label, li, td, th, h1, h2, h3')) {
        if ((el.innerText || '').toLowerCase().trim() === txt) return { el, via: 'playwright_text_exact' };
      }
      for (const el of document.querySelectorAll('button, a, span, p, div, label, li, td, th, h1, h2, h3')) {
        if ((el.innerText || '').toLowerCase().includes(txt)) return { el, via: 'playwright_text_contains' };
      }
      return null;
    }
    try {
      const bare = document.querySelector(sel) || findDeep(sel, document);
      if (bare) return { el: bare, via: 'css' };
    } catch {}
    return null;
  }

  function collect() {
    const list = Array.from(document.querySelectorAll(SEL));
    const out = [];
    let idx = 0;
    for (const el of list) {
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      if (rect.width > 4 && rect.height > 4 && style.display !== 'none' && style.visibility !== 'hidden') {
        const itemIndex = idx++;
        const label = (el.innerText || el.value || el.getAttribute('aria-label') || el.title || el.placeholder || '').trim().replace(/\s+/g, ' ').slice(0, 100);
        try { el.setAttribute('data-ss-id', String(itemIndex)); } catch {}
        out.push({
          index: itemIndex,
          tag: el.tagName.toLowerCase(),
          type: el.getAttribute('type') || undefined,
          href: el.getAttribute('href') || undefined,
          text: label || undefined,
          x: Math.round(rect.x + rect.width / 2),
          y: Math.round(rect.y + rect.height / 2),
        });
        if (out.length >= 300) break;
      }
    }
    return out;
  }

  async function findByWithRetry(a, maxWaitMs = 2000) {
    const start = Date.now();
    while (Date.now() - start < maxWaitMs) {
      if (a.selector) {
        const pw = resolvePlaywrightLocator(a.selector);
        if (pw) return pw;
        const el = document.querySelector(a.selector) || findDeep(a.selector, document);
        if (el) return { el, via: 'selector' };
      }
      if (typeof a.index === 'number') {
        const el = document.querySelector('[data-ss-id="' + a.index + '"]');
        if (el) return { el, via: 'data-ss-id' };
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    return null;
  }

  // Tool Dispatches
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

  if (args.__tool === 'web_find') {
    const sel = args.selector || '*';
    const textFilter = args.text ? String(args.text).toLowerCase() : null;
    const hasTextFilter = args.hasText ? String(args.hasText).toLowerCase() : null;
    let all = [];
    if (sel.includes('>>>') || sel.startsWith('pierce/')) {
      const hit = resolvePlaywrightLocator(sel);
      if (hit && hit.el) all = [hit.el];
    } else {
      try { all = Array.from(document.querySelectorAll(sel)); }
      catch {
        const hit = resolvePlaywrightLocator(sel);
        if (hit && hit.el) all = [hit.el];
        else return { ok: false, error: 'Invalid selector: ' + sel };
      }
    }
    if (textFilter) all = all.filter((el) => (el.innerText || el.textContent || '').toLowerCase().includes(textFilter));
    if (hasTextFilter) all = all.filter((el) => (el.innerText || el.textContent || '').toLowerCase().includes(hasTextFilter));

    let target = null;
    let selectedIdx = null;
    if (typeof args.nth === 'number') {
      const idx = args.nth < 0 ? all.length + args.nth : args.nth;
      if (idx >= 0 && idx < all.length) { target = all[idx]; selectedIdx = idx; }
    } else if (all.length > 0) { target = all[0]; selectedIdx = 0; }

    const limit = Math.min(Number(args.limit) || 20, 100);
    const matches = all.slice(0, limit).map((el, i) => {
      const r = el.getBoundingClientRect();
      return {
        index: i,
        tag: el.tagName.toLowerCase(),
        text: (el.innerText || el.textContent || '').trim().slice(0, 100),
        rect: { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height), visible: r.width > 0 && r.height > 0 },
        id: el.id || undefined,
        role: el.getAttribute('role') || undefined,
      };
    });

    let selectedData = null;
    if (target) {
      const r = target.getBoundingClientRect();
      selectedData = {
        index: selectedIdx,
        tag: target.tagName.toLowerCase(),
        text: (target.innerText || target.textContent || '').trim().slice(0, 200),
        rect: { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height), visible: r.width > 0 && r.height > 0 },
        center: { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) },
      };
      if (args.highlight !== false) showActionRipple(selectedData.center.x, selectedData.center.y, `Match #${selectedIdx}`, '#10B981');
    }

    return { ok: true, data: { count: all.length, selected: selectedData, matches } };
  }

  if (args.__tool === 'web_scrape_schema') {
    const itemSelector = args.itemSelector || args.selector || '.card, article, [data-item], tr, li.item, div[class*="item"]';
    const schema = args.schema || { text: '' };
    const limit = Math.min(Number(args.limit) || 100, 500);
    const roots = Array.from(document.querySelectorAll(itemSelector)).slice(0, limit);
    const results = [];

    for (const root of roots) {
      const row = {};
      for (const [key, rule] of Object.entries(schema)) {
        if (!rule) { row[key] = (root.innerText || '').trim(); continue; }
        let subSel = String(rule);
        let attr = null;
        if (subSel.includes('@')) {
          const parts = subSel.split('@');
          subSel = parts[0].trim();
          attr = parts[1].trim();
        }
        const targetEl = subSel ? root.querySelector(subSel) : root;
        if (!targetEl) { row[key] = null; continue; }
        row[key] = attr ? (targetEl.getAttribute(attr) || targetEl[attr] || null) : (targetEl.innerText || targetEl.value || targetEl.getAttribute('aria-label') || '').trim();
      }
      results.push(row);
    }
    return { ok: true, data: { items: results, count: results.length, itemSelector } };
  }

  if (args.__tool === 'web_dom_diff') {
    const dialog = document.querySelector('div[role="dialog"], [aria-modal="true"], .modal, .share-creation-state');
    const toast = document.querySelector('.toast, [role="alert"], [aria-live="polite"], [aria-live="assertive"]');
    const current = {
      url: location.href,
      title: document.title,
      interactiveCount: collect().length,
      headingCount: document.querySelectorAll('h1, h2, h3').length,
      hasModal: Boolean(dialog),
      modalTitle: dialog ? ((dialog.querySelector('h1, h2, h3, [role="heading"]') && dialog.querySelector('h1, h2, h3, [role="heading"]').innerText) || 'Dialog') : null,
      toastMessage: toast ? (toast.innerText || '').trim() : null,
      bodyTextLength: (document.body && document.body.innerText ? document.body.innerText.length : 0),
    };

    let delta = null;
    if (args.previous && typeof args.previous === 'object') {
      const prev = args.previous;
      delta = {
        urlChanged: current.url !== prev.url,
        titleChanged: current.title !== prev.title,
        modalOpened: !prev.hasModal && current.hasModal,
        modalClosed: prev.hasModal && !current.hasModal,
        toastAppeared: !prev.toastMessage && Boolean(current.toastMessage),
        newToast: current.toastMessage,
        interactiveDelta: current.interactiveCount - (prev.interactiveCount || 0),
      };
    }
    return { ok: true, data: { snapshot: current, delta: delta || { message: 'Baseline snapshot created.' } } };
  }

  if (args.__tool === 'web_element_bounds') {
    const hit = await findByWithRetry(args);
    if (!hit) return { ok: false, error: 'Element not found for bounds calculation.' };
    hit.el.scrollIntoView({ block: 'center', inline: 'center' });
    const r = hit.el.getBoundingClientRect();
    return {
      ok: true,
      data: {
        x: Math.max(0, Math.round(r.x)),
        y: Math.max(0, Math.round(r.y)),
        width: Math.max(1, Math.round(r.width)),
        height: Math.max(1, Math.round(r.height)),
        devicePixelRatio: window.devicePixelRatio || 1,
        via: hit.via,
      },
    };
  }

  if (args.__tool === 'web_remove_overlay') {
    const badges = document.querySelectorAll('[data-ss-som-badge]');
    badges.forEach((b) => b.remove());
    return { ok: true, data: { removed: badges.length } };
  }

  if (args.__tool === 'web_som_overlay') {
    document.querySelectorAll('[data-ss-som-badge]').forEach((b) => b.remove());
    const maxBadges = Math.min(Number(args.limit) || 60, 150);
    const badgeColor = args.color || '#EF4444';
    const candidates = Array.from(document.querySelectorAll(SEL)).filter((el) => {
      const r = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      return (r.width > 4 && r.height > 4 && r.top < window.innerHeight && r.bottom > 0 && r.left < window.innerWidth && r.right > 0 && style.display !== 'none' && style.visibility !== 'hidden');
    }).slice(0, maxBadges);

    const elements = [];
    candidates.forEach((el, idx) => {
      const r = el.getBoundingClientRect();
      const badge = document.createElement('div');
      badge.setAttribute('data-ss-som-badge', 'true');
      badge.textContent = String(idx + 1);
      badge.style.cssText = `
        position: fixed; left: ${Math.max(2, Math.round(r.left))}px; top: ${Math.max(2, Math.round(r.top))}px;
        background: ${badgeColor}; color: #FFFFFF; font-family: monospace; font-size: 11px; font-weight: 800;
        padding: 2px 5px; border-radius: 4px; border: 1px solid #FFFFFF; box-shadow: 0 2px 6px rgba(0,0,0,0.5);
        pointer-events: none; z-index: 2147483646;
      `;
      document.body.appendChild(badge);
      elements.push({
        badgeNumber: idx + 1,
        tag: el.tagName.toLowerCase(),
        text: (el.innerText || el.textContent || el.getAttribute('aria-label') || el.title || '').trim().slice(0, 80),
        center: { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) },
      });
    });
    return { ok: true, data: { totalOverlaid: elements.length, elements, instruction: 'Numbered badges rendered on page.' } };
  }

  if (args.__tool === 'web_assert') {
    const condition = String(args.condition || 'visible').toLowerCase();
    const sel = args.selector;
    const expectedText = args.text ? String(args.text).toLowerCase() : null;
    const expectedValue = args.value !== undefined ? String(args.value) : null;
    const expectedCount = typeof args.count === 'number' ? args.count : null;
    let pass = false;
    let actualValue = null;

    if (condition === 'visible') {
      const el = sel ? document.querySelector(sel) : null;
      if (el) {
        const r = el.getBoundingClientRect();
        const s = window.getComputedStyle(el);
        pass = r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden';
        actualValue = pass ? 'visible' : 'hidden/zero-dimension';
      } else { pass = false; actualValue = 'not_in_dom'; }
    } else if (condition === 'not_visible') {
      const el = sel ? document.querySelector(sel) : null;
      if (!el) { pass = true; actualValue = 'not_in_dom'; }
      else {
        const r = el.getBoundingClientRect();
        const s = window.getComputedStyle(el);
        pass = r.width === 0 || r.height === 0 || s.display === 'none' || s.visibility === 'hidden';
        actualValue = pass ? 'hidden' : 'visible';
      }
    } else if (condition === 'has_text') {
      const el = sel ? document.querySelector(sel) : document.body;
      const text = ((el && (el.innerText || el.textContent)) || '').toLowerCase();
      actualValue = text.slice(0, 100);
      pass = expectedText ? text.includes(expectedText) : false;
    } else if (condition === 'has_value') {
      const el = sel ? document.querySelector(sel) : null;
      actualValue = el ? String(el.value ?? '') : null;
      pass = actualValue === expectedValue;
    } else if (condition === 'has_count') {
      const list = sel ? document.querySelectorAll(sel) : [];
      actualValue = list.length;
      pass = actualValue === expectedCount;
    } else if (condition === 'matches_url') {
      actualValue = window.location.href;
      pass = expectedText ? actualValue.toLowerCase().includes(expectedText) : false;
    } else if (condition === 'matches_title') {
      actualValue = document.title;
      pass = expectedText ? actualValue.toLowerCase().includes(expectedText) : false;
    } else {
      return { ok: false, error: `Unknown assertion condition: ${condition}` };
    }

    if (pass) {
      if (sel) {
        const el = document.querySelector(sel);
        if (el) { const r = el.getBoundingClientRect(); showActionRipple(r.x + r.width / 2, r.y + r.height / 2, 'Assertion Passed', '#10B981'); }
      }
      return { ok: true, data: { condition, passed: true, actual: actualValue } };
    }
    return { ok: false, error: `Assertion failed: expected condition "${condition}" for "${sel || 'page'}", but found "${actualValue}".` };
  }

  if (args.__tool === 'web_markdown_extract') {
    const title = document.title || '';
    const metaDesc = (document.querySelector('meta[name="description"]') || {}).content || '';
    const metaAuthor = (document.querySelector('meta[name="author"]') || {}).content || '';
    const canonical = (document.querySelector('link[rel="canonical"]') || {}).href || window.location.href;
    const root = document.querySelector('article') || document.querySelector('main') || document.querySelector('[role="main"]') || document.querySelector('.post-content, .article-body, #content, .entry-content') || document.body;
    const clone = root.cloneNode(true);
    clone.querySelectorAll('script, style, noscript, iframe, nav, footer, header, aside, .ad, .ads, .social-share, .cookie-banner, [role="navigation"], [role="banner"]').forEach((n) => n.remove());

    function nodeToMd(node) {
      if (!node) return '';
      if (node.nodeType === 3) return node.textContent.replace(/\s+/g, ' ');
      if (node.nodeType !== 1) return '';
      const tag = node.tagName.toLowerCase();
      const inner = Array.from(node.childNodes).map(nodeToMd).join('');
      switch (tag) {
        case 'h1': return `\n\n# ${inner.trim()}\n\n`;
        case 'h2': return `\n\n## ${inner.trim()}\n\n`;
        case 'h3': return `\n\n### ${inner.trim()}\n\n`;
        case 'h4': return `\n\n#### ${inner.trim()}\n\n`;
        case 'p': return `\n\n${inner.trim()}\n\n`;
        case 'br': return '\n';
        case 'strong': case 'b': return `**${inner.trim()}**`;
        case 'em': case 'i': return `*${inner.trim()}*`;
        case 'code': return `\`${inner.trim()}\``;
        case 'pre': return `\n\n\`\`\`\n${node.textContent.trim()}\n\`\`\`\n\n`;
        case 'blockquote': return `\n\n> ${inner.trim().replace(/\n/g, '\n> ')}\n\n`;
        case 'li': return `\n- ${inner.trim()}`;
        case 'ul': case 'ol': return `\n\n${inner.trim()}\n\n`;
        case 'a': { const h = node.getAttribute('href'); return (h && inner.trim()) ? `[${inner.trim()}](${h})` : inner; }
        case 'img': { const a = node.getAttribute('alt') || 'image'; const s = node.getAttribute('src'); return s ? `![${a}](${s})` : ''; }
        case 'table': return `\n\n${inner.trim()}\n\n`;
        case 'tr': return `| ${Array.from(node.children).map((c) => nodeToMd(c).trim()).join(' | ')} |\n`;
        default: return inner;
      }
    }
    const markdown = nodeToMd(clone).replace(/\n{3,}/g, '\n\n').trim();
    const wordCount = (markdown.match(/\b\w+\b/g) || []).length;
    return {
      ok: true,
      data: {
        title, description: metaDesc, author: metaAuthor, canonical, wordCount,
        readingTimeMinutes: Math.max(1, Math.round(wordCount / 200)),
        markdown: `# ${title}\n\n${metaDesc ? `> ${metaDesc}\n\n` : ''}${markdown}`,
      },
    };
  }

  return { ok: false, error: 'Unknown extraction tool: ' + args.__tool };
}
