// ScreenSync Agent Window Manager (Phase 4 — BrowserSkill parity)
// Provides optional isolated-window mode for agent tasks with visual amber border.
// Agent tabs are created in this window; accessing user tabs requires borrowing approval.

let agentWindow = null; // { windowId, createdAt, borrowedTabs: Map<tabId, origWindowId> }

/**
 * Create a dedicated agent window with visual amber breathing border.
 */
export async function createAgentWindow(_args = {}) {
  if (agentWindow) {
    return { ok: true, data: { windowId: agentWindow.windowId, alreadyActive: true } };
  }
  const win = await chrome.windows.create({
    type: 'normal',
    state: 'normal',
    focused: true,
    url: 'about:blank',
  });
  agentWindow = { windowId: win.id, createdAt: Date.now(), borrowedTabs: new Map() };

  // Inject amber breathing border into each tab in the agent window
  for (const tab of win.tabs || []) {
    injectAgentBorder(tab.id).catch(() => {});
  }

  // Listen for new tabs in the agent window to inject border
  chrome.tabs.onCreated.addListener(onAgentTabCreated);

  return {
    ok: true,
    data: {
      windowId: win.id,
      message: 'Agent window created. New tabs will open here. To use an existing user tab, it must be borrowed with approval.',
    },
  };
}

function onAgentTabCreated(tab) {
  if (!agentWindow || tab.windowId !== agentWindow.windowId) return;
  chrome.tabs.onUpdated.addListener(function listener(tabId, info) {
    if (tabId !== tab.id || info.status !== 'complete') return;
    chrome.tabs.onUpdated.removeListener(listener);
    injectAgentBorder(tabId).catch(() => {});
  });
}

async function injectAgentBorder(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        if (document.getElementById('ss-agent-border')) return;
        const el = document.createElement('div');
        el.id = 'ss-agent-border';
        el.style.cssText = [
          'position:fixed', 'inset:0', 'pointer-events:none', 'z-index:2147483647',
          'box-shadow:inset 0 0 20px 4px rgba(249,115,22,0.25)',
          'animation:ss-breathe 2s ease-in-out infinite', 'transition:box-shadow 0.3s',
        ].join(';');
        const style = document.createElement('style');
        style.textContent = `@keyframes ss-breathe {
          0%,100% { box-shadow: inset 0 0 20px 4px rgba(249,115,22,0.18); }
          50%     { box-shadow: inset 0 0 28px 6px rgba(249,115,22,0.35); }
        }`;
        document.head.appendChild(style);
        document.body.appendChild(el);
      },
    });
  } catch {}
}

/**
 * Close the agent window and return any borrowed tabs.
 */
export async function closeAgentWindow() {
  if (!agentWindow) return { ok: false, error: 'No agent window is active.' };
  const { windowId, borrowedTabs } = agentWindow;

  // Return borrowed tabs to their original windows
  for (const [tabId, origWindowId] of borrowedTabs) {
    try {
      await chrome.tabs.move(tabId, { windowId: origWindowId, index: -1 });
    } catch {}
  }

  // Remove listener
  chrome.tabs.onCreated.removeListener(onAgentTabCreated);

  try {
    await chrome.windows.remove(windowId);
  } catch {}
  agentWindow = null;
  return { ok: true, data: { closed: true } };
}

/**
 * Get agent window status.
 */
export function getAgentWindowStatus() {
  if (!agentWindow) return { active: false };
  return {
    active: true,
    windowId: agentWindow.windowId,
    createdAt: agentWindow.createdAt,
    elapsedMs: Date.now() - agentWindow.createdAt,
    borrowedTabCount: agentWindow.borrowedTabs.size,
  };
}

/**
 * Check whether a tab requires borrowing approval (not in the agent window).
 */
export function requiresBorrowing(_tabId) {
  if (!agentWindow) return false;
  return true; // In agent-window mode, all operations check borrow status
}

/**
 * Record that a tab has been borrowed (after user approval).
 */
export async function borrowTab(tabId) {
  if (!agentWindow) return { ok: false, error: 'No agent window active.' };
  const tab = await chrome.tabs.get(tabId);
  if (tab.windowId === agentWindow.windowId) {
    return { ok: true, data: { alreadyInAgentWindow: true } };
  }
  agentWindow.borrowedTabs.set(tabId, tab.windowId);
  return { ok: true, data: { borrowed: true, originalWindowId: tab.windowId } };
}

/**
 * Return a borrowed tab to its original window.
 */
export async function returnTab(tabId) {
  if (!agentWindow || !agentWindow.borrowedTabs.has(tabId)) {
    return { ok: false, error: 'Tab was not borrowed.' };
  }
  const origWindowId = agentWindow.borrowedTabs.get(tabId);
  try {
    await chrome.tabs.move(tabId, { windowId: origWindowId, index: -1 });
  } catch {}
  agentWindow.borrowedTabs.delete(tabId);
  return { ok: true, data: { returned: true } };
}

/**
 * Handle the web_agent_window tool call.
 */
export async function execWebAgentWindow(tabId, args = {}) {
  const action = String(args.action || 'status');
  switch (action) {
    case 'create': return createAgentWindow(args);
    case 'close': return closeAgentWindow();
    case 'status': return { ok: true, data: getAgentWindowStatus() };
    case 'borrow': return borrowTab(Number(args.targetTabId || tabId));
    case 'return': return returnTab(Number(args.targetTabId || tabId));
    default: return { ok: false, error: `Unknown action: ${action}` };
  }
}
