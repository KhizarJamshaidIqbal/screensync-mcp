// ScreenSync Browser Extension — Web Bridge Dispatcher
// Resolves active tabs safely, checks grants & actionability and dispatches to the specialised units;
// web-bridge.js receives the hub's requests, runs them through the approval gate, then calls executeWebTool.

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
import { execWebPopupWait, getRecentPopups } from './web-popup.js';
import { execWebTakeover, execWebRequestHelp } from './takeover.js';
import { buildVom } from './web-vom-engine.js';
import { readLongScreenshotTile } from './web-long-screenshot.js';
import { execWebAgentWindow } from './web-agent-window.js';
import { execWebSiteMemory } from './site-memory.js';
import { execCognitiveTool } from './cognitive-memory-ext.js';
import { apiFetch } from './web-api-fetch.js';
import { historySearch, bookmarksSearch } from './web-browser-data.js';
import { getProfileIdentity, setProfileIdentity, RUNTIME_ID, BROWSER_NAME } from './profile-identity.js';
import { execTabGroup } from './web-tab-groups.js';
import { pickActiveTab, isRestrictedTab, waitForTabComplete, groupAgentTab } from './tab-resolve.js';
import { makeError, ERROR_CODES } from './errors.js';
import { getAuditLog, clearAuditLog, exportAuditLog } from './audit.js';
import { execWebTabs, execWebTab, execWebWindow, execTabPool, execSandboxGroup } from './web-tab-mgmt.js';
import { execWebScreenshot } from './web-screenshot.js';
import { validateToolArgs } from './validate.js';
import { registerWebBridge } from './web-bridge.js';
import {
  getOriginGrant,
  isLoopbackOrTestOrigin,
  recordExtraction,
  getExtractionBudget,
  checkOriginPermission,
} from './consent.js';

const INTERACT_TOOLS = new Set([
  'web_click', 'web_type', 'web_paste', 'web_clear', 'web_highlight', 'web_scroll',
  'web_drag_and_drop',
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
export const isActTool = (tool) => INTERACT_TOOLS.has(tool) || AGENT_ACTION_TOOLS.has(tool); // needs the owner's `act` grant

export const SELF_BROWSER = {
  id: RUNTIME_ID,
  name: BROWSER_NAME,
};

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
    case 'web_extension_dashboard': {
      const tab = await chrome.tabs.create({ url: chrome.runtime.getURL('pages/dashboard.html') });
      return { ok: true, data: { opened: true, tabId: tab.id, url: tab.url, message: 'Opened the ScreenSync dashboard in a new tab.' } };
    }
    case 'web_extension_side_panel': {
      // chrome.sidePanel.open() is only permitted while a real user gesture is live.
      // An agent tool call has none, so this cannot be forced open from here. Report
      // that honestly instead of pretending, and let the caller ask the user.
      let opened = false;
      let reason = '';
      try {
        if (chrome.sidePanel && chrome.sidePanel.open) {
          let windowId = null;
          try {
            const [t] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
            if (t) windowId = t.windowId;
          } catch {}
          if (windowId == null) {
            try { windowId = (await chrome.windows.getCurrent()).id; } catch {}
          }
          await chrome.sidePanel.open(windowId != null ? { windowId } : {});
          opened = true;
        } else {
          reason = 'The sidePanel API is unavailable in this Chrome version.';
        }
      } catch (e) {
        reason = (e && e.message) || String(e);
      }
      if (!opened) {
        return {
          ok: true,
          data: {
            opened: false,
            requiresUserGesture: true,
            reason: reason || 'Chrome requires a user gesture to open the side panel.',
            hint: 'Ask the user to click the extension icon and press "Side Panel", or to press Alt+Shift+D. No agent can open it, because the call must happen inside a real click.',
          },
        };
      }
      return { ok: true, data: { opened: true } };
    }
    case 'web_extension_settings': {
      const s = await getSettings();
      return {
        ok: true,
        data: {
          hubUrl: s.hubUrl,
          onboardingComplete: s.onboardingComplete === true,
          webAccessEnabled: s.webAccessEnabled === true,
          theme: s.theme,
          tokenConfigured: typeof s.token === 'string' && s.token.length > 0,
          grantsCount: s.grants && typeof s.grants === 'object' ? Object.keys(s.grants).length : 0,
          readOnly: true,
          note: 'webAccessEnabled is deliberately read-only over MCP: an agent must not be able to re-enable its own access after the user turns it off. The user changes it on the dashboard Web Access tab.',
        },
      };
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
    case 'web_screenshot': return execWebScreenshot(args);
    case 'web_navigate': {
      const url = String(args.url || '');
      if (!/^https?:/i.test(url)) return makeError(ERROR_CODES.BAD_ARGS, 'Only http(s) URLs are supported.');
      const current = await pickActiveTab(args);
      // A page with unsaved state raises the native beforeunload dialog on navigation.
      // It is browser chrome, not DOM, so no DOM tool can dismiss it and the navigation
      // would hang until timeout. Attach a CDP session first so the dialog event is
      // received, and accept it because the caller asked to navigate. Pass
      // acceptBeforeUnload:false to leave the page alone instead.
      const guard = args.acceptBeforeUnload === false
        ? null
        : await execAdvTool('web_dialog_rule', current, { action: 'accept' }).catch(() => null);
      const tab = args.newTab ? await chrome.tabs.create({ url }) : await chrome.tabs.update(current.id, { url });
      if (args.newTab && tab.id) groupAgentTab(tab.id);
      await waitForTabComplete(tab.id, 20000);
      if (guard && guard.ok) await execAdvTool('web_dialog_rule', tab, { action: 'clear' }).catch(() => null);
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
      // Same beforeunload guard as web_navigate: an unsaved page would otherwise raise a
      // native dialog that nothing can click, and the reload would hang.
      const guard = args.acceptBeforeUnload === false
        ? null
        : await execAdvTool('web_dialog_rule', tab, { action: 'accept' }).catch(() => null);
      await chrome.tabs.reload(tab.id, { bypassCache: !!args.bypassCache });
      await waitForTabComplete(tab.id, 20000);
      if (guard && guard.ok) await execAdvTool('web_dialog_rule', tab, { action: 'clear' }).catch(() => null);
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
    case 'web_tab_group': return execTabGroup(args);    case 'web_in_frame': {
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
    case 'web_profile': {
      const action = String(args.action || 'get');
      if (action === 'configure' || action === 'set') {
        const updated = await setProfileIdentity(args);
        await registerWebBridge();
        return { ok: true, data: { updated: true, identity: updated } };
      }
      const id = await getProfileIdentity();
      return { ok: true, data: { identity: id } };
    }
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
        if (!isSafeOrigin && !args.__humanApproved) {
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
      // Read-only by design (2026-09-14). The origin grants reported here ARE the user's
      // consent record, so an agent must not be able to grant or revoke its own access -
      // that would turn the user's consent UI into a suggestion. Grants are managed on
      // the dashboard's Web Access tab only.
      const action = String(args.action || 'list');
      if (action !== 'list') {
        return makeError(ERROR_CODES.BAD_ARGS, `web_consent is read-only; unsupported action: '${action}'. Manage grants in the extension dashboard.`);
      }
      return {
        ok: true,
        data: {
          grants: await getOriginGrant(args.origin || 'unknown'),
          budget: getExtractionBudget(),
          readOnly: true,
        },
      };
    }
    case 'web_popup_wait': {
      const tab = await pickActiveTab(args);
      return execWebPopupWait(tab ? tab.id : null, args);
    }
    case 'web_takeover': {
      const tab = await pickActiveTab(args);
      return execWebTakeover(tab ? tab.id : null, args);
    }
    case 'web_request_help': {
      const tab = await pickActiveTab(args);
      return execWebRequestHelp(tab ? tab.id : null, args);
    }
    case 'web_page_observe': {
      const tab = await pickActiveTab(args);
      if (isRestrictedTab(tab)) return makeError(ERROR_CODES.RESTRICTED_PAGE, `Cannot observe restricted tab (${tab.url}).`);
      return buildVom(tab, args);
    }
    case 'web_screenshot_read': {
      return readLongScreenshotTile(args.captureId, args.tileIndex || 0);
    }
    case 'web_agent_window': {
      const tab = await pickActiveTab(args).catch(() => null);
      return execWebAgentWindow(tab ? tab.id : null, args);
    }
    case 'web_site_memory': {
      const tab = await pickActiveTab(args);
      return execWebSiteMemory(tab ? tab.id : null, args);
    }
    case 'web_recall': case 'web_learn': case 'web_warm': case 'web_consolidate': case 'web_graph_query': case 'web_contract_check': case 'web_lineage': case 'web_metacognition': case 'web_similarity_search':
    case 'web_federated_catalog': case 'web_cognitive_stage': case 'web_cognitive_replay': case 'web_episodic_query': case 'web_cognitive_hygiene': case 'web_object_permanence': case 'web_theory_of_mind':
    case 'web_cognitive_undo': case 'web_rpd_prototype': case 'web_cognitive_maturation': case 'web_epistemic_graph': case 'web_curiosity_frontier': case 'web_homeostatic_regulation': case 'web_cognitive_lifespan': case 'web_graph_pattern_match': case 'web_motor_babbling': case 'web_metaphoric_transfer': case 'web_synaptic_pruning': case 'web_critical_period': case 'web_working_memory_span': case 'web_executive_function': case 'web_erikson_identity': case 'web_autonoetic_memory': case 'web_infant_error_signature': case 'web_wisdom_calibration': case 'web_assimilation_accommodation': case 'web_forgetting_curve': case 'web_reinforcement_schedule': case 'web_prospective_memory': case 'web_source_monitoring': case 'web_interference_check': case 'web_reward_prediction_error': case 'web_cognitive_load_budget':
    case 'web_rem_dream_simulation': case 'web_system1_reflex_compile': case 'web_amygdala_threat_inoculation': case 'web_zpd_scaffold_tutor': case 'web_somatic_marker_risk': case 'web_baddeley_working_memory': case 'web_dialectical_synthesis': case 'web_generative_wisdom_capsule':
      return execCognitiveTool(tool, args);
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
        const prePopups = (INTERACT_TOOLS.has(tool) || AGENT_ACTION_TOOLS.has(tool)) ? getRecentPopups(tab.id) : [];
        const res = await inject(tab, { ...args, __tool: tool, __actGranted: !!grant.act });
        if (res && res.ok && (INTERACT_TOOLS.has(tool) || AGENT_ACTION_TOOLS.has(tool))) {
          const postPopups = getRecentPopups(tab.id);
          if (postPopups.length > prePopups.length) {
            const newPopup = postPopups[postPopups.length - 1];
            if (typeof res.data === 'object' && res.data !== null) {
              res.data.newTabOpened = { tabId: newPopup.tabId, url: newPopup.url, title: newPopup.title };
            }
          }
        }
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
