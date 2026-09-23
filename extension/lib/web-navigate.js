// web_navigate: open a URL in a new tab, or load it in the target tab.
//
// Two bugs seen live on 2026-09-23 (an agent window open, the person browsing in their own
// window) and fixed here:
//   1. newTab still attached the beforeunload guard (a CDP session) to the CURRENT tab - the
//      tab the person was using - although a new tab unloads nothing. When that attach hung,
//      the whole call hung until the hub's 45 s timeout and no tab ever opened.
//   2. web_agent_window promises "New tabs will open here", but chrome.tabs.create had no
//      windowId, so the new tab opened wherever Chrome chose (the person's window).
// Now: a new tab gets no guard, opens in the agent window when one is open (falling back to
// Chrome's choice if that window is gone), and the same-tab guard is bounded so a hung CDP
// attach can no longer stall a navigation.

import { pickActiveTab, waitForTabComplete, groupAgentTab } from './tab-resolve.js';
import { agentWindowStatus } from './web-agent-window.js';

/** How long the beforeunload guard may take before the navigation goes ahead without it. */
export const GUARD_TIMEOUT_MS = 4000;

/** Resolves with the promise's value, or null after ms - whichever comes first. */
function within(promise, ms) {
  let timer;
  const expiry = new Promise((resolve) => {
    timer = setTimeout(() => resolve(null), ms);
  });
  return Promise.race([promise, expiry]).finally(() => clearTimeout(timer));
}

/**
 * @param {Record<string, any>} args  validated web_navigate args (url is http(s))
 * @param {(tool: string, tab: any, args: any) => Promise<any>} execAdvTool  the CDP tool runner
 */
export async function execWebNavigate(args, execAdvTool) {
  const url = String(args.url || '');

  if (args.newTab) {
    const agent = await agentWindowStatus();
    let tab = null;
    if (agent.active) {
      // The agent window may have been closed by the person: fall back instead of failing.
      tab = await chrome.tabs.create({ url, windowId: agent.windowId, active: true }).catch(() => null);
    }
    if (!tab) tab = await chrome.tabs.create({ url });
    if (tab.id) groupAgentTab(tab.id);
    await waitForTabComplete(tab.id, 20000);
    const after = await chrome.tabs.get(tab.id);
    return {
      ok: true,
      data: {
        tabId: tab.id,
        windowId: after.windowId,
        url: after.url,
        title: after.title,
        status: after.status,
        inAgentWindow: !!agent.active && after.windowId === agent.windowId,
      },
    };
  }

  const current = await pickActiveTab(args);
  // A page with unsaved state raises the native beforeunload dialog on navigation. It is
  // browser chrome, not DOM, so no DOM tool can dismiss it and the navigation would hang.
  // Attach a CDP session first so the dialog is accepted (the caller asked to navigate);
  // acceptBeforeUnload:false leaves the page alone instead. Bounded: see GUARD_TIMEOUT_MS.
  const guard = args.acceptBeforeUnload === false
    ? null
    : await within(execAdvTool('web_dialog_rule', current, { action: 'accept' }).catch(() => null), GUARD_TIMEOUT_MS);
  const tab = await chrome.tabs.update(current.id, { url });
  await waitForTabComplete(tab.id, 20000);
  if (guard && guard.ok) {
    await within(execAdvTool('web_dialog_rule', tab, { action: 'clear' }).catch(() => null), GUARD_TIMEOUT_MS);
  }
  const after = await chrome.tabs.get(tab.id);
  return { ok: true, data: { tabId: tab.id, url: after.url, title: after.title, status: after.status } };
}
