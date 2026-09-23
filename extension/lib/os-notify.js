// Desktop (OS) notifications, shared by web_request_help (takeover.js) and the approval queue (approval-notify.js).
//
// web_request_help promised a desktop notification but never showed one: the manifest had no "notifications"
// permission, so chrome.notifications was undefined and the call failed inside a try/catch, and its icon path
// ('icon128.png') did not exist either. The permission is now declared and every caller goes through here.
// Nothing here throws: a notification is a courtesy, the popup and the badge work without it.

const ICON = 'icons/icon128.png';

const api = () => (typeof chrome !== 'undefined' && chrome.notifications && typeof chrome.notifications.create === 'function'
  ? chrome.notifications : null);

/** Calls a callback-style chrome.notifications method and resolves with its result, or `fallback` on failure. */
function call(method, args, fallback) {
  const n = api();
  if (!n || typeof n[method] !== 'function') return Promise.resolve(fallback);
  return new Promise((resolve) => {
    try {
      n[method](...args, (result) => {
        const failed = chrome.runtime && chrome.runtime.lastError;
        resolve(failed ? fallback : result);
      });
    } catch {
      resolve(fallback);
    }
  });
}

/**
 * Shows (or replaces) notification `id`. Resolves true once it is up. `buttons` are dropped and the call retried
 * if the platform refuses them.
 */
export async function showNotification(id, options = {}) {
  if (!api()) return false;
  const iconUrl = chrome.runtime && chrome.runtime.getURL ? chrome.runtime.getURL(ICON) : ICON;
  const full = { type: 'basic', iconUrl, priority: 2, ...options };
  const created = await call('create', [id, full], null);
  if (created) return true;
  if (!full.buttons) return false;
  const { buttons: _dropped, ...plain } = full;
  return Boolean(await call('create', [id, plain], null));
}

/** Changes a notification that is up; resolves false if there is none. */
export function updateNotification(id, options = {}) {
  return call('update', [id, options], false).then(Boolean);
}

/** Takes a notification down. */
export function clearNotification(id) {
  return call('clear', [id], false).then(Boolean);
}

/** Ids of the notifications this extension has up. */
export async function notificationIds() {
  const all = await call('getAll', [], {});
  return Object.keys(all || {});
}
