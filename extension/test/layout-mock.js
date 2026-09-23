// A small laid-out DOM for running the page-side perception and table units in Node. Unlike dom-mock.js (events,
// shadow roots, trust), this one models what those units read: rendered boxes, computed style, innerText versus
// textContent, closed <details>, CSS animations, scroll containers and a hidden tab. With the browser's rules
// where they matter here:
//   - an element inside a closed <details> (other than its <summary>) or under display:none is not rendered: its
//     box is 0x0 and its innerText is '', while textContent still holds the text;
//   - a hidden tab never runs requestAnimationFrame or IntersectionObserver callbacks.

export class El {
  constructor(tag, attrs = {}, text = '') {
    this.tagName = String(tag).toUpperCase();
    this.attrs = { ...attrs };
    this.childNodes = [];
    this.parentElement = null;
    this.isConnected = true;
    this.nodeType = 1;
    this.style = { display: 'block', visibility: 'visible', opacity: '1' };
    this.animations = [];
    this.open = false;
    this._rect = null;
    this.scrollTop = 0;
    if (text) this.childNodes.push({ nodeType: 3, textContent: text });
  }
  get children() { return this.childNodes.filter((n) => n.nodeType === 1); }
  get childElementCount() { return this.children.length; }
  get textContent() { return this.childNodes.map((n) => n.textContent).join(' '); }
  get innerText() { return this.rendered() ? this.textContent : ''; }
  get className() { return this.attrs.class || ''; }
  get id() { return this.attrs.id || ''; }
  append(...kids) { for (const k of kids) { k.parentElement = this; this.childNodes.push(k); } return this; }
  getAttribute(n) { return n in this.attrs ? String(this.attrs[n]) : null; }
  setAttribute(n, v) { this.attrs[n] = String(v); }
  hasClass(c) { return this.className.split(/\s+/).includes(c); }
  getAnimations() { return this.animations; }
  /** Rendered: no display:none on the way up, and not inside a closed <details> (its <summary> excepted). */
  rendered() {
    for (let n = this; n; n = n.parentElement) {
      if (n.style.display === 'none') return false;
      const p = n.parentElement;
      if (p && p.tagName === 'DETAILS' && !p.open && n.tagName !== 'SUMMARY') return false;
    }
    return true;
  }
  getBoundingClientRect() {
    if (!this.rendered()) return { x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0 };
    const r = this._rect || { x: 10, y: 10, width: 100, height: 20 };
    let dy = 0; // scrolled ancestors move the box, they do not hide it
    for (let p = this.parentElement; p; p = p.parentElement) dy += p.scrollTop || 0;
    const y = r.y - dy;
    return { x: r.x, y, width: r.width, height: r.height, top: y, left: r.x, right: r.x + r.width, bottom: y + r.height };
  }
  matchesCompound(sel) {
    const m = sel.match(/^([a-zA-Z][a-zA-Z0-9-]*|\*)?((?:[.#][a-zA-Z0-9_-]+)*)$/);
    if (!m) return false;
    if (m[1] && m[1] !== '*' && m[1].toUpperCase() !== this.tagName) return false;
    for (const part of (m[2].match(/[.#][a-zA-Z0-9_-]+/g) || [])) {
      if (part[0] === '.' && !this.hasClass(part.slice(1))) return false;
      if (part[0] === '#' && this.id !== part.slice(1)) return false;
    }
    return true;
  }
  /** Comma lists and the descendant combinator over tag / .class / #id compounds. */
  matches(sel) {
    return String(sel).split(',').some((one) => {
      const parts = one.trim().split(/\s+/);
      if (!this.matchesCompound(parts[parts.length - 1])) return false;
      let i = parts.length - 2;
      for (let p = this.parentElement; p && i >= 0; p = p.parentElement) if (p.matchesCompound(parts[i])) i--;
      return i < 0;
    });
  }
  closest(sel) { for (let n = this; n; n = n.parentElement) if (n.matches(sel)) return n; return null; }
  descendants() { return this.children.flatMap((c) => [c, ...c.descendants()]); }
  querySelectorAll(sel) { return this.descendants().filter((d) => d.matches(sel)); }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
  contains(el) { return el === this || this.descendants().includes(el); }
}

/** A <table> with a header row and data rows, from arrays of strings. */
export function table(headers, rows) {
  const t = new El('table');
  const thead = new El('thead').append(new El('tr').append(...headers.map((h) => new El('th', {}, h))));
  const tbody = new El('tbody').append(...rows.map((r) => new El('tr').append(...r.map((c) => new El('td', {}, c)))));
  return t.append(thead, tbody);
}

/** Installs document / window / location and the frame APIs a hidden tab never serves. */
export function installLayout({ visibilityState = 'visible', title = 'Test page' } = {}) {
  const html = new El('html');
  const body = new El('body');
  html.append(body);
  const frameCallbacks = { raf: 0, io: 0 };
  const document = {
    nodeType: 9,
    documentElement: html,
    body,
    title,
    activeElement: null,
    visibilityState,
    get hidden() { return this.visibilityState === 'hidden'; },
    querySelector: (sel) => (sel === 'body' ? body : body.querySelector(sel)),
    querySelectorAll: (sel) => body.querySelectorAll(sel),
    createElement: (tag) => new El(tag),
    createTreeWalker: () => ({ nextNode: () => false, currentNode: null }),
    elementFromPoint: () => null,
  };
  Object.assign(globalThis, {
    document,
    window: { getComputedStyle: (el) => ({ ...el.style }), innerWidth: 1280, innerHeight: 800 },
    location: { href: 'https://cbm.example/wp-admin/admin.php?page=cbm-index' },
    NodeFilter: { SHOW_ELEMENT: 1 },
    // A hidden tab renders no frames: these callbacks never run.
    requestAnimationFrame: () => { frameCallbacks.raf++; return 0; },
    IntersectionObserver: class { constructor() { frameCallbacks.io++; } observe() {} disconnect() {} },
  });
  return { document, body, frameCallbacks };
}
