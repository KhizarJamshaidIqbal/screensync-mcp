// ScreenSync Tab & Window Management (Playwright & Multi-Tab Parity)
// Modular single-responsibility unit under 300 lines.

import { pickActiveTab, groupAgentTab, waitForTabComplete, isRestrictedTab } from './tab-resolve.js';
import { makeError, ERROR_CODES } from './errors.js';

export async function execWebTabs(args = {}) {
  let tabs;
  if (args.windowId) {
    tabs = await chrome.tabs.query({ windowId: Number(args.windowId) }).catch(() => []);
  } else if (args.all) {
    tabs = await chrome.tabs.query({}).catch(() => []);
  } else {
    tabs = await chrome.tabs.query({ lastFocusedWindow: true }).catch(() => []);
    if (!tabs || tabs.length === 0) tabs = await chrome.tabs.query({}).catch(() => []);
  }
  return {
    ok: true,
    data: {
      tabs: (tabs || []).map((t) => ({
        tabId: t.id,
        windowId: t.windowId,
        url: t.url,
        title: t.title,
        active: t.active,
        groupId: t.groupId !== -1 ? t.groupId : undefined,
      })),
    },
  };
}

export async function execWebTab(args = {}) {
  const action = String(args.action || 'open');
  if (action === 'open') {
    const url = String(args.url || '');
    if (!/^https?:/i.test(url)) {
      return makeError(ERROR_CODES.BAD_ARGS, 'Only http(s) URLs are supported.');
    }
    const created = await chrome.tabs.create({ url });
    if (created && created.id) groupAgentTab(created.id);
    await waitForTabComplete(created.id, 20000);
    const t = await chrome.tabs.get(created.id);
    return { ok: true, data: { tabId: t.id, windowId: t.windowId, url: t.url, title: t.title } };
  }
  if (action === 'switch') {
    const tabId = Number(args.tabId);
    if (!tabId) return makeError(ERROR_CODES.BAD_ARGS, 'tabId is required for switch action.');
    const t = await chrome.tabs.update(tabId, { active: true });
    if (t.windowId) await chrome.windows.update(t.windowId, { focused: true });
    return { ok: true, data: { tabId, windowId: t.windowId, url: t.url, title: t.title } };
  }
  if (action === 'close') {
    const tabId = Number(args.tabId);
    if (!tabId) return makeError(ERROR_CODES.BAD_ARGS, 'tabId is required for close action.');
    await chrome.tabs.remove(tabId);
    return { ok: true, data: { closed: tabId } };
  }
  return makeError(ERROR_CODES.BAD_ARGS, `Unknown web_tab action: ${action}. Supported: open, switch, close.`);
}

export async function execWebWindow(args = {}) {
  try {
    const action = String(args.action || 'update');
    if (action === 'create') {
      const createOpts = {};
      if (args.tabId) createOpts.tabId = Number(args.tabId);
      if (args.url) createOpts.url = String(args.url);
      if (args.focused !== undefined) createOpts.focused = Boolean(args.focused);
      if (args.state) createOpts.state = String(args.state);
      const win = await chrome.windows.create(createOpts);
      return { ok: true, data: { windowId: win.id, focused: win.focused, state: win.state } };
    }
    if (action === 'list') {
      const wins = await chrome.windows.getAll({ populate: true }).catch(() => []);
      return {
        ok: true,
        data: {
          windows: (wins || []).map((w) => {
            const activeTab = (w.tabs || []).find((t) => t.active) || (w.tabs && w.tabs[0]);
            return {
              windowId: w.id,
              focused: w.focused,
              state: w.state,
              type: w.type,
              top: w.top,
              left: w.left,
              width: w.width,
              height: w.height,
              tabCount: w.tabs ? w.tabs.length : 0,
              activeTab: activeTab ? { tabId: activeTab.id, url: activeTab.url, title: activeTab.title } : null,
            };
          }),
        },
      };
    }
    if (action === 'focus') {
      let winId = Number(args.windowId) || 0;
      if (!winId && args.tabId) {
        // Mirror the fallback the default/update path below already does: a caller that only
        // has a tabId (the common case right after web_navigate/web_click) shouldn't have to
        // look up windowId separately just to focus it.
        const t = await chrome.tabs.get(Number(args.tabId)).catch(() => null);
        if (t && t.windowId) winId = t.windowId;
      }
      if (!winId) return makeError(ERROR_CODES.BAD_ARGS, 'windowId (or a resolvable tabId) is required for focus action.');
      const win = await chrome.windows.update(winId, { focused: true });
      return { ok: true, data: { windowId: win.id, focused: win.focused, state: win.state } };
    }
    if (action === 'close') {
      const winId = Number(args.windowId);
      if (!winId) return makeError(ERROR_CODES.BAD_ARGS, 'windowId is required for close action.');
      await chrome.windows.remove(winId);
      return { ok: true, data: { closedWindowId: winId } };
    }

    const tabs = await chrome.tabs.query({});
    let winId = args.windowId ? Number(args.windowId) : null;
    if (!winId) {
      if (args.tabId) {
        // An explicit tabId that can't be found (closed, or owned by a different profile/window)
        // used to fall straight through to "the active tab of some window" below — silently
        // moving/resizing/focusing the WRONG window. Fail loudly instead.
        const t = tabs.find((x) => x.id === Number(args.tabId));
        if (!t) return makeError(ERROR_CODES.NO_ACTIVE_TAB, `Tab ${args.tabId} was not found (it may belong to a different window/profile, or have been closed).`);
        winId = t.windowId;
      } else {
        const t = tabs.find((x) => x.active) || tabs[0];
        winId = t && t.windowId;
      }
    }
    if (!winId) return makeError(ERROR_CODES.NO_ACTIVE_TAB, 'No window found.');
    const updates = {};
    if (args.state) updates.state = String(args.state);
    if (args.focused === true) updates.focused = true;
    if (args.left !== undefined) updates.left = Number(args.left);
    if (args.top !== undefined) updates.top = Number(args.top);
    if (args.width !== undefined) updates.width = Number(args.width);
    if (args.height !== undefined) updates.height = Number(args.height);
    if (!Object.keys(updates).length) updates.state = 'normal';
    const win = await chrome.windows.update(winId, updates);
    return { ok: true, data: { windowId: win.id, state: win.state, width: win.width, height: win.height, focused: win.focused } };
  } catch (e) {
    return makeError(ERROR_CODES.INTERNAL, `web_window failed: ${e.message}`);
  }
}

export async function execTabPool(args = {}) {
  const action = String(args.action || 'list');
  const poolName = String(args.poolName || 'default');

  if (action === 'create') {
    const size = Math.min(Number(args.size) || 3, 10);
    const urls = Array.isArray(args.urls) ? args.urls : [];
    const createdTabs = [];
    for (let i = 0; i < size; i++) {
      const u = urls[i] || 'about:blank';
      const t = await chrome.tabs.create({ url: u, active: false });
      createdTabs.push({ id: t.id, url: u });
      if (t.id) groupAgentTab(t.id);
    }
    return { ok: true, data: { pool: poolName, count: createdTabs.length, tabs: createdTabs } };
  }
  if (action === 'close') {
    const all = await chrome.tabs.query({});
    const closed = [];
    for (const t of all) {
      if (t.title && t.title.includes(poolName)) {
        await chrome.tabs.remove(t.id);
        closed.push(t.id);
      }
    }
    return { ok: true, data: { pool: poolName, closedCount: closed.length } };
  }
  const tabs = await chrome.tabs.query({});
  return { ok: true, data: { pool: poolName, activeTabs: tabs.map((t) => ({ id: t.id, url: t.url, title: t.title })) } };
}

export async function execSandboxGroup(args = {}) {
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
    if (!chrome.tabs.group) return makeError(ERROR_CODES.INTERNAL, 'tabGroups API not supported in this browser.');
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
    if (!tabId) return makeError(ERROR_CODES.BAD_ARGS, 'tabId is required for discard action.');
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
    if (!groupId) return makeError(ERROR_CODES.BAD_ARGS, 'groupId is required for close_group.');
    const tabs = await chrome.tabs.query({ groupId });
    const tabIds = tabs.map((t) => t.id);
    if (tabIds.length > 0) await chrome.tabs.remove(tabIds);
    return { ok: true, data: { closedGroupId: groupId, closedTabCount: tabIds.length } };
  }
  return makeError(ERROR_CODES.BAD_ARGS, `Unknown web_sandbox_group action: ${action}.`);
}
