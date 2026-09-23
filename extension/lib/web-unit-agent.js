// ScreenSync Agent Unit — Playwright-grade assertions, snapshots, structured reads & actions
// Unified facade dispatching to ssWebUnitPerception, ssWebUnitTable and ssWebUnitAction

import { ssWebUnitPerception } from './web-unit-perception.js';
import { ssWebUnitTable } from './web-unit-table.js';
import { ssWebUnitAction } from './web-unit-action.js';

export async function ssWebUnitAgent(args = {}) {
  const tool = (args && args.__tool) || '';
  if (tool === 'web_table_extract') return ssWebUnitTable(args);
  if (['web_expect', 'web_aria_snapshot', 'web_media_extract', 'web_actionable'].includes(tool)) {
    return ssWebUnitPerception(args);
  }
  return ssWebUnitAction(args);
}

export { ssWebUnitPerception, ssWebUnitTable, ssWebUnitAction };
