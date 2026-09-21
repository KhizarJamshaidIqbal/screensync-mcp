// Who may drive the extension's own controls.
//
// The service worker answers messages that read and change what the owner has decided: the origin grants,
// the web-access switch, the settings and the approval queue. They are meant for the extension's own pages
// (popup, dashboard, side panel), and the browser says who is asking: `sender.url` and `sender.origin` are
// the web page's for a script running in a tab and chrome-extension://<id> for the extension itself. A page
// cannot forge them.
//
// This is hardening, not the fix for a live hole. Checked in Chrome on 2026-09-21: web_run_code and web_eval
// run through the debugger in the page's own world, which has no extension APIs, and the extension's
// isolated world did not evaluate a string (web_wait_for_function never succeeds), so no agent-supplied code
// runs where it could send these messages today. But the messages carry no other proof of who sent them, so
// the day a feature does run agent-influenced code there (a content script, a changed CSP) the approval
// queue would approve nothing but the agent's own wishes. Storage has the same shape (a script in a tab can
// read and write chrome.storage.local, where the grants live), so it is locked to the extension's own
// contexts as well.

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
