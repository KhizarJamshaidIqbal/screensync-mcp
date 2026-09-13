import { getSettings } from './storage.js';
import { hubFetch } from './api.js';
import { execAdvTool, cdpWaitNetworkIdle } from './web-adv.js';
import { execDeviceTool } from './web-adv-device.js';
import { execWatch } from './web-watch.js';
import { ssWebUnitInteract, ssWebUnitExtract } from './web-unit.js';
import { ssWebUnitAgent } from './web-unit-agent.js';
import { execInFrame } from './web-frames.js';
import { sessionExport, sessionImport } from './web-session-sync.js';

// Browser-side executor for the hub's web bridge. The hub pushes
// {type:'web_request', id, tool, args} over SSE; we run the tool against the
// user's active tab and POST the result back to /api/web/result. Modular page-side
// execution is partitioned into web-unit-interact.js, web-unit-extract.js and
// web-unit-agent.js (Playwright expect/snapshot/get_by/run_code parity layer).

const RESTRICTED_TAB = /^(chrome|edge|about|view-source|devtools|chrome-extension):/;

const INTERACT_TOOLS = new Set([
  'web_click',
  'web_type',
  'web_paste',
  'web_clear',
  'web_highlight',
  'web_scroll',
  'web_upload_file',
  'web_drag_and_drop',
]);

const AGENT_UNIT_TOOLS = new Set([
  'web_expect',
  'web_aria_snapshot',
  'web_table_extract',
  'web_get_by',
  'web_fill',
  'web_check',
  'web_focus',
  'web_scroll_to',
  'web_media_extract',
]);

const DEVICE_TOOLS = new Set([
  'web_device_emulate',
  'web_resize',
  'web_set_user_agent',
]);

// ── Multi-browser identity: each extension install registers a stable id and
// a human browser name, and ignores web requests targeted at another browser. ──
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
  } catch { return 'chrome'; }
}

const SELF_BROWSER = {
  id: (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id) || 'default',
  name: detectBrowserName(),
};

function selfBrowserMatches(hint) {
  const h = String(hint || '').toLowerCase();
  if (!h || h === 'any' || h === 'default') return true;
  return h === SELF_BROWSER.name || h === String(SELF_BROWSER.id).toLowerCase();
}

async function pickActiveTab(args = {}) {
  if (args && args.tabId) {
    try {
      const t = await chrome.tabs.get(Number(args.tabId));
      if (t) return t;
    } catch { /* tabId not found, fallback to active */ }
  }
  let tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tabs || !tabs.length) tabs = await chrome.tabs.query({ active: true });
  if (!tabs || !tabs.length) tabs = await chrome.tabs.query({});
  if (!tabs || !tabs.length) throw new Error('No browser tab found.');

  const active = tabs[0];
  if (active && RESTRICTED_TAB.test(active.url || '')) {
    const allTabs = await chrome.tabs.query({}).catch(() => []);
    const usable = allTabs.find((t) => t.url && !RESTRICTED_TAB.test(t.url));
    if (usable) return usable;
  }
  return active;
}

async function inject(tab, args) {
  if (RESTRICTED_TAB.test(tab.url || '')) {
    return { ok: false, error: `Cannot run web tools on this tab (${tab.url}). Switch to a normal web page first.` };
  }
  try {
    const toolName = (args && args.__tool) || '';
    const fn = INTERACT_TOOLS.has(toolName) ? ssWebUnitInteract
      : AGENT_UNIT_TOOLS.has(toolName) ? ssWebUnitAgent
        : ssWebUnitExtract;
    const results = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: fn, args: [args] });
    return (results && results[0] && results[0].result) || { ok: false, error: 'Injection returned no result.' };
  } catch (e) {
    return { ok: false, error: `Cannot access that page: ${String((e && e.message) || e)}` };
  }
}

function waitForTabComplete(tabId, timeoutMs) {
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

async function ensureOffscreenDoc() {
  if (!chrome.offscreen || !chrome.offscreen.createDocument) return false;
  try {
    if (chrome.offscreen.hasDocument && (await chrome.offscreen.hasDocument())) return true;
    await chrome.offscreen.createDocument({
      url: 'pages/offscreen.html',
      reasons: ['BLOBS'],
      justification: 'Keep background service worker active and perform canvas diffing',
    });
    return true;
  } catch (e) {
    if (String(e).includes('Only a single offscreen')) return true;
    return false;
  }
}

async function groupAgentTab(tabId) {
  try {
    if (!chrome.tabs.group || !chrome.tabGroups) return;
    const groupId = await chrome.tabs.group({ tabIds: [tabId] });
    await chrome.tabGroups.update(groupId, { title: 'ScreenSync AI', color: 'cyan' });
  } catch {}
}


async function executeWebTool(tool, args) {
  switch (tool) {
    case 'web_status': {
      const tab = await pickActiveTab();
      return { ok: true, data: { activeTab: { url: tab.url, title: tab.title } } };
    }
    case 'web_extension_reload': {
      setTimeout(() => {
        try { chrome.runtime.reload(); } catch {}
      }, 150);
      return { ok: true, data: { reloading: true, message: 'Extension is reloading from disk now.' } };
    }
    case 'web_screenshot': {
      const tab = await pickActiveTab(args);
      if (RESTRICTED_TAB.test(tab.url || '')) {
        return { ok: false, error: `Cannot capture this tab (${tab.url}). Switch to a normal web page first.` };
      }
      try {
        const imageDataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'jpeg', quality: 85 });
        return { ok: true, data: { imageDataUrl, url: tab.url, title: tab.title } };
      } catch (err) {
        try {
          const cdpRes = await execAdvTool('web_full_screenshot', tab, { format: 'jpeg', quality: 85 });
          if (cdpRes && cdpRes.ok && cdpRes.data && cdpRes.data.imageDataUrl) {
            return { ok: true, data: { imageDataUrl: cdpRes.data.imageDataUrl, url: tab.url, title: tab.title, via: 'cdp_fallback' } };
          }
        } catch {}
        return { ok: false, error: String((err && err.message) || err) };
      }
    }
    case 'web_navigate': {
      const url = String(args.url || '');
      if (!/^https?:/i.test(url)) return { ok: false, error: 'Only http(s) URLs are supported.' };
      const current = await pickActiveTab();
      const tab = args.newTab ? await chrome.tabs.create({ url }) : await chrome.tabs.update(current.id, { url });
      if (args.newTab && tab.id) groupAgentTab(tab.id);
      await waitForTabComplete(tab.id, 20000);
      const after = await chrome.tabs.get(tab.id);
      return { ok: true, data: { tabId: tab.id, url: after.url, title: after.title, status: after.status } };
    }
    case 'web_hierarchy':
    case 'web_click':
    case 'web_type':
    case 'web_paste':
    case 'web_clear':
    case 'web_highlight':
    case 'web_scroll':
    case 'web_scrape_schema':
    case 'web_dom_diff':
    case 'web_drag_and_drop':
    case 'web_find':
    case 'web_som_overlay':
    case 'web_remove_overlay':
    case 'web_assert':
    case 'web_markdown_extract':
    case 'web_expect':
    case 'web_aria_snapshot':
    case 'web_table_extract':
    case 'web_get_by':
    case 'web_fill':
    case 'web_check':
    case 'web_focus':
    case 'web_scroll_to':
    case 'web_media_extract': {
      const tab = await pickActiveTab(args);
      return inject(tab, { ...args, __tool: tool });
    }
    case 'web_eval':
    case 'web_cdp_eval':
    case 'web_a11y_tree':
    case 'web_console':
    case 'web_network':
    case 'web_dialog':
    case 'web_storage':
    case 'web_perf':
    case 'web_wait_for':
    case 'web_key':
    case 'web_hover':
    case 'web_select':
    case 'web_cdp_click':
    case 'web_cdp_type':
    case 'web_full_screenshot':
    case 'web_element_screenshot':
    case 'web_emulate':
    case 'web_upload_file':
    case 'web_pdf':
    case 'web_stealth_cloak':
    case 'web_export_har':
    case 'web_human_mouse':
    case 'web_network_mock':
    case 'web_key_combo':
    case 'web_mouse':
    case 'web_touch':
    case 'web_grant_permissions':
    case 'web_set_timezone':
    case 'web_route':
    case 'web_dialog_rule':
    case 'web_coverage':
    case 'web_set_geolocation':
    case 'web_throttle_network':
    case 'web_set_color_scheme':
    case 'web_clipboard':
    case 'web_wait_for_response':
    case 'web_wait_for_request':
    case 'web_websocket_traffic':
    case 'web_human_type':
    case 'web_human_scroll':
    case 'web_screencast':
    case 'web_network_auth':
    case 'web_run_code':
    case 'web_har_record':
    case 'web_trace_record':
    case 'web_video_record':
    case 'web_clock_set':
    case 'web_clock_clear': {
      const tab = await pickActiveTab(args);
      if (RESTRICTED_TAB.test(tab.url || '')) {
        return { ok: false, error: 'Cannot run web tools on this tab (' + tab.url + '). Switch to a normal web page first.' };
      }
      return execAdvTool(tool, tab, args);
    }
    case 'web_device_emulate':
    case 'web_resize':
    case 'web_set_user_agent': {
      const tab = await pickActiveTab(args);
      if (RESTRICTED_TAB.test(tab.url || '')) {
        return { ok: false, error: 'Cannot run web tools on this tab (' + tab.url + '). Switch to a normal web page first.' };
      }
      return execDeviceTool(tool, tab, args);
    }
    case 'web_wait_load_state': {
      const tab = await pickActiveTab();
      if (RESTRICTED_TAB.test(tab.url || '')) {
        return { ok: false, error: 'Cannot wait for load state on restricted tab: ' + tab.url };
      }
      const state = String(args.state || 'load').toLowerCase();
      const timeoutMs = Number(args.timeoutMs) || 15000;

      if (state === 'networkidle') {
        return cdpWaitNetworkIdle(tab, timeoutMs, Number(args.idleMs) || 500);
      }

      if (state === 'domcontentloaded') {
        const check = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: () => document.readyState !== 'loading',
        }).catch(() => null);
        if (check && check[0] && check[0].result) {
          return { ok: true, data: { state: 'domcontentloaded', immediate: true } };
        }
        return new Promise((resolve) => {
          const timer = setTimeout(() => {
            chrome.tabs.onUpdated.removeListener(onUpdated);
            resolve({ ok: false, error: `Timeout of ${timeoutMs}ms waiting for domcontentloaded` });
          }, timeoutMs);
          const onUpdated = (id, info) => {
            if (id === tab.id && (info.status === 'complete' || info.title)) {
              clearTimeout(timer);
              chrome.tabs.onUpdated.removeListener(onUpdated);
              resolve({ ok: true, data: { state: 'domcontentloaded' } });
            }
          };
          chrome.tabs.onUpdated.addListener(onUpdated);
        });
      }

      const checkComplete = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => document.readyState === 'complete',
      }).catch(() => null);
      if (checkComplete && checkComplete[0] && checkComplete[0].result) {
        return { ok: true, data: { state: 'load', immediate: true } };
      }
      await waitForTabComplete(tab.id, timeoutMs);
      return { ok: true, data: { state: 'load' } };
    }
    case 'web_profile_sync': {
      return inspectUserProfileSync(args);
    }
    case 'web_social_matrix': {
      return socialMatrix(args);
    }
    case 'web_social_sync': {
      return socialSync(args);
    }
    case 'web_multi_tab_sync': {
      return multiTabSync(args);
    }
    case 'web_keep_alive': {
      return keepTabAlive(args);
    }
    case 'web_social_feed_cluster': {
      return socialFeedCluster(args);
    }
    case 'web_social_dossier': {
      return socialDossier(args);
    }
    case 'web_social_search': {
      return socialSearch(args);
    }
    case 'web_batch_crawl': {
      return batchCrawl(args);
    }
    case 'web_frame_tree': {
      const tab = await pickActiveTab(args);
      if (RESTRICTED_TAB.test(tab.url || '')) {
        return { ok: false, error: 'Cannot inspect frames on this tab (' + tab.url + '). Switch to a normal web page first.' };
      }
      if (!chrome.webNavigation || !chrome.webNavigation.getAllFrames) {
        return { ok: false, error: 'webNavigation API not available in this context.' };
      }
      const frames = await chrome.webNavigation.getAllFrames({ tabId: tab.id });
      return {
        ok: true,
        data: {
          tabId: tab.id,
          url: tab.url,
          frameCount: (frames || []).length,
          frames: (frames || []).map((f) => ({
            frameId: f.frameId,
            parentFrameId: f.parentFrameId,
            url: f.url,
            errorOccurred: f.errorOccurred,
          })),
        },
      };
    }
    case 'web_frame_exec': {
      const tab = await pickActiveTab(args);
      if (RESTRICTED_TAB.test(tab.url || '')) {
        return { ok: false, error: 'Cannot run script on this tab (' + tab.url + '). Switch to a normal web page first.' };
      }
      const frameId = Number(args.frameId);
      if (frameId === undefined || isNaN(frameId)) {
        return { ok: false, error: 'frameId (number) is required for web_frame_exec' };
      }
      const code = String(args.code || args.expression || '');
      if (!code.trim()) {
        return { ok: false, error: 'code or expression is required for web_frame_exec' };
      }
      try {
        const results = await chrome.scripting.executeScript({
          target: { tabId: tab.id, frameIds: [frameId] },
          func: async (src) => {
            try {
              const res = await Promise.resolve((0, eval)(src));
              return { ok: true, result: res !== undefined ? JSON.parse(JSON.stringify(res)) : null };
            } catch (err) {
              return { ok: false, error: String((err && err.message) || err) };
            }
          },
          args: [code],
        });
        if (!results || !results[0]) {
          return { ok: false, error: 'No execution result returned from frame ' + frameId };
        }
        const frameResult = results[0].result;
        if (frameResult && !frameResult.ok && frameResult.error) {
          return { ok: false, error: frameResult.error, frameId };
        }
        return {
          ok: true,
          data: {
            tabId: tab.id,
            frameId,
            result: frameResult ? frameResult.result : null,
          },
        };
      } catch (err) {
        return { ok: false, error: 'Failed executing in frame ' + frameId + ': ' + String((err && err.message) || err) };
      }
    }
    case 'web_pixel_diff': {
      let { imageA, imageB, threshold = 0.1 } = args;
      if (!imageA) {
        return { ok: false, error: 'imageA (data URL or baseline screenshot) is required for web_pixel_diff' };
      }
      if (!imageB) {
        const tab = await pickActiveTab();
        if (RESTRICTED_TAB.test(tab.url || '')) {
          return { ok: false, error: 'Cannot capture current tab (' + tab.url + ') as imageB.' };
        }
        imageB = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'jpeg', quality: 85 });
      }
      await ensureOffscreenDoc();
      try {
        const res = await chrome.runtime.sendMessage({
          type: 'pixel-diff',
          imageA,
          imageB,
          threshold: Number(threshold) || 0.1,
        });
        if (!res) return { ok: false, error: 'No response from offscreen pixel diff engine.' };
        return res;
      } catch (err) {
        return { ok: false, error: 'Pixel diff message dispatch failed: ' + String((err && err.message) || err) };
      }
    }
    case 'web_tabs': {
      let tabs = await chrome.tabs.query({ lastFocusedWindow: true }).catch(() => []);
      if (!tabs || tabs.length === 0) tabs = await chrome.tabs.query({}).catch(() => []);
      return { ok: true, data: { tabs: (tabs || []).map((t) => ({ tabId: t.id, url: t.url, title: t.title, active: t.active })) } };
    }
    case 'web_tab': {
      const action = String(args.action || 'open');
      if (action === 'open') {
        const url = String(args.url || '');
        if (!/^https?:/i.test(url)) return { ok: false, error: 'Only http(s) URLs are supported.' };
        const created = await chrome.tabs.create({ url });
        if (created && created.id) groupAgentTab(created.id);
        await waitForTabComplete(created.id, 20000);
        const t = await chrome.tabs.get(created.id);
        return { ok: true, data: { tabId: t.id, url: t.url, title: t.title } };
      }
      if (action === 'switch') {
        const tabId = Number(args.tabId);
        if (!tabId) return { ok: false, error: 'tabId is required for switch' };
        const t = await chrome.tabs.update(tabId, { active: true });
        if (t.windowId) await chrome.windows.update(t.windowId, { focused: true });
        return { ok: true, data: { tabId, url: t.url, title: t.title } };
      }
      if (action === 'close') {
        const tabId = Number(args.tabId);
        if (!tabId) return { ok: false, error: 'tabId is required for close' };
        await chrome.tabs.remove(tabId);
        return { ok: true, data: { closed: tabId } };
      }
      return { ok: false, error: `Unknown web_tab action: ${action}` };
    }
    case 'web_watch': {
      const tab = await pickActiveTab();
      if (RESTRICTED_TAB.test(tab.url || '')) {
        return { ok: false, error: `Cannot capture this tab (${tab.url}). Switch to a normal web page first.` };
      }
      return execWatch(tab, args, hubFetch);
    }
    case 'web_session_save': {
      const tab = await pickActiveTab(args);
      if (!tab.url || RESTRICTED_TAB.test(tab.url)) {
        return { ok: false, error: 'Cannot save session on this tab (' + tab.url + '). Switch to a normal web page first.' };
      }
      const urlObj = new URL(tab.url);
      const domain = urlObj.hostname;
      const cookies = await chrome.cookies.getAll({ domain }).catch(() => []);
      const lsResult = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => ({ ...localStorage }),
      }).catch(() => null);
      const storage = (lsResult && lsResult[0] && lsResult[0].result) || {};
      return {
        ok: true,
        data: {
          domain,
          origin: urlObj.origin,
          savedAt: new Date().toISOString(),
          cookieCount: cookies.length,
          cookies: cookies.map((c) => ({
            name: c.name,
            value: c.value,
            domain: c.domain,
            path: c.path,
            secure: c.secure,
            httpOnly: c.httpOnly,
            sameSite: c.sameSite,
            expirationDate: c.expirationDate,
          })),
          localStorage: storage,
        },
      };
    }
    case 'web_session_restore': {
      const tab = await pickActiveTab(args);
      const session = args.session || args;
      if (!session || !Array.isArray(session.cookies)) {
        return { ok: false, error: 'Invalid session payload. Must include cookies array.' };
      }
      let restoredCookies = 0;
      for (const c of session.cookies) {
        try {
          const cookieUrl = (c.secure ? 'https://' : 'http://') + (c.domain.startsWith('.') ? c.domain.slice(1) : c.domain) + (c.path || '/');
          await chrome.cookies.set({
            url: cookieUrl,
            name: c.name,
            value: c.value,
            domain: c.domain,
            path: c.path || '/',
            secure: c.secure,
            httpOnly: c.httpOnly,
            sameSite: c.sameSite,
            expirationDate: c.expirationDate,
          });
          restoredCookies++;
        } catch {}
      }
      if (session.localStorage && Object.keys(session.localStorage).length > 0) {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: (storageData) => {
            for (const [k, v] of Object.entries(storageData)) {
              try { localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v)); } catch {}
            }
          },
          args: [session.localStorage],
        }).catch(() => null);
      }
      return { ok: true, data: { restoredCookies, localStorageKeys: Object.keys(session.localStorage || {}).length } };
    }
    case 'web_in_frame': {
      const tab = await pickActiveTab(args);
      if (RESTRICTED_TAB.test(tab.url || '')) {
        return { ok: false, error: 'Cannot run in-frame tools on this tab (' + tab.url + ').' };
      }
      return execInFrame(tab, args);
    }
    case 'web_session_export': {
      return sessionExport(args);
    }
    case 'web_session_import': {
      return sessionImport(args);
    }
    case 'web_extension_diagnostics': {
      const manifest = chrome.runtime.getManifest();
      const storageBytes = (chrome.storage && chrome.storage.local && chrome.storage.local.getBytesInUse)
        ? await chrome.storage.local.getBytesInUse(null).catch(() => 0)
        : 0;
      const alarms = (chrome.alarms && chrome.alarms.getAll)
        ? await chrome.alarms.getAll().catch(() => [])
        : [];
      const tabs = await chrome.tabs.query({}).catch(() => []);
      const activeTab = tabs.find((t) => t.active && t.lastFocusedWindow) || tabs.find((t) => t.active) || null;
      let groupsCount = 0;
      if (chrome.tabGroups && chrome.tabGroups.query) {
        const groups = await chrome.tabGroups.query({}).catch(() => []);
        groupsCount = groups.length;
      }
      return {
        ok: true,
        data: {
          extension: {
            id: chrome.runtime.id,
            name: manifest.name,
            version: manifest.version,
            manifestVersion: manifest.manifest_version,
            permissions: manifest.permissions,
          },
          health: {
            storageBytesInUse: storageBytes,
            activeAlarms: alarms.map((a) => ({ name: a.name, periodInMinutes: a.periodInMinutes, scheduledTime: a.scheduledTime })),
            totalTabsOpen: tabs.length,
            totalTabGroups: groupsCount,
            activeTab: activeTab ? { id: activeTab.id, url: activeTab.url, title: activeTab.title } : null,
            platform: navigator.platform,
            userAgent: navigator.userAgent,
          },
        },
      };
    }
    case 'web_network_rules': {
      if (!chrome.declarativeNetRequest) {
        return { ok: false, error: 'declarativeNetRequest API is not available.' };
      }
      const action = String(args.action || 'list');
      if (action === 'list') {
        const rules = await chrome.declarativeNetRequest.getDynamicRules();
        return { ok: true, data: { activeRulesCount: rules.length, rules } };
      }
      if (action === 'clear') {
        const rules = await chrome.declarativeNetRequest.getDynamicRules();
        const ruleIds = rules.map((r) => r.id);
        if (ruleIds.length > 0) {
          await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: ruleIds });
        }
        return { ok: true, data: { clearedRuleCount: ruleIds.length } };
      }
      if (action === 'allow_framing' || action === 'strip_headers') {
        const ruleId = Number(args.ruleId) || 1001;
        const domains = Array.isArray(args.domains) && args.domains.length > 0 ? args.domains : undefined;
        const newRule = {
          id: ruleId,
          priority: 1,
          action: {
            type: 'modifyHeaders',
            responseHeaders: [
              { header: 'x-frame-options', operation: 'remove' },
              { header: 'content-security-policy', operation: 'remove' },
              { header: 'frame-options', operation: 'remove' },
            ],
          },
          condition: {
            urlFilter: args.urlFilter || '*',
            resourceTypes: ['main_frame', 'sub_frame'],
            ...(domains ? { initiatorDomains: domains } : {}),
          },
        };
        await chrome.declarativeNetRequest.updateDynamicRules({
          removeRuleIds: [ruleId],
          addRules: [newRule],
        });
        return { ok: true, data: { ruleAdded: newRule, description: 'Framing restrictions (X-Frame-Options, CSP) stripped' } };
      }
      if (action === 'inject_headers') {
        const ruleId = Number(args.ruleId) || 1002;
        const headers = Array.isArray(args.headers) ? args.headers : [{ header: 'X-ScreenSync-Agent', operation: 'set', value: 'Active' }];
        const newRule = {
          id: ruleId,
          priority: 1,
          action: {
            type: 'modifyHeaders',
            requestHeaders: headers,
          },
          condition: {
            urlFilter: args.urlFilter || '*',
            resourceTypes: ['main_frame', 'sub_frame', 'xmlhttprequest'],
          },
        };
        await chrome.declarativeNetRequest.updateDynamicRules({
          removeRuleIds: [ruleId],
          addRules: [newRule],
        });
        return { ok: true, data: { ruleAdded: newRule, description: 'Custom headers injected' } };
      }
      return { ok: false, error: `Unknown web_network_rules action: ${action}. Supported: list, clear, allow_framing, inject_headers` };
    }
    case 'web_sandbox_group': {
      const action = String(args.action || 'list');
      if (action === 'list') {
        if (!chrome.tabGroups) return { ok: true, data: { groups: [] } };
        const groups = await chrome.tabGroups.query({});
        const allTabs = await chrome.tabs.query({});
        const grouped = groups.map((g) => ({
          groupId: g.id,
          title: g.title,
          color: g.color,
          collapsed: g.collapsed,
          tabs: allTabs.filter((t) => t.groupId === g.id).map((t) => ({ id: t.id, url: t.url, title: t.title, discarded: t.discarded, active: t.active })),
        }));
        return { ok: true, data: { groupCount: groups.length, groups: grouped } };
      }
      if (action === 'create') {
        if (!chrome.tabs.group) return { ok: false, error: 'tabGroups API not supported in this browser.' };
        let tabIds = Array.isArray(args.tabIds) ? args.tabIds : [];
        if (tabIds.length === 0) {
          const active = await pickActiveTab();
          tabIds = [active.id];
        }
        const groupId = await chrome.tabs.group({ tabIds });
        const title = String(args.title || 'Agent Sandbox');
        const color = args.color || 'cyan';
        await chrome.tabGroups.update(groupId, { title, color });
        return { ok: true, data: { groupId, title, color, tabIds } };
      }
      if (action === 'discard') {
        const tabId = Number(args.tabId);
        if (!tabId) return { ok: false, error: 'tabId is required for discard action.' };
        const discardedTab = await chrome.tabs.discard(tabId);
        return { ok: true, data: { discardedTabId: discardedTab ? discardedTab.id : tabId, discarded: true } };
      }
      if (action === 'discard_all_inactive') {
        const tabs = await chrome.tabs.query({ active: false });
        const discardedIds = [];
        for (const t of tabs) {
          if (!t.discarded) {
            try {
              await chrome.tabs.discard(t.id);
              discardedIds.push(t.id);
            } catch {}
          }
        }
        return { ok: true, data: { discardedCount: discardedIds.length, discardedTabIds: discardedIds } };
      }
      if (action === 'close_group') {
        const groupId = Number(args.groupId);
        if (!groupId) return { ok: false, error: 'groupId is required for close_group.' };
        const tabs = await chrome.tabs.query({ groupId });
        const tabIds = tabs.map((t) => t.id);
        if (tabIds.length > 0) await chrome.tabs.remove(tabIds);
        return { ok: true, data: { closedGroupId: groupId, closedTabCount: tabIds.length } };
      }
      return { ok: false, error: `Unknown web_sandbox_group action: ${action}. Supported: list, create, discard, discard_all_inactive, close_group` };
    }
    case 'web_go_back': {
      const tab = await pickActiveTab();
      await chrome.tabs.goBack(tab.id);
      await new Promise((r) => setTimeout(r, 500));
      const after = await chrome.tabs.get(tab.id);
      return { ok: true, data: { url: after.url, title: after.title } };
    }
    case 'web_go_forward': {
      const tab = await pickActiveTab();
      await chrome.tabs.goForward(tab.id);
      await new Promise((r) => setTimeout(r, 500));
      const after = await chrome.tabs.get(tab.id);
      return { ok: true, data: { url: after.url, title: after.title } };
    }
    case 'web_reload': {
      const tab = await pickActiveTab();
      const bypassCache = !!args.bypassCache;
      await chrome.tabs.reload(tab.id, { bypassCache });
      await waitForTabComplete(tab.id, 20000);
      const after = await chrome.tabs.get(tab.id);
      return { ok: true, data: { url: after.url, title: after.title, bypassCache } };
    }
    case 'web_wait_for_url': {
      const tab = await pickActiveTab();
      const pattern = String(args.url || args.pattern || '');
      const timeoutMs = Math.min(Number(args.timeoutMs) || 10000, 30000);
      if (!pattern) return { ok: false, error: 'url or pattern is required.' };
      const isRegex = args.regex === true;
      const re = isRegex ? new RegExp(pattern) : null;
      const match = (u) => isRegex ? re.test(u) : u.includes(pattern);
      if (match(tab.url || '')) return { ok: true, data: { url: tab.url, waitedMs: 0, immediate: true } };
      return new Promise((resolve) => {
        const t0 = Date.now();
        const timer = setTimeout(() => {
          chrome.tabs.onUpdated.removeListener(onUpdated);
          resolve({ ok: false, error: `Timeout after ${timeoutMs}ms waiting for URL matching "${pattern}"` });
        }, timeoutMs);
        const onUpdated = (id, info) => {
          if (id === tab.id && info.url && match(info.url)) {
            clearTimeout(timer);
            chrome.tabs.onUpdated.removeListener(onUpdated);
            resolve({ ok: true, data: { url: info.url, waitedMs: Date.now() - t0 } });
          }
        };
        chrome.tabs.onUpdated.addListener(onUpdated);
      });
    }
    case 'web_wait_for_function': {
      const tab = await pickActiveTab();
      if (RESTRICTED_TAB.test(tab.url || '')) return { ok: false, error: 'Cannot run on restricted tab.' };
      const expression = String(args.expression || args.fn || '');
      if (!expression) return { ok: false, error: 'expression is required.' };
      const timeoutMs = Math.min(Number(args.timeoutMs) || 10000, 30000);
      const pollMs = Math.max(Number(args.pollMs) || 200, 50);
      const t0 = Date.now();
      return new Promise((resolve) => {
        const tick = async () => {
          if (Date.now() - t0 >= timeoutMs) {
            resolve({ ok: false, error: `Timeout after ${timeoutMs}ms waiting for expression to be truthy.` });
            return;
          }
          try {
            const results = await chrome.scripting.executeScript({
              target: { tabId: tab.id },
              world: 'MAIN',
              func: (expr) => {
                try {
                  return !!new Function('return (' + expr + ')')();
                } catch {
                  try { return !!new Function(expr)(); } catch { return false; }
                }
              },
              args: [expression],
            });
            if (results && results[0] && results[0].result) {
              resolve({ ok: true, data: { matched: true, waitedMs: Date.now() - t0 } });
              return;
            }
          } catch {}
          setTimeout(tick, pollMs);
        };
        tick();
      });
    }
    case 'web_cookies': {
      const action = String(args.action || 'get');
      const tab = await pickActiveTab();
      const urlObj = tab.url ? new URL(tab.url) : null;
      const domain = args.domain || (urlObj ? urlObj.hostname : '');
      if (action === 'get') {
        const cookies = await chrome.cookies.getAll({ domain }).catch(() => []);
        if (args.name) {
          const found = cookies.find((c) => c.name === args.name);
          return { ok: true, data: { cookie: found || null } };
        }
        return { ok: true, data: { cookies: cookies.map((c) => ({ name: c.name, value: c.value, domain: c.domain, path: c.path, secure: c.secure, httpOnly: c.httpOnly, sameSite: c.sameSite, expirationDate: c.expirationDate })), count: cookies.length } };
      }
      if (action === 'set') {
        if (!args.name) return { ok: false, error: 'name is required for cookie set.' };
        const cookieUrl = (args.secure ? 'https://' : 'http://') + (domain.startsWith('.') ? domain.slice(1) : domain) + (args.path || '/');
        await chrome.cookies.set({
          url: cookieUrl, name: args.name, value: args.value || '', domain: args.domain,
          path: args.path || '/', secure: args.secure, httpOnly: args.httpOnly, sameSite: args.sameSite, expirationDate: args.expirationDate,
        });
        return { ok: true, data: { set: args.name } };
      }
      if (action === 'delete') {
        if (!args.name) return { ok: false, error: 'name is required for cookie delete.' };
        const cookieUrl = (tab.url && tab.url.startsWith('https') ? 'https://' : 'http://') + domain + '/';
        await chrome.cookies.remove({ url: cookieUrl, name: args.name });
        return { ok: true, data: { deleted: args.name } };
      }
      if (action === 'clear') {
        const cookies = await chrome.cookies.getAll({ domain }).catch(() => []);
        for (const c of cookies) {
          const cookieUrl = (c.secure ? 'https://' : 'http://') + (c.domain.startsWith('.') ? c.domain.slice(1) : c.domain) + c.path;
          await chrome.cookies.remove({ url: cookieUrl, name: c.name }).catch(() => {});
        }
        return { ok: true, data: { cleared: cookies.length, domain } };
      }
      return { ok: false, error: `Unknown web_cookies action: ${action}` };
    }
    case 'web_download': {
      const tab = await pickActiveTab();
      const url = String(args.url || '');
      if (!url) return { ok: false, error: 'url is required for web_download.' };
      const filename = args.filename || undefined;
      const timeoutMs = Math.min(Number(args.timeoutMs) || 30000, 60000);
      return new Promise((resolve) => {
        const timer = setTimeout(() => {
          chrome.downloads.onChanged.removeListener(onChange);
          resolve({ ok: false, error: `Download timeout after ${timeoutMs}ms.` });
        }, timeoutMs);
        let downloadId = null;
        const onChange = (delta) => {
          if (delta.id !== downloadId) return;
          if (delta.state && delta.state.current === 'complete') {
            clearTimeout(timer);
            chrome.downloads.onChanged.removeListener(onChange);
            chrome.downloads.search({ id: downloadId }, (results) => {
              const dl = results && results[0];
              resolve({ ok: true, data: { downloadId, filename: dl ? dl.filename : null, fileSize: dl ? dl.fileSize : null, mime: dl ? dl.mime : null, url: dl ? dl.finalUrl : url } });
            });
          } else if (delta.state && delta.state.current === 'interrupted') {
            clearTimeout(timer);
            chrome.downloads.onChanged.removeListener(onChange);
            resolve({ ok: false, error: `Download interrupted: ${delta.error ? delta.error.current : 'unknown'}` });
          }
        };
        chrome.downloads.onChanged.addListener(onChange);
        chrome.downloads.download({ url, filename }, (id) => {
          if (chrome.runtime.lastError) {
            clearTimeout(timer);
            chrome.downloads.onChanged.removeListener(onChange);
            resolve({ ok: false, error: chrome.runtime.lastError.message });
            return;
          }
          downloadId = id;
        });
      });
    }
    case 'web_social_scrape': {
      return socialScrape(args);
    }
    case 'web_social_post': {
      return socialPost(args);
    }
    case 'web_tab_pool': {
      return tabPool(args);
    }
    case 'web_storage_state': {
      return storageState(args);
    }
    default:
      return { ok: false, error: `Unknown web tool: ${tool}` };
  }
}

async function socialScrape(args = {}) {
  const platform = String(args.platform || 'all').toLowerCase();
  const timeoutMs = Math.min(Number(args.timeoutMs) || 25000, 60000);
  const platformsToScrape = platform === 'all'
    ? ['twitter', 'github', 'linkedin', 'facebook']
    : [platform];

  const results = {};

  for (const plat of platformsToScrape) {
    let url = '';
    if (plat === 'twitter' || plat === 'x') url = 'https://x.com/home';
    else if (plat === 'github') url = 'https://github.com';
    else if (plat === 'linkedin') url = 'https://www.linkedin.com/feed/';
    else if (plat === 'facebook') url = 'https://www.facebook.com';
    else if (plat === 'reddit') url = 'https://www.reddit.com';
    if (!url) continue;

    let tab = null;
    let created = false;

    const existing = await chrome.tabs.query({ url: `${url.split('/')[0]}//${url.split('/')[2]}/*` }).catch(() => []);
    if (existing.length > 0) {
      tab = existing[0];
    } else {
      tab = await chrome.tabs.create({ url, active: false });
      created = true;
      if (chrome.tabs.group) {
        try {
          const gid = await chrome.tabs.group({ tabIds: [tab.id] });
          if (chrome.tabGroups) await chrome.tabGroups.update(gid, { title: 'ScreenSync Social', color: 'blue' });
        } catch {}
      }
      await waitForTabComplete(tab.id, timeoutMs);
    }

    let extracted = null;
    try {
      const [res] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: (p) => {
          const data = { platform: p, title: document.title, url: window.location.href };
          if (p === 'twitter' || p === 'x') {
            const profileLink = document.querySelector('a[data-testid*="AppTabBar_Profile_Link"]');
            const handle = profileLink ? profileLink.getAttribute('href')?.replace('/', '@') : null;
            const notifBadge = document.querySelector('a[data-testid*="AppTabBar_Notifications_Link"] div[aria-label]');
            const tweets = Array.from(document.querySelectorAll('article[data-testid="tweet"]')).slice(0, 3).map((t) => ({
              text: (t.querySelector('div[data-testid="tweetText"]')?.innerText || '').slice(0, 150),
              author: t.querySelector('div[data-testid="User-Name"]')?.innerText?.split('\n')[0] || '',
            }));
            data.authenticated = !document.querySelector('a[href*="/login"]');
            data.handle = handle;
            data.notifications = notifBadge?.getAttribute('aria-label') || '0';
            data.recentTweets = tweets;
          } else if (p === 'github') {
            const metaLogin = document.querySelector('meta[name="user-login"]')?.content;
            const notif = document.querySelector('.mail-status.unread, a[aria-label*="unread"]');
            data.authenticated = !!metaLogin;
            data.username = metaLogin || null;
            data.hasUnreadNotifications = !!notif;
          } else if (p === 'linkedin') {
            const nameEl = document.querySelector('.feed-identity-module__actor-meta, [class*="identity"] [class*="name"]');
            const headlineEl = document.querySelector('[class*="identity-headline"], .feed-identity-module__headline');
            data.authenticated = !document.querySelector('a[href*="/login"]');
            data.name = nameEl?.innerText?.trim() || null;
            data.headline = headlineEl?.innerText?.trim() || null;
          } else if (p === 'facebook') {
            const profileName = document.querySelector('[aria-label="Your profile"] span, [role="navigation"] [aria-label*="profile"]');
            data.authenticated = !document.querySelector('input[name="email"]');
            data.name = profileName?.innerText?.trim() || 'Active Facebook User';
          }
          return data;
        },
        args: [plat],
      });
      extracted = res?.result || { platform: plat, error: 'Extraction failed' };
    } catch (e) {
      extracted = { platform: plat, error: String(e && e.message || e) };
    }

    if (created && tab && tab.id) {
      try { await chrome.tabs.remove(tab.id); } catch {}
    }

    results[plat] = extracted;
  }

  return { ok: true, data: { scrapedPlatforms: results, timestamp: new Date().toISOString() } };
}

async function socialPost(args = {}) {
  const platform = String(args.platform || 'twitter').toLowerCase();
  const text = String(args.text || '').trim();
  if (!text) return { ok: false, error: 'text is required to post.' };
  const submit = !!args.submit;

  if (platform === 'twitter' || platform === 'x') {
    let tab = (await chrome.tabs.query({ url: '*://x.com/*' }))[0] || (await chrome.tabs.query({ url: '*://twitter.com/*' }))[0];
    if (!tab) {
      tab = await chrome.tabs.create({ url: 'https://x.com/compose/post', active: true });
      await waitForTabComplete(tab.id, 20000);
    } else {
      await chrome.tabs.update(tab.id, { active: true });
    }

    const [res] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: async (postText, doSubmit) => {
        let textarea = document.querySelector('[data-testid="tweetTextarea_0"], [role="textbox"][aria-label*="Post"]');
        if (!textarea) {
          const composeBtn = document.querySelector('a[href*="/compose/post"], a[data-testid*="SideNav_NewTweet_Button"]');
          if (composeBtn) composeBtn.click();
          await new Promise((r) => setTimeout(r, 1000));
          textarea = document.querySelector('[data-testid="tweetTextarea_0"], [role="textbox"][aria-label*="Post"]');
        }
        if (!textarea) return { ok: false, error: 'Tweet compose textarea not found.' };

        textarea.focus();
        document.execCommand('selectAll', false, null);
        document.execCommand('insertText', false, postText);
        textarea.dispatchEvent(new InputEvent('input', { bubbles: true }));

        let submitted = false;
        if (doSubmit) {
          await new Promise((r) => setTimeout(r, 500));
          const tweetBtn = document.querySelector('[data-testid="tweetButtonInline"], [data-testid="tweetButton"]');
          if (tweetBtn && !tweetBtn.disabled) {
            tweetBtn.click();
            submitted = true;
          }
        }
        return { ok: true, submitted, platform: 'x', textSnippet: postText.slice(0, 100) };
      },
      args: [text, submit],
    });
    return (res && res.result) || { ok: false, error: 'Failed to post to X/Twitter.' };
  }

  if (platform === 'linkedin') {
    let tab = (await chrome.tabs.query({ url: '*://www.linkedin.com/*' }))[0];
    if (!tab) {
      tab = await chrome.tabs.create({ url: 'https://www.linkedin.com/feed/', active: true });
      await waitForTabComplete(tab.id, 20000);
    } else {
      await chrome.tabs.update(tab.id, { active: true });
    }

    const [res] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: async (postText, doSubmit) => {
        const startPostBtn = document.querySelector('button.share-box-feed-entry__trigger, button[id*="share-box"], [aria-label*="Start a post"]');
        if (startPostBtn) startPostBtn.click();
        await new Promise((r) => setTimeout(r, 1200));

        const editor = document.querySelector('.ql-editor, [role="textbox"][aria-label*="post"], div[contenteditable="true"]');
        if (!editor) return { ok: false, error: 'LinkedIn post editor modal not found.' };

        editor.focus();
        document.execCommand('selectAll', false, null);
        document.execCommand('insertText', false, postText);
        editor.dispatchEvent(new Event('input', { bubbles: true }));

        let submitted = false;
        if (doSubmit) {
          await new Promise((r) => setTimeout(r, 600));
          const postBtn = document.querySelector('button.share-actions__primary-action, button[class*="share-actions__primary"]');
          if (postBtn && !postBtn.disabled) {
            postBtn.click();
            submitted = true;
          }
        }
        return { ok: true, submitted, platform: 'linkedin', textSnippet: postText.slice(0, 100) };
      },
      args: [text, submit],
    });
    return (res && res.result) || { ok: false, error: 'Failed to post to LinkedIn.' };
  }

  return { ok: false, error: `Unsupported platform for web_social_post: ${platform}. Supported: twitter, x, linkedin.` };
}

async function tabPool(args = {}) {
  const action = String(args.action || 'list').toLowerCase();
  if (action === 'create') {
    const urls = Array.isArray(args.urls) ? args.urls : [];
    if (urls.length === 0) return { ok: false, error: 'urls array is required for create.' };
    const tabIds = [];
    for (const u of urls) {
      const t = await chrome.tabs.create({ url: u, active: false });
      tabIds.push(t.id);
    }
    let groupId = null;
    if (chrome.tabs.group && tabIds.length > 0) {
      groupId = await chrome.tabs.group({ tabIds });
      if (chrome.tabGroups) await chrome.tabGroups.update(groupId, { title: args.title || 'Agent Tab Pool', color: 'blue' });
    }
    return { ok: true, data: { tabIds, groupId, totalCreated: tabIds.length } };
  }
  if (action === 'list') {
    const all = await chrome.tabs.query({});
    return {
      ok: true,
      data: {
        totalTabs: all.length,
        tabs: all.map((t) => ({ id: t.id, url: t.url, title: t.title, active: t.active, groupId: t.groupId })),
      },
    };
  }
  if (action === 'close') {
    const tabIds = Array.isArray(args.tabIds) ? args.tabIds.map(Number) : [];
    if (tabIds.length > 0) {
      await chrome.tabs.remove(tabIds);
      return { ok: true, data: { closedTabIds: tabIds } };
    }
    return { ok: false, error: 'tabIds array is required for close.' };
  }
  return { ok: false, error: `Unknown web_tab_pool action: ${action}. Supported: create, list, close.` };
}

async function storageState(args = {}) {
  const action = String(args.action || 'export').toLowerCase();
  if (action === 'export') {
    const allCookies = await chrome.cookies.getAll({});
    const tabs = await chrome.tabs.query({});
    const origins = [];

    for (const t of tabs.slice(0, 10)) {
      if (t.url && !RESTRICTED_TAB.test(t.url)) {
        try {
          const originUrl = new URL(t.url).origin;
          const [res] = await chrome.scripting.executeScript({
            target: { tabId: t.id },
            func: () => {
              const items = [];
              for (let i = 0; i < localStorage.length; i++) {
                const k = localStorage.key(i);
                items.push({ name: k, value: localStorage.getItem(k) });
              }
              return items;
            },
          });
          if (res && res.result && res.result.length > 0) {
            origins.push({ origin: originUrl, localStorage: res.result });
          }
        } catch {}
      }
    }

    const state = {
      cookies: allCookies.map((c) => ({
        name: c.name,
        value: c.value,
        domain: c.domain,
        path: c.path,
        expires: c.expirationDate || -1,
        httpOnly: c.httpOnly,
        secure: c.secure,
        sameSite: c.sameSite === 'no_restriction' ? 'None' : (c.sameSite === 'lax' ? 'Lax' : 'Strict'),
      })),
      origins,
    };
    return { ok: true, data: { storageState: state, totalCookies: allCookies.length, totalOrigins: origins.length } };
  }
  if (action === 'import') {
    const state = args.storageState || args.state;
    if (!state || typeof state !== 'object') return { ok: false, error: 'storageState object is required for import.' };
    let importedCookies = 0;
    if (Array.isArray(state.cookies)) {
      for (const c of state.cookies) {
        try {
          const url = (c.secure ? 'https://' : 'http://') + (c.domain.startsWith('.') ? c.domain.slice(1) : c.domain) + (c.path || '/');
          await chrome.cookies.set({
            url,
            name: c.name,
            value: c.value,
            domain: c.domain,
            path: c.path,
            secure: c.secure,
            httpOnly: c.httpOnly,
            expirationDate: c.expires > 0 ? c.expires : undefined,
          });
          importedCookies++;
        } catch {}
      }
    }
    // Playwright storageState parity: restore localStorage origins too
    // (open each origin temporarily when no tab is already on it).
    let restoredOrigins = 0;
    let localStorageKeys = 0;
    const origins = Array.isArray(state.origins) ? state.origins : [];
    for (const o of origins) {
      if (!o || !o.origin || !Array.isArray(o.localStorage) || !o.localStorage.length) continue;
      try {
        let tab = null;
        const tabs = await chrome.tabs.query({});
        tab = (tabs || []).find((t) => { try { return t.url && t.url.startsWith(o.origin); } catch { return false; } });
        let openedHere = false;
        if (!tab) {
          tab = await chrome.tabs.create({ url: o.origin + '/', active: false });
          openedHere = true;
          await new Promise((r) => setTimeout(r, 2500));
        }
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: (entries) => { for (const e of entries) { try { localStorage.setItem(e.name, String(e.value)); } catch {} } },
          args: [o.localStorage],
        });
        restoredOrigins++;
        localStorageKeys += o.localStorage.length;
        if (openedHere) { try { await chrome.tabs.remove(tab.id); } catch {} }
      } catch { /* origin unreachable — skip */ }
    }
    return { ok: true, data: { importedCookies, restoredOrigins, localStorageKeys } };
  }
  return { ok: false, error: `Unknown web_storage_state action: ${action}. Supported: export, import.` };
}

async function inspectUserProfileSync(args = {}) {
  const targetPlatforms = Array.isArray(args.platforms) && args.platforms.length > 0
    ? args.platforms
    : ['twitter', 'github', 'facebook', 'linkedin', 'instagram', 'reddit'];

  const platformConfigs = {
    twitter: { domains: ['.x.com', '.twitter.com', 'x.com', 'twitter.com'], authCookies: ['auth_token', 'ct0', 'twid'], name: 'X / Twitter' },
    github: { domains: ['.github.com', 'github.com'], authCookies: ['user_session', 'logged_in', 'dotcom_user'], name: 'GitHub' },
    linkedin: { domains: ['.linkedin.com', 'linkedin.com'], authCookies: ['li_at', 'JSESSIONID'], name: 'LinkedIn' },
    facebook: { domains: ['.facebook.com', 'facebook.com'], authCookies: ['c_user', 'xs'], name: 'Facebook' },
    instagram: { domains: ['.instagram.com', 'instagram.com'], authCookies: ['sessionid', 'ds_user_id'], name: 'Instagram' },
    reddit: { domains: ['.reddit.com', 'reddit.com'], authCookies: ['reddit_session', 'token_v2'], name: 'Reddit' },
  };

  const results = {};

  for (const plat of targetPlatforms) {
    const key = plat.toLowerCase();
    const cfg = platformConfigs[key];
    if (!cfg) continue;

    let authenticated = false;
    const foundCookies = [];
    let username = null;

    for (const dom of cfg.domains) {
      try {
        const cookies = await chrome.cookies.getAll({ domain: dom });
        if (cookies && cookies.length > 0) {
          for (const c of cookies) {
            if (cfg.authCookies.includes(c.name)) {
              authenticated = true;
              foundCookies.push(c.name);
              if (c.name === 'dotcom_user' || c.name === 'ds_user_id' || c.name === 'c_user') {
                username = c.value;
              }
            }
          }
        }
      } catch {}
    }

    results[key] = {
      platform: cfg.name,
      authenticated,
      authTokensPresent: Array.from(new Set(foundCookies)),
      accountHint: username ? `ID/User: ${username}` : (authenticated ? 'Active Session' : 'Not Logged In'),
    };
  }

  let customDomainData = null;
  if (args.domain) {
    try {
      const cDom = String(args.domain).replace(/^https?:\/\//, '').split('/')[0];
      const cookies = await chrome.cookies.getAll({ domain: cDom });
      customDomainData = {
        domain: cDom,
        cookieCount: (cookies || []).length,
        cookies: (cookies || []).map((c) => ({ name: c.name, httpOnly: c.httpOnly, secure: c.secure, path: c.path })),
      };
    } catch (e) {
      customDomainData = { domain: args.domain, error: String((e && e.message) || e) };
    }
  }

  return {
    ok: true,
    data: {
      profileSyncEnabled: true,
      platforms: results,
      customDomain: customDomainData,
      summary: `${Object.values(results).filter((p) => p.authenticated).length} of ${Object.keys(results).length} platforms authenticated in browser profile`,
    },
  };
}

async function batchCrawl(args = {}) {
  const urls = Array.isArray(args.urls) ? args.urls.filter((u) => /^https?:/i.test(u)) : [];
  if (urls.length === 0) return { ok: false, error: 'urls array of valid http(s) URLs is required.' };

  const maxConcurrency = Math.min(Math.max(Number(args.maxConcurrency) || 3, 1), 6);
  const delayMs = Number(args.delayMs) || 500;
  const timeoutMs = Number(args.timeoutMs) || 20000;
  const discardAfter = args.discardAfter !== false;
  const results = [];

  let groupId = null;

  for (let i = 0; i < urls.length; i += maxConcurrency) {
    const chunk = urls.slice(i, i + maxConcurrency);
    const chunkPromises = chunk.map(async (url) => {
      let tab = null;
      try {
        tab = await chrome.tabs.create({ url, active: false });

        if (chrome.tabs.group && !groupId) {
          try {
            groupId = await chrome.tabs.group({ tabIds: [tab.id] });
            if (chrome.tabGroups) await chrome.tabGroups.update(groupId, { title: 'ScreenSync Crawl', color: 'purple' });
          } catch {}
        } else if (chrome.tabs.group && groupId) {
          try { await chrome.tabs.group({ tabIds: [tab.id], groupId }); } catch {}
        }

        await waitForTabComplete(tab.id, timeoutMs);

        const [meta] = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: () => ({
            title: document.title,
            description: document.querySelector('meta[name="description"]')?.content || null,
            headings: Array.from(document.querySelectorAll('h1, h2, h3')).slice(0, 10).map((h) => h.innerText.trim()).filter(Boolean),
            textExcerpt: (document.body?.innerText || '').slice(0, 1000).replace(/\s+/g, ' ').trim(),
          }),
        }).catch(() => [{ result: { title: '', textExcerpt: '' } }]);

        let schemaData = null;
        if (args.schema && typeof args.schema === 'object') {
          const [sRes] = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: (schemaObj) => {
              const res = {};
              for (const [key, sel] of Object.entries(schemaObj)) {
                if (typeof sel === 'string') {
                  const node = document.querySelector(sel);
                  res[key] = node ? (node.innerText || node.value || node.src || node.href || '').trim() : null;
                }
              }
              return res;
            },
            args: [args.schema],
          }).catch(() => [{}]);
          schemaData = sRes?.result || null;
        }

        const data = {
          url,
          status: 'success',
          title: meta?.result?.title || '',
          meta: meta?.result || {},
          schema: schemaData,
        };

        if (discardAfter && tab && tab.id) {
          try { await chrome.tabs.remove(tab.id); } catch {}
        }

        return data;
      } catch (err) {
        if (discardAfter && tab && tab.id) {
          try { await chrome.tabs.remove(tab.id); } catch {}
        }
        return { url, status: 'error', error: String((err && err.message) || err) };
      }
    });

    const chunkResults = await Promise.all(chunkPromises);
    results.push(...chunkResults);

    if (i + maxConcurrency < urls.length && delayMs > 0) {
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }

  return {
    ok: true,
    data: {
      total: urls.length,
      successful: results.filter((r) => r.status === 'success').length,
      failed: results.filter((r) => r.status === 'error').length,
      results,
    },
  };
}

async function socialMatrix(args = {}) {
  const platforms = {
    x: { name: 'X (Twitter)', domains: ['.x.com', '.twitter.com'], authCookies: ['auth_token', 'ct0', 'twid'] },
    github: { name: 'GitHub', domains: ['.github.com', 'github.com'], authCookies: ['user_session', 'logged_in', 'dotcom_user'] },
    linkedin: { name: 'LinkedIn', domains: ['.linkedin.com', 'linkedin.com'], authCookies: ['li_at', 'JSESSIONID'] },
    facebook: { name: 'Facebook', domains: ['.facebook.com', 'facebook.com'], authCookies: ['c_user', 'xs'] },
    instagram: { name: 'Instagram', domains: ['.instagram.com', 'instagram.com'], authCookies: ['sessionid', 'ds_user_id'] },
    reddit: { name: 'Reddit', domains: ['.reddit.com', 'reddit.com'], authCookies: ['reddit_session', 'token_v2'] },
    google: { name: 'Google / YouTube', domains: ['.google.com', '.youtube.com'], authCookies: ['SID', 'HSID', 'SSID'] },
    whatsapp: { name: 'WhatsApp Web', domains: ['.whatsapp.com'], authCookies: ['wa_lang_pref'] },
  };

  const tabs = await chrome.tabs.query({}).catch(() => []);
  const matrix = {};

  for (const [key, cfg] of Object.entries(platforms)) {
    let authenticated = false;
    let username = null;
    const foundTokens = [];

    for (const dom of cfg.domains) {
      try {
        const cookies = await chrome.cookies.getAll({ domain: dom });
        for (const c of (cookies || [])) {
          if (cfg.authCookies.includes(c.name)) {
            authenticated = true;
            foundTokens.push(c.name);
            if (c.name === 'dotcom_user' || c.name === 'c_user' || c.name === 'ds_user_id') {
              username = c.value;
            }
          }
        }
      } catch {}
    }

    const openTabs = tabs.filter((t) => t.url && cfg.domains.some((d) => t.url.includes(d.replace(/^\./, ''))));
    const activeTab = openTabs.find((t) => t.active) || openTabs[0] || null;

    if (key === 'whatsapp' && openTabs.length > 0) {
      authenticated = true;
    }

    matrix[key] = {
      platform: cfg.name,
      authenticated,
      username: username || (authenticated ? 'Active Session' : null),
      tokensFound: Array.from(new Set(foundTokens)),
      openTabsCount: openTabs.length,
      activeUrl: activeTab ? activeTab.url : null,
    };
  }

  const wpTabs = tabs.filter((t) => t.url && t.url.includes('/wp-admin/'));
  matrix.wordpress = {
    platform: 'WordPress Admin',
    authenticated: wpTabs.length > 0,
    openTabsCount: wpTabs.length,
    activeUrl: wpTabs[0] ? wpTabs[0].url : null,
  };

  const authenticatedList = Object.entries(matrix).filter(([_, v]) => v.authenticated).map(([k]) => k);

  return {
    ok: true,
    data: {
      totalPlatformsChecked: Object.keys(matrix).length,
      authenticatedCount: authenticatedList.length,
      authenticatedPlatforms: authenticatedList,
      matrix,
    },
  };
}

async function socialSync(args = {}) {
  const platform = String(args.platform || 'x').toLowerCase();
  const task = String(args.task || 'feed').toLowerCase();
  const limit = Math.min(Math.max(Number(args.limit) || 10, 1), 50);

  let targetUrl = '';
  if (platform === 'x' || platform === 'twitter') {
    if (task === 'notifications') targetUrl = 'https://x.com/notifications';
    else if (task === 'bookmarks') targetUrl = 'https://x.com/i/bookmarks';
    else if (task === 'search' && args.query) targetUrl = `https://x.com/search?q=${encodeURIComponent(args.query)}&f=live`;
    else targetUrl = 'https://x.com/home';
  } else if (platform === 'github') {
    if (task === 'notifications') targetUrl = 'https://github.com/notifications';
    else if (task === 'trending') targetUrl = 'https://github.com/trending';
    else targetUrl = 'https://github.com';
  } else if (platform === 'reddit') {
    const sub = args.subreddit ? `r/${args.subreddit}` : 'popular';
    targetUrl = `https://www.reddit.com/${sub}/`;
  } else if (platform === 'linkedin') {
    targetUrl = 'https://www.linkedin.com/feed/';
  } else {
    return { ok: false, error: `Unsupported platform: ${platform}. Supported: x, github, reddit, linkedin.` };
  }

  let tab = null;
  let groupId = null;
  try {
    tab = await chrome.tabs.create({ url: targetUrl, active: false });
    if (chrome.tabs.group) {
      try {
        groupId = await chrome.tabs.group({ tabIds: [tab.id] });
        if (chrome.tabGroups) await chrome.tabGroups.update(groupId, { title: 'ScreenSync Sync', color: 'blue' });
      } catch {}
    }
    await waitForTabComplete(tab.id, 25000);

    let extractFunc;
    if (platform === 'x' || platform === 'twitter') {
      extractFunc = (maxItems) => {
        const articles = Array.from(document.querySelectorAll('article')).slice(0, maxItems);
        return articles.map((a) => {
          const userEl = a.querySelector('[data-testid="User-Name"]');
          const textEl = a.querySelector('[data-testid="tweetText"]');
          const timeEl = a.querySelector('time');
          const link = a.querySelector('a[href*="/status/"]');
          const replies = a.querySelector('[data-testid="reply"]')?.innerText || '0';
          const reposts = a.querySelector('[data-testid="retweet"]')?.innerText || '0';
          const likes = a.querySelector('[data-testid="like"]')?.innerText || '0';
          return {
            author: userEl ? userEl.innerText.split('\n')[0] : 'Unknown',
            handle: userEl ? (userEl.innerText.split('\n')[1] || '') : '',
            time: timeEl ? timeEl.getAttribute('datetime') : null,
            text: textEl ? textEl.innerText.trim() : '',
            permalink: link ? link.href : null,
            stats: { replies, reposts, likes },
          };
        }).filter((t) => t.text || t.permalink);
      };
    } else if (platform === 'github') {
      extractFunc = (maxItems) => {
        const rows = Array.from(document.querySelectorAll('.notifications-list-item, .Box-row, article.Box-row')).slice(0, maxItems);
        return rows.map((r) => {
          const titleEl = r.querySelector('.notification-list-item-link, h2 a, h1 a');
          const descEl = r.querySelector('p, .text-small');
          return {
            title: titleEl ? titleEl.innerText.trim() : r.innerText.slice(0, 80).trim(),
            url: titleEl ? titleEl.href : null,
            description: descEl ? descEl.innerText.trim() : null,
          };
        }).filter((i) => i.title);
      };
    } else if (platform === 'reddit') {
      extractFunc = (maxItems) => {
        const posts = Array.from(document.querySelectorAll('shreddit-post, [data-testid="post-container"]')).slice(0, maxItems);
        return posts.map((p) => {
          const title = p.getAttribute('post-title') || p.querySelector('h1, h2, a[slot="title"]')?.innerText || '';
          const author = p.getAttribute('author') || p.querySelector('a[href*="/user/"]')?.innerText || '';
          const score = p.getAttribute('score') || p.querySelector('[score]')?.innerText || '';
          const permalink = p.getAttribute('permalink') || p.querySelector('a[data-click-id="body"]')?.href || '';
          return { title: title.trim(), author, score, permalink: permalink.startsWith('http') ? permalink : `https://reddit.com${permalink}` };
        }).filter((p) => p.title);
      };
    } else {
      extractFunc = () => ({ title: document.title, excerpt: (document.body?.innerText || '').slice(0, 1000) });
    }

    const [res] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: extractFunc,
      args: [limit],
    }).catch((e) => [{ error: String(e) }]);

    const items = (res && res.result) || [];

    if (tab && tab.id) {
      try { await chrome.tabs.remove(tab.id); } catch {}
    }

    return {
      ok: true,
      data: {
        platform,
        task,
        targetUrl,
        itemsCount: Array.isArray(items) ? items.length : 1,
        items,
      },
    };
  } catch (err) {
    if (tab && tab.id) {
      try { await chrome.tabs.remove(tab.id); } catch {}
    }
    return { ok: false, error: `socialSync failed: ${String((err && err.message) || err)}` };
  }
}

async function multiTabSync(args = {}) {
  const tasks = Array.isArray(args.tasks) ? args.tasks : [];
  if (tasks.length === 0) return { ok: false, error: 'tasks array is required' };

  const concurrency = Math.min(Math.max(Number(args.concurrency) || 3, 1), 6);
  const timeoutMs = Number(args.timeoutMs) || 25000;
  const results = [];

  for (let i = 0; i < tasks.length; i += concurrency) {
    const batch = tasks.slice(i, i + concurrency);
    const batchPromises = batch.map(async (taskItem) => {
      const url = String(taskItem.url || '');
      if (!/^https?:/i.test(url)) return { url, ok: false, error: 'Invalid URL' };
      const mode = String(taskItem.extract || 'markdown').toLowerCase();
      let tab = null;
      try {
        tab = await chrome.tabs.create({ url, active: false });
        await waitForTabComplete(tab.id, timeoutMs);

        let data = null;
        if (mode === 'markdown') {
          const res = await inject(tab, { __tool: 'web_markdown_extract' });
          data = res && res.data;
        } else if (mode === 'schema' && taskItem.schema) {
          const res = await inject(tab, { __tool: 'web_scrape_schema', schema: taskItem.schema });
          data = res && res.data;
        } else if (mode === 'eval' && taskItem.expression) {
          const res = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: (expr) => Promise.resolve((0, eval)(expr)),
            args: [taskItem.expression],
          });
          data = res && res[0] && res[0].result;
        } else {
          data = { title: tab.title, url: tab.url };
        }

        try { await chrome.tabs.remove(tab.id); } catch {}
        return { url, ok: true, data };
      } catch (err) {
        if (tab && tab.id) {
          try { await chrome.tabs.remove(tab.id); } catch {}
        }
        return { url, ok: false, error: String((err && err.message) || err) };
      }
    });

    const batchResults = await Promise.all(batchPromises);
    results.push(...batchResults);
  }

  return {
    ok: true,
    data: {
      totalTasks: tasks.length,
      successful: results.filter((r) => r.ok).length,
      failed: results.filter((r) => !r.ok).length,
      results,
    },
  };
}

async function keepTabAlive(args = {}) {
  const action = String(args.action || 'protect').toLowerCase();
  const tab = await pickActiveTab(args);
  if (!tab || !tab.id) return { ok: false, error: 'No valid tab found to protect.' };

  if (action === 'protect') {
    if (chrome.tabs && chrome.tabs.update) {
      await chrome.tabs.update(tab.id, { autoDiscardable: false }).catch(() => {});
    }
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        if (!window.__ssKeepAliveInterval) {
          window.__ssKeepAliveInterval = setInterval(() => {
            window.__ssLastPing = Date.now();
          }, 5000);
        }
      },
    }).catch(() => {});
    return { ok: true, data: { tabId: tab.id, protected: true, autoDiscardable: false } };
  }

  if (action === 'release') {
    if (chrome.tabs && chrome.tabs.update) {
      await chrome.tabs.update(tab.id, { autoDiscardable: true }).catch(() => {});
    }
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        if (window.__ssKeepAliveInterval) {
          clearInterval(window.__ssKeepAliveInterval);
          delete window.__ssKeepAliveInterval;
        }
      },
    }).catch(() => {});
    return { ok: true, data: { tabId: tab.id, protected: false, autoDiscardable: true } };
  }

  return { ok: false, error: `Unknown keep_alive action: ${action}. Supported: protect, release.` };
}

async function socialFeedCluster(args = {}) {
  const limit = Math.min(Number(args.limit) || 5, 20);
  const matrixRes = await socialMatrix({});
  const authenticated = (matrixRes && matrixRes.data && matrixRes.data.authenticatedPlatforms) || [];
  
  let targetPlatforms = Array.isArray(args.platforms) && args.platforms.length > 0
    ? args.platforms.map((p) => p.toLowerCase())
    : authenticated.filter((p) => ['x', 'twitter', 'github', 'linkedin', 'reddit'].includes(p));

  if (targetPlatforms.length === 0) {
    targetPlatforms = ['github', 'x'];
  }

  const clusterResults = [];
  const tabIdsToClose = [];

  for (const plat of targetPlatforms) {
    let feedUrl = '';
    if (plat === 'x' || plat === 'twitter') feedUrl = 'https://x.com/home';
    else if (plat === 'github') feedUrl = 'https://github.com/dashboard-feed';
    else if (plat === 'linkedin') feedUrl = 'https://www.linkedin.com/feed/';
    else if (plat === 'reddit') feedUrl = 'https://www.reddit.com';

    if (!feedUrl) continue;

    let tab = null;
    try {
      tab = await chrome.tabs.create({ url: feedUrl, active: false });
      tabIdsToClose.push(tab.id);
      await waitForTabComplete(tab.id, 20000);
      await new Promise((r) => setTimeout(r, 2000));

      const extractRes = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: (platformName, maxCount) => {
          const items = [];
          if (platformName === 'x' || platformName === 'twitter') {
            const articles = document.querySelectorAll('article[data-testid="tweet"]');
            for (const art of Array.from(articles).slice(0, maxCount)) {
              const author = art.querySelector('[data-testid="User-Name"]')?.innerText?.replace(/\n/g, ' ') || '';
              const tweetText = art.querySelector('[data-testid="tweetText"]')?.innerText || '';
              const time = art.querySelector('time')?.getAttribute('datetime') || new Date().toISOString();
              items.push({ platform: 'x', author, text: tweetText, time });
            }
          } else if (platformName === 'github') {
            const events = document.querySelectorAll('.dashboard-changelog, .js-feed-item-view, article, .feed-item');
            for (const ev of Array.from(events).slice(0, maxCount)) {
              const title = ev.querySelector('h3, h4, .Link--primary')?.innerText?.trim() || '';
              const body = ev.querySelector('.color-fg-muted, p')?.innerText?.trim() || '';
              items.push({ platform: 'github', author: 'GitHub', title, text: body, time: new Date().toISOString() });
            }
          } else if (platformName === 'linkedin') {
            const updates = document.querySelectorAll('.feed-shared-update-v2');
            for (const up of Array.from(updates).slice(0, maxCount)) {
              const author = up.querySelector('.update-components-actor__name')?.innerText?.trim() || '';
              const post = up.querySelector('.feed-shared-update-v2__description')?.innerText?.trim() || '';
              items.push({ platform: 'linkedin', author, text: post, time: new Date().toISOString() });
            }
          } else if (platformName === 'reddit') {
            const posts = document.querySelectorAll('shreddit-post, [data-testid="post-container"]');
            for (const p of Array.from(posts).slice(0, maxCount)) {
              const title = p.getAttribute('post-title') || p.querySelector('h1, h2, h3')?.innerText || '';
              const author = p.getAttribute('author') || '';
              const score = p.getAttribute('score') || '0';
              items.push({ platform: 'reddit', author, title, score, time: new Date().toISOString() });
            }
          }
          return items;
        },
        args: [plat, limit],
      });

      const extractedItems = (extractRes && extractRes[0] && extractRes[0].result) || [];
      clusterResults.push(...extractedItems);
    } catch (e) {
      clusterResults.push({ platform: plat, error: String((e && e.message) || e) });
    }
  }

  for (const tid of tabIdsToClose) {
    try { await chrome.tabs.remove(tid); } catch {}
  }

  return {
    ok: true,
    data: {
      totalItemsExtracted: clusterResults.filter((i) => !i.error).length,
      platformsQueried: targetPlatforms,
      feed: clusterResults,
    },
  };
}

async function socialDossier(args = {}) {
  const platform = String(args.platform || 'github').toLowerCase();
  const targetHandle = args.targetHandle ? String(args.targetHandle).trim().replace(/^@/, '') : '';
  const timeoutMs = Math.min(Number(args.timeoutMs) || 25000, 60000);

  let profileUrl = '';
  if (platform === 'github') {
    profileUrl = targetHandle ? `https://github.com/${targetHandle}` : 'https://github.com';
  } else if (platform === 'x' || platform === 'twitter') {
    profileUrl = targetHandle ? `https://x.com/${targetHandle}` : 'https://x.com';
  } else if (platform === 'linkedin') {
    profileUrl = targetHandle ? `https://www.linkedin.com/in/${targetHandle}/` : 'https://www.linkedin.com/in/me/';
  } else if (platform === 'reddit') {
    profileUrl = targetHandle ? `https://www.reddit.com/user/${targetHandle}/` : 'https://www.reddit.com/user/me/';
  }

  if (!profileUrl) return { ok: false, error: `Unsupported platform for dossier: ${platform}` };

  let tab = null;
  try {
    tab = await chrome.tabs.create({ url: profileUrl, active: false });
    await waitForTabComplete(tab.id, timeoutMs);
    await new Promise((r) => setTimeout(r, 2000));

    const dossierRes = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: (plat) => {
        if (plat === 'github') {
          const name = document.querySelector('.p-name, span[itemprop="name"], .vcard-fullname, h1.vcard-names span')?.innerText?.trim() || '';
          const username = document.querySelector('.p-nickname, span[itemprop="additionalName"], .vcard-username')?.innerText?.trim() || '';
          const bio = document.querySelector('.user-profile-bio, .p-note, [data-bio-text], .bio')?.innerText?.trim() || '';
          const followersRaw = document.querySelector('a[href*="followers"]')?.innerText?.trim() || '0';
          const followingRaw = document.querySelector('a[href*="following"]')?.innerText?.trim() || '0';
          const repos = document.querySelectorAll('.pinned-item-list-item-content, ol.pinned-items-list li, span.repo');
          const pinned = Array.from(repos).map((r) => (r.querySelector('span.repo, a.text-bold') || r)?.innerText?.trim()).filter(Boolean);
          const avatar = document.querySelector('img.avatar-user, img.avatar')?.src || '';
          return { platform: 'github', name, username, bio, followers: followersRaw, following: followingRaw, pinnedRepositories: pinned.slice(0, 6), avatar, url: window.location.href };
        }
        if (plat === 'x' || plat === 'twitter') {
          const name = document.querySelector('[data-testid="UserName"] span, [data-testid="UserName"]')?.innerText?.trim() || '';
          const bio = document.querySelector('[data-testid="UserDescription"]')?.innerText?.trim() || '';
          const followersEl = document.querySelector('a[href$="/verified_followers"] span, a[href$="/followers"] span');
          const followingEl = document.querySelector('a[href$="/following"] span');
          return { platform: 'x', name, bio, followers: followersEl?.innerText || '0', following: followingEl?.innerText || '0', url: window.location.href };
        }
        return { platform: plat, title: document.title, url: window.location.href };
      },
      args: [platform],
    });

    try { await chrome.tabs.remove(tab.id); } catch {}
    const data = (dossierRes && dossierRes[0] && dossierRes[0].result) || {};
    return { ok: true, data };
  } catch (err) {
    if (tab && tab.id) { try { await chrome.tabs.remove(tab.id); } catch {} }
    return { ok: false, error: `Dossier extraction failed: ${err.message}` };
  }
}

async function socialSearch(args = {}) {
  const platform = String(args.platform || 'github').toLowerCase();
  const query = String(args.query || '').trim();
  if (!query) return { ok: false, error: 'query is required for social search.' };
  const limit = Math.min(Number(args.limit) || 10, 30);
  const timeoutMs = Math.min(Number(args.timeoutMs) || 25000, 60000);

  let searchUrl = '';
  if (platform === 'github') {
    searchUrl = `https://github.com/search?q=${encodeURIComponent(query)}&type=repositories`;
  } else if (platform === 'x' || platform === 'twitter') {
    searchUrl = `https://x.com/search?q=${encodeURIComponent(query)}&f=live`;
  } else if (platform === 'reddit') {
    searchUrl = `https://www.reddit.com/search/?q=${encodeURIComponent(query)}`;
  }

  if (!searchUrl) return { ok: false, error: `Platform ${platform} search not implemented yet.` };

  let tab = null;
  try {
    tab = await chrome.tabs.create({ url: searchUrl, active: false });
    await waitForTabComplete(tab.id, timeoutMs);
    await new Promise((r) => setTimeout(r, 2000));

    const searchRes = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: (plat, maxCount) => {
        const results = [];
        if (plat === 'github') {
          const items = document.querySelectorAll('[data-testid="results-list"] > div, .repo-list-item, div.search-title, ul.repo-list > li, [data-testid="search-results"] article');
          for (const item of Array.from(items).slice(0, maxCount)) {
            const title = item.querySelector('h3 a, a.v-align-middle, a[data-testid="search-result-title"], a.Link--primary')?.innerText?.trim() || '';
            const desc = item.querySelector('.search-match, p, div[data-testid="search-result-description"]')?.innerText?.trim() || '';
            const stars = item.querySelector('[aria-label*="star"], a[href$="/stargazers"], span[data-testid="search-result-star-count"]')?.innerText?.trim() || '0';
            const link = item.querySelector('h3 a, a.v-align-middle, a[data-testid="search-result-title"], a.Link--primary')?.getAttribute('href') || '';
            if (title || link) {
              results.push({ title, description: desc, stars, link: link.startsWith('http') ? link : `https://github.com${link}` });
            }
          }
        } else if (plat === 'x' || plat === 'twitter') {
          const tweets = document.querySelectorAll('article[data-testid="tweet"]');
          for (const t of Array.from(tweets).slice(0, maxCount)) {
            const author = t.querySelector('[data-testid="User-Name"]')?.innerText?.replace(/\n/g, ' ') || '';
            const text = t.querySelector('[data-testid="tweetText"]')?.innerText || '';
            results.push({ author, text });
          }
        } else if (plat === 'reddit') {
          const posts = document.querySelectorAll('shreddit-post, [data-testid="post-container"]');
          for (const p of Array.from(posts).slice(0, maxCount)) {
            const title = p.getAttribute('post-title') || p.querySelector('h1, h2, h3')?.innerText || '';
            const author = p.getAttribute('author') || '';
            const link = p.getAttribute('permalink') || '';
            results.push({ title, author, link });
          }
        }
        return results;
      },
      args: [platform, limit],
    });

    try { await chrome.tabs.remove(tab.id); } catch {}
    const items = (searchRes && searchRes[0] && searchRes[0].result) || [];
    return { ok: true, data: { platform, query, count: items.length, results: items } };
  } catch (err) {
    if (tab && tab.id) { try { await chrome.tabs.remove(tab.id); } catch {} }
    return { ok: false, error: `Social search failed: ${err.message}` };
  }
}

// ── Registration / heartbeat ──
export async function registerWebBridge() {
  let tab = null;
  try {
    const [t] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (t && t.url && !RESTRICTED_TAB.test(t.url)) tab = { url: t.url, title: t.title };
  } catch { /* browser has no usable tab yet */ }
  try {
    const s = await getSettings();
    await hubFetch('/api/web/register', {
      method: 'POST',
      body: {
        webAccessEnabled: s.webAccessEnabled !== false,
        tab,
        userAgent: navigator.userAgent,
        browserId: SELF_BROWSER.id,
        browserName: SELF_BROWSER.name,
      },
    });
  } catch { /* hub offline — presence simply stays stale */ }
}

export async function handleWebRequest(req) {
  const { id, tool, args = {} } = req || {};
  // Multi-browser targeting: a request aimed at another connected browser is
  // not ours — stay silent so the right install answers and the hub does not
  // resolve twice (late results 404 harmlessly, but silence is cleaner).
  if (args.__browser && !selfBrowserMatches(args.__browser)) return;
  let out;
  const s = await getSettings();
  if (!s.webAccessEnabled) {
    out = { ok: false, error: 'Web access is disabled. Enable the "Web access for AI agents" toggle in the ScreenSync extension dashboard.' };
  } else {
    try {
      out = await executeWebTool(tool, args);
    } catch (e) {
      out = { ok: false, error: String((e && e.message) || e) };
    }
  }
  try {
    await hubFetch('/api/web/result', { method: 'POST', body: { id, ok: !!out.ok, data: out.data, error: out.error } });
  } catch { /* hub gone — nothing to resolve */ }
}