// Shared Tab & Origin Resolver (Plan §3.4 & D8)
// Single source of truth for picking active tabs, detecting restricted pages,
// finding or opening tabs for given origins, and waiting for page loads.

export const RESTRICTED_TAB = /^(chrome|edge|about|view-source|devtools|chrome-extension):/;

/**
 * Checks whether a URL or Tab is on a restricted browser internal scheme.
 * @param {string | { url?: string }} tabOrUrl
 * @returns {boolean}
 */
export function isRestrictedTab(tabOrUrl) {
  const url = typeof tabOrUrl === 'string' ? tabOrUrl : (tabOrUrl && tabOrUrl.url) || '';
  return RESTRICTED_TAB.test(url);
}

/**
 * Selects an active tab for agent operation.
 * @param {{ tabId?: number }} [args]
 * @returns {Promise<chrome.tabs.Tab>}
 */
export async function pickActiveTab(args = {}) {
  if (args && args.tabId) {
    try {
      const t = await chrome.tabs.get(Number(args.tabId));
      if (t) return t;
    } catch {
      /* tabId not found or closed, fallback to query */
    }
  }

  let tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true }).catch(() => []);
  if (!tabs || !tabs.length) tabs = await chrome.tabs.query({ active: true }).catch(() => []);
  if (!tabs || !tabs.length) tabs = await chrome.tabs.query({}).catch(() => []);
  if (!tabs || !tabs.length) throw new Error('No browser tab found.');

  const active = tabs[0];
  if (active && isRestrictedTab(active)) {
    const allTabs = await chrome.tabs.query({}).catch(() => []);
    const usable = allTabs.find((t) => t.url && !isRestrictedTab(t));
    if (usable) return usable;
  }
  return active;
}

/**
 * Waits until a tab finishes loading (status === 'complete') or timeout.
 * @param {number} tabId
 * @param {number} [timeoutMs=20000]
 * @returns {Promise<void>}
 */
export async function waitForTabComplete(tabId, timeoutMs = 20000) {
  try {
    const current = await chrome.tabs.get(Number(tabId));
    if (current && current.status === 'complete') return;
  } catch {}

  return new Promise((resolve) => {
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      try {
        chrome.tabs.onUpdated.removeListener(onUpdated);
      } catch {}
      resolve();
    };
    const onUpdated = (id, info) => {
      if (id === tabId && info.status === 'complete') finish();
    };
    const timer = setTimeout(finish, timeoutMs);
    try {
      chrome.tabs.onUpdated.addListener(onUpdated);
    } catch {
      finish();
    }
  });
}

/**
 * Finds an open tab matching a given origin or domain, or creates one if missing.
 * @param {string} originOrUrl - Target origin (e.g. 'https://x.com') or URL
 * @param {boolean} [createIfMissing=true]
 * @returns {Promise<(chrome.tabs.Tab & { _isNew?: boolean }) | null>}
 */
export async function findOrOpenTabForOrigin(originOrUrl, createIfMissing = true) {
  if (!originOrUrl) return null;
  let targetOrigin = '';
  try {
    const u = new URL(originOrUrl.startsWith('http') ? originOrUrl : `https://${originOrUrl}`);
    targetOrigin = u.origin.toLowerCase();
  } catch {
    targetOrigin = originOrUrl.toLowerCase();
  }

  const allTabs = await chrome.tabs.query({}).catch(() => []);
  for (const tab of allTabs) {
    if (!tab.url) continue;
    try {
      const u = new URL(tab.url);
      if (u.origin.toLowerCase() === targetOrigin || tab.url.toLowerCase().includes(targetOrigin)) {
        tab._isNew = false;
        return tab;
      }
    } catch {}
  }

  if (!createIfMissing) return null;

  const launchUrl = originOrUrl.startsWith('http') ? originOrUrl : `https://${originOrUrl}`;
  const newTab = await chrome.tabs.create({ url: launchUrl, active: false });
  if (newTab && newTab.id) {
    newTab._isNew = true;
    groupAgentTab(newTab.id).catch(() => {});
    await waitForTabComplete(newTab.id, 25000);
    const refreshed = await chrome.tabs.get(newTab.id).catch(() => newTab);
    refreshed._isNew = true;
    return refreshed;
  }
  return newTab;
}


/**
 * Groups an agent-controlled tab under the "ScreenSync AI" tab group.
 * @param {number} tabId
 */
export async function groupAgentTab(tabId) {
  try {
    if (!chrome.tabs.group || !chrome.tabGroups) return;
    const groupId = await chrome.tabs.group({ tabIds: [tabId] });
    await chrome.tabGroups.update(groupId, { title: 'ScreenSync AI', color: 'cyan' });
  } catch {}
}
