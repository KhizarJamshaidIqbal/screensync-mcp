// ScreenSync Browser Extension - Web Bridge
// Registers this browser with the hub (presence, capabilities, windows) and answers the hub's SSE
// requests: check the request is for us, run it through the approval gate, dispatch it, audit it, and
// POST the result back. Split out of web-tools.js, which is the dispatcher and had grown past the repo's
// 500-line limit.

import { getSettings } from './storage.js';
import { hubFetch } from './api.js';
import { getProfileIdentity, matchesSelfTarget } from './profile-identity.js';
import { isRestrictedTab } from './tab-resolve.js';
import { makeError, ERROR_CODES } from './errors.js';
import { recordAuditEntry } from './audit.js';
import { runWithApproval } from './approval-gate.js';
import { executeWebTool, isActTool } from './web-tools.js';

export async function registerWebBridge() {
  let tab = null;
  try {
    const [t] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (t && t.url && !isRestrictedTab(t)) tab = { url: t.url, title: t.title };
  } catch {}
  let windows = [];
  try {
    const wins = await chrome.windows.getAll({ populate: true });
    windows = (wins || []).map((w) => {
      const activeTab = (w.tabs || []).find((t) => t.active) || (w.tabs && w.tabs[0]);
      return {
        id: w.id,
        focused: w.focused,
        state: w.state,
        type: w.type,
        tabCount: w.tabs ? w.tabs.length : 0,
        activeTab: activeTab && activeTab.url && !isRestrictedTab(activeTab)
          ? { tabId: activeTab.id, url: activeTab.url, title: activeTab.title }
          : null,
      };
    });
  } catch {}
  try {
    const identity = await getProfileIdentity();
    const s = await getSettings();
    const regRes = await hubFetch('/api/web/register', {
      method: 'POST',
      body: {
        webAccessEnabled: s.webAccessEnabled === true,
        tab,
        windows,
        userAgent: navigator.userAgent,
        browserId: identity.runtimeId,
        instanceId: identity.instanceId,
        browserName: identity.browserName,
        profileEmail: identity.profileEmail,
        profileName: identity.profileName,
        // This build puts a risky action in front of a person before it runs (approval-gate.js). The hub
        // only hands a gated call to a browser that says so: an older extension would just run it.
        approvals: true,
        extensionVersion: chrome.runtime.getManifest().version,
      },
    });
    if (regRes && regRes.reloadRequested === true) {
      setTimeout(() => { try { chrome.runtime.reload(); } catch {} }, 200);
    }
  } catch {}
}

export async function handleWebRequest(req) {
  const { id, tool, args = {} } = req || {};
  const identity = await getProfileIdentity();

  // Strict Zero Cross-Talk Guard:
  // If targeted to a specific profile, instance, or email, drop immediately if not for us.
  if (!matchesSelfTarget(req, identity)) {
    return;
  }

  const startedAt = Date.now();
  let out;
  const s = await getSettings();
  if (!s.webAccessEnabled) {
    out = makeError(ERROR_CODES.NO_GRANT, 'Web access is disabled in the ScreenSync extension dashboard.');
  } else {
    try {
      // A person, not the agent, decides anything destructive: see approval-gate.js.
      out = await runWithApproval(tool, args, req, executeWebTool, { isActTool });
    } catch (e) {
      out = makeError(ERROR_CODES.INTERNAL, String((e && e.message) || e));
    }
  }

  // Record into privacy-preserving audit ring (Plan §2.4)
  recordAuditEntry({
    tool,
    durationMs: Date.now() - startedAt,
    ok: !!out.ok,
    code: out.code,
    error: out.error,
    args,
  }).catch(() => {});

  try {
    await hubFetch('/api/web/result', {
      method: 'POST',
      body: {
        id,
        ok: !!out.ok,
        data: out.data,
        error: out.error,
        code: out.code,
        retryable: out.retryable,
        browserId: identity.runtimeId,
        instanceId: identity.instanceId,
        browserName: identity.browserName,
        profileEmail: identity.profileEmail,
        profileName: identity.profileName,
      },
    });
  } catch {}
}