// ScreenSync DOM Unit — Playwright-grade DOM inspection, bounding boxes,
// computed styles, script/style tag injections, and Reader Mode readability.
// Self-contained page-side unit designed for chrome.scripting.executeScript ({ func, args }).

export async function ssWebUnitDom(args = {}) {
  const tool = String(args.__tool || '');

  // ── Universal DOM Locator Resolver (Playwright Locators + Shadow DOM) ──
  function findBy(selector, ref, root = document) {
    if (typeof ref === 'number' || (typeof ref === 'string' && /^\d+$/.test(ref))) {
      const byRef = root.querySelector(`[data-ss-id="${ref}"]`);
      if (byRef) return byRef;
    }
    if (!selector) return null;
    const sel = String(selector).trim();

    // 1. Shadow-piercing locator: "a >>> b" or "pierce/..."
    if (sel.includes('>>>') || sel.startsWith('pierce/')) {
      const parts = sel.startsWith('pierce/') ? sel.slice(7).split(/\s+/) : sel.split(/\s*>>>\s*/);
      let cur = root;
      for (let i = 0; i < parts.length; i++) {
        if (!cur) return null;
        const part = parts[i].trim();
        if (!part) continue;
        const found = cur.querySelector(part);
        if (!found) {
          // deep walk shadow roots
          const walker = document.createTreeWalker(cur, NodeFilter.SHOW_ELEMENT, null);
          let match = null;
          while (walker.nextNode()) {
            const node = walker.currentNode;
            if (node && node.shadowRoot) {
              const inside = node.shadowRoot.querySelector(part);
              if (inside) { match = inside; break; }
            }
          }
          if (!match) return null;
          cur = match.shadowRoot || match;
        } else {
          cur = found.shadowRoot || found;
        }
      }
      return cur instanceof Element ? cur : null;
    }

    // 2. Playwright text= or :has-text()
    if (sel.startsWith('text=')) {
      const needle = sel.slice(5).replace(/^["']|["']$/g, '').toLowerCase();
      const all = root.querySelectorAll('*');
      for (const el of all) {
        if (el.children.length === 0 && (el.textContent || '').toLowerCase().includes(needle)) {
          return el;
        }
      }
      for (const el of all) {
        if ((el.textContent || '').toLowerCase().includes(needle)) return el;
      }
      return null;
    }
    if (sel.includes(':has-text(')) {
      const m = sel.match(/^(.*?):has-text\((["']?)(.*?)\2\)(.*)$/);
      if (m) {
        const baseSel = m[1].trim() || '*';
        const needle = m[3].toLowerCase();
        const cand = root.querySelectorAll(baseSel);
        for (const c of cand) {
          if ((c.textContent || '').toLowerCase().includes(needle)) return c;
        }
        return null;
      }
    }

    // 3. Playwright role=
    if (sel.startsWith('role=')) {
      const roleName = sel.slice(5).replace(/^["']|["']$/g, '').toLowerCase();
      const direct = root.querySelector(`[role="${roleName}" i]`);
      if (direct) return direct;
      // Native tag mappings
      if (roleName === 'button') return root.querySelector('button, input[type="button"], input[type="submit"]');
      if (roleName === 'link') return root.querySelector('a[href]');
      if (roleName === 'textbox') return root.querySelector('input:not([type="button"]):not([type="submit"]):not([type="checkbox"]):not([type="radio"]), textarea');
      if (roleName === 'checkbox') return root.querySelector('input[type="checkbox"]');
      if (roleName === 'heading') return root.querySelector('h1, h2, h3, h4, h5, h6');
    }

    // 4. Playwright placeholder=, label=, testid=
    if (sel.startsWith('placeholder=')) {
      const val = sel.slice(12).replace(/^["']|["']$/g, '');
      return root.querySelector(`[placeholder="${val}" i]`);
    }
    if (sel.startsWith('testid=')) {
      const val = sel.slice(7).replace(/^["']|["']$/g, '');
      return root.querySelector(`[data-testid="${val}" i], [data-test-id="${val}" i], [data-test="${val}" i]`);
    }
    if (sel.startsWith('label=')) {
      const val = sel.slice(6).replace(/^["']|["']$/g, '').toLowerCase();
      const labels = root.querySelectorAll('label');
      for (const l of labels) {
        if ((l.textContent || '').toLowerCase().includes(val)) {
          if (l.htmlFor) {
            const input = document.getElementById(l.htmlFor);
            if (input) return input;
          }
          const nested = l.querySelector('input, select, textarea');
          if (nested) return nested;
        }
      }
    }

    // 5. XPath: xpath=... or //...
    if (sel.startsWith('xpath=') || sel.startsWith('//')) {
      const xp = sel.startsWith('xpath=') ? sel.slice(6) : sel;
      try {
        const res = document.evaluate(xp, root, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
        if (res.singleNodeValue instanceof Element) return res.singleNodeValue;
      } catch {}
      return null;
    }

    // 6. Direct CSS selector
    const cleanCss = sel.startsWith('css=') ? sel.slice(4) : sel;
    try {
      const found = root.querySelector(cleanCss);
      if (found) return found;
    } catch {}

    // 7. Fallback search through shadow DOMs
    try {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, null);
      while (walker.nextNode()) {
        const node = walker.currentNode;
        if (node && node.shadowRoot) {
          try {
            const inside = node.shadowRoot.querySelector(cleanCss);
            if (inside) return inside;
          } catch {}
        }
      }
    } catch {}

    return null;
  }

  function rippleEffect(x, y, color = '#3B82F6') {
    try {
      const dot = document.createElement('div');
      dot.setAttribute('data-ss-halo', 'true');
      dot.style.cssText = `position:fixed;left:${x}px;top:${y}px;width:36px;height:36px;margin-left:-18px;margin-top:-18px;border-radius:50%;border:2px solid ${color};box-shadow:0 0 12px ${color};pointer-events:none;z-index:2147483647;transform:scale(0.4);transition:transform 0.5s ease-out,opacity 0.5s ease-out;`;
      (document.body || document.documentElement).appendChild(dot);
      requestAnimationFrame(() => { dot.style.transform = 'scale(1.8)'; dot.style.opacity = '0'; });
      setTimeout(() => { try { dot.remove(); } catch {} }, 550);
    } catch {}
  }

  // ── 1. web_content: Playwright page.content() parity ──────────────────────
  if (tool === 'web_content') {
    const hasTarget = Boolean(args.selector || typeof args.ref !== 'undefined');
    const el = hasTarget ? findBy(args.selector, args.ref) : null;
    if (hasTarget && !el) {
      return { ok: false, error: `Element not found: selector="${args.selector || ''}", ref=${args.ref ?? 'none'}` };
    }
    let html = '';
    if (el) {
      html = el.outerHTML;
    } else {
      const docType = document.doctype
        ? `<!DOCTYPE ${document.doctype.name}${document.doctype.publicId ? ` PUBLIC "${document.doctype.publicId}"` : ''}${document.doctype.systemId ? ` "${document.doctype.systemId}"` : ''}>\n`
        : '<!DOCTYPE html>\n';
      html = docType + (document.documentElement ? document.documentElement.outerHTML : '');
    }

    if (args.clean === true) {
      // Clean mode: strip scripts, inline SVG base64s, noscript, and long comments
      html = html
        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
        .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
        .replace(/<noscript\b[^<]*(?:(?!<\/noscript>)<[^<]*)*<\/noscript>/gi, '')
        .replace(/<!--[\s\S]*?-->/g, '')
        .replace(/data:image\/[a-zA-Z0-9.+_-]+;base64,[A-Za-z0-9+/=]{100,}/g, '[data-uri]');
    }

    return {
      ok: true,
      data: {
        url: window.location.href,
        title: document.title,
        length: html.length,
        clean: args.clean === true,
        html,
      },
    };
  }

  // ── 2. web_bounding_box: Playwright locator.boundingBox() parity ─────────
  if (tool === 'web_bounding_box') {
    const el = findBy(args.selector, args.ref);
    if (!el) {
      return { ok: false, error: `Element not found: selector="${args.selector || ''}", ref=${args.ref ?? 'none'}` };
    }
    if (args.scrollIntoView === true) {
      try { el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' }); } catch {}
    }
    const r = el.getBoundingClientRect();
    const scrollX = window.scrollX || window.pageXOffset || 0;
    const scrollY = window.scrollY || window.pageYOffset || 0;
    const inViewport = r.width > 0 && r.height > 0 &&
      r.top < (window.innerHeight || document.documentElement.clientHeight) &&
      r.bottom > 0 &&
      r.left < (window.innerWidth || document.documentElement.clientWidth) &&
      r.right > 0;

    rippleEffect(r.left + r.width / 2, r.top + r.height / 2, '#3B82F6');

    return {
      ok: true,
      data: {
        x: r.x,
        y: r.y,
        width: r.width,
        height: r.height,
        top: r.top,
        right: r.right,
        bottom: r.bottom,
        left: r.left,
        pageX: r.x + scrollX,
        pageY: r.y + scrollY,
        visible: r.width > 0 && r.height > 0,
        inViewport,
        tagName: el.tagName.toLowerCase(),
      },
    };
  }

  // ── 3. web_computed_style: CSS computed styles inspection ─────────────────
  if (tool === 'web_computed_style') {
    const el = findBy(args.selector, args.ref);
    if (!el) {
      return { ok: false, error: `Element not found for computed style: ${args.selector || args.ref}` };
    }
    const cs = window.getComputedStyle(el);
    const requested = Array.isArray(args.properties) && args.properties.length > 0 ? args.properties : [
      'display', 'visibility', 'opacity', 'position', 'zIndex',
      'width', 'height', 'margin', 'padding', 'border',
      'color', 'backgroundColor', 'fontSize', 'fontFamily', 'fontWeight',
      'lineHeight', 'overflow', 'cursor', 'pointerEvents', 'transform',
    ];

    const styles = {};
    for (const prop of requested) {
      // Support camelCase or kebab-case
      const kebab = prop.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase());
      styles[prop] = cs.getPropertyValue(kebab) || cs[prop] || '';
    }

    return {
      ok: true,
      data: {
        tagName: el.tagName.toLowerCase(),
        id: el.id || null,
        className: el.className || null,
        styles,
      },
    };
  }

  // ── 4. web_add_script_tag: Playwright page.addScriptTag parity ────────────
  if (tool === 'web_add_script_tag') {
    try {
      if (args.url) {
        await new Promise((resolve, reject) => {
          const script = document.createElement('script');
          script.src = String(args.url);
          if (args.type) script.type = String(args.type);
          const timer = setTimeout(() => reject(new Error(`Timeout loading script from ${args.url}`)), 15000);
          script.onload = () => { clearTimeout(timer); resolve(); };
          script.onerror = () => { clearTimeout(timer); reject(new Error(`Failed to load script from ${args.url}`)); };
          (document.head || document.documentElement).appendChild(script);
        });
        return {
          ok: true,
          data: {
            injected: true,
            type: 'script',
            url: args.url,
            loaded: true,
          },
        };
      } else if (args.content) {
        const script = document.createElement('script');
        script.textContent = String(args.content);
        if (args.type) script.type = String(args.type);
        (document.head || document.documentElement).appendChild(script);
        return {
          ok: true,
          data: {
            injected: true,
            type: 'script',
            url: null,
            contentLength: String(args.content).length,
          },
        };
      } else {
        return { ok: false, error: 'web_add_script_tag requires either "url" or "content".' };
      }
    } catch (e) {
      return { ok: false, error: `Failed to inject script tag: ${String((e && e.message) || e)}` };
    }
  }

  // ── 5. web_add_style_tag: Playwright page.addStyleTag parity ──────────────
  if (tool === 'web_add_style_tag') {
    try {
      if (args.url) {
        await new Promise((resolve, reject) => {
          const link = document.createElement('link');
          link.rel = 'stylesheet';
          link.href = String(args.url);
          const timer = setTimeout(() => reject(new Error(`Timeout loading stylesheet from ${args.url}`)), 15000);
          link.onload = () => { clearTimeout(timer); resolve(); };
          link.onerror = () => { clearTimeout(timer); reject(new Error(`Failed to load stylesheet from ${args.url}`)); };
          (document.head || document.documentElement).appendChild(link);
        });
        return { ok: true, data: { injected: true, type: 'link', url: args.url, loaded: true } };
      }
      if (args.content) {
        const style = document.createElement('style');
        style.textContent = String(args.content);
        (document.head || document.documentElement).appendChild(style);
        return { ok: true, data: { injected: true, type: 'style', contentLength: String(args.content).length } };
      }
      return { ok: false, error: 'web_add_style_tag requires either "url" or "content".' };
    } catch (e) {
      return { ok: false, error: `Failed to inject style tag: ${String((e && e.message) || e)}` };
    }
  }

  // ── 6. web_reader_mode: Clutter-free Reader Mode & Markdown Extractor ──────
  if (tool === 'web_reader_mode') {
    // Determine title
    const ogTitle = document.querySelector('meta[property="og:title"]')?.getAttribute('content');
    const h1 = document.querySelector('h1')?.innerText?.trim();
    const title = ogTitle || h1 || document.title || 'Untitled';

    // Author / byline
    const byline = document.querySelector('[rel="author"], .byline, .author, meta[name="author"]')?.getAttribute('content') ||
      document.querySelector('[rel="author"], .byline, .author')?.innerText?.trim() || null;

    // Publish date
    const publishDate = document.querySelector('time[datetime]')?.getAttribute('datetime') ||
      document.querySelector('meta[property="article:published_time"]')?.getAttribute('content') ||
      document.querySelector('meta[name="date"]')?.getAttribute('content') || null;

    // Lead image
    const leadImage = document.querySelector('meta[property="og:image"]')?.getAttribute('content') ||
      document.querySelector('article img, main img')?.src || null;

    // Locate primary content container
    const candidates = [
      document.querySelector('article'),
      document.querySelector('main'),
      document.querySelector('[role="main"]'),
      document.querySelector('.post-content, .article-content, .entry-content, .story-body'),
      document.querySelector('#content, #main-content'),
    ].filter(Boolean);

    let mainEl = candidates[0];
    if (!mainEl) {
      // Pick container with maximum paragraph density
      const divs = Array.from(document.querySelectorAll('div, section'));
      let maxScore = 0;
      for (const d of divs) {
        const pCount = d.querySelectorAll('p').length;
        const textLen = (d.innerText || '').length;
        const score = pCount * 50 + textLen;
        if (score > maxScore && !/nav|header|footer|sidebar|menu|comments/i.test(d.className + ' ' + d.id)) {
          maxScore = score;
          mainEl = d;
        }
      }
    }
    if (!mainEl) mainEl = document.body;

    // Clone and sanitize
    const clone = mainEl.cloneNode(true);
    const unwanted = clone.querySelectorAll('script, style, noscript, nav, header, footer, aside, form, iframe, .ads, .ad, [role="complementary"], .social-share, .comments');
    unwanted.forEach((el) => el.remove());

    // Markdown converter for clean readability
    function toMarkdown(node) {
      if (node.nodeType === Node.TEXT_NODE) return node.textContent || '';
      if (node.nodeType !== Node.ELEMENT_NODE) return '';

      const tag = node.tagName.toLowerCase();
      const children = Array.from(node.childNodes).map(toMarkdown).join('');

      if (/^h[1-6]$/.test(tag)) {
        const level = Number(tag[1]);
        return `\n\n${'#'.repeat(level)} ${children.trim()}\n\n`;
      }
      if (tag === 'p') return `\n\n${children.trim()}\n\n`;
      if (tag === 'pre') return `\n\`\`\`\n${node.textContent.trim()}\n\`\`\`\n`;
      if (tag === 'code') {
        if (node.parentElement && node.parentElement.tagName.toLowerCase() === 'pre') {
          return node.textContent;
        }
        return ` \`${node.textContent.trim()}\` `;
      }
      if (tag === 'ul' || tag === 'ol') return `\n${children}\n`;
      if (tag === 'a') {
        const href = node.getAttribute('href');
        return href ? `[${children.trim()}](${href})` : children;
      }
      if (tag === 'strong' || tag === 'b') return `**${children.trim()}**`;
      if (tag === 'em' || tag === 'i') return `*${children.trim()}*`;
      if (tag === 'img') {
        const alt = node.getAttribute('alt') || 'image';
        const src = node.getAttribute('src');
        return src ? `![${alt}](${src})` : '';
      }
      if (tag === 'br') return '\n';
      if (tag === 'hr') return '\n---\n';
      return children;
    }

    const rawMd = toMarkdown(clone);
    const cleanMd = rawMd.replace(/\n{3,}/g, '\n\n').trim();
    const words = cleanMd.split(/\s+/).filter(Boolean);
    const wordCount = words.length;
    const readingTimeMinutes = Math.max(1, Math.ceil(wordCount / 200));
    const excerpt = words.slice(0, 50).join(' ') + (words.length > 50 ? '...' : '');
    const canonical = (document.querySelector('link[rel="canonical"]') || {}).href || window.location.href;

    return {
      ok: true,
      data: {
        url: window.location.href,
        canonicalUrl: canonical,
        title,
        author: byline,
        byline,
        publishDate,
        leadImage,
        wordCount,
        readingTimeMinutes,
        excerpt,
        markdown: cleanMd,
      },
    };
  }

  return { ok: false, error: `Unknown ssWebUnitDom tool: ${tool}` };
}
