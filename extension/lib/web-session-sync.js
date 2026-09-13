// ScreenSync Session Sync — domain-scoped session export/import between
// browsers. Cookies are browser-level (chrome.cookies); localStorage needs a
// tab on the origin (an existing one is reused, otherwise one is opened
// temporarily). Used by the hub's web_session_transfer orchestrator.

const RESTRICTED_TAB = /^(chrome|edge|about|view-source|devtools|chrome-extension):/;

async function findTabOnOrigin(origin) {
  const tabs = await chrome.tabs.query({});
  const hit = (tabs || []).find((t) => {
    try { return t.url && t.url.startsWith(origin) && !RESTRICTED_TAB.test(t.url); } catch { return false; }
  });
  return hit || null;
}

async function readLocalStorage(tabId) {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => JSON.parse(JSON.stringify({ ...localStorage })),
    });
    return (results && results[0] && results[0].result) || {};
  } catch { return {}; }
}

export async function sessionExport(args) {
  const domain = String(args.domain || '').replace(/^https?:\/\//, '').split('/')[0].trim();
  if (!domain) return { ok: false, error: 'web_session_export requires domain.' };
  const includeLocalStorage = args.localStorage !== false;
  const cookies = await chrome.cookies.getAll({ domain: domain.replace(/^\./, '') });
  if (!cookies.length) {
    return { ok: true, data: { domain, cookieCount: 0, cookies: [], localStorage: {}, note: 'No cookies for this domain in this browser — likely not logged in here.' } };
  }
  let localStorageOut = {};
  let localStorageFrom = null;
  if (includeLocalStorage) {
    const secureOrigin = `https://${domain.replace(/^\./, '')}`;
    let tab = await findTabOnOrigin(secureOrigin);
    let openedHere = false;
    if (!tab) {
      try {
        tab = await chrome.tabs.create({ url: secureOrigin + '/', active: false });
        openedHere = true;
        await new Promise((r) => setTimeout(r, 2500));
      } catch { /* origin unreachable — skip localStorage */ }
    }
    if (tab && tab.id) {
      localStorageOut = await readLocalStorage(tab.id);
      localStorageFrom = 'reused';
      if (openedHere) {
        localStorageFrom = 'opened-temporarily';
        try { await chrome.tabs.remove(tab.id); } catch {}
      }
    }
  }
  return {
    ok: true,
    data: {
      domain,
      savedAt: new Date().toISOString(),
      cookieCount: cookies.length,
      cookies,
      localStorage: localStorageOut,
      localStorageFrom,
    },
  };
}

export async function sessionImport(args) {
  const session = args.session || args;
  if (!session || !Array.isArray(session.cookies)) return { ok: false, error: 'web_session_import requires session.cookies (from web_session_export).' };
  const domain = String(session.domain || args.domain || '').replace(/^\./, '');
  const results = { cookiesSet: 0, cookiesFailed: 0, localStorageKeys: 0, localStorageFailed: false };
  for (const c of session.cookies) {
    try {
      const cookieUrl = `${c.secure ? 'https' : 'http'}://${(c.domain || domain).replace(/^\./, '')}${c.path || '/'}`;
      await chrome.cookies.set({
        url: cookieUrl,
        name: c.name,
        value: c.value,
        domain: c.domain || undefined,
        path: c.path || '/',
        secure: c.secure === true,
        httpOnly: c.httpOnly === true,
        sameSite: c.sameSite && c.sameSite !== 'unspecified' ? c.sameSite : undefined,
        expirationDate: c.expirationDate || undefined,
      });
      results.cookiesSet++;
    } catch { results.cookiesFailed++; }
  }
  // localStorage: restore onto a tab of the origin (find or open temporarily)
  const ls = session.localStorage && typeof session.localStorage === 'object' ? session.localStorage : {};
  const keys = Object.keys(ls);
  if (keys.length) {
    const secureOrigin = `https://${domain || new URL(`https://${(session.cookies[0]?.domain || '').replace(/^\./, '')}`).hostname}`;
    let tab = await findTabOnOrigin(secureOrigin);
    let openedHere = false;
    if (!tab) {
      try {
        tab = await chrome.tabs.create({ url: secureOrigin + '/', active: false });
        openedHere = true;
        await new Promise((r) => setTimeout(r, 2500));
      } catch { results.localStorageFailed = true; }
    }
    if (tab && tab.id) {
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: (entries) => { for (const [k, v] of Object.entries(entries)) { try { localStorage.setItem(k, String(v)); } catch {} } },
          args: [ls],
        });
        results.localStorageKeys = keys.length;
      } catch { results.localStorageFailed = true; }
      if (openedHere) { try { await chrome.tabs.remove(tab.id); } catch {} }
    }
  }
  return { ok: true, data: { domain: domain || session.domain, ...results } };
}
