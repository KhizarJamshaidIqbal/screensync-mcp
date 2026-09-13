// ScreenSync Real-Browser Authenticated Data Sync Orchestrator
// Coordinates session-assisted data extraction across single or multiple browser tabs.
// Does NOT dump cookies to disk or transfer credentials unsafely.

import { findOrOpenTabForOrigin, waitForTabComplete } from './tab-resolve.js';
import { ssWebUnitSync } from './web-unit-sync.js';
import { makeError, ERROR_CODES } from './errors.js';

/**
 * Executes a real data synchronization pass across single or multiple tabs.
 * @param {{
 *   targets?: Array<{ url?: string, origin?: string, platform?: string, limit?: number, customSelector?: string }>,
 *   url?: string,
 *   platform?: string,
 *   limit?: number,
 *   customSelector?: string,
 *   multiTab?: boolean,
 *   closeOnFinish?: boolean,
 *   timeoutMs?: number
 * }} args
 */
export async function execRealDataSync(args = {}) {
  let targetList = [];

  if (Array.isArray(args.targets) && args.targets.length > 0) {
    targetList = args.targets;
  } else if (args.url || args.platform) {
    targetList = [{
      url: args.url,
      platform: args.platform,
      limit: args.limit,
      customSelector: args.customSelector,
    }];
  } else {
    // Sync current active tab
    targetList = [{ limit: args.limit, customSelector: args.customSelector }];
  }

  const results = [];
  const timeoutMs = Math.min(Number(args.timeoutMs) || 25000, 60000);
  const closeOnFinish = Boolean(args.closeOnFinish);

  for (const t of targetList) {
    let tab = null;
    let createdNew = false;
    try {
      if (t.url) {
        tab = await findOrOpenTabForOrigin(t.url, true);
        createdNew = Boolean(tab && tab._isNew);
      } else if (t.platform) {
        const platUrls = {
          x: 'https://x.com/home',
          twitter: 'https://x.com/home',
          linkedin: 'https://www.linkedin.com/feed/',
          reddit: 'https://www.reddit.com/',
          github: 'https://github.com/',
        };
        const u = platUrls[t.platform.toLowerCase()] || `https://${t.platform}.com`;
        tab = await findOrOpenTabForOrigin(u, true);
        createdNew = Boolean(tab && tab._isNew);
      } else {
        const [active] = await chrome.tabs.query({ active: true, lastFocusedWindow: true }).catch(() => []);
        tab = active;
      }

      if (!tab || !tab.id) {
        results.push(makeError(ERROR_CODES.NO_ACTIVE_TAB, 'Could not resolve or open a browser tab for target.', false, { target: t }));
        continue;
      }

      await waitForTabComplete(tab.id, timeoutMs);

      const injectRes = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: ssWebUnitSync,
        args: [{
          limit: t.limit || args.limit || 15,
          timeoutMs: Math.min(timeoutMs, 10000),
          customSelector: t.customSelector || args.customSelector || undefined,
        }],
      });

      const data = (injectRes && injectRes[0] && injectRes[0].result) || null;
      if (data && data.ok) {
        results.push({
          target: t.url || t.platform || tab.url,
          tabId: tab.id,
          ...data.data,
        });
      } else {
        results.push({
          target: t.url || t.platform || tab.url,
          tabId: tab.id,
          ok: false,
          error: data?.error || 'Extraction returned no data.',
        });
      }

      if (createdNew && closeOnFinish && tab.id) {
        try { await chrome.tabs.remove(tab.id); } catch {}
      }
    } catch (err) {
      if (createdNew && closeOnFinish && tab && tab.id) {
        try { await chrome.tabs.remove(tab.id); } catch {}
      }
      results.push(makeError(ERROR_CODES.INTERNAL, `Data sync failed for target: ${err.message}`, false, { target: t }));
    }
  }

  const allSuccess = results.length > 0 && results.every((r) => r.ok !== false);
  const totalExtracted = results.reduce((acc, r) => acc + (Array.isArray(r.items) ? r.items.length : 0), 0);

  return {
    ok: allSuccess,
    data: {
      syncedAt: new Date().toISOString(),
      targetCount: targetList.length,
      totalItems: totalExtracted,
      results,
    },
  };
}
