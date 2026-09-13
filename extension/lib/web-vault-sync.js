// ScreenSync Session Vault — Full Authentication & Storage State Synchronizer
// Handles high-fidelity export and import of cookies, localStorage, and sessionStorage.

function waitForTab(tabId, timeoutMs = 20000) {
  return new Promise((resolve) => {
    const onUpdated = (id, info) => {
      if (id === tabId && info.status === 'complete') finish();
    };
    const timer = setTimeout(finish, timeoutMs);
    function finish() {
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      resolve();
    }
    chrome.tabs.onUpdated.addListener(onUpdated);
  });
}

export async function sessionVaultExport(args = {}) {
  const domain = String(args.domain || '').trim();
  if (!domain) return { ok: false, error: 'web_session_vault export requires "domain" (e.g. "linkedin.com").' };

  try {
    // 1. Gather all matching cookies for the domain
    const allCookies = [];
    const domainVariants = [domain, `.${domain}`, `www.${domain}`];
    for (const d of domainVariants) {
      const found = await chrome.cookies.getAll({ domain: d }).catch(() => []);
      for (const c of found) {
        if (!allCookies.some((existing) => existing.name === c.name && existing.domain === c.domain && existing.path === c.path)) {
          allCookies.push(c);
        }
      }
    }

    // 2. Gather localStorage and sessionStorage if requested
    let localData = {};
    let sessionData = {};
    if (args.includeStorage !== false) {
      const tabs = await chrome.tabs.query({}).catch(() => []);
      const matchTab = tabs.find((t) => t.url && t.url.includes(domain));
      let tempTab = null;

      try {
        const targetTab = matchTab || (tempTab = await chrome.tabs.create({ url: `https://${domain}`, active: false }));
        if (tempTab) {
          await waitForTab(tempTab.id, 15000);
        } else if (matchTab && matchTab.status !== 'complete') {
          await waitForTab(matchTab.id, 10000);
        }

        const [evalRes] = await chrome.scripting.executeScript({
          target: { tabId: targetTab.id },
          func: () => {
            const loc = {};
            const ses = {};
            try {
              for (let i = 0; i < localStorage.length; i++) {
                const k = localStorage.key(i);
                if (k) loc[k] = localStorage.getItem(k);
              }
            } catch {}
            try {
              for (let i = 0; i < sessionStorage.length; i++) {
                const k = sessionStorage.key(i);
                if (k) ses[k] = sessionStorage.getItem(k);
              }
            } catch {}
            return { loc, ses };
          },
        }).catch(() => []);

        if (evalRes && evalRes.result) {
          localData = evalRes.result.loc || {};
          sessionData = evalRes.result.ses || {};
        }
      } finally {
        if (tempTab && tempTab.id) {
          try { await chrome.tabs.remove(tempTab.id); } catch {}
        }
      }
    }

    return {
      ok: true,
      data: {
        domain,
        exportedAt: new Date().toISOString(),
        cookieCount: allCookies.length,
        cookies: allCookies.map((c) => ({
          name: c.name,
          value: c.value,
          domain: c.domain,
          path: c.path,
          secure: c.secure,
          httpOnly: c.httpOnly,
          sameSite: c.sameSite,
          hostOnly: c.hostOnly,
          expirationDate: c.expirationDate,
        })),
        localStorageCount: Object.keys(localData).length,
        localStorage: localData,
        sessionStorageCount: Object.keys(sessionData).length,
        sessionStorage: sessionData,
      },
    };
  } catch (err) {
    return { ok: false, error: `sessionVaultExport failed: ${String((err && err.message) || err)}` };
  }
}

export async function sessionVaultImport(args = {}) {
  const payload = args.session || args.payload;
  if (!payload || !payload.domain) {
    return { ok: false, error: 'web_session_vault import requires "session" payload with "domain".' };
  }

  const domain = String(payload.domain);
  const cookies = Array.isArray(payload.cookies) ? payload.cookies : [];
  let cookiesSet = 0;

  try {
    // 1. Restore cookies
    for (const c of cookies) {
      try {
        const protocol = c.secure ? 'https:' : 'http:';
        const cleanDomain = c.domain.startsWith('.') ? c.domain.slice(1) : c.domain;
        const cookieUrl = `${protocol}//${cleanDomain}${c.path || '/'}`;

        const setDetails = {
          url: cookieUrl,
          name: c.name,
          value: c.value,
          path: c.path || '/',
          secure: Boolean(c.secure),
          httpOnly: Boolean(c.httpOnly),
        };
        // In Chrome cookies API, domain cookies require domain: cleanDomain,
        // while host-only cookies omit domain.
        if (c.hostOnly === false || c.domain.startsWith('.')) {
          setDetails.domain = cleanDomain;
        }
        if (c.sameSite && ['no_restriction', 'lax', 'strict'].includes(c.sameSite)) {
          setDetails.sameSite = c.sameSite;
          if (c.sameSite === 'no_restriction') setDetails.secure = true;
        }
        if (c.expirationDate && c.expirationDate > Date.now() / 1000) {
          setDetails.expirationDate = c.expirationDate;
        }

        await chrome.cookies.set(setDetails);
        cookiesSet++;
      } catch {}
    }

    // 2. Restore localStorage / sessionStorage
    let storageRestored = false;
    const localData = payload.localStorage;
    const sessionData = payload.sessionStorage;

    if (localData || sessionData) {
      const tabs = await chrome.tabs.query({}).catch(() => []);
      const matchTab = tabs.find((t) => t.url && t.url.includes(domain));
      let tempTab = null;

      try {
        const targetTab = matchTab || (tempTab = await chrome.tabs.create({ url: `https://${domain}`, active: false }));
        if (tempTab) {
          await waitForTab(tempTab.id, 15000);
        } else if (matchTab && matchTab.status !== 'complete') {
          await waitForTab(matchTab.id, 10000);
        }

        await chrome.scripting.executeScript({
          target: { tabId: targetTab.id },
          func: (loc, ses) => {
            if (loc) {
              for (const [k, v] of Object.entries(loc)) {
                try { localStorage.setItem(k, v); } catch {}
              }
            }
            if (ses) {
              for (const [k, v] of Object.entries(ses)) {
                try { sessionStorage.setItem(k, v); } catch {}
              }
            }
          },
          args: [localData || null, sessionData || null],
        }).catch(() => {});
        storageRestored = true;
      } finally {
        if (tempTab && tempTab.id) {
          try { await chrome.tabs.remove(tempTab.id); } catch {}
        }
      }
    }

    return {
      ok: true,
      data: {
        domain,
        cookiesSet,
        totalCookiesInPayload: cookies.length,
        storageRestored,
        restoredAt: new Date().toISOString(),
      },
    };
  } catch (err) {
    return { ok: false, error: `sessionVaultImport failed: ${String((err && err.message) || err)}` };
  }
}
