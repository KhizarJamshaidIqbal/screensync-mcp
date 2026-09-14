// ScreenSync Popup & New-Tab Tracker (Playwright context.on('page') / expect_popup parity)
// Tracks tabs created with openerTabId, buffers recent popups, and provides
// waitForPopup() for agents waiting on window.open() or target="_blank" clicks.

const recentPopups = []; // Array<{ tabId: number, openerTabId: number|null, url: string, title: string, createdAt: number }>
const pendingWaiters = new Set(); // Set<{ openerTabId: number|null, resolve: Function, reject: Function, timer: any }>

function pruneStalePopups() {
  const cutoff = Date.now() - 60000; // 60s retention
  while (recentPopups.length > 0 && recentPopups[0].createdAt < cutoff) {
    recentPopups.shift();
  }
}

export function registerPopupTab(tab) {
  if (!tab || !tab.id) return;
  pruneStalePopups();
  const entry = {
    tabId: tab.id,
    openerTabId: tab.openerTabId || null,
    url: tab.url || tab.pendingUrl || '',
    title: tab.title || '',
    createdAt: Date.now(),
  };
  recentPopups.push(entry);

  // Notify any pending waiters
  for (const waiter of pendingWaiters) {
    if (!waiter.openerTabId || waiter.openerTabId === entry.openerTabId) {
      clearTimeout(waiter.timer);
      pendingWaiters.delete(waiter);
      waiter.resolve(entry);
    }
  }
}

export function updatePopupTab(tabId, changeInfo, _tab) {
  for (const p of recentPopups) {
    if (p.tabId === tabId) {
      if (changeInfo.url) p.url = changeInfo.url;
      if (changeInfo.title) p.title = changeInfo.title;
      break;
    }
  }
}

export function removePopupTab(tabId) {
  const idx = recentPopups.findIndex((p) => p.tabId === tabId);
  if (idx !== -1) recentPopups.splice(idx, 1);
}

export function getRecentPopups(openerTabId = null) {
  pruneStalePopups();
  if (openerTabId == null) return [...recentPopups];
  return recentPopups.filter((p) => p.openerTabId === openerTabId);
}

export async function waitForPopup({ openerTabId = null, timeoutMs = 5000 } = {}) {
  pruneStalePopups();

  // Check if a popup was already recorded within the last 1500ms
  const recentThreshold = Date.now() - 1500;
  const existing = recentPopups.slice().reverse().find((p) => {
    if (p.createdAt < recentThreshold) return false;
    return openerTabId ? p.openerTabId === openerTabId : true;
  });
  if (existing) {
    return { ok: true, data: existing };
  }

  return new Promise((resolve) => {
    const waiter = {
      openerTabId,
      resolve: (data) => resolve({ ok: true, data }),
      reject: () => resolve({ ok: false, error: 'TIMEOUT_WAITING_FOR_POPUP' }),
      timer: null,
    };
    waiter.timer = setTimeout(() => {
      pendingWaiters.delete(waiter);
      resolve({ ok: false, error: 'TIMEOUT_WAITING_FOR_POPUP', timeoutMs });
    }, Math.min(timeoutMs, 30000));
    pendingWaiters.add(waiter);
  });
}

export async function execWebPopupWait(tabId, args = {}) {
  const openerTabId = typeof args.openerTabId === 'number' ? args.openerTabId : (typeof tabId === 'number' ? tabId : null);
  const timeoutMs = Number(args.timeoutMs) || 5000;
  return waitForPopup({ openerTabId, timeoutMs });
}

export function initPopupTracker() {
  if (typeof chrome !== 'undefined' && chrome.tabs) {
    if (chrome.tabs.onCreated) chrome.tabs.onCreated.addListener(registerPopupTab);
    if (chrome.tabs.onUpdated) chrome.tabs.onUpdated.addListener(updatePopupTab);
    if (chrome.tabs.onRemoved) chrome.tabs.onRemoved.addListener(removePopupTab);
  }
}

initPopupTracker();
