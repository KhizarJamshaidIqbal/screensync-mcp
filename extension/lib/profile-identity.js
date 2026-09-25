// ScreenSync Profile & Instance Identity (Zero Cross-Talk Multi-Profile)
// Ensures each browser profile (e.g. epsoldev@gmail.com vs khizar@dreamland...)
// possesses a unique, persistent instanceId and strictly filters incoming tool calls.

import { getSettings, saveSettings } from './storage.js';

function detectBrowserName() {
  try {
    const brands = (navigator.userAgentData && navigator.userAgentData.brands) || [];
    for (const b of brands) {
      const n = b.brand.toLowerCase();
      if (n.includes('edge')) return 'edge';
      if (n.includes('brave')) return 'brave';
      if (n.includes('opera')) return 'opera';
      if (n.includes('vivaldi')) return 'vivaldi';
    }
    const ua = navigator.userAgent || '';
    if (/Edg\//.test(ua)) return 'edge';
    if (/OPR\//.test(ua)) return 'opera';
    return 'chrome';
  } catch {
    return 'chrome';
  }
}

export const RUNTIME_ID = (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id) || 'default';
export const BROWSER_NAME = detectBrowserName();

let cachedInstanceId = null;
let instanceIdLoading = null;

async function loadInstanceId() {
  const s = await getSettings();
  if (s.instanceId && typeof s.instanceId === 'string' && s.instanceId.trim()) return s.instanceId.trim();
  const randomPart = typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID().slice(0, 8)
    : Math.random().toString(36).slice(2, 10);
  const newId = `inst_${BROWSER_NAME}_${Date.now().toString(36)}_${randomPart}`;
  await saveSettings({ instanceId: newId });
  return newId;
}

// Single-flight: a fresh service worker calls this from boot, the alarm, tab events and the SSE supervisor at
// once. With empty storage (first install, or storage cleared) each caller used to mint its own id, so the hub
// saw a second, phantom browser instance that no request could ever reach.
export async function getInstanceId() {
  if (cachedInstanceId) return cachedInstanceId;
  if (!instanceIdLoading) {
    instanceIdLoading = loadInstanceId().then(
      (id) => { cachedInstanceId = id; return id; },
      (e) => { instanceIdLoading = null; throw e; },
    );
  }
  return instanceIdLoading;
}

export async function detectProfileUserInfo() {
  // 1. chrome.identity API
  try {
    if (typeof chrome !== 'undefined' && chrome.identity && chrome.identity.getProfileUserInfo) {
      const info = await new Promise((resolve) => {
        chrome.identity.getProfileUserInfo({ accountStatus: 'ANY' }, (u) => resolve(u));
      });
      if (info && info.email) return info;
    }
  } catch {}

  // 2. Cookie scan for signed-in Google account email
  try {
    if (typeof chrome !== 'undefined' && chrome.cookies && chrome.cookies.getAll) {
      const cookies = await chrome.cookies.getAll({ domain: 'google.com' }).catch(() => []);
      for (const c of cookies) {
        if (c.name === 'ACCOUNT_CHOOSER' || c.name.includes('ACCOUNT')) {
          const match = decodeURIComponent(c.value).match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
          if (match) return { email: match[0], id: '' };
        }
      }
    }
  } catch {}

  // 3. Tab inspection heuristic for known user accounts
  try {
    if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.query) {
      const tabs = await chrome.tabs.query({}).catch(() => []);
      for (const t of tabs) {
        const u = (t.url || '').toLowerCase();
        const title = (t.title || '').toLowerCase();
        if (u.includes('epsoldev') || title.includes('epsoldev') || u.includes('epsol') || title.includes('@epsoldev')) {
          return { email: 'epsoldev@gmail.com', name: 'Epsol' };
        }
        if (u.includes('dreamlandadventuretourism') || u.includes('niagarafalls') || title.includes('niagarafalls')) {
          return { email: 'khizar@dreamlandadventuretourism.com', name: 'khizar' };
        }
        if (u.includes('customsofa') || title.includes('custom sofa')) {
          return { email: 'customsofaprice@gmail.com', name: 'Custom sofa' };
        }
      }
    }
  } catch {}

  // 4. Extension runtime ID correlation
  if (RUNTIME_ID === 'jemgpkfioegjjnidjbhmmpnnjdadapko') {
    return { email: 'epsoldev@gmail.com', name: 'Epsol' };
  }

  return null;
}

export async function setProfileIdentity({ profileEmail, profileName } = {}) {
  const patch = {};
  if (profileEmail && typeof profileEmail === 'string') patch.profileEmail = profileEmail.trim().toLowerCase();
  if (profileName && typeof profileName === 'string') patch.profileName = profileName.trim();
  await saveSettings(patch);
  return getProfileIdentity();
}

export async function getProfileIdentity() {
  const instanceId = await getInstanceId();
  const s = await getSettings();
  let email = s.profileEmail || '';
  let name = s.profileName || '';

  if (!email) {
    const detected = await detectProfileUserInfo();
    if (detected && detected.email) {
      email = detected.email;
      if (!name) name = detected.name || email.split('@')[0];
      await saveSettings({ profileEmail: email, profileName: name });
    }
  }

  return {
    instanceId,
    browserName: BROWSER_NAME,
    runtimeId: RUNTIME_ID,
    profileEmail: email,
    profileName: name || (email ? email.split('@')[0] : BROWSER_NAME),
  };
}

// How many browser instances the hub's last register reply listed as online, this one included. null = unknown:
// an older hub that sends no browser list, or no reply yet since this service worker started.
let hubOnlineInstances = null;

/** Records the hub's view of who is online from a /api/web/register reply (web-bridge.js registerWebBridge). */
export function noteHubPresence(status) {
  const browsers = status && Array.isArray(status.browsers) ? status.browsers : null;
  hubOnlineInstances = browsers ? browsers.filter((b) => b && b.online === true).length : null;
}

const namesTarget = (v) => typeof v === 'string' && !['', 'any', 'default'].includes(v.trim().toLowerCase());

/**
 * Strict Zero Cross-Talk Target Filter.
 * Checks whether an incoming web_request is intended for this specific profile/instance.
 * If not, returns false so this profile will drop the request without touching any DOM or tabs.
 */
export function matchesSelfTarget(req, identity, onlineInstances = hubOnlineInstances) {
  if (!req) return true;
  const args = req.args || {};
  const targetInstance = req.targetInstanceId || args.__instance || args.instanceId;
  const targetEmail = req.targetEmail || args.__email || args.email || args.profileEmail;
  const targetProfile = req.targetProfile || args.__profile || args.profile;
  const targetBrowser = req.targetBrowser || args.__browser;

  // 0. A request that names nobody reaches EVERY connected profile, so with two logged-in accounts one click
  // would run in both. Current hubs always name an instance; this guards older ones. Accept it only when the hub
  // has not told us that another instance is online (unknown keeps the old behaviour).
  if (![targetInstance, targetEmail, targetProfile, targetBrowser].some(namesTarget) && onlineInstances > 1) {
    return false;
  }

  // 1. Exact Instance ID matching (highest priority)
  if (targetInstance && typeof targetInstance === 'string') {
    if (targetInstance.trim().toLowerCase() !== identity.instanceId.toLowerCase()) {
      return false;
    }
  }

  // 2. Email matching (case-insensitive)
  if (targetEmail && typeof targetEmail === 'string') {
    const wanted = targetEmail.trim().toLowerCase();
    const selfEmail = (identity.profileEmail || '').toLowerCase();
    if (!selfEmail) {
      return false;
    }
    if (selfEmail !== wanted && !selfEmail.includes(wanted) && !wanted.includes(selfEmail)) {
      return false;
    }
  }

  // 3. Profile Name / Email alias matching
  if (targetProfile && typeof targetProfile === 'string') {
    const wanted = targetProfile.trim().toLowerCase();
    const selfEmail = (identity.profileEmail || '').toLowerCase();
    const selfName = (identity.profileName || '').toLowerCase();
    const matchEmail = selfEmail && (selfEmail === wanted || selfEmail.includes(wanted) || wanted.includes(selfEmail));
    const matchName = selfName && (selfName === wanted || selfName.includes(wanted) || wanted.includes(selfName));
    if (!matchEmail && !matchName) {
      return false;
    }
  }

  // 4. Target Browser matching
  if (targetBrowser && typeof targetBrowser === 'string') {
    const wanted = targetBrowser.trim().toLowerCase();
    if (wanted !== 'any' && wanted !== 'default') {
      const matchName = wanted === identity.browserName.toLowerCase();
      const matchInst = wanted === identity.instanceId.toLowerCase();
      const matchEmail = identity.profileEmail && identity.profileEmail.toLowerCase().includes(wanted);
      const matchProf = identity.profileName && identity.profileName.toLowerCase().includes(wanted);
      const matchRuntime = wanted === identity.runtimeId.toLowerCase();
      if (!matchName && !matchInst && !matchEmail && !matchProf && !matchRuntime) {
        return false;
      }
    }
  }

  return true;
}
