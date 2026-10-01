"""The changelog page template, rendered by tools/build_changelog.py.

Placeholders filled at render time: __HEADER__ and __FOOTER__ (the site header and footer, copied from
website/index.html by tools/site_chrome.py), __ENTRIES__ (static release list), __DATA__ (the JSON feed
that drives search and filter), __GENERATED__, __RELEASES__ and __CHANGES__.
"""

TEMPLATE = r"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>ScreenSync MCP Changelog: Android App &amp; Extension Releases</title>
<meta name="description" content="Release notes for every ScreenSync MCP build: what changed in the Android app and the Chrome and Edge extension, generated from the repository history.">
<meta name="robots" content="index,follow">
<meta name="theme-color" content="#6541D6">
<link rel="canonical" href="https://www.screensyncmcp.tech/changelog.html">
<meta property="og:type" content="website">
<meta property="og:url" content="https://www.screensyncmcp.tech/changelog.html">
<meta property="og:title" content="ScreenSync MCP Changelog: Android App &amp; Extension Releases">
<meta property="og:description" content="What changed in the ScreenSync MCP Android app and browser extension, release by release.">
<meta property="og:image" content="https://www.screensyncmcp.tech/assets/og/og-default.jpg">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="ScreenSync MCP: live Android screen capture and control for AI agents">
<meta property="og:site_name" content="ScreenSync MCP">
<meta property="og:locale" content="en_US">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="ScreenSync MCP Changelog: Android App &amp; Extension Releases">
<meta name="twitter:description" content="What changed in the ScreenSync MCP Android app and browser extension, release by release.">
<meta name="twitter:image" content="https://www.screensyncmcp.tech/assets/og/og-default.jpg">
<meta name="twitter:image:alt" content="ScreenSync MCP: live Android screen capture and control for AI agents">
<link rel="icon" href="/favicon.ico" sizes="any">
<link rel="icon" type="image/png" href="/assets/icon-192.png">
<link rel="apple-touch-icon" href="/assets/apple-touch-icon.png">
<link rel="manifest" href="/site.webmanifest">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@200;300;400;500;600;700;800&display=swap" rel="stylesheet">
<script>document.documentElement.classList.add("js")</script>
<script src="https://cdn.tailwindcss.com/3.4.17"></script>
<script src="https://unpkg.com/lucide@0.469.0/dist/umd/lucide.min.js" defer></script>
<link rel="stylesheet" href="css/custom.css">
<script type="application/ld+json">
{"@context": "https://schema.org", "@graph": [
  {"@type": "CollectionPage", "@id": "https://www.screensyncmcp.tech/changelog.html#webpage", "url": "https://www.screensyncmcp.tech/changelog.html",
   "name": "ScreenSync MCP changelog: every Android app and extension release", "inLanguage": "en-US", "dateModified": "__GENERATED__",
   "description": "Release notes for every ScreenSync MCP build: what changed in the Android app and the Chrome and Edge extension.",
   "isPartOf": {"@type": "WebSite", "@id": "https://www.screensyncmcp.tech/#website", "name": "ScreenSync MCP", "url": "https://www.screensyncmcp.tech/"},
   "publisher": {"@type": "Organization", "@id": "https://epsoldev.com/#organization", "name": "EpsolDev", "url": "https://epsoldev.com/"},
   "breadcrumb": {"@id": "https://www.screensyncmcp.tech/changelog.html#breadcrumb"}},
  {"@type": "BreadcrumbList", "@id": "https://www.screensyncmcp.tech/changelog.html#breadcrumb", "itemListElement": [
   {"@type": "ListItem", "position": 1, "name": "Home", "item": "https://www.screensyncmcp.tech/"},
   {"@type": "ListItem", "position": 2, "name": "Changelog", "item": "https://www.screensyncmcp.tech/changelog.html"}]}
]}
</script>
<style>
  :root { --cl-accent: #6541D6; --cl-ink: #150E27; --cl-dim: #6B6482; --cl-line: #EDE9F7; --cl-lav: #EFEAF9; }
  * { box-sizing: border-box; }
  body {
    margin: 0; background: #FBFAFE; color: var(--cl-ink); font-weight: 400;
    font-family: 'Plus Jakarta Sans', 'Inter', system-ui, sans-serif; -webkit-font-smoothing: antialiased;
  }
  .cl-shell { max-width: 1080px; margin: 0 auto; padding: 0 24px 140px; }

  /* ---- header: generous, quiet, one accent ---- */
  .cl-hero { padding: 132px 0 64px; }
  .cl-eyebrow { font-size: 11px; font-weight: 700; letter-spacing: .22em; text-transform: uppercase; color: var(--cl-accent); margin: 0 0 28px; }
  .cl-h1 { font-size: clamp(2.1rem, 4.8vw, 3.4rem); line-height: 1.08; font-weight: 200; letter-spacing: -.03em; margin: 0 0 26px; max-width: 22ch; }
  .cl-h1 b { font-weight: 600; }
  .cl-lede { font-size: 1.0625rem; line-height: 1.75; color: var(--cl-dim); max-width: 46ch; margin: 0 0 40px; font-weight: 400; }
  .cl-stat-row { display: flex; flex-wrap: wrap; gap: 56px; margin: 0 0 8px; }
  .cl-stat .n { font-size: 2.25rem; font-weight: 600; letter-spacing: -.02em; display: block; }
  .cl-stat .l { font-size: 11px; letter-spacing: .18em; text-transform: uppercase; color: var(--cl-dim); }
  .cl-feed { margin-top: 40px; display: flex; gap: 14px; flex-wrap: wrap; }

  /* ---- controls ---- */
  .cl-controls {
    position: sticky; top: 0; z-index: 20;
    display: flex; flex-wrap: wrap; gap: 14px; align-items: center;
    padding: 18px 0; margin: 0 0 8px;
    /* A flat background instead of backdrop-filter: the blur made the chips
       report as "moving or animating" to automation, so a click could not land. */
    background: #FBFAFE;
    border-bottom: 1px solid var(--cl-line);
  }
  .cl-chip {
    appearance: none; cursor: pointer; border: 1px solid var(--cl-line); background: #fff; color: var(--cl-dim); padding: 9px 20px;
    border-radius: 999px; font: inherit; font-size: 13px; font-weight: 600; transition: color .25s ease, border-color .25s ease, background .25s ease;
  }
  .cl-chip:hover { border-color: var(--cl-accent); color: var(--cl-accent); }
  .cl-chip[aria-pressed="true"] { background: var(--cl-accent); border-color: var(--cl-accent); color: #fff; }
  .cl-search {
    flex: 1 1 220px; min-width: 180px; border: 1px solid var(--cl-line); background: #fff; color: var(--cl-ink);
    padding: 11px 16px; border-radius: 999px; font: inherit; font-size: 14px;
  }
  .cl-search:focus, .cl-chip:focus-visible { outline: 2px solid var(--cl-accent); outline-offset: 2px; }
  .cl-count { font-size: 12px; color: var(--cl-dim); margin-left: auto; white-space: nowrap; }

  /* ---- timeline ---- */
  .cl-list { list-style: none; margin: 0; padding: 0; }
  .cl-entry { position: relative; padding: 48px 0 48px 0; border-bottom: 1px solid var(--cl-line); }
  .cl-entry:last-child { border-bottom: 0; }
  .cl-when { display: flex; flex-wrap: wrap; align-items: baseline; gap: 14px; margin: 0 0 22px; }
  .cl-date { font-size: 12px; letter-spacing: .16em; text-transform: uppercase; color: var(--cl-dim); }
  .cl-tag {
    font-size: 11px; font-weight: 700; letter-spacing: .06em; padding: 4px 11px; border-radius: 999px;
    border: 1px solid var(--cl-line); background: #fff; color: var(--cl-ink);
  }
  .cl-tag.app { border-color: rgba(101,65,214,.35); color: var(--cl-accent); }
  .cl-tag.ext { border-color: rgba(139,106,236,.4); color: #6F4FD8; background: var(--cl-lav); }
  .cl-title { font-size: 1.5rem; font-weight: 300; letter-spacing: -.02em; margin: 0 0 26px; }
  .cl-title b { font-weight: 600; }
  .cl-group { margin: 0 0 22px; }
  .cl-group h3 { font-size: 10px; letter-spacing: .22em; text-transform: uppercase; color: var(--cl-dim); font-weight: 700; margin: 0 0 12px; }
  .cl-group ul { margin: 0; padding: 0; list-style: none; }
  .cl-group li { position: relative; padding-left: 20px; margin: 0 0 10px; font-size: 15px; line-height: 1.65; color: #322A46; }
  .cl-group li::before { content: ""; position: absolute; left: 2px; top: .62em; width: 6px; height: 6px; border-radius: 50%; background: var(--cl-accent); opacity: .5; }
  .cl-group.new li::before { background: #12A150; opacity: .75; }
  .cl-group.fixed li::before { background: #C2410C; opacity: .7; }
  .cl-actions { display: flex; gap: 18px; flex-wrap: wrap; margin-top: 26px; }
  .cl-link {
    appearance: none; background: none; border: 0; padding: 0; cursor: pointer; font: inherit; font-size: 12px; font-weight: 600;
    color: var(--cl-dim); border-bottom: 1px solid transparent; transition: color .25s ease, border-color .25s ease;
  }
  .cl-link:hover { color: var(--cl-accent); border-color: var(--cl-accent); }
  .cl-sha { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; color: var(--cl-dim); }

  /* ---- empty state (the error path a filter can hit) ---- */
  .cl-empty { display: none; padding: 96px 0; text-align: center; color: var(--cl-dim); }
  .cl-empty.show { display: block; }
  .cl-empty strong { display: block; font-size: 1.125rem; font-weight: 600; color: var(--cl-ink); margin-bottom: 8px; }

  .cl-foot { padding-top: 72px; color: var(--cl-dim); font-size: 13px; line-height: 1.8; }
  .cl-foot a { color: var(--cl-accent); text-decoration: none; }
  .cl-foot a:hover { text-decoration: underline; }
  @media (max-width: 640px) {
    .cl-hero { padding: 96px 0 40px; }
    .cl-stat-row { gap: 32px; }
    .cl-entry { padding: 38px 0; }
  }
  @media print { .cl-controls, .cl-actions { display: none; } }
</style>
</head>
<body class="bg-[#FAFAFC] text-[#1E1633] antialiased">

<!-- site header: copied from website/index.html by tools/site_chrome.py -->
__HEADER__

<main id="main" class="cl-shell">

  <header class="cl-hero">
    <p class="cl-eyebrow">Changelog</p>
    <h1 class="cl-h1">ScreenSync MCP changelog: <b>every Android app and extension release</b></h1>
    <p class="cl-lede">
      What actually changed in the Android app and the browser extension, release by release.
      Generated from this repository's history, so it cannot drift from what shipped.
    </p>
    <div class="cl-stat-row">
      <div class="cl-stat"><span class="n">__RELEASES__</span><span class="l">Releases</span></div>
      <div class="cl-stat"><span class="n">__CHANGES__</span><span class="l">Changes logged</span></div>
    </div>
    <div class="cl-feed">
      <a class="cl-chip" href="changelog.json" style="text-decoration:none">JSON feed</a>
      <a class="cl-chip" href="/" style="text-decoration:none">Back to home</a>
      <a class="cl-chip" href="extension.html" style="text-decoration:none">Get the extension</a>
    </div>
  </header>

  <div class="cl-controls">
    <button class="cl-chip" type="button" data-filter="all" aria-pressed="true">All</button>
    <button class="cl-chip" type="button" data-filter="app" aria-pressed="false">App</button>
    <button class="cl-chip" type="button" data-filter="extension" aria-pressed="false">Extension</button>
    <input class="cl-search" id="cl-q" type="search" placeholder="Search a change&hellip;" aria-label="Search the changelog">
    <span class="cl-count" id="cl-count">__RELEASES__ of __RELEASES__ releases</span>
  </div>

  <ul class="cl-list" id="cl-list">
__ENTRIES__
  </ul>

  <div class="cl-empty" id="cl-empty">
    <strong>Nothing matches that.</strong>
    Try a different word, or switch the filter back to All.
  </div>

  <footer class="cl-foot">
    Generated __GENERATED__ from the repository history. App builds arrive on
    <a href="https://play.google.com/store/apps/details?id=com.screensync.mcp" target="_blank" rel="noopener">Google Play</a>;
    the extension ships from <a href="extension.html">the extension page</a>.
    This page is rebuilt by <span class="cl-sha">tools/build_changelog.py</span> on every release.
  </footer>
</main>

<!-- site footer: copied from website/index.html by tools/site_chrome.py -->
__FOOTER__

<script src="js/main.js" defer></script>

<script id="cl-data" type="application/json">__DATA__</script>
<script>
(function () {
  var data = JSON.parse(document.getElementById('cl-data').textContent);
  var list = document.getElementById('cl-list');
  var empty = document.getElementById('cl-empty');
  var countEl = document.getElementById('cl-count');
  var input = document.getElementById('cl-q');
  var chips = Array.prototype.slice.call(document.querySelectorAll('.cl-chip[data-filter]'));
  var filter = 'all';
  var query = '';

  function esc(value) {
    return String(value).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function textOf(entry) {
    var t = entry.title + ' ' + (entry.date || '') + ' ' + (entry.sha || '');
    entry.parts.forEach(function (part) {
      t += ' ' + part.display + ' ' + part.streamLabel;
      Object.keys(part.groups).forEach(function (k) { t += ' ' + part.groups[k].join(' '); });
    });
    return t.toLowerCase();
  }

  function matchesFilter(entry) {
    if (filter === 'all') return true;
    return entry.parts.some(function (p) { return p.stream === filter; });
  }

  // Unique anchor computed once by tools/build_changelog.py (repeated versions get "-b<build>").
  function entryId(entry) { return entry.id; }

  function groupHtml(part) {
    var html = '';
    ['NEW', 'IMPROVED', 'FIXED'].forEach(function (name) {
      var items = part.groups[name] || [];
      if (!items.length) return;
      html += '<div class="cl-group ' + name.toLowerCase() + '"><h3>' + name + ' &middot; ' +
        esc(part.streamLabel) + '</h3><ul>';
      items.forEach(function (item) { html += '<li>' + esc(item) + '</li>'; });
      html += '</ul></div>';
    });
    return html;
  }

  function entryHtml(entry) {
    var tags = entry.parts.map(function (p) {
      var cls = p.stream === 'app' ? 'app' : 'ext';
      var label = p.stream === 'app' ? ('App ' + p.version + (p.build ? ' &middot; build ' + p.build : '')) : ('Extension ' + p.version);
      return '<span class="cl-tag ' + cls + '">' + label + '</span>';
    }).join('');
    var title = entry.parts.map(function (p) {
      return p.stream === 'app' ? p.version : ('Extension ' + p.version);
    }).join(' <b>+</b> ');
    var groups = entry.parts.map(groupHtml).join('');
    return '<li class="cl-entry" id="' + esc(entryId(entry)) + '">' +
      '<div class="cl-when"><span class="cl-date">' + esc(entry.date) + '</span>' + tags + '</div>' +
      '<h2 class="cl-title">' + title + ' <b>&middot;</b> ' + entry.count + ' change' + (entry.count === 1 ? '' : 's') + '</h2>' +
      groups +
      '<div class="cl-actions">' +
        '<button class="cl-link" type="button" data-copy="' + esc(entryId(entry)) + '">Copy link</button>' +
        '<span class="cl-sha">' + esc(entry.sha) + '</span>' +
      '</div></li>';
  }

  function render() {
    var visible = data.entries.filter(function (entry) {
      if (!matchesFilter(entry)) return false;
      if (!query) return true;
      return textOf(entry).indexOf(query) !== -1;
    });
    list.innerHTML = visible.map(entryHtml).join('');
    empty.classList.toggle('show', visible.length === 0);
    countEl.textContent = visible.length + ' of ' + data.entries.length + ' releases';
  }

  chips.forEach(function (chip) {
    chip.addEventListener('click', function () {
      filter = chip.getAttribute('data-filter');
      chips.forEach(function (c) { c.setAttribute('aria-pressed', String(c === chip)); });
      render();
    });
  });

  input.addEventListener('input', function () {
    query = input.value.trim().toLowerCase();
    render();
  });

  list.addEventListener('click', function (event) {
    var button = event.target.closest('[data-copy]');
    if (!button) return;
    var url = location.origin + location.pathname + '#' + button.getAttribute('data-copy');
    var done = function () {
      var old = button.textContent;
      button.textContent = 'Copied';
      setTimeout(function () { button.textContent = old; }, 1400);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(done, done);
    } else {
      done();
    }
  });

  render();

  // Deep link: #app-2.5.4 should reveal that entry. getElementById, not querySelector: the
  // dots in a version make "#app-2.5.4" an invalid CSS selector.
  if (location.hash) {
    var target = document.getElementById(decodeURIComponent(location.hash.slice(1)));
    if (target) { target.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
  }
})();
</script>
</body>
</html>
"""
