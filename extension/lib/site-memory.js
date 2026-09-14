// ScreenSync Site Memory — Learned Selectors & Auto-Healing (Rev 4 Item D3 / A4)
// Stores verified resilient selectors per origin with success timestamps,
// and heals decayed selectors on redesigns via semantic fallback roles/names.

const STORAGE_KEY = 'site_memory';

let memoryCache = null; // { [origin]: { [alias]: { selector, lastSuccess, successCount, healedFrom } } }

async function loadMemory() {
  if (memoryCache) return memoryCache;
  try {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      const data = await chrome.storage.local.get(STORAGE_KEY);
      memoryCache = (data && data[STORAGE_KEY]) || {};
      return memoryCache;
    }
  } catch {}
  memoryCache = {};
  return memoryCache;
}

async function persistMemory() {
  try {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      await chrome.storage.local.set({ [STORAGE_KEY]: memoryCache });
    }
  } catch {}
}

export function normalizeOrigin(originOrUrl) {
  if (!originOrUrl) return 'default';
  try {
    const u = new URL(originOrUrl.startsWith('http') ? originOrUrl : `https://${originOrUrl}`);
    return u.origin.toLowerCase();
  } catch {
    return String(originOrUrl).toLowerCase();
  }
}

export async function getSiteMemory(origin) {
  const mem = await loadMemory();
  const key = normalizeOrigin(origin);
  return mem[key] || {};
}

export async function recordSelectorSuccess(origin, alias, selector) {
  const mem = await loadMemory();
  const normOrigin = normalizeOrigin(origin);
  if (!mem[normOrigin]) mem[normOrigin] = {};
  const current = mem[normOrigin][alias] || { selector, lastSuccess: 0, successCount: 0 };
  current.selector = selector;
  current.lastSuccess = Date.now();
  current.successCount = (current.successCount || 0) + 1;
  mem[normOrigin][alias] = current;
  await persistMemory();
  return current;
}

export async function autoHealSelector(origin, alias, fallbackSelector, role = null, name = null) {
  const mem = await loadMemory();
  const normOrigin = normalizeOrigin(origin);
  if (!mem[normOrigin]) mem[normOrigin] = {};
  const previous = mem[normOrigin][alias] ? mem[normOrigin][alias].selector : null;
  const entry = {
    selector: fallbackSelector,
    lastSuccess: Date.now(),
    successCount: 1,
    healedFrom: previous,
    role: role || undefined,
    name: name || undefined,
  };
  mem[normOrigin][alias] = entry;
  await persistMemory();
  return entry;
}

export async function clearSiteMemory(origin = null) {
  const mem = await loadMemory();
  if (origin) {
    const key = normalizeOrigin(origin);
    delete mem[key];
  } else {
    memoryCache = {};
  }
  await persistMemory();
  return { ok: true };
}

export async function execWebSiteMemory(tabId, args = {}) {
  const action = String(args.action || 'get').toLowerCase();
  const origin = args.origin || 'active';
  if (action === 'get') {
    return { ok: true, data: { origin, selectors: await getSiteMemory(origin) } };
  }
  if (action === 'record') {
    if (!args.alias || !args.selector) return { ok: false, error: 'alias and selector required to record' };
    const saved = await recordSelectorSuccess(origin, args.alias, args.selector);
    return { ok: true, data: { recorded: true, entry: saved } };
  }
  if (action === 'clear') {
    await clearSiteMemory(origin === 'all' ? null : origin);
    return { ok: true, data: { cleared: true, origin } };
  }
  return { ok: false, error: 'Unknown web_site_memory action: ' + action + '. Supported: get, record, clear.' };
}
