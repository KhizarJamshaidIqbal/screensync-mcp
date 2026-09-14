// ScreenSync Frame Bridge — run any interact/agent/extract tool inside a
// specific iframe (Playwright frameLocator parity). Resolves the frame via
// chrome.webNavigation.getAllFrames, then injects the chosen unit with
// chrome.scripting target.frameIds.

import { ssWebUnitInteract } from './web-unit-interact.js';
import { ssWebUnitExtract } from './web-unit-extract.js';
import { ssWebUnitPerception } from './web-unit-perception.js';
import { ssWebUnitAction } from './web-unit-action.js';

const RESTRICTED_TAB = /^(chrome|edge|view-source|devtools|chrome-extension):/;
const INTERACT_TOOLS = new Set(['web_click', 'web_type', 'web_paste', 'web_clear', 'web_highlight', 'web_scroll', 'web_upload_file', 'web_drag_and_drop']);
const PERCEPTION_TOOLS = new Set(['web_expect', 'web_aria_snapshot', 'web_table_extract', 'web_media_extract', 'web_actionable']);
const ACTION_TOOLS = new Set(['web_get_by', 'web_fill', 'web_check', 'web_focus', 'web_scroll_to', 'web_run_code']);

export async function execInFrame(tab, args) {
  const innerTool = String(args.tool || '');
  if (!/^web_[a-z_]+$/.test(innerTool)) return { ok: false, error: 'web_in_frame requires tool (a web_* tool to run inside the frame).' };
  if (!INTERACT_TOOLS.has(innerTool) && !PERCEPTION_TOOLS.has(innerTool) && !ACTION_TOOLS.has(innerTool) && !['web_find', 'web_scrape_schema', 'web_dom_diff', 'web_som_overlay', 'web_remove_overlay', 'web_assert', 'web_markdown_extract'].includes(innerTool)) {
    return { ok: false, error: `Tool ${innerTool} is not a frame-scopable page tool. Use interact/agent/extract tools (web_click, web_fill, web_expect, ...).` };
  }
  let frames;
  try {
    frames = await chrome.webNavigation.getAllFrames({ tabId: tab.id });
  } catch (e) {
    return { ok: false, error: `getAllFrames failed: ${String((e && e.message) || e)}` };
  }
  const usable = (frames || []).filter((f) => f.frameId !== 0 && !f.errorOccurred && f.url && !RESTRICTED_TAB.test(f.url));
  if (!usable.length) return { ok: false, error: 'No accessible sub-frames on this tab.' };

  let frame = null;
  if (typeof args.frameId === 'number') {
    frame = usable.find((f) => f.frameId === args.frameId);
    if (!frame) return { ok: false, error: `frameId ${args.frameId} not found or restricted. Available: ${usable.map((f) => `${f.frameId}(${f.url.slice(0, 60)})`).join(', ')}` };
  } else if (args.frameUrl) {
    const needle = String(args.frameUrl).toLowerCase();
    frame = usable.find((f) => f.url.toLowerCase().includes(needle));
    if (!frame) return { ok: false, error: `No frame URL contains "${args.frameUrl}". Available: ${usable.map((f) => f.url.slice(0, 60)).join(' | ')}` };
  } else {
    return { ok: false, error: 'web_in_frame requires frameId (from web_frame_tree) or frameUrl substring.' };
  }

  const fn = INTERACT_TOOLS.has(innerTool) ? ssWebUnitInteract
    : PERCEPTION_TOOLS.has(innerTool) ? ssWebUnitPerception
    : ACTION_TOOLS.has(innerTool) ? ssWebUnitAction
    : ssWebUnitExtract;
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id, frameIds: [frame.frameId] },
      func: fn,
      args: [{ ...args.args, __tool: innerTool }],
    });
    const out = (results && results[0] && results[0].result) || { ok: false, error: 'Frame injection returned no result.' };
    if (out && typeof out === 'object') out.frameId = frame.frameId, out.frameUrl = frame.url;
    return out;
  } catch (e) {
    return { ok: false, error: `Cannot access frame ${frame.frameId}: ${String((e && e.message) || e)}`, frameId: frame.frameId, frameUrl: frame.url };
  }
}
