// ScreenSync Tab Grouping Management — Chrome Tab Groups API
// Organizes agent and operator tabs into clean, color-coded, labeled groups.

export async function execTabGroup(args = {}) {
  if (!chrome.tabs.group || !chrome.tabGroups) {
    return { ok: false, error: 'Tab Groups API is not supported in this browser.' };
  }

  const action = String(args.action || 'list').toLowerCase();

  try {
    // ── 1. Create a new Tab Group ──────────────────────────────────────────
    if (action === 'create') {
      let tabIds = Array.isArray(args.tabIds) ? args.tabIds.map(Number) : [];
      if (tabIds.length === 0) {
        if (args.tabId) {
          tabIds = [Number(args.tabId)];
        } else {
          let [active] = await chrome.tabs.query({ active: true, lastFocusedWindow: true }).catch(() => []);
          if (!active) [active] = await chrome.tabs.query({ active: true, currentWindow: true }).catch(() => []);
          if (active && active.id) tabIds = [active.id];
        }
      }
      if (tabIds.length === 0) {
        return { ok: false, error: 'web_tab_group action="create" requires tabIds or an active tab.' };
      }

      const groupId = await chrome.tabs.group({ tabIds });
      const updateProps = {};
      if (args.title) updateProps.title = String(args.title);
      const validColors = ['grey', 'blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan', 'orange'];
      if (args.color && validColors.includes(String(args.color).toLowerCase())) {
        updateProps.color = String(args.color).toLowerCase();
      }
      if (typeof args.collapsed === 'boolean') updateProps.collapsed = args.collapsed;

      if (Object.keys(updateProps).length > 0) {
        await chrome.tabGroups.update(groupId, updateProps);
      }

      const grp = await chrome.tabGroups.get(groupId);
      return {
        ok: true,
        data: {
          groupId,
          title: grp.title || null,
          color: grp.color,
          collapsed: grp.collapsed,
          tabIds,
        },
      };
    }

    // ── 2. Add tabs to existing group ──────────────────────────────────────
    if (action === 'add') {
      const groupId = Number(args.groupId);
      if (!groupId) return { ok: false, error: 'web_tab_group action="add" requires "groupId".' };
      const tabIds = Array.isArray(args.tabIds) ? args.tabIds.map(Number) : (args.tabId ? [Number(args.tabId)] : []);
      if (tabIds.length === 0) return { ok: false, error: 'web_tab_group action="add" requires "tabIds".' };

      await chrome.tabs.group({ groupId, tabIds });
      return { ok: true, data: { groupId, addedTabIds: tabIds } };
    }

    // ── 3. Ungroup / remove tabs from group ────────────────────────────────
    if (action === 'remove' || action === 'ungroup') {
      const tabIds = Array.isArray(args.tabIds) ? args.tabIds.map(Number) : (args.tabId ? [Number(args.tabId)] : []);
      if (tabIds.length === 0) {
        return { ok: false, error: 'web_tab_group action="remove" requires "tabIds".' };
      }
      await chrome.tabs.ungroup(tabIds);
      return { ok: true, data: { ungroupedTabIds: tabIds } };
    }

    // ── 4. Update group properties ─────────────────────────────────────────
    if (action === 'update') {
      const groupId = Number(args.groupId);
      if (!groupId) return { ok: false, error: 'web_tab_group action="update" requires "groupId".' };

      const updateProps = {};
      if (args.title !== undefined) updateProps.title = String(args.title);
      if (args.color) updateProps.color = String(args.color);
      if (typeof args.collapsed === 'boolean') updateProps.collapsed = args.collapsed;

      const grp = await chrome.tabGroups.update(groupId, updateProps);
      return {
        ok: true,
        data: {
          groupId: grp.id,
          title: grp.title,
          color: grp.color,
          collapsed: grp.collapsed,
        },
      };
    }

    // ── 5. List all tab groups ─────────────────────────────────────────────
    if (action === 'list') {
      const groups = await chrome.tabGroups.query(args.windowId ? { windowId: Number(args.windowId) } : {});
      const detailed = await Promise.all(
        groups.map(async (g) => {
          const tabs = await chrome.tabs.query({ groupId: g.id });
          return {
            groupId: g.id,
            title: g.title || '(untitled)',
            color: g.color,
            collapsed: g.collapsed,
            windowId: g.windowId,
            tabCount: tabs.length,
            tabs: tabs.map((t) => ({ id: t.id, title: t.title, url: t.url, active: t.active })),
          };
        })
      );
      return { ok: true, data: { count: detailed.length, groups: detailed } };
    }

    return { ok: false, error: `Unknown web_tab_group action: "${action}". Supported: create, add, remove, update, list.` };
  } catch (e) {
    return { ok: false, error: `Tab group operation failed: ${String((e && e.message) || e)}` };
  }
}
