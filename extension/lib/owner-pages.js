// Who may drive the extension's own controls.
//
// The service worker answers messages that read and change what the owner has decided: the origin grants,
// the web-access switch, the settings and the approval queue. They are meant for the extension's own pages
// (popup, dashboard, side panel). But chrome.runtime.sendMessage is also available to any script injected
// into a tab, and web_run_code injects the AGENT's code into the extension's isolated world. Left open, that
// code could resolve its own approval requests or grant itself access to any site, and the approval queue
// would approve nothing but the agent's own wishes.
//
// The browser fills in `sender.url` and `sender.origin` and a page cannot forge them: for a script injected
// into a tab they are the web page's, for the extension's own pages and its service worker they are
// chrome-extension://<id>. Storage has the same problem (a script in a tab can read and write
// chrome.storage.local, where the grants live), so it is locked to the extension's own contexts as well.

const clip = (value, max) => String(value ?? '').slice(0, max);

/** True when `sender` is one of this extension's own pages, or its service worker. */
export function isOwnerPage(sender) {
  try {
    if (!sender || sender.id !== chrome.runtime.id) return false;
    const base = chrome.runtime.getURL('');
    return (typeof sender.url === 'string' && sender.url.startsWith(base))
      || sender.origin === base.replace(/\/$/, '');
  } catch {
    return false;
  }
}

function refuse(kind, what, sender) {
  console.warn('[ss] refused a', kind, 'from outside the extension:', clip(what, 40), 'sender:', clip(sender && sender.url, 120));
}

/** Wraps a chrome.runtime.onMessage listener so it only ever sees messages from the owner's own pages. */
export function ownerMessagesOnly(listener) {
  return (msg, sender, sendResponse) => {
    if (isOwnerPage(sender)) return listener(msg, sender, sendResponse);
    refuse('message', msg && msg.type, sender);
    return false;
  };
}

/** Wraps a chrome.runtime.onConnect listener the same way: a port from a tab is closed, not served. */
export function ownerPortsOnly(listener) {
  return (port) => {
    if (isOwnerPage(port && port.sender)) return listener(port);
    refuse('connection', port && port.name, port && port.sender);
    try { port.disconnect(); } catch { /* already gone */ }
    return undefined;
  };
}

/**
 * Restricts chrome.storage.local and .sync to the extension's own contexts (service worker, popup, dashboard,
 * offscreen document). Call it from the service worker at start-up. A browser without the API keeps its old
 * behaviour; nothing in the extension reads storage from a tab, so nothing legitimate is lost.
 */
export function lockStorageToOwnerContexts() {
  for (const area of ['local', 'sync']) {
    try {
      const store = chrome.storage && chrome.storage[area];
      if (store && typeof store.setAccessLevel === 'function') {
        Promise.resolve(store.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' })).catch(() => {});
      }
    } catch { /* keep going: the other area, and the message check, still apply */ }
  }
}
