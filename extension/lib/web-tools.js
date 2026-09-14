// ScreenSync Browser Extension — Web Bridge Dispatcher (Under 500 lines)
// Hub SSE requests arrive via handleWebRequest, resolve active tabs safely,
// check grants & actionability, dispatch to specialized units, and log to the audit ring.

import { getSettings } from './storage.js';
import { hubFetch } from './api.js';
import { execAdvTool, cdpWaitNetworkIdle } from './web-adv.js';
import { execDeviceTool } from './web-adv-device.js';
import { execWatch } from './web-watch.js';
import { ssWebUnitInteract } from './web-unit-interact.js';
import { ssWebUnitExtract } from './web-unit-extract.js';
import { ssWebUnitPerception } from './web-unit-perception.js';
import { ssWebUnitAction } from './web-unit-action.js';
import { ssWebUnitDom } from './web-unit-dom.js';
import { ssWebUnitStorageAdv } from './web-storage-adv.js';
import { ssWebUnitDigest } from './web-unit-digest.js';
import { execInFrame, getFrameTree, execFrameCode } from './web-frames.js';
import { execPixelDiff } from './web-diff.js';
import { execDownload, execWaitDownload } from './web-download.js';
import { execBatchCrawl, execMultiTabSync } from './web-crawl.js';
import { execExtensionDiagnostics } from './web-diag.js';
import { apiFetch } from './web-api-fetch.js';
import { historySearch, bookmarksSearch } from './web-browser-data.js';
import { execTabGroup } from './web-tab-groups.js';
import { pickActiveTab, isRestrictedTab, waitForTabComplete, groupAgentTab } from './tab-resolve.js';
import { makeError, ERROR_CODES } from './errors.js';
import { recordAuditEntry, getAuditLog, clearAuditLog, exportAuditLog } from './audit.js';
import { execWebTabs, execWebTab, execWebWindow, execTabPool, execSandboxGroup } from './web-tab-mgmt.js';
import { validateToolArgs } from './validate.js';
import {
  getOriginGrant,
  saveOriginGrant,
  revokeOriginGrant,
  isLoopbackOrTestOrigin,
  recordExtraction,
  getExtractionBudget,
  checkOriginPermission,
} from './consent.js';

const INTERACT_TOOLS = new Set([
  'web_click', 'web_type', 'web_paste', 'web_clear', 'web_highlight', 'web_scroll',
  'web_upload_file', 'web_drag_and_drop',
]);

const AGENT_PERCEPTION_TOOLS = new Set([
  'web_expect', 'web_aria_snapshot', 'web_table_extract', 'web_media_extract',
  'web_actionable',
]);

const AGENT_ACTION_TOOLS = new Set([
  'web_get_by', 'web_fill', 'web_check', 'web_focus', 'web_scroll_to',
]);

const DOM_TOOLS = new Set([
  'web_content', 'web_bounding_box', 'web_computed_style', 'web_add_script_tag',
  'web_add_style_tag', 'web_reader_mode',
]);

const STORAGE_ADV_TOOLS = new Set(['web_indexeddb', 'web_cache_storage']);

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

export const SELF_BROWSER = {
  id: (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id) || 'default',
  name: detectBrowserName(),
};

function selfBrowserMatches(hint) {
  const h = String(hint || '').toLowerCase();
  if (!h || h === 'any' || h === 'default') return true;
  return h === SELF_BROWSER.name || h === String(SELF_BROWSER.id).toLowerCase();
}

async function inject(tab, args) {
  if (isRestrictedTab(tab)) {
    return makeError(ERROR_CODES.RESTRICTED_PAGE, `Cannot run web tools on restricted tab (${tab.url}).`);
  }
  try {
    const toolName = (args && args.__tool) || '';
    const fn = INTERACT_TOOLS.has(toolName) ? ssWebUnitInteract
      : AGENT_PERCEPTION_TOOLS.has(toolName) ? ssWebUnitPerception
      : AGENT_ACTION_TOOLS.has(toolName) ? ssWebUnitAction
      : DOM_TOOLS.has(toolName) ? ssWebUnitDom
      : STORAGE_ADV_TOOLS.has(toolName) ? ssWebUnitStorageAdv
      : ssWebUnitExtract;

    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: fn,
      args: [args],
    });
    return (results && results[0] && results[0].result) || makeError(ERROR_CODES.INTERNAL, 'Injection returned no result.');
  } catch (e) {
    return makeError(ERROR_CODES.SCRIPT_INJECT_FAILED, `Cannot access page: ${e.message}`);
  }
}

export async function executeWebTool(tool, args = {}) {
  const validationError = validateToolArgs(tool, args);
  if (validationError) return validationError;

  switch (tool) {
    case 'web_status': {
      const tab = await pickActiveTab(args);
      return { ok: true, data: { activeTab: { url: tab.url, title: tab.title } } };
    }
    case 'web_extension_reload': {
      setTimeout(() => { try { chrome.runtime.reload(); } catch {} }, 150);
      return { ok: true, data: { reloading: true, message: 'Extension is reloading from disk now.' } };
    }
    case 'web_page_digest': {
      const tab = await pickActiveTab(args);
      if (isRestrictedTab(tab)) return makeError(ERROR_CODES.RESTRICTED_PAGE, `Restricted tab: ${tab.url}`);
      const res = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: ssWebUnitDigest, args: [args] });
      return (res && res[0] && res[0].result) || makeError(ERROR_CODES.INTERNAL, 'Digest returned no result.');
    }
    case 'web_audit_log': {
      const action = String(args.action || 'get');
      if (action === 'clear') return clearAuditLog();
      if (action === 'export') return exportAuditLog();
      return getAuditLog(args);
    }
    case 'web_screenshot': {
      const tab = await pickActiveTab(args);
      if (isRestrictedTab(tab)) return makeError(ERROR_CODES.RESTRICTED_PAGE, `Cannot capture restricted tab (${tab.url}).`);
      const format = args.format === 'png' ? 'png' : 'jpeg';
      const opts = format === 'png' ? { format: 'png' } : { format: 'jpeg', quality: typeof args.quality === 'number' ? Math.min(100, Math.max(1, args.quality)) : 85 };
      try {
        const imageDataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, opts);
        return { ok: true, data: { imageDataUrl, url: tab.url, title: tab.title, format } };
      } catch (err) {
        const cdpRes = await execAdvTool('web_full_screenshot', tab, { format, quality: opts.quality }).catch(() => null);
        if (cdpRes && cdpRes.ok && cdpRes.data && cdpRes.data.imageDataUrl) {
          return { ok: true, data: { imageDataUrl: cdpRes.data.imageDataUrl, url: tab.url, title: tab.title, via: 'cdp_fallback', format } };
        }
        return makeError(ERROR_CODES.INTERNAL, String((err && err.message) || err));
      }
    }
    case 'web_navigate': {
      const url = String(args.url || '');
      if (!/^https?:/i.test(url)) return makeError(ERROR_CODES.BAD_ARGS, 'Only http(s) URLs are supported.');
      const current = await pickActiveTab(args);
      const tab = args.newTab ? await chrome.tabs.create({ url }) : await chrome.tabs.update(current.id, { url });
      if (args.newTab && tab.id) groupAgentTab(tab.id);
      await waitForTabComplete(tab.id, 20000);
      const after = await chrome.tabs.get(tab.id);
      return { ok: true, data: { tabId: tab.id, url: after.url, title: after.title, status: after.status } };
    }
    case 'web_go_back': {
      const tab = await pickActiveTab(args);
      await chrome.tabs.goBack(tab.id);
      await new Promise((r) => setTimeout(r, 400));
      const after = await chrome.tabs.get(tab.id);
      return { ok: true, data: { url: after.url, title: after.title } };
    }
    case 'web_go_forward': {
      const tab = await pickActiveTab(args);
      await chrome.tabs.goForward(tab.id);
      await new Promise((r) => setTimeout(r, 400));
      const after = await chrome.tabs.get(tab.id);
      return { ok: true, data: { url: after.url, title: after.title } };
    }
    case 'web_reload': {
      const tab = await pickActiveTab(args);
      await chrome.tabs.reload(tab.id, { bypassCache: !!args.bypassCache });
      await waitForTabComplete(tab.id, 20000);
      const after = await chrome.tabs.get(tab.id);
      return { ok: true, data: { url: after.url, title: after.title } };
    }
    case 'web_wait_load_state': {
      const tab = await pickActiveTab(args);
      if (isRestrictedTab(tab)) return makeError(ERROR_CODES.RESTRICTED_PAGE, `Restricted tab: ${tab.url}`);
      const state = String(args.state || 'load').toLowerCase();
      const timeoutMs = Number(args.timeoutMs) || 15000;
      if (state === 'networkidle') return cdpWaitNetworkIdle(tab, timeoutMs, Number(args.idleMs) || 500);
      await waitForTabComplete(tab.id, timeoutMs);
      return { ok: true, data: { state: 'load' } };
    }
    case 'web_tabs': return execWebTabs(args);
    case 'web_tab': return execWebTab(args);
    case 'web_window': return execWebWindow(args);
    case 'web_tab_pool': return execTabPool(args);
    case 'web_sandbox_group': return execSandboxGroup(args);
    case 'web_api_fetch': return apiFetch(args);
    case 'web_history': return historySearch(args);
    case 'web_bookmarks': return bookmarksSearch(args);
    case 'web_tab_group': return execTabGroup(args);
    case 'web_profile_sync': {
      const domain = String(args.domain || '').trim();
      if (domain && !isLoopbackOrTestOrigin(domain)) {
        const g = await getOriginGrant(domain);
        if (!g.read) {
          return makeError(ERROR_CODES.NO_GRANT, `Profile sync requires read grant for origin ${domain}. Grant read permission in extension dashboard.`);
        }
      }
      const cookies = domain ? await chrome.cookies.getAll({ domain }).catch(() => []) : [];
      return {
        ok: true,
        data: {
          customDomain: {
            domain,
            cookieCount: cookies.length,
            cookies: cookies.map((c) => ({ name: c.name })),
          },
        },
      };
    }
    case 'web_in_frame': {
      const tab = await pickActiveTab(args);
      if (isRestrictedTab(tab)) return makeError(ERROR_CODES.RESTRICTED_PAGE, 'Cannot run in-frame tools on restricted tab.');
      return execInFrame(tab, args);
    }
    case 'web_frame_tree': {
      const tab = await pickActiveTab(args);
      if (isRestrictedTab(tab)) return makeError(ERROR_CODES.RESTRICTED_PAGE, 'Cannot inspect frame tree on restricted tab.');
      return getFrameTree(tab);
    }
    case 'web_frame_exec': {
      const tab = await pickActiveTab(args);
      if (isRestrictedTab(tab)) return makeError(ERROR_CODES.RESTRICTED_PAGE, 'Cannot run frame execution on restricted tab.');
      return execFrameCode(tab, args);
    }
    case 'web_pixel_diff': {
      const tab = await pickActiveTab(args).catch(() => null);
      return execPixelDiff(tab, args);
    }
    case 'web_download': return execDownload(args);
    case 'web_wait_download': return execWaitDownload(args);
    case 'web_multi_tab_sync': return execMultiTabSync(args);
    case 'web_batch_crawl': return execBatchCrawl(args);
    case 'web_extension_diagnostics': return execExtensionDiagnostics();
    case 'web_keep_alive': {
      const tab = await pickActiveTab(args);
      const action = String(args.action || 'protect').toLowerCase();
      const autoDiscardable = action === 'release';
      await chrome.tabs.update(tab.id, { autoDiscardable }).catch(() => {});
      return { ok: true, data: { tabId: tab.id, action, autoDiscardable, message: action === 'protect' ? 'Tab protected from memory discard' : 'Tab discard protection released' } };
    }
    case 'web_wait_for_url': {
      const tab = await pickActiveTab(args);
      const target = String(args.url || args.pattern || '');
      const isRegex = !!args.regex;
      const timeoutMs = Math.min(Math.max(Number(args.timeoutMs) || 10000, 500), 60000);
      const start = Date.now();
      while (Date.now() - start < timeoutMs) {
        const current = await chrome.tabs.get(tab.id).catch(() => null);
        if (current && current.url) {
          const matched = isRegex ? new RegExp(target).test(current.url) : current.url.includes(target);
          if (matched) return { ok: true, data: { url: current.url, matched: true, elapsedMs: Date.now() - start } };
        }
        await new Promise((r) => setTimeout(r, 200));
      }
      return makeError(ERROR_CODES.INTERNAL, `Timeout of ${timeoutMs}ms waiting for URL matching "${target}".`);
    }
    case 'web_wait_for_function': {
      const tab = await pickActiveTab(args);
      if (isRestrictedTab(tab)) return makeError(ERROR_CODES.RESTRICTED_PAGE, `Restricted tab: ${tab.url}`);
      const expr = String(args.expression || '');
      if (!expr) return makeError(ERROR_CODES.BAD_ARGS, 'web_wait_for_function requires expression.');
      const timeoutMs = Math.min(Math.max(Number(args.timeoutMs) || 10000, 500), 60000);
      const pollMs = Math.min(Math.max(Number(args.pollMs) || 200, 50), 2000);
      const start = Date.now();
      while (Date.now() - start < timeoutMs) {
        try {
          const res = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: (e) => {
              try { return Boolean((0, eval)(e)); } catch { return false; }
            },
            args: [expr],
          });
          if (res && res[0] && res[0].result) {
            return { ok: true, data: { satisfied: true, elapsedMs: Date.now() - start } };
          }
        } catch {}
        await new Promise((r) => setTimeout(r, pollMs));
      }
      return makeError(ERROR_CODES.INTERNAL, `Timeout of ${timeoutMs}ms waiting for expression.`);
    }
    case 'web_watch': {
      const tab = await pickActiveTab(args);
      if (isRestrictedTab(tab)) return makeError(ERROR_CODES.RESTRICTED_PAGE, 'Cannot watch restricted tab.');
      return execWatch(tab, args, hubFetch);
    }
    case 'web_cookies': {
      const action = String(args.action || 'get');
      const tab = await pickActiveTab(args);
      const urlObj = tab.url ? new URL(tab.url) : null;
      const domain = args.domain || (urlObj ? urlObj.hostname : '');
      const isSafeOrigin = isLoopbackOrTestOrigin(domain);
      const originGrant = isSafeOrigin ? { read: true, act: true, cookies: true } : await getOriginGrant(domain);

      if (action === 'get') {
        const cookies = await chrome.cookies.getAll({ domain }).catch(() => []);
        const includeValues = args.includeValues === true && originGrant.cookies === true;
        if (args.name) {
          const found = cookies.find((c) => c.name === args.name);
          if (!found) return { ok: true, data: { cookie: null } };
          return {
            ok: true,
            data: {
              cookie: {
                ...found,
                value: includeValues ? found.value : '[REDACTED]',
              },
              valuesRedacted: !includeValues,
            },
          };
        }
        return {
          ok: true,
          data: {
            cookies: cookies.map((c) => ({
              name: c.name,
              value: includeValues ? c.value : '[REDACTED]',
              domain: c.domain,
              path: c.path,
              secure: c.secure,
              httpOnly: c.httpOnly,
            })),
            count: cookies.length,
            valuesRedacted: !includeValues,
          },
        };
      }
      if (action === 'set' || action === 'remove') {
        if (!isSafeOrigin && !originGrant.act) {
          return makeError(ERROR_CODES.NO_GRANT, `Cookie modification requires act grant for origin ${domain}.`);
        }
        if (!isSafeOrigin && !args.confirmed && !args.force) {
          return { ok: false, code: 'USER_CONFIRMATION_REQUIRED', risk: 'destructive', error: `Cookie modification on ${domain} requires user confirmation.` };
        }
        if (action === 'remove') {
          if (!args.name) return makeError(ERROR_CODES.BAD_ARGS, 'name is required for cookie remove.');
          const cookieUrl = (args.secure ? 'https://' : 'http://') + (domain.startsWith('.') ? domain.slice(1) : domain) + (args.path || '/');
          await chrome.cookies.remove({ url: cookieUrl, name: args.name });
          return { ok: true, data: { removed: args.name } };
        }
        if (!args.name) return makeError(ERROR_CODES.BAD_ARGS, 'name is required for cookie set.');
        const cookieUrl = (args.secure ? 'https://' : 'http://') + (domain.startsWith('.') ? domain.slice(1) : domain) + (args.path || '/');
        await chrome.cookies.set({ url: cookieUrl, name: args.name, value: args.value || '', domain: args.domain, path: args.path || '/' });
        return { ok: true, data: { set: args.name } };
      }
      return makeError(ERROR_CODES.BAD_ARGS, `Unknown web_cookies action: ${action}`);
    }
    case 'web_consent': {
      const action = String(args.action || 'list');
      if (action === 'list') return { ok: true, data: { grants: await getOriginGrant(args.origin || 'unknown'), budget: getExtractionBudget() } };
      if (action === 'grant') {
        if (!args.origin) return makeError(ERROR_CODES.BAD_ARGS, 'origin is required for grant.');
        const updated = await saveOriginGrant(args.origin, args);
        return { ok: true, data: { origin: args.origin, grant: updated } };
      }
      if (action === 'revoke') {
        if (!args.origin) return makeError(ERROR_CODES.BAD_ARGS, 'origin is required for revoke.');
        return { ok: true, data: await revokeOriginGrant(args.origin) };
      }
      return makeError(ERROR_CODES.BAD_ARGS, `Unknown web_consent action: ${action}`);
    }
    default: {
      // Injected DOM / Agent / Storage tools
      if (
        INTERACT_TOOLS.has(tool) || AGENT_PERCEPTION_TOOLS.has(tool) || AGENT_ACTION_TOOLS.has(tool) || DOM_TOOLS.has(tool) ||
        STORAGE_ADV_TOOLS.has(tool) || tool === 'web_hierarchy' || tool === 'web_find' ||
        tool === 'web_assert' || tool === 'web_markdown_extract' || tool === 'web_som_overlay' ||
        tool === 'web_remove_overlay' || tool === 'web_dom_diff' || tool === 'web_scrape_schema'
      ) {
        const tab = await pickActiveTab(args);
        const category = (INTERACT_TOOLS.has(tool) || AGENT_ACTION_TOOLS.has(tool)) ? 'act' : 'read';
        const perm = await checkOriginPermission(tab.url, category, tool, args);
        if (!perm.ok) return makeError(ERROR_CODES.NO_GRANT, perm.error);
        const grant = perm.grant || {};
        const res = await inject(tab, { ...args, __tool: tool, __actGranted: !!grant.act });
        if (res && res.ok && res.data) {
          const str = typeof res.data === 'string' ? res.data : JSON.stringify(res.data);
          recordExtraction(tab.url, str.length);
        }
        return res;
      }
      // Device Emulation Tools
      if (tool === 'web_device_emulate' || tool === 'web_resize' || tool === 'web_set_user_agent') {
        const tab = await pickActiveTab(args);
        if (isRestrictedTab(tab)) return makeError(ERROR_CODES.RESTRICTED_PAGE, `Restricted tab: ${tab.url}`);
        return execDeviceTool(tool, tab, args);
      }
      // Advanced CDP & Protocol Tools
      const tab = await pickActiveTab(args);
      if (isRestrictedTab(tab)) return makeError(ERROR_CODES.RESTRICTED_PAGE, `Restricted tab: ${tab.url}`);
      return execAdvTool(tool, tab, args);
    }
  }
}

export async function registerWebBridge() {
  let tab = null;
  try {
    const [t] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (t && t.url && !isRestrictedTab(t)) tab = { url: t.url, title: t.title };
  } catch {}
  try {
    const s = await getSettings();
    const regRes = await hubFetch('/api/web/register', {
      method: 'POST',
      body: {
        webAccessEnabled: s.webAccessEnabled !== false,
        tab,
        userAgent: navigator.userAgent,
        browserId: SELF_BROWSER.id,
        browserName: SELF_BROWSER.name,
      },
    });
    if (regRes && regRes.reloadRequested === true) {
      setTimeout(() => { try { chrome.runtime.reload(); } catch {} }, 200);
    }
  } catch {}
}

export async function handleWebRequest(req) {
  const { id, tool, args = {}, targetBrowser } = req || {};
  const target = (typeof args.__browser === 'string' && args.__browser) || (typeof targetBrowser === 'string' && targetBrowser) || null;
  if (target && !selfBrowserMatches(target)) return;
  const startedAt = Date.now();
  let out;
  const s = await getSettings();
  if (!s.webAccessEnabled) {
    out = makeError(ERROR_CODES.NO_GRANT, 'Web access is disabled in the ScreenSync extension dashboard.');
  } else {
    try {
      out = await executeWebTool(tool, args);
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
        browserId: SELF_BROWSER.id,
        browserName: SELF_BROWSER.name,
      },
    });
  } catch {}
}