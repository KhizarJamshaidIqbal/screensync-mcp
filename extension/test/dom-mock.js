// A small DOM for running page-side units in Node: elements, open and CLOSED shadow roots, text nodes, events,
// popovers and the IntersectionObserver the approval dialog relies on. Only what the tests need, with the
// browser's rules where they matter for security:
//   - `isTrusted` is true only for events the "browser" made (trustedClick below); anything a script builds
//     with `new MouseEvent(...)` or `el.click()` is untrusted, exactly as in Chrome;
//   - a closed shadow root is not reachable through `host.shadowRoot`, and querySelectorAll does not enter it;
//   - a disabled button receives no click;
//   - innerHTML / outerHTML / insertAdjacentHTML throw, so a unit that uses them fails its test.

const TRUSTED = new WeakSet();

export class FakeEvent {
  constructor(type, init = {}) {
    this.type = type;
    this.detail = init.detail ?? 0;
    this.target = null;
    this.defaultPrevented = false;
    this.propagationStopped = false;
  }
  get isTrusted() { return TRUSTED.has(this); }
  preventDefault() { this.defaultPrevented = true; }
  stopPropagation() { this.propagationStopped = true; }
}
export class FakeMouseEvent extends FakeEvent {}

/** What only the browser can make: a person's pointer click (detail = click count), or a keypress-made click (0). */
export function trustedClick(detail = 1) {
  const e = new FakeMouseEvent('click', { detail });
  TRUSTED.add(e);
  return e;
}

/** A trusted non-mouse event, e.g. the window gaining focus. */
export function trustedEvent(type) {
  const e = new FakeEvent(type);
  TRUSTED.add(e);
  return e;
}

class FakeNode {
  constructor() { this.childNodes = []; this.parentNode = null; this.listeners = {}; }
  append(...nodes) { for (const n of nodes) this.appendChild(typeof n === 'string' ? new FakeText(n) : n); }
  appendChild(n) {
    if (n.parentNode) n.parentNode.removeChild(n);
    n.parentNode = this;
    this.childNodes.push(n);
    return n;
  }
  removeChild(n) {
    const i = this.childNodes.indexOf(n);
    if (i >= 0) this.childNodes.splice(i, 1);
    n.parentNode = null;
    return n;
  }
  remove() { if (this.parentNode) this.parentNode.removeChild(this); }
  get textContent() { return this.childNodes.map((c) => c.textContent).join(''); }
  set textContent(v) {
    this.childNodes = [];
    const s = v == null ? '' : String(v);
    if (s) this.appendChild(new FakeText(s));
  }
  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
  removeEventListener(type, fn) { this.listeners[type] = (this.listeners[type] || []).filter((f) => f !== fn); }
  listenerCount() { return Object.values(this.listeners).reduce((n, l) => n + l.length, 0); }
  dispatchEvent(ev) {
    if (!ev.target) ev.target = this;
    for (const fn of [...(this.listeners[ev.type] || [])]) fn(ev);
    return !ev.defaultPrevented;
  }
  /** Every element below this node in the LIGHT tree (a shadow root is only entered through its own node). */
  descendants() {
    const out = [];
    for (const c of this.childNodes) if (c instanceof FakeElement) out.push(c, ...c.descendants());
    return out;
  }
}

class FakeText extends FakeNode {
  constructor(text) { super(); this.data = text; }
  get textContent() { return this.data; }
  set textContent(v) { this.data = String(v); }
}

export class FakeElement extends FakeNode {
  constructor(tag, ns) {
    super();
    this.tagName = String(tag).toUpperCase();
    this.namespaceURI = ns || 'http://www.w3.org/1999/xhtml';
    this.attributes = {};
    this.className = '';
    this.style = { display: '', width: '' };
    this._disabled = false;
    this._shadow = null;
    this.popoverOpen = false;
  }
  setAttribute(k, v) { this.attributes[k] = String(v); }
  getAttribute(k) { return k in this.attributes ? this.attributes[k] : null; }
  removeAttribute(k) { delete this.attributes[k]; }
  get disabled() { return this._disabled; }
  set disabled(v) { this._disabled = Boolean(v); }
  attachShadow({ mode }) {
    if (this._shadow) throw new Error('NotSupportedError: the element already hosts a shadow root');
    this._shadow = new FakeShadowRoot(this, mode);
    return this._shadow;
  }
  /** What page script sees: null for a closed root. */
  get shadowRoot() { return this._shadow && this._shadow.mode === 'open' ? this._shadow : null; }
  /** Test-only: what the extension itself holds. */
  get internalShadowRoot() { return this._shadow; }
  showPopover() {
    if (!this.parentNode) throw new Error('InvalidStateError: not connected');
    if (this.getAttribute('popover') == null) throw new Error('NotSupportedError: not a popover');
    this.popoverOpen = true;
  }
  hidePopover() { this.popoverOpen = false; }
  matches(sel) { return sel === ':popover-open' ? this.popoverOpen : false; }
  set innerHTML(_v) { throw new Error('innerHTML must not be used'); }
  set outerHTML(_v) { throw new Error('outerHTML must not be used'); }
  insertAdjacentHTML() { throw new Error('insertAdjacentHTML must not be used'); }
  dispatchEvent(ev) {
    if (ev.type === 'click' && this.tagName === 'BUTTON' && this._disabled) return false; // as in a browser
    return super.dispatchEvent(ev);
  }
  /** What page script can do to any element it holds. Never trusted. */
  click() { return this.dispatchEvent(new FakeMouseEvent('click', { detail: 1 })); }
  querySelectorAll(tag) { return this.descendants().filter((e) => e.tagName === String(tag).toUpperCase()); }
}

class FakeShadowRoot extends FakeNode {
  constructor(host, mode) { super(); this.host = host; this.mode = mode; this.adoptedStyleSheets = []; }
}

/** Installs document, window, events, CSSStyleSheet and IntersectionObserver on globalThis. */
export function installDom({ visibilityState = 'visible' } = {}) {
  const html = new FakeElement('html');
  const docEvents = new FakeNode();
  const win = new FakeNode();
  const observers = [];
  const document = {
    documentElement: html,
    visibilityState,
    createElement: (tag) => new FakeElement(tag),
    createElementNS: (ns, tag) => new FakeElement(tag, ns),
    addEventListener: (t, fn) => docEvents.addEventListener(t, fn),
    removeEventListener: (t, fn) => docEvents.removeEventListener(t, fn),
    dispatchEvent: (ev) => docEvents.dispatchEvent(ev),
    querySelectorAll: (tag) => html.querySelectorAll(tag),
  };
  class FakeSheet { replaceSync(text) { this.cssText = String(text); } }
  class FakeIntersectionObserver {
    constructor(cb, options) { this.cb = cb; this.options = options; this.targets = []; this.disconnected = false; observers.push(this); }
    observe(t) { this.targets.push(t); }
    disconnect() { this.targets = []; this.disconnected = true; }
  }
  Object.assign(globalThis, {
    document, window: win, MouseEvent: FakeMouseEvent, Event: FakeEvent,
    CSSStyleSheet: FakeSheet, IntersectionObserver: FakeIntersectionObserver,
  });
  return {
    document, html, win, docEvents, observers,
    /** IntersectionObserver v2 reports whether the observed button is visible (nothing drawn over it). */
    setVisible(isVisible) {
      for (const o of observers) if (!o.disconnected) o.cb(o.targets.map((t) => ({ target: t, isVisible, isIntersecting: true })));
    },
  };
}
