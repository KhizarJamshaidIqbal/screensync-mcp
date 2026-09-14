import { DEFAULT_TOKEN } from './constants.js';

// ScreenSync Storage Layout (Plan §3.3 & D2)
// Sensitive pairing secrets, tokens, origin grants, and audit trails live in
// chrome.storage.local (machine-local only, never replicated to Google Account sync).
// Only non-secret UI preferences live in chrome.storage.sync.

const LOCAL_DEFAULTS = {
  hubUrl: 'http://127.0.0.1:3000',
  token: '',
  onboardingComplete: false,
  webAccessEnabled: false,
  grants: {},
  setupGuideCache: null,
  setupGuideFetchedAt: null,
};

const SYNC_DEFAULTS = {
  theme: 'dark',
  reduceMotion: false,
};

const LOCAL_KEYS = new Set([
  'hubUrl',
  'token',
  'onboardingComplete',
  'webAccessEnabled',
  'grants',
  'ss_audit_log',
  'vaultSessions',
  'setupGuideCache',
  'setupGuideFetchedAt',
]);

export async function getSettings() {
  try {
    const local = await chrome.storage.local.get(LOCAL_DEFAULTS);
    let sync = {};
    if (chrome.storage.sync) {
      try {
        sync = await chrome.storage.sync.get(SYNC_DEFAULTS);
      } catch {
        /* chrome.storage.sync quota/offline fallback */
      }
    }
    return { ...SYNC_DEFAULTS, ...LOCAL_DEFAULTS, ...sync, ...local };
  } catch (err) {
    console.error('[ss] getSettings error:', err);
    return { ...LOCAL_DEFAULTS, ...SYNC_DEFAULTS };
  }
}

export async function saveSettings(patch) {
  if (!patch || typeof patch !== 'object') return getSettings();
  const localPatch = {};
  const syncPatch = {};

  for (const [k, v] of Object.entries(patch)) {
    if (LOCAL_KEYS.has(k)) {
      localPatch[k] = v;
    } else {
      syncPatch[k] = v;
    }
  }

  if (Object.keys(localPatch).length > 0) {
    await chrome.storage.local.set(localPatch);
  }
  if (Object.keys(syncPatch).length > 0 && chrome.storage.sync) {
    try {
      await chrome.storage.sync.set(syncPatch);
    } catch {
      await chrome.storage.local.set(syncPatch);
    }
  }

  return getSettings();
}
