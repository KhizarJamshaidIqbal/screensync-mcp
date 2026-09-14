// ScreenSync Page Digest Unit (AI Browser Parity: Claude / ChatGPT / Comet)
// Generates a compact, token-bounded, accessibility-first structural view of the page.
// Self-contained page-side execution unit for chrome.scripting.executeScript.

export function ssWebUnitDigest(args = {}) {
  const maxNodes = Math.min(Math.max(Number(args.maxNodes) || 80, 20), 300);
  const includeForms = args.includeForms !== false;

  function visible(el) {
    try {
      const r = el.getBoundingClientRect();
      const s = window.getComputedStyle(el);
      return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden' && s.opacity !== '0';
    } catch {
      return false;
    }
  }

  function roleOf(el) {
    const explicit = el.getAttribute && el.getAttribute('role');
    if (explicit) return explicit.toLowerCase();
    const tag = (el.tagName || '').toLowerCase();
    const type = (el.getAttribute('type') || '').toLowerCase();
    if (el.getAttribute && el.getAttribute('onclick')) return 'button';
    if (tag === 'a' && el.getAttribute('href')) return 'link';
    if (tag === 'button' || (tag === 'input' && ['button', 'submit', 'reset'].includes(type))) return 'button';
    if (tag === 'input' || tag === 'textarea' || el.isContentEditable) {
      return type === 'checkbox' ? 'checkbox' : type === 'radio' ? 'radio' : 'textbox';
    }
    if (tag === 'select') return 'combobox';
    if (/^h[1-6]$/.test(tag)) return 'heading';
    if (tag === 'dialog' || el.getAttribute('aria-modal') === 'true') return 'dialog';
    if (['main', 'nav', 'header', 'footer', 'aside'].includes(tag)) return tag;
    return tag;
  }

  function nameOf(el) {
    return (
      el.getAttribute('aria-label') ||
      el.innerText ||
      el.value ||
      el.getAttribute('placeholder') ||
      el.getAttribute('alt') ||
      el.title ||
      ''
    )
      .trim()
      .replace(/\s+/g, ' ')
      .slice(0, 100);
  }

  // 1. Headings
  const headings = [];
  for (const h of document.querySelectorAll('h1, h2, h3, h4, h5, h6, [role="heading"]')) {
    if (!visible(h)) continue;
    const tag = h.tagName.toLowerCase();
    const m = tag.match(/^h([1-6])$/);
    const level = m ? Number(m[1]) : Number(h.getAttribute('aria-level') || 2);
    const text = (h.innerText || h.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 120);
    if (text) {
      headings.push({ level, text });
    }
    if (headings.length >= 25) break;
  }

  // 2. Semantic Landmarks
  const landmarks = [];
  for (const lm of document.querySelectorAll('main, nav, header, footer, aside, [role="main"], [role="navigation"], [role="search"], [role="dialog"], [role="banner"], [role="contentinfo"]')) {
    if (!visible(lm)) continue;
    const role = lm.getAttribute('role') || lm.tagName.toLowerCase();
    const name = nameOf(lm);
    landmarks.push({ role, name: name || undefined, tag: lm.tagName.toLowerCase() });
    if (landmarks.length >= 15) break;
  }

  // 3. Interactive Elements with stable stamped refs
  const interactives = [];
  const sel = 'button, a[href], input, textarea, select, [role="button"], [role="link"], [role="checkbox"], [role="radio"], [role="tab"], [role="combobox"], [contenteditable="true"]';
  let refCount = 0;

  for (const el of document.querySelectorAll(sel)) {
    if (interactives.length >= maxNodes) break;
    if (!visible(el)) continue;

    const r = el.getBoundingClientRect();
    const inViewport = r.top < window.innerHeight && r.bottom > 0 && r.left < window.innerWidth && r.right > 0;
    const role = roleOf(el);
    const name = nameOf(el);
    const tag = el.tagName.toLowerCase();
    const type = el.getAttribute('type') || undefined;

    // Stamp with data-ss-id so any subsequent action tool can target by ref
    try {
      el.setAttribute('data-ss-id', String(refCount));
    } catch {}

    const item = {
      ref: refCount,
      role,
      name: name || undefined,
      tag,
      type,
      inViewport,
      rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
      state: {},
    };

    if (el.checked !== undefined) item.state.checked = el.checked;
    if (el.disabled || el.getAttribute('aria-disabled') === 'true') item.state.disabled = true;
    if (el.getAttribute('aria-expanded') !== null) item.state.expanded = el.getAttribute('aria-expanded') === 'true';
    if (el.getAttribute('aria-selected') !== null) item.state.selected = el.getAttribute('aria-selected') === 'true';
    if (tag === 'input' || tag === 'textarea' || tag === 'select') {
      const v = String(el.value || '');
      item.value = type === 'password' ? '••••••' : v.slice(0, 50);
    }

    interactives.push(item);
    refCount++;
  }

  // 4. Forms summary
  const forms = [];
  if (includeForms) {
    for (const f of document.querySelectorAll('form, [role="form"]')) {
      if (!visible(f)) continue;
      const formName = f.getAttribute('name') || f.getAttribute('id') || f.getAttribute('aria-label') || 'form';
      const fields = [];
      for (const input of f.querySelectorAll('input, select, textarea')) {
        if (!visible(input)) continue;
        fields.push({
          tag: input.tagName.toLowerCase(),
          type: input.getAttribute('type') || 'text',
          name: input.getAttribute('name') || input.getAttribute('id') || undefined,
          placeholder: input.getAttribute('placeholder') || undefined,
          value: input.type === 'password' ? '••••' : String(input.value || '').slice(0, 40),
        });
      }
      const submitBtn = f.querySelector('button[type="submit"], input[type="submit"], button:not([type="button"])');
      forms.push({
        name: formName,
        fieldCount: fields.length,
        fields: fields.slice(0, 15),
        submitText: submitBtn ? nameOf(submitBtn) : undefined,
      });
      if (forms.length >= 5) break;
    }
  }

  return {
    ok: true,
    data: {
      url: location.href,
      title: document.title,
      viewport: { width: window.innerWidth, height: window.innerHeight },
      headings,
      landmarks,
      interactives,
      forms,
      interactiveCount: interactives.length,
      truncated: interactives.length >= maxNodes,
    },
  };
}
