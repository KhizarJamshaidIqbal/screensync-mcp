// While an approval dialog is showing on a page, the agent's trusted input to that page is paused.
//
// The in-page approval dialog (approval-dialog.js) accepts only a trusted pointer click, which page script can
// never forge. But web_cdp_click, web_mouse, web_cdp_type and web_key_combo drive the page through the Chrome
// DevTools Protocol, and CDP input IS trusted: an agent could click Approve on its own request. So while the
// dialog is up on a tab, those tools refuse to touch that tab. Untrusted input (web_click, web_touch, a
// script's .click()) cannot approve anything and is left alone.

import { makeError } from './errors.js';

/** Tools that send trusted (CDP) mouse or keyboard input to a page. */
export const TRUSTED_INPUT_TOOLS = new Set(['web_cdp_click', 'web_cdp_type', 'web_mouse', 'web_key_combo']);

const guarded = new Set(); // tab ids with an approval dialog up

export function guardTab(tabId) { if (Number.isInteger(tabId)) guarded.add(tabId); }
export function releaseTab(tabId) { guarded.delete(tabId); }
export function isTabGuarded(tabId) { return guarded.has(tabId); }

/** The refusal for `tool` on `tabId`, or null when it may run. */
export function trustedInputRefusal(tool, tabId) {
  if (!TRUSTED_INPUT_TOOLS.has(tool) || !guarded.has(tabId)) return null;
  return makeError('APPROVAL_PENDING',
    `${tool} was not run: a ScreenSync approval dialog is showing on this tab, and trusted mouse and keyboard input to it is paused until the user answers (it could click the dialog). Wait for the call that is waiting for approval to finish, then retry.`,
    true);
}
