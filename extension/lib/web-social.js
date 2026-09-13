// ScreenSync Social Operations (Playwright & Multi-Platform Intelligence)
// Extracted from web-tools.js to enforce the 500-600 line limit.

import { waitForTabComplete } from './tab-resolve.js';
import { makeError, ERROR_CODES } from './errors.js';

export async function socialScrape(args = {}) {
  const platform = String(args.platform || 'all').toLowerCase();
  const timeoutMs = Math.min(Number(args.timeoutMs) || 25000, 60000);
  const platformsToScrape = platform === 'all'
    ? ['twitter', 'github', 'linkedin', 'facebook']
    : [platform];

  const results = {};

  for (const plat of platformsToScrape) {
    let url = '';
    if (plat === 'twitter' || plat === 'x') url = 'https://x.com/home';
    else if (plat === 'github') url = 'https://github.com';
    else if (plat === 'linkedin') url = 'https://www.linkedin.com/feed/';
    else if (plat === 'facebook') url = 'https://www.facebook.com';
    else if (plat === 'reddit') url = 'https://www.reddit.com';
    if (!url) continue;

    let tab = null;
    let created = false;

    const existing = await chrome.tabs.query({ url: `${url.split('/')[0]}//${url.split('/')[2]}/*` }).catch(() => []);
    if (existing.length > 0) {
      tab = existing[0];
    } else {
      tab = await chrome.tabs.create({ url, active: false });
      created = true;
      if (chrome.tabs.group) {
        try {
          const gid = await chrome.tabs.group({ tabIds: [tab.id] });
          if (chrome.tabGroups) await chrome.tabGroups.update(gid, { title: 'ScreenSync Social', color: 'blue' });
        } catch {}
      }
      await waitForTabComplete(tab.id, timeoutMs);
    }

    let extracted = null;
    try {
      const [res] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: (p) => {
          const data = { platform: p, title: document.title, url: window.location.href };
          if (p === 'twitter' || p === 'x') {
            const profileLink = document.querySelector('a[data-testid*="AppTabBar_Profile_Link"]');
            const handle = profileLink ? profileLink.getAttribute('href')?.replace('/', '@') : null;
            const notifBadge = document.querySelector('a[data-testid*="AppTabBar_Notifications_Link"] div[aria-label]');
            const tweets = Array.from(document.querySelectorAll('article[data-testid="tweet"]')).slice(0, 3).map((t) => ({
              text: (t.querySelector('div[data-testid="tweetText"]')?.innerText || '').slice(0, 150),
              author: t.querySelector('div[data-testid="User-Name"]')?.innerText?.split('\n')[0] || '',
            }));
            data.authenticated = !document.querySelector('a[href*="/login"]');
            data.handle = handle;
            data.notifications = notifBadge?.getAttribute('aria-label') || '0';
            data.recentTweets = tweets;
          } else if (p === 'github') {
            const metaLogin = document.querySelector('meta[name="user-login"]')?.content;
            const notif = document.querySelector('.mail-status.unread, a[aria-label*="unread"]');
            data.authenticated = !!metaLogin;
            data.username = metaLogin || null;
            data.hasUnreadNotifications = !!notif;
          } else if (p === 'linkedin') {
            const nameEl = document.querySelector('.feed-identity-module__actor-meta, [class*="identity"] [class*="name"]');
            const headlineEl = document.querySelector('[class*="identity-headline"], .feed-identity-module__headline');
            data.authenticated = !document.querySelector('a[href*="/login"]');
            data.name = nameEl?.innerText?.trim() || null;
            data.headline = headlineEl?.innerText?.trim() || null;
          } else if (p === 'facebook') {
            const profileName = document.querySelector('[aria-label="Your profile"] span, [role="navigation"] [aria-label*="profile"]');
            data.authenticated = !document.querySelector('input[name="email"]');
            data.name = profileName?.innerText?.trim() || 'Active Facebook User';
          }
          return data;
        },
        args: [plat],
      });
      extracted = res ? res.result : null;
    } catch {}

    if (created && tab && tab.id) {
      try { await chrome.tabs.remove(tab.id); } catch {}
    }

    results[plat] = extracted || { platform: plat, error: 'Failed to extract DOM state' };
  }

  return { ok: true, data: { scrapedCount: Object.keys(results).length, results } };
}

export async function socialPost(args = {}) {
  const platform = String(args.platform || 'x').toLowerCase();
  const text = String(args.text || '').trim();
  if (!text) return makeError(ERROR_CODES.BAD_ARGS, 'Text is required for social post.');
  const timeoutMs = Math.min(Number(args.timeoutMs) || 30000, 60000);

  let composeUrl = '';
  if (platform === 'x' || platform === 'twitter') composeUrl = `https://x.com/intent/post?text=${encodeURIComponent(text)}`;
  else if (platform === 'linkedin') composeUrl = `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(location.href)}`;
  else return makeError(ERROR_CODES.BAD_ARGS, `Platform ${platform} post intent not configured.`);

  let tab = null;
  try {
    tab = await chrome.tabs.create({ url: composeUrl, active: true });
    await waitForTabComplete(tab.id, timeoutMs);
    return { ok: true, data: { status: 'intent_opened', platform, tabId: tab.id, url: tab.url, text: text.slice(0, 50) } };
  } catch (err) {
    return makeError(ERROR_CODES.INTERNAL, `Social post failed: ${err.message}`);
  }
}

export async function socialMatrix(args = {}) {
  const platforms = {
    x: { name: 'X / Twitter', domains: ['.x.com', '.twitter.com'], tokens: ['auth_token', 'ct0', 'twid'] },
    github: { name: 'GitHub', domains: ['.github.com', 'github.com'], tokens: ['user_session', '__Host-user_session_same_site', 'dotcom_user'] },
    linkedin: { name: 'LinkedIn', domains: ['.linkedin.com', 'www.linkedin.com'], tokens: ['li_at', 'JSESSIONID', 'bcookie'] },
    reddit: { name: 'Reddit', domains: ['.reddit.com', 'reddit.com'], tokens: ['reddit_session', 'token_v2'] },
  };

  const tabs = await chrome.tabs.query({}).catch(() => []);
  const matrix = {};

  for (const [key, cfg] of Object.entries(platforms)) {
    let authenticated = false;
    let username = null;
    const foundTokens = [];

    for (const d of cfg.domains) {
      try {
        const cookies = await chrome.cookies.getAll({ domain: d }).catch(() => []);
        for (const c of cookies) {
          if (cfg.tokens.includes(c.name)) {
            foundTokens.push(c.name);
            authenticated = true;
          }
          if (c.name === 'dotcom_user') username = c.value;
        }
      } catch {}
    }

    const openTabs = tabs.filter((t) => t.url && cfg.domains.some((d) => t.url.includes(d.replace(/^\./, ''))));
    matrix[key] = {
      platform: cfg.name,
      authenticated,
      username: username || (authenticated ? 'Active Session' : null),
      tokensFound: Array.from(new Set(foundTokens)),
      openTabsCount: openTabs.length,
      activeUrl: openTabs[0] ? openTabs[0].url : null,
    };
  }

  const authenticatedList = Object.entries(matrix).filter(([_, v]) => v.authenticated).map(([k]) => k);
  return {
    ok: true,
    data: {
      totalPlatformsChecked: Object.keys(matrix).length,
      authenticatedCount: authenticatedList.length,
      authenticatedPlatforms: authenticatedList,
      matrix,
    },
  };
}

export async function socialSync(args = {}) {
  const platform = String(args.platform || 'x').toLowerCase();
  const task = String(args.task || 'feed').toLowerCase();
  const limit = Math.min(Math.max(Number(args.limit) || 10, 1), 50);

  let targetUrl = '';
  if (platform === 'x' || platform === 'twitter') {
    if (task === 'notifications') targetUrl = 'https://x.com/notifications';
    else if (task === 'bookmarks') targetUrl = 'https://x.com/i/bookmarks';
    else if (task === 'search' && args.query) targetUrl = `https://x.com/search?q=${encodeURIComponent(args.query)}&f=live`;
    else targetUrl = 'https://x.com/home';
  } else if (platform === 'github') {
    if (task === 'notifications') targetUrl = 'https://github.com/notifications';
    else if (task === 'trending') targetUrl = 'https://github.com/trending';
    else targetUrl = 'https://github.com';
  } else if (platform === 'reddit') {
    const sub = args.subreddit ? `r/${args.subreddit}` : 'popular';
    targetUrl = `https://www.reddit.com/${sub}/`;
  } else if (platform === 'linkedin') {
    targetUrl = 'https://www.linkedin.com/feed/';
  } else {
    return makeError(ERROR_CODES.BAD_ARGS, `Unsupported platform: ${platform}.`);
  }

  let tab = null;
  try {
    tab = await chrome.tabs.create({ url: targetUrl, active: false });
    await waitForTabComplete(tab.id, 25000);

    const [res] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: (max) => {
        const articles = Array.from(document.querySelectorAll('article, .feed-shared-update-v2, shreddit-post')).slice(0, max);
        return articles.map((a) => ({
          text: (a.innerText || '').slice(0, 200),
          url: a.querySelector('a[href]')?.getAttribute('href') || null,
        }));
      },
      args: [limit],
    });

    try { await chrome.tabs.remove(tab.id); } catch {}
    const items = res ? res.result : [];
    return { ok: true, data: { platform, task, count: items.length, items } };
  } catch (err) {
    if (tab && tab.id) { try { await chrome.tabs.remove(tab.id); } catch {} }
    return makeError(ERROR_CODES.INTERNAL, `socialSync failed: ${err.message}`);
  }
}

export async function multiTabSync(args = {}) {
  const urls = Array.isArray(args.urls) ? args.urls : [];
  if (!urls.length) return makeError(ERROR_CODES.BAD_ARGS, 'urls array required for multiTabSync.');
  const results = [];
  for (const u of urls.slice(0, 5)) {
    try {
      const tab = await chrome.tabs.create({ url: u, active: false });
      await waitForTabComplete(tab.id, 20000);
      const [res] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => ({ title: document.title, url: location.href }),
      });
      try { await chrome.tabs.remove(tab.id); } catch {}
      results.push({ url: u, data: res?.result });
    } catch (e) {
      results.push({ url: u, error: e.message });
    }
  }
  return { ok: true, data: { syncedCount: results.length, results } };
}

export async function keepTabAlive(args = {}) {
  const action = String(args.action || 'protect');
  const [active] = await chrome.tabs.query({ active: true, lastFocusedWindow: true }).catch(() => []);
  const tabId = Number(args.tabId) || (active ? active.id : null);
  if (!tabId) return makeError(ERROR_CODES.NO_ACTIVE_TAB, 'tabId required for keepTabAlive.');
  try {
    if (action === 'protect') {
      await chrome.tabs.update(tabId, { autoDiscardable: false });
      return { ok: true, data: { tabId, autoDiscardable: false } };
    }
    await chrome.tabs.update(tabId, { autoDiscardable: true });
    return { ok: true, data: { tabId, autoDiscardable: true } };
  } catch (e) {
    return makeError(ERROR_CODES.INTERNAL, e.message);
  }
}

export async function socialFeedCluster(args = {}) {
  return socialMatrix(args);
}

export async function socialDossier(args = {}) {
  const platform = String(args.platform || 'github').toLowerCase();
  const matrixRes = await socialMatrix({ platform });
  return { ok: true, data: { platform, dossier: matrixRes.data } };
}

export async function socialSearch(args = {}) {
  const query = String(args.query || '').trim();
  if (!query) return makeError(ERROR_CODES.BAD_ARGS, 'query is required for socialSearch.');
  return { ok: true, data: { query, results: [] } };
}

export async function inspectUserProfileSync(args = {}) {
  return socialMatrix(args);
}

export async function batchCrawl(args = {}) {
  return multiTabSync(args);
}
