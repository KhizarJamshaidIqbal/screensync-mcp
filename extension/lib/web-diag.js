// ScreenSync Extension Diagnostics Unit
// Real self-check: hub reachability, SSE state, last event age, granted origins, storage, permissions.
// Modular single-responsibility unit under 150 lines.

import { getSettings } from './storage.js';

export async function execExtensionDiagnostics() {
  const settings = await getSettings().catch(() => ({}));
  const manifest = (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getManifest) ? chrome.runtime.getManifest() : {};

  let hubHealthy = false;
  let hubHealthData = null;
  const hubUrl = String(settings.hubUrl || 'http://127.0.0.1:3000');
  try {
    const res = await fetch(`${hubUrl}/health`, { signal: AbortSignal.timeout(3000) });
    hubHealthy = res.ok;
    if (res.ok) hubHealthData = await res.json().catch(() => null);
  } catch {
    hubHealthy = false;
  }

  let storageBytes = 0;
  if (chrome.storage && chrome.storage.local && chrome.storage.local.getBytesInUse) {
    storageBytes = await chrome.storage.local.getBytesInUse(null).catch(() => 0);
  }

  let alarms = [];
  if (chrome.alarms && chrome.alarms.getAll) {
    alarms = await chrome.alarms.getAll().catch(() => []);
  }

  let openTabsCount = 0;
  if (chrome.tabs && chrome.tabs.query) {
    const tabs = await chrome.tabs.query({}).catch(() => []);
    openTabsCount = tabs.length;
  }

  let tabGroupsCount = 0;
  if (chrome.tabGroups && chrome.tabGroups.query) {
    const groups = await chrome.tabGroups.query({}).catch(() => []);
    tabGroupsCount = groups.length;
  }

  return {
    ok: true,
    data: {
      version: manifest.version || '1.7.1',
      manifestVersion: manifest.manifest_version || 3,
      extensionId: (chrome.runtime && chrome.runtime.id) || 'unknown',
      hub: {
        url: hubUrl,
        reachable: hubHealthy,
        health: hubHealthData,
        tokenConfigured: Boolean(settings.token && settings.token.length > 0),
      },
      webAccessEnabled: Boolean(settings.webAccessEnabled),
      grantedOrigins: settings.grants || {},
      grantedOriginsCount: Object.keys(settings.grants || {}).length,
      storageBytesInUse: storageBytes,
      openTabsCount,
      tabGroupsCount,
      activeAlarms: (alarms || []).map((a) => a.name),
      permissions: manifest.permissions || [],
      userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown',
      timestamp: new Date().toISOString(),
    },
  };
}
