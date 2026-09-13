// ScreenSync Unified Web Unit (Router & Master Facade)
// Adheres strictly to AGENTS.md: Modular, clean architecture (< 100 lines)

import { ssWebUnitInteract } from './web-unit-interact.js';
import { ssWebUnitExtract } from './web-unit-extract.js';

export { ssWebUnitInteract } from './web-unit-interact.js';
export { ssWebUnitExtract } from './web-unit-extract.js';

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

/**
 * Universal dispatcher for page-side execution.
 * When called inside Node or directly, routes to the specialized engine.
 * When serialized via chrome.scripting.executeScript, executes the appropriate submodule.
 */
export async function ssWebUnit(args) {
  const tool = args && args.__tool ? args.__tool : '';
  if (INTERACT_TOOLS.has(tool)) {
    return ssWebUnitInteract(args);
  }
  return ssWebUnitExtract(args);
}
