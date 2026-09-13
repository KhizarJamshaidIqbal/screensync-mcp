// ScreenSync Authenticated Harvester — Real User Social & Web Intelligence
// Extracts live feeds, profiles, notifications, and search results using already logged-in browser sessions.

function waitForTabComplete(tabId, timeoutMs = 25000) {
  return new Promise((resolve) => {
    const onUpdated = (id, info) => {
      if (id === tabId && info.status === 'complete') finish();
    };
    const timer = setTimeout(finish, timeoutMs);
    function finish() {
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      resolve();
    }
    chrome.tabs.onUpdated.addListener(onUpdated);
  });
}

// ── Authenticated Multi-Account Harvester ─────────────────────────────────
export async function authenticatedHarvest(args = {}) {
  const platform = String(args.platform || 'x').toLowerCase();
  const task = String(args.task || 'feed').toLowerCase();
  const limit = Math.min(Math.max(Number(args.limit) || 20, 1), 100);
  const scrollPages = Math.min(Math.max(Number(args.scrollPages) || 0, 0), 10);

  // Platform URL routing
  let targetUrl = args.url ? String(args.url) : '';
  const domainKeywords = {
    x: ['x.com', 'twitter.com'],
    twitter: ['x.com', 'twitter.com'],
    linkedin: ['linkedin.com'],
    github: ['github.com'],
    reddit: ['reddit.com'],
    facebook: ['facebook.com'],
    instagram: ['instagram.com'],
    youtube: ['youtube.com'],
    threads: ['threads.net'],
  };

  if (!targetUrl) {
    if (platform === 'x' || platform === 'twitter') {
      if (task === 'notifications') targetUrl = 'https://x.com/notifications';
      else if (task === 'profile') targetUrl = 'https://x.com/home';
      else if (task === 'bookmarks') targetUrl = 'https://x.com/i/bookmarks';
      else if (task === 'search' && args.query) targetUrl = `https://x.com/search?q=${encodeURIComponent(args.query)}&f=live`;
      else targetUrl = 'https://x.com/home';
    } else if (platform === 'linkedin') {
      if (task === 'notifications') targetUrl = 'https://www.linkedin.com/notifications/';
      else if (task === 'profile') targetUrl = 'https://www.linkedin.com/in/me/';
      else if (task === 'search' && args.query) targetUrl = `https://www.linkedin.com/search/results/all/?keywords=${encodeURIComponent(args.query)}`;
      else targetUrl = 'https://www.linkedin.com/feed/';
    } else if (platform === 'github') {
      if (task === 'notifications') targetUrl = 'https://github.com/notifications';
      else if (task === 'trending') targetUrl = 'https://github.com/trending';
      else if (task === 'profile') targetUrl = 'https://github.com/settings/profile';
      else targetUrl = 'https://github.com';
    } else if (platform === 'reddit') {
      const sub = args.subreddit ? `r/${args.subreddit}/` : '';
      if (task === 'notifications') targetUrl = 'https://www.reddit.com/notifications';
      else if (task === 'popular') targetUrl = 'https://www.reddit.com/r/popular/';
      else targetUrl = `https://www.reddit.com/${sub}`;
    } else if (platform === 'facebook') {
      targetUrl = task === 'notifications' ? 'https://www.facebook.com/notifications' : 'https://www.facebook.com/';
    } else if (platform === 'instagram') {
      targetUrl = task === 'notifications' ? 'https://www.instagram.com/notifications/' : 'https://www.instagram.com/';
    } else if (platform === 'youtube') {
      targetUrl = task === 'subscriptions' ? 'https://www.youtube.com/feed/subscriptions' : 'https://www.youtube.com/';
    } else if (platform === 'threads') {
      targetUrl = 'https://www.threads.net/';
    } else {
      return { ok: false, error: `Unsupported harvest platform: ${platform}. Provide a "url" for custom scraping.` };
    }
  }

  // Check if an existing open tab can be reused
  let tab = null;
  let reusedExisting = false;
  if (args.useExistingTab !== false) {
    const existingTabs = await chrome.tabs.query({}).catch(() => []);
    const keywords = domainKeywords[platform] || [new URL(targetUrl).hostname];
    tab = existingTabs.find((t) => t.url && keywords.some((k) => t.url.includes(k)));
    if (tab) reusedExisting = true;
  }

  let createdGroupId = null;
  try {
    if (!tab) {
      tab = await chrome.tabs.create({ url: targetUrl, active: false });
      if (chrome.tabs.group) {
        try {
          createdGroupId = await chrome.tabs.group({ tabIds: [tab.id] });
          if (chrome.tabGroups) {
            await chrome.tabGroups.update(createdGroupId, { title: 'ScreenSync Harvest', color: 'purple' });
          }
        } catch {}
      }
      await waitForTabComplete(tab.id, 30000);
    } else {
      // Reused existing tab: navigate to targetUrl if on a different page
      const cur = tab.url || '';
      if (targetUrl && !cur.startsWith(targetUrl)) {
        await chrome.tabs.update(tab.id, { url: targetUrl });
        await waitForTabComplete(tab.id, 20000);
      } else if (tab.status !== 'complete') {
        await waitForTabComplete(tab.id, 10000);
      }
    }

    // Optional page scrolling for lazy-loaded infinite feeds
    if (scrollPages > 0) {
      for (let s = 0; s < scrollPages; s++) {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: () => window.scrollBy({ top: window.innerHeight * 1.5, behavior: 'smooth' }),
        }).catch(() => {});
        await new Promise((r) => setTimeout(r, 1200 + Math.random() * 600));
      }
    }

    // Page-side extraction function (completely self-contained)
    const [execRes] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: (plat, tsk, maxLimit, customSel) => {
        const results = {
          authenticated: false,
          user: null,
          title: document.title,
          url: window.location.href,
          items: [],
          stats: {},
        };

        // ── Platform: X / Twitter ──────────────────────────────────────────
        if (plat === 'x' || plat === 'twitter') {
          const authAvatar = document.querySelector('[data-testid="SideNav_AccountSwitcher_Button"], [data-testid="AppTabBar_Profile_Link"]');
          results.authenticated = Boolean(authAvatar || document.cookie.includes('auth_token'));

          if (tsk === 'profile') {
            const nameEl = document.querySelector('[data-testid="UserName"], [data-testid="User-Name"]');
            const bioEl = document.querySelector('[data-testid="UserDescription"]');
            const followEls = Array.from(document.querySelectorAll('a[href*="/following"], a[href*="/verified_followers"]'));
            results.user = {
              displayName: nameEl ? nameEl.innerText.split('\n')[0] : null,
              handle: nameEl ? (nameEl.innerText.split('\n')[1] || '') : null,
              bio: bioEl ? bioEl.innerText.trim() : null,
              stats: followEls.map((e) => e.innerText.trim()),
            };
          } else if (tsk === 'notifications') {
            const notifs = Array.from(document.querySelectorAll('article, [data-testid="cellInnerDiv"]')).slice(0, maxLimit);
            results.items = notifs.map((n) => {
              const text = n.innerText.trim();
              const link = n.querySelector('a[href*="/status/"], a[href*="/i/"]');
              return { text: text.slice(0, 300), url: link ? link.href : null };
            }).filter((n) => n.text);
          } else {
            const articles = Array.from(document.querySelectorAll('article')).slice(0, maxLimit);
            results.items = articles.map((a) => {
              const userEl = a.querySelector('[data-testid="User-Name"]');
              const textEl = a.querySelector('[data-testid="tweetText"]');
              const timeEl = a.querySelector('time');
              const link = a.querySelector('a[href*="/status/"]');
              const replies = a.querySelector('[data-testid="reply"]')?.innerText || '0';
              const reposts = a.querySelector('[data-testid="retweet"]')?.innerText || '0';
              const likes = a.querySelector('[data-testid="like"]')?.innerText || '0';
              const mediaImgs = Array.from(a.querySelectorAll('img[src*="pbs.twimg.com/media/"]')).map((m) => m.src);

              const handlePart = userEl ? userEl.innerText.split('\n') : [];
              return {
                author: handlePart[0] || 'Unknown',
                handle: handlePart[1] || '',
                timestamp: timeEl ? timeEl.getAttribute('datetime') : null,
                text: textEl ? textEl.innerText.trim() : '',
                permalink: link ? link.href : null,
                metrics: { replies, reposts, likes },
                media: mediaImgs,
              };
            }).filter((t) => t.text || t.permalink);
          }
          return results;
        }

        // ── Platform: LinkedIn ─────────────────────────────────────────────
        if (plat === 'linkedin') {
          results.authenticated = Boolean(document.querySelector('.feed-identity-module, .global-nav__me, #global-nav') || document.cookie.includes('li_at'));
          if (tsk === 'profile') {
            const name = document.querySelector('.text-heading-xlarge, h1')?.innerText?.trim();
            const headline = document.querySelector('.text-body-medium')?.innerText?.trim();
            results.user = { name, headline };
          } else {
            const feedPosts = Array.from(document.querySelectorAll('.feed-shared-update-v2, .feed-shared-update')).slice(0, maxLimit);
            results.items = feedPosts.map((p) => {
              const author = p.querySelector('.update-components-actor__name, .feed-shared-actor__name')?.innerText?.trim();
              const text = p.querySelector('.feed-shared-update-v2__description, .feed-shared-text')?.innerText?.trim();
              const time = p.querySelector('.update-components-actor__sub-description, time')?.innerText?.trim();
              const socialCounts = p.querySelector('.social-details-social-counts')?.innerText?.trim();
              return { author, timestamp: time, text: text || '', socialCounts };
            }).filter((p) => p.text || p.author);
          }
          return results;
        }

        // ── Platform: GitHub ───────────────────────────────────────────────
        if (plat === 'github') {
          results.authenticated = Boolean(document.querySelector('meta[name="user-login"]') || document.cookie.includes('user_session'));
          const userLogin = document.querySelector('meta[name="user-login"]')?.getAttribute('content');
          if (userLogin) results.user = { login: userLogin };

          if (tsk === 'notifications') {
            const list = Array.from(document.querySelectorAll('.notifications-list-item, article.Box-row')).slice(0, maxLimit);
            results.items = list.map((item) => {
              const titleLink = item.querySelector('.notification-list-item-link, h2 a, h1 a');
              const repo = item.querySelector('.notification-list-item-repository, .text-bold')?.innerText?.trim();
              return {
                title: titleLink ? titleLink.innerText.trim() : item.innerText.slice(0, 100).trim(),
                url: titleLink ? titleLink.href : null,
                repo,
              };
            }).filter((i) => i.title);
          } else {
            const rows = Array.from(document.querySelectorAll('article.Box-row, .feed-item')).slice(0, maxLimit);
            results.items = rows.map((r) => ({
              title: r.querySelector('h2, h1, h3')?.innerText?.trim() || '',
              description: r.querySelector('p')?.innerText?.trim() || '',
              link: r.querySelector('a')?.href || null,
            })).filter((r) => r.title);
          }
          return results;
        }

        // ── Platform: Reddit ───────────────────────────────────────────────
        if (plat === 'reddit') {
          results.authenticated = Boolean(document.querySelector('[id*="user-drawer"], faceplate-dropdown[slot="user-dropdown"]') || document.cookie.includes('reddit_session'));
          const posts = Array.from(document.querySelectorAll('shreddit-post, [data-testid="post-container"]')).slice(0, maxLimit);
          results.items = posts.map((p) => {
            const title = p.getAttribute('post-title') || p.querySelector('h1, h2, a[slot="title"]')?.innerText || '';
            const author = p.getAttribute('author') || p.querySelector('a[href*="/user/"]')?.innerText || '';
            const score = p.getAttribute('score') || p.querySelector('[score]')?.innerText || '';
            const comments = p.getAttribute('comment-count') || '';
            const permalink = p.getAttribute('permalink') || p.querySelector('a[data-click-id="body"]')?.href || '';
            return {
              title: title.trim(),
              author,
              score,
              comments,
              permalink: permalink.startsWith('http') ? permalink : `https://reddit.com${permalink}`,
            };
          }).filter((p) => p.title);
          return results;
        }

        // ── Platform: YouTube ──────────────────────────────────────────────
        if (plat === 'youtube') {
          const avatar = document.querySelector('button#avatar-btn, ytd-topbar-menu-button-renderer img');
          results.authenticated = Boolean(avatar || document.cookie.includes('LOGIN_INFO') || document.cookie.includes('__Secure-3PSID'));
          const videos = Array.from(document.querySelectorAll('ytd-rich-item-renderer, ytd-video-renderer, ytd-compact-video-renderer, ytd-grid-video-renderer')).slice(0, maxLimit);
          results.items = videos.map((v) => {
            const titleEl = v.querySelector('#video-title, #video-title-link');
            const channelEl = v.querySelector('#channel-name, #text.ytd-channel-name');
            const metaSpans = Array.from(v.querySelectorAll('#metadata-line span')).map((s) => s.innerText.trim());
            const linkEl = v.querySelector('a#video-title-link, a#thumbnail');
            return {
              title: titleEl ? titleEl.innerText.trim() : '',
              channel: channelEl ? channelEl.innerText.trim() : '',
              metadata: metaSpans.join(' • '),
              url: linkEl ? linkEl.href : null,
            };
          }).filter((v) => v.title);
          return results;
        }

        // ── Platform: Facebook ─────────────────────────────────────────────
        if (plat === 'facebook') {
          results.authenticated = Boolean(document.querySelector('[role="navigation"] [aria-label*="Your profile"], [aria-label="Facebook"][role="region"]') || document.cookie.includes('c_user'));
          const posts = Array.from(document.querySelectorAll('div[role="feed"] > div, div[role="article"], div[data-pagelet*="FeedUnit"]')).slice(0, maxLimit);
          results.items = posts.map((p) => {
            const author = p.querySelector('h2, h3, h4, strong')?.innerText?.trim();
            const text = p.querySelector('div[dir="auto"], [data-ad-preview="message"]')?.innerText?.trim();
            const link = p.querySelector('a[href*="/posts/"], a[href*="/permalink/"], a[href*="story_fbid"]')?.href;
            return { author: author || 'Facebook Post', text: (text || '').slice(0, 400), url: link || null };
          }).filter((p) => p.text);
          return results;
        }

        // ── Platform: Instagram ────────────────────────────────────────────
        if (plat === 'instagram') {
          results.authenticated = Boolean(document.querySelector('svg[aria-label="Home"], svg[aria-label="New post"], a[href*="/direct/inbox/"]') || document.cookie.includes('sessionid'));
          const posts = Array.from(document.querySelectorAll('article, div._aagv, div._aabd')).slice(0, maxLimit);
          results.items = posts.map((p) => {
            const caption = p.querySelector('h1, span._aacu, span._ap3a')?.innerText?.trim();
            const link = p.querySelector('a[href*="/p/"], a[href*="/reel/"]')?.href;
            return { text: (caption || '').slice(0, 400), url: link || null };
          }).filter((p) => p.text || p.url);
          return results;
        }

        // ── Platform: Threads ──────────────────────────────────────────────
        if (plat === 'threads') {
          results.authenticated = Boolean(document.querySelector('svg[aria-label="Profile"], a[href*="/@"]') || document.cookie.includes('sessionid'));
          const posts = Array.from(document.querySelectorAll('[data-pressable-container="true"], article, div[data-testid*="post"]')).slice(0, maxLimit);
          results.items = posts.map((p) => {
            const author = p.querySelector('a[href*="/@"] span')?.innerText?.trim();
            const text = p.querySelector('div[dir="auto"]')?.innerText?.trim();
            const link = p.querySelector('a[href*="/post/"]')?.href;
            return { author: author || 'Threads User', text: (text || '').slice(0, 400), url: link || null };
          }).filter((p) => p.text);
          return results;
        }

        // ── Generic / Custom Selector Scraping ─────────────────────────────
        const itemSel = (customSel && customSel.itemSelector) || 'article, .card, .post, .item, li';
        const items = Array.from(document.querySelectorAll(itemSel)).slice(0, maxLimit);
        results.items = items.map((el) => {
          const title = customSel && customSel.titleSelector ? el.querySelector(customSel.titleSelector)?.innerText : el.querySelector('h1, h2, h3, h4')?.innerText;
          const link = customSel && customSel.linkSelector ? el.querySelector(customSel.linkSelector)?.href : el.querySelector('a')?.href;
          return {
            title: title ? title.trim() : null,
            text: el.innerText.slice(0, 400).trim(),
            url: link || null,
          };
        }).filter((i) => i.title || i.text);

        return results;
      },
      args: [platform, task, limit, args.selectors || null],
    });

    const data = (execRes && execRes.result) || { items: [] };

    // Clean up tab if it was created by us and not explicitly kept
    if (!reusedExisting && args.keepTab !== true && tab && tab.id) {
      try { await chrome.tabs.remove(tab.id); } catch {}
    }

    return {
      ok: true,
      data: {
        platform,
        task,
        targetUrl,
        reusedExistingTab: reusedExisting,
        authenticated: Boolean(data.authenticated),
        user: data.user || null,
        itemCount: Array.isArray(data.items) ? data.items.length : 0,
        items: data.items,
        timestamp: new Date().toISOString(),
      },
    };
  } catch (err) {
    if (!reusedExisting && tab && tab.id && args.keepTab !== true) {
      try { await chrome.tabs.remove(tab.id); } catch {}
    }
    return { ok: false, error: `authenticatedHarvest failed: ${String((err && err.message) || err)}` };
  }
}
