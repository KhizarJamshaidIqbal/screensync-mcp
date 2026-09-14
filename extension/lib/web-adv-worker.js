// ScreenSync Service Worker Inspector & Controller (P12)
// Playwright / DevTools parity for inspecting, listing, attaching to,
// and controlling background Service Workers per origin via CDP.

import { attachCdp, detachCdp } from './web-adv-core.js';

/**
 * Executes service worker inspection, listing, and lifecycle actions.
 * @param {chrome.tabs.Tab} tab
 * @param {Record<string, any>} args
 */
export async function cdpServiceWorker(tab, args) {
  if (!tab || !tab.id) return { ok: false, error: 'Target tab required for web_service_worker.' };
  const action = String(args.action || 'list').toLowerCase();

  const attached = await attachCdp(tab);
  if (!attached.ok) return attached;

  try {
    // 1. List active service workers
    if (action === 'list') {
      await chrome.debugger.sendCommand({ tabId: tab.id }, 'ServiceWorker.enable').catch(() => {});
      const targetRes = await chrome.debugger.sendCommand({ tabId: tab.id }, 'Target.getTargets', {}).catch(() => ({ targetInfos: [] }));
      const allTargets = targetRes?.targetInfos || [];
      const origin = args.origin ? String(args.origin).toLowerCase() : (tab.url ? new URL(tab.url).origin.toLowerCase() : '');

      const workers = allTargets
        .filter(t => t.type === 'service_worker')
        .filter(t => !origin || (t.url && t.url.toLowerCase().includes(origin)))
        .map(t => ({
          targetId: t.targetId,
          type: t.type,
          title: t.title,
          url: t.url,
          attached: t.attached,
        }));

      return {
        ok: true,
        data: {
          origin: origin || 'all',
          workers,
          count: workers.length,
          totalTargets: allTargets.length,
        },
      };
    }

    // 2. Attach to target service worker
    if (action === 'attach') {
      const targetId = String(args.targetId || '');
      if (!targetId) return { ok: false, error: 'targetId is required to attach to a service worker.' };

      const attachRes = await chrome.debugger.sendCommand({ tabId: tab.id }, 'Target.attachToTarget', {
        targetId,
        flatten: true,
      });

      return {
        ok: true,
        data: {
          attached: true,
          targetId,
          sessionId: attachRes?.sessionId,
        },
      };
    }

    // 3. Stop running service worker
    if (action === 'stop') {
      const versionId = String(args.versionId || '');
      if (!versionId) return { ok: false, error: 'versionId is required to stop a service worker.' };

      await chrome.debugger.sendCommand({ tabId: tab.id }, 'ServiceWorker.enable').catch(() => {});
      await chrome.debugger.sendCommand({ tabId: tab.id }, 'ServiceWorker.stopWorker', { versionId });
      return { ok: true, data: { stopped: true, versionId } };
    }

    // 4. Unregister service worker registration
    if (action === 'unregister') {
      const scopeURL = String(args.scopeURL || (tab.url ? new URL(tab.url).origin + '/' : ''));
      if (!scopeURL) return { ok: false, error: 'scopeURL is required to unregister service worker.' };

      await chrome.debugger.sendCommand({ tabId: tab.id }, 'ServiceWorker.enable').catch(() => {});
      await chrome.debugger.sendCommand({ tabId: tab.id }, 'ServiceWorker.unregister', { scopeURL });
      return { ok: true, data: { unregistered: true, scopeURL } };
    }

    return { ok: false, error: 'Unknown web_service_worker action: ' + action + '. Supported: list, attach, stop, unregister.' };
  } catch (e) {
    return { ok: false, error: 'Service worker operation failed: ' + String((e && e.message) || e) };
  } finally {
    // Keep CDP attached if requested or release
    if (args.keepAttached !== true && action !== 'attach') {
      await detachCdp(tab);
    }
  }
}
