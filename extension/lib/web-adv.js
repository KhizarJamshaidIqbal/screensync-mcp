// ScreenSync Advanced Web Tools — facade + tool dispatch. CDP infrastructure
// lives in web-adv-core.js; executors in web-adv-{units,input,capture,net,
// eval,record,device}.js. Facade kept under the AGENTS.md §2 line budget.
import { ssReadBuffer, ssEval, ssStorage, ssPerf, ssWaitFor, ssKey, ssHover, ssSelect, ensureHooks, main, isolated } from './web-adv-units.js';
import { attachCdp, detachCdp } from './web-adv-core.js';
import { cdpWaitNetworkIdle } from './web-adv-net.js';
import { cdpInput, cdpUploadFile, cdpKeyCombo, cdpMouse, cdpTouch, cdpHumanMouse, cdpHumanType, cdpHumanScroll, cdpClipboard } from './web-adv-input.js';
import { cdpScreenshot, cdpPdf, cdpElementScreenshot, cdpAXTree, cdpExportHar, cdpCoverage, cdpScreencast, cdpMhtml } from './web-adv-capture.js';
import { cdpNetworkMock, cdpRoute, cdpDialogRule, cdpWaitForResponse, cdpWaitForRequest, cdpWebSocketTraffic, cdpNetworkAuth, cdpCacheControl, cdpNetworkRules } from './web-adv-net.js';
import { cdpEmulate, cdpGrantPermissions, cdpSetTimezone, cdpSetGeolocation, cdpThrottleNetwork, cdpSetColorScheme, cdpEmulateMedia } from './web-adv-emulate.js';
import { cdpEval, cdpRunCode } from './web-adv-eval.js';
import { cdpHarRecord, cdpVideoRecord, cdpClockSet, cdpClockClear, cdpClockFastForward, cdpTraceRecord } from './web-adv-record.js';
import { handleWebHandle } from './web-handles.js';
import { cdpServiceWorker } from './web-adv-worker.js';

export { attachCdp, detachCdp, cdpWaitNetworkIdle, ensureHooks };

export async function execAdvTool(tool, tab, args) {
  switch (tool) {
    case 'web_eval': {
      const res = await main(tab, ssEval, args);
      if (!res.ok && res.error && (res.error.includes('Content Security Policy') || res.error.includes('violates the following'))) {
        return cdpEval(tab, args);
      }
      return res;
    }
    case 'web_console': await ensureHooks(tab); return main(tab, ssReadBuffer, { ...args, kind: 'console' });
    case 'web_network': await ensureHooks(tab); return main(tab, ssReadBuffer, { ...args, kind: 'network' });
    case 'web_dialog': await ensureHooks(tab); return main(tab, ssReadBuffer, { ...args, kind: 'dialog' });
    case 'web_storage': return main(tab, ssStorage, args);
    case 'web_perf': return main(tab, ssPerf, args);
    case 'web_wait_for': return isolated(tab, ssWaitFor, args);
    case 'web_key': return isolated(tab, ssKey, args);
    case 'web_hover': return isolated(tab, ssHover, args);
    case 'web_select': return isolated(tab, ssSelect, args);
    case 'web_cdp_click': return cdpInput(tab, 'click', args);
    case 'web_cdp_type': return cdpInput(tab, 'type', args);
    case 'web_full_screenshot': return cdpScreenshot(tab, args);
    case 'web_pdf': return cdpPdf(tab, args);
    case 'web_mhtml': return cdpMhtml(tab, args);
    case 'web_cdp_eval': return cdpEval(tab, args);
    case 'web_a11y_tree': return cdpAXTree(tab, args);
    case 'web_export_har': return cdpExportHar(tab, args);
    case 'web_human_mouse': return cdpHumanMouse(tab, args);
    case 'web_network_mock': return cdpNetworkMock(tab, args);
    case 'web_network_auth': return cdpNetworkAuth(tab, args);
    case 'web_cache_control': return cdpCacheControl(tab, args);
    case 'web_element_screenshot': return cdpElementScreenshot(tab, args);
    case 'web_emulate': return cdpEmulate(tab, args);
    case 'web_upload_file': return cdpUploadFile(tab, args);
    case 'web_key_combo': return cdpKeyCombo(tab, args);
    case 'web_mouse': return cdpMouse(tab, args);
    case 'web_touch': return cdpTouch(tab, args);
    case 'web_grant_permissions': return cdpGrantPermissions(tab, args);
    case 'web_set_timezone': return cdpSetTimezone(tab, args);
    case 'web_route': return cdpRoute(tab, args);
    case 'web_dialog_rule': return cdpDialogRule(tab, args);
    case 'web_coverage': return cdpCoverage(tab, args);
    case 'web_set_geolocation': return cdpSetGeolocation(tab, args);
    case 'web_throttle_network': return cdpThrottleNetwork(tab, args);
    case 'web_set_color_scheme': return cdpSetColorScheme(tab, args);
    case 'web_emulate_media': return cdpEmulateMedia(tab, args);
    case 'web_clipboard': return cdpClipboard(tab, args);
    case 'web_wait_for_response': return cdpWaitForResponse(tab, args);
    case 'web_wait_for_request': return cdpWaitForRequest(tab, args);
    case 'web_websocket_traffic': return cdpWebSocketTraffic(tab, args);
    case 'web_human_type': return cdpHumanType(tab, args);
    case 'web_human_scroll': return cdpHumanScroll(tab, args);
    case 'web_screencast': return cdpScreencast(tab, args);
    case 'web_run_code': return cdpRunCode(tab, args);
    case 'web_har_record': return cdpHarRecord(tab, args);
    case 'web_trace_record': return cdpTraceRecord(tab, args);
    case 'web_video_record': return cdpVideoRecord(tab, args);
    case 'web_clock_set': return cdpClockSet(tab, args);
    case 'web_clock_fast_forward': return cdpClockFastForward(tab, args);
    case 'web_clock_clear': return cdpClockClear(tab, args);
    case 'web_network_rules': return cdpNetworkRules(tab, args);
    case 'web_handle': return handleWebHandle(tab, args);
    case 'web_service_worker': return cdpServiceWorker(tab, args);
    default: return { ok: false, error: `Unknown advanced tool: ${tool}` };
  }
}

