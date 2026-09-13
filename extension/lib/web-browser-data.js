// ScreenSync Browser Data — operator context from the profile: recent
// navigation history and bookmarks. Uses chrome.history / chrome.bookmarks.

export async function historySearch(args = {}) {
  const text = String(args.text || '').trim();
  const hoursBack = Math.min(Number(args.hoursBack) || 24, 24 * 90);
  const limit = Math.min(Number(args.limit) || 25, 100);
  const startedAt = Date.now() - hoursBack * 3600_000;
  try {
    const query = { startTime: startedAt, maxResults: limit * (text ? 4 : 1) };
    if (text) query.text = text;
    const items = await chrome.history.search(query);
    const filtered = (items || [])
      .filter((it) => /^https?:/i.test(it.url || ''))
      .slice(0, limit)
      .map((it) => ({
        url: it.url,
        title: (it.title || '').slice(0, 140) || undefined,
        lastVisitAt: new Date(it.lastVisitTime).toISOString(),
        visitCount: it.visitCount,
      }));
    return { ok: true, data: { count: filtered.length, hoursBack, text: text || null, items: filtered } };
  } catch (e) {
    return { ok: false, error: 'web_history failed: ' + String((e && e.message) || e) };
  }
}

export async function bookmarksSearch(args = {}) {
  const text = String(args.text || '').trim().toLowerCase();
  const limit = Math.min(Number(args.limit) || 25, 100);
  try {
    const tree = await chrome.bookmarks.getTree();
    const flat = [];
    const walk = (nodes, path) => {
      for (const n of nodes || []) {
        const p = path ? path + ' / ' + (n.title || '') : (n.title || '');
        if (n.url) flat.push({ title: (n.title || '').slice(0, 140), url: n.url, path: p });
        if (n.children) walk(n.children, p);
      }
    };
    walk(tree || [], '');
    const filtered = (text ? flat.filter((b) => (b.title + ' ' + b.url + ' ' + b.path).toLowerCase().includes(text)) : flat).slice(0, limit);
    return { ok: true, data: { count: filtered.length, totalBookmarks: flat.length, text: text || null, items: filtered } };
  } catch (e) {
    return { ok: false, error: 'web_bookmarks failed: ' + String((e && e.message) || e) };
  }
}
