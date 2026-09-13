// ScreenSync Real-Browser Authenticated Data Sync Unit
// Extracts live structured data from the user's authenticated web sessions.
// Self-contained page-side execution unit for chrome.scripting.executeScript.

export async function ssWebUnitSync(args = {}) {
  try {
    if (navigator.webdriver) Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  } catch {}

  const limit = Math.min(Math.max(Number(args.limit) || 15, 1), 100);
  const timeoutMs = Math.min(Number(args.timeoutMs) || 8000, 30000);
  const customSel = args.customSelector ? String(args.customSelector) : '';
  const extractType = String(args.extractType || 'all').toLowerCase();

  // Helper to wait until at least one candidate element appears
  async function waitForElements(selector, maxWaitMs) {
    const start = Date.now();
    while (Date.now() - start < maxWaitMs) {
      try {
        const found = document.querySelectorAll(selector);
        if (found && found.length > 0) return Array.from(found);
      } catch {}
      await new Promise((r) => setTimeout(r, 150));
    }
    return [];
  }

  function cleanText(txt) {
    return String(txt || '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  // 1. Custom selector extraction if provided
  if (customSel) {
    const els = await waitForElements(customSel, timeoutMs);
    const items = [];
    for (const el of els.slice(0, limit)) {
      const link = el.querySelector('a[href]')?.getAttribute('href') || (el.tagName === 'A' ? el.getAttribute('href') : null);
      const title = cleanText(el.querySelector('h1, h2, h3, h4, strong, [role="heading"]')?.innerText || el.innerText);
      const text = cleanText(el.innerText || el.textContent);
      const img = el.querySelector('img[src]')?.getAttribute('src');
      items.push({
        title: title ? title.slice(0, 150) : undefined,
        text: text ? text.slice(0, 300) : undefined,
        link: link ? (link.startsWith('http') ? link : new URL(link, location.href).href) : undefined,
        image: img || undefined,
      });
    }
    return {
      ok: true,
      data: {
        mode: 'custom_selector',
        selector: customSel,
        url: location.href,
        count: items.length,
        items,
      },
    };
  }

  const hostname = location.hostname.toLowerCase();

  // 2. X / Twitter
  if (hostname.includes('twitter.com') || hostname.includes('x.com')) {
    const tweets = await waitForElements('article[data-testid="tweet"], article[role="article"]', timeoutMs);
    const items = [];
    for (const tw of tweets.slice(0, limit)) {
      const author = cleanText(tw.querySelector('[data-testid="User-Name"]')?.innerText);
      const text = cleanText(tw.querySelector('[data-testid="tweetText"]')?.innerText);
      const time = tw.querySelector('time')?.getAttribute('datetime') || tw.querySelector('time')?.innerText || null;
      const linkEl = tw.querySelector('a[href*="/status/"]');
      const permalink = linkEl ? `https://x.com${linkEl.getAttribute('href')}` : null;
      const media = Array.from(tw.querySelectorAll('img[src*="pbs.twimg.com/media"], video')).map((m) => m.currentSrc || m.src || '');
      items.push({ author, text, time, permalink, media: media.filter(Boolean) });
    }
    return {
      ok: true,
      data: { platform: 'x', url: location.href, count: items.length, items },
    };
  }

  // 3. LinkedIn
  if (hostname.includes('linkedin.com')) {
    const posts = await waitForElements('.feed-shared-update-v2, div[data-urn*="urn:li:activity"]', timeoutMs);
    const items = [];
    for (const p of posts.slice(0, limit)) {
      const author = cleanText(p.querySelector('.update-components-actor__name, .feed-shared-actor__name')?.innerText);
      const title = cleanText(p.querySelector('.update-components-actor__description, .feed-shared-actor__description')?.innerText);
      const text = cleanText(p.querySelector('.feed-shared-update-v2__description, .update-components-text')?.innerText);
      const link = p.querySelector('a[href*="/feed/update/"]')?.getAttribute('href');
      items.push({
        author,
        title: title ? title.slice(0, 100) : undefined,
        text: text ? text.slice(0, 400) : undefined,
        link: link ? (link.startsWith('http') ? link : `https://www.linkedin.com${link}`) : undefined,
      });
    }
    return {
      ok: true,
      data: { platform: 'linkedin', url: location.href, count: items.length, items },
    };
  }

  // 4. Reddit
  if (hostname.includes('reddit.com')) {
    const posts = await waitForElements('shreddit-post, [data-testid="post-container"], article', timeoutMs);
    const items = [];
    for (const p of posts.slice(0, limit)) {
      const title = cleanText(p.getAttribute('post-title') || p.querySelector('h1, h2, h3, a[slot="title"]')?.innerText);
      const author = p.getAttribute('author') || cleanText(p.querySelector('a[href*="/user/"]')?.innerText);
      const score = p.getAttribute('score') || cleanText(p.querySelector('[data-testid="post-vote-count"]')?.innerText);
      const permalink = p.getAttribute('permalink') || p.querySelector('a[data-click-id="body"]')?.getAttribute('href');
      const comments = p.getAttribute('comment-count') || cleanText(p.querySelector('a[data-click-id="comments"]')?.innerText);
      items.push({
        title,
        author: author || undefined,
        score: score ? Number(score) || score : undefined,
        comments: comments ? Number(comments) || comments : undefined,
        permalink: permalink ? (permalink.startsWith('http') ? permalink : `https://www.reddit.com${permalink}`) : undefined,
      });
    }
    return {
      ok: true,
      data: { platform: 'reddit', url: location.href, count: items.length, items },
    };
  }

  // 5. GitHub
  if (hostname.includes('github.com')) {
    const repos = await waitForElements('.repo-list-item, div.search-title, [data-testid="results-list"] > div, article, li.d-flex', timeoutMs);
    const items = [];
    for (const r of repos.slice(0, limit)) {
      const name = cleanText(r.querySelector('h3 a, a.Link--primary, a.v-align-middle')?.innerText);
      const desc = cleanText(r.querySelector('p, .search-match, .mb-1')?.innerText);
      const stars = cleanText(r.querySelector('[aria-label*="star"], a[href$="/stargazers"]')?.innerText);
      const link = r.querySelector('h3 a, a.Link--primary')?.getAttribute('href');
      if (name || link) {
        items.push({
          name,
          description: desc || undefined,
          stars: stars || undefined,
          link: link ? (link.startsWith('http') ? link : `https://github.com${link}`) : undefined,
        });
      }
    }
    return {
      ok: true,
      data: { platform: 'github', url: location.href, count: items.length, items },
    };
  }

  // 6. Generic articles / structured cards fallback
  const cards = await waitForElements('article, .card, .post, [role="article"], .item, li.search-result', 2000);
  const genericItems = [];
  for (const c of cards.slice(0, limit)) {
    const title = cleanText(c.querySelector('h1, h2, h3, h4, a.title, [role="heading"]')?.innerText);
    const text = cleanText(c.querySelector('p, .description, .summary, .content')?.innerText || c.innerText);
    const link = c.querySelector('a[href]')?.getAttribute('href');
    if (title || text) {
      genericItems.push({
        title: title ? title.slice(0, 150) : undefined,
        text: text ? text.slice(0, 300) : undefined,
        link: link ? (link.startsWith('http') ? link : new URL(link, location.href).href) : undefined,
      });
    }
  }

  return {
    ok: true,
    data: {
      platform: 'generic',
      url: location.href,
      title: document.title,
      count: genericItems.length,
      items: genericItems,
    },
  };
}
