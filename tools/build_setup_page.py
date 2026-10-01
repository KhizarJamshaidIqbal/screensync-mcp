#!/usr/bin/env python3
"""Generate the setup guide page (website/setup.html) from website/setup-guide.json.

Why this exists
---------------
setup-guide.json is the machine-readable install guide that the app and agents read. The
human page must say exactly the same thing, so it is rendered from that file instead of
being hand-edited: every hub step, environment variable, MCP config, HTTP endpoint,
pairing format and troubleshooting item in the JSON appears on the page.

The site header and footer are copied from website/index.html at build time (tools/site_chrome.py),
with the Setup links marked as the current page, so the page never drifts from the rest of the site.

Output is deterministic: no timestamps, stable ids, sorted nothing that is ordered in the
JSON. Re-run after changing setup-guide.json, the site header/footer in index.html, or the
"tested with" versions below.

Usage:
    python tools/build_setup_page.py              # write website/setup.html
    python tools/build_setup_page.py --check      # exit 1 if setup.html is stale
    python tools/build_setup_page.py --stdout     # print the page only
"""

from __future__ import annotations

import argparse
import html
import json
import re
import sys
from pathlib import Path

from site_chrome import site_chrome

REPO = Path(__file__).resolve().parent.parent
SITE = REPO / "website"
GUIDE = SITE / "setup-guide.json"
PAGE = SITE / "setup.html"

ORIGIN = "https://www.screensyncmcp.tech"
URL = ORIGIN + "/setup.html"
PLAY = "https://play.google.com/store/apps/details?id=com.screensync.mcp"
ORG = "https://epsoldev.com/#organization"

# A claim, not a lookup: change these by hand only after re-testing the guide end to end.
UPDATED_ISO, UPDATED_TEXT = "2026-10-01", "1 October 2026"
TESTED_APP, TESTED_APP_BUILD, TESTED_HUB = "2.5.7", "35", "1.14.4"

TITLE = "Control Android with Claude: ScreenSync MCP Setup Guide"
H1 = "How to control Android with Claude using the ScreenSync MCP server"
DESCRIPTION = ("Install the ScreenSync MCP hub, pair your Android phone and add it to Claude Code, "
               "Claude Desktop, Cursor or VS Code. Copy-ready configs included.")
OG_ALT = "ScreenSync MCP setup guide: hub, phone pairing and MCP config for Claude"


def esc(value: str) -> str:
    return html.escape(str(value), quote=True)


# Code-like tokens in the guide's prose are set in <code>; real https links become links.
TOKEN = re.compile(
    r"(?P<code>git clone \S+|https?://localhost:\d+|(?:sh |node )?\b[a-z][\w-]*\.(?:bat|sh|js|json|command)\b"
    r"|SCREEN_SYNC_\w+|/api/[\w/:.-]*\w)"
    r"|(?P<url>https://[^\s)]+[^\s).,;])"
)


def inline(text: str) -> str:
    out, pos = [], 0
    for m in TOKEN.finditer(text):
        out.append(esc(text[pos:m.start()]))
        if m.group("code"):
            out.append("<code>%s</code>" % esc(m.group("code")))
        else:
            url = m.group("url")
            href = url[len(ORIGIN):] if url.startswith(ORIGIN + "/") else url
            ext = "" if href.startswith("/") else ' rel="noopener"'
            out.append('<a href="%s"%s>%s</a>' % (esc(href), ext, esc(url)))
        pos = m.end()
    out.append(esc(text[pos:]))
    return "".join(out)


class Blocks:
    """Hands out stable ids for copyable code blocks."""

    def __init__(self) -> None:
        self.n = 0

    def code(self, label: str, body: str) -> str:
        self.n += 1
        cid = "code-%d" % self.n
        return (
            '<div class="code-block"><div class="code-head"><span>%s</span>'
            '<button type="button" class="copy-btn" data-copy-target="%s" aria-label="Copy: %s">Copy</button></div>'
            '<pre id="%s"><code>%s</code></pre></div>' % (esc(label), cid, esc(label), cid, esc(body))
        )


def file_label(label: str) -> str:
    """'.mcp.json (project root)' -> '<code>.mcp.json</code> (project root)'."""
    name, sep, note = label.partition(" (")
    return "<code>%s</code>%s" % (esc(name), (" (" + esc(note)) if sep else "")


def default_of(desc: str) -> tuple[str, str]:
    m = re.search(r"\s*\(default:\s*([^)]+)\)\s*$", desc)
    return (desc[: m.start()].strip(), m.group(1).strip()) if m else (desc.strip(), "")


def schema() -> str:
    graph = [
        {"@type": "Organization", "@id": ORG, "name": "EpsolDev", "url": "https://epsoldev.com/", "email": "info@epsoldev.com"},
        {"@type": "WebSite", "@id": ORIGIN + "/#website", "url": ORIGIN + "/", "name": "ScreenSync MCP",
         "alternateName": ["ScreenSync"], "publisher": {"@id": ORG}, "inLanguage": "en-US"},
        {"@type": "WebPage", "@id": URL + "#webpage", "url": URL, "name": TITLE, "description": DESCRIPTION,
         "isPartOf": {"@id": ORIGIN + "/#website"}, "breadcrumb": {"@id": URL + "#breadcrumb"},
         "mainEntity": {"@id": URL + "#article"}, "datePublished": UPDATED_ISO, "dateModified": UPDATED_ISO, "inLanguage": "en-US"},
        {"@type": "TechArticle", "@id": URL + "#article", "headline": H1, "description": DESCRIPTION,
         "author": {"@id": ORG}, "publisher": {"@id": ORG}, "datePublished": UPDATED_ISO, "dateModified": UPDATED_ISO,
         "image": ORIGIN + "/assets/og/og-setup.jpg", "mainEntityOfPage": {"@id": URL + "#webpage"}, "inLanguage": "en-US",
         "proficiencyLevel": "Beginner",
         "dependencies": "ScreenSync MCP app %s on Android 7.0 or later; Node.js 18 or later; ADB for control tools" % TESTED_APP},
        {"@type": "BreadcrumbList", "@id": URL + "#breadcrumb", "itemListElement": [
            {"@type": "ListItem", "position": 1, "name": "Home", "item": ORIGIN + "/"},
            {"@type": "ListItem", "position": 2, "name": "Setup guide", "item": URL}]},
    ]
    return json.dumps({"@context": "https://schema.org", "@graph": graph}, indent=2, ensure_ascii=False)


def head() -> str:
    og = ORIGIN + "/assets/og/og-setup.jpg"
    return "\n".join([
        "<!DOCTYPE html>", '<html lang="en">', "<head>", '<meta charset="UTF-8">',
        '<meta name="viewport" content="width=device-width, initial-scale=1.0">',
        "<title>%s</title>" % esc(TITLE),
        '<meta name="description" content="%s">' % esc(DESCRIPTION),
        '<meta name="robots" content="index,follow">', '<meta name="author" content="EpsolDev">',
        '<meta name="theme-color" content="#6541D6">', '<link rel="canonical" href="%s">' % URL,
        '<meta property="og:type" content="article">', '<meta property="og:site_name" content="ScreenSync MCP">',
        '<meta property="og:locale" content="en_US">', '<meta property="og:url" content="%s">' % URL,
        '<meta property="og:title" content="%s">' % esc(TITLE),
        '<meta property="og:description" content="%s">' % esc(DESCRIPTION),
        '<meta property="og:image" content="%s">' % og,
        '<meta property="og:image:width" content="1200">', '<meta property="og:image:height" content="630">',
        '<meta property="og:image:alt" content="%s">' % esc(OG_ALT),
        '<meta name="twitter:card" content="summary_large_image">',
        '<meta name="twitter:title" content="%s">' % esc(TITLE),
        '<meta name="twitter:description" content="%s">' % esc(DESCRIPTION),
        '<meta name="twitter:image" content="%s">' % og, '<meta name="twitter:image:alt" content="%s">' % esc(OG_ALT),
        '<link rel="icon" href="/favicon.ico" sizes="any">', '<link rel="icon" type="image/png" href="/assets/icon-192.png">',
        '<link rel="apple-touch-icon" href="/assets/apple-touch-icon.png">', '<link rel="manifest" href="/site.webmanifest">',
        '<link rel="preconnect" href="https://fonts.googleapis.com">',
        '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>',
        '<link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet">',
        '<script>document.documentElement.classList.add("js")</script>',
        '<script src="https://cdn.tailwindcss.com/3.4.17"></script>',
        '<script src="https://unpkg.com/lucide@0.469.0/dist/umd/lucide.min.js" defer></script>',
        '<link rel="stylesheet" href="css/custom.css">', '<link rel="stylesheet" href="css/docs.css">',
        '<script type="application/ld+json">', schema(), "</script>", "</head>",
        '<body class="bg-[#FAFAFC] text-[#1E1633] antialiased">', "",
    ])


def table(head_cells: list[str], rows: list[list[str]], caption: str = "", min_width: int = 0) -> str:
    style = ' style="min-width:%dpx"' % min_width if min_width else ""
    cap = "<caption>%s</caption>" % esc(caption) if caption else ""
    th = "".join('<th scope="col">%s</th>' % esc(c) for c in head_cells)
    body = "\n".join("<tr><th scope=\"row\">%s</th>%s</tr>" % (r[0], "".join("<td>%s</td>" % c for c in r[1:])) for r in rows)
    return ('<div class="doc-table-wrap"><table class="doc-table"%s>%s<thead><tr>%s</tr></thead>\n<tbody>\n%s\n</tbody></table></div>'
            % (style, cap, th, body))


def h2(anchor: str, num: str, text: str) -> str:
    badge = '<span class="step-num" aria-hidden="true">%s</span>' % num if num else ""
    return '<h2 id="%s">%s%s</h2>' % (anchor, badge, esc(text))


def body(guide: dict) -> str:
    b = Blocks()
    hub, mcp = guide["hubInstall"], guide["mcpConfig"]
    env = hub["envVars"]
    token_default = default_of(env.get("SCREEN_SYNC_TOKEN", ""))[1] or "screensync-local-dev"
    entry = json.loads(mcp["claudeCode"]["template"])["mcpServers"]["screensync"]
    vscode = json.dumps({"servers": {"screensync": {"type": "stdio", **entry}}}, indent=2)
    out: list[str] = []
    add = out.append

    add('<section class="hero-glow pt-28 pb-10 sm:pt-36 sm:pb-12"><div class="max-w-3xl mx-auto px-5 sm:px-8">')
    add('<nav class="crumbs" aria-label="Breadcrumb"><ol><li><a href="/">Home</a></li><li aria-current="page">Setup guide</li></ol></nav>')
    add('<h1 class="mt-5 text-4xl sm:text-5xl font-extrabold leading-[1.1] tracking-tight">%s</h1>' % esc(H1))
    add('<p class="mt-6 text-lg text-[#4B4460] leading-relaxed">To control an Android phone with Claude, run the free ScreenSync MCP hub on your '
        'computer, pair the ScreenSync MCP app with it, and add the hub to Claude Code or Claude Desktop as a local MCP server. '
        'Screen capture works at once; turn on USB or wireless debugging to let Claude tap, swipe and type. It takes about ten minutes.</p>')
    add('<p class="doc-meta mt-5">Last updated %s &middot; Tested with app %s / hub %s</p>' % (UPDATED_TEXT, TESTED_APP, TESTED_HUB))
    add('<div class="mt-7 flex flex-wrap gap-3">'
        '<a href="downloads/screensync-hub.zip" class="btn-primary px-6 py-3 rounded-full font-semibold inline-flex items-center gap-2">'
        '<i data-lucide="download" class="w-5 h-5"></i> Download the hub (zip)</a>'
        '<a href="%s" target="_blank" rel="noopener" class="btn-secondary px-6 py-3 rounded-full font-semibold inline-flex items-center gap-2">'
        '<i data-lucide="smartphone" class="w-5 h-5"></i> Get the app on Google Play</a></div>' % PLAY)
    add("</div></section>")

    add('<div class="max-w-3xl mx-auto px-5 sm:px-8 pb-20">')
    add('<nav class="doc-toc lux-card no-lift p-6 mb-12" aria-label="On this page"><p class="font-bold text-[#1E1633] mb-3">On this page</p><ol>')
    for anchor, label in [("requirements", "Requirements"), ("install-hub", "1. Install the hub"), ("connect-client", "2. Connect your AI client"),
                          ("pair-phone", "3. Pair the phone"), ("control", "4. Turn on control tools"), ("env-vars", "Environment variables"),
                          ("endpoints", "HTTP endpoints"), ("troubleshooting", "Troubleshooting"), ("privacy", "Privacy and next steps")]:
        add('<li><a href="#%s">%s</a></li>' % (anchor, esc(label)))
    add("</ol></nav>")
    add('<article class="doc-prose">')

    add(h2("requirements", "", "Requirements"))
    add(table(["Part", "What you need"], [
        ["Android phone", 'Android 7.0 or later with the <a href="%s" target="_blank" rel="noopener">ScreenSync MCP app</a> (tested with %s, build %s)'
         % (PLAY, TESTED_APP, TESTED_APP_BUILD)],
        ["Screen capture", "No root and no ADB. Android asks for your consent each session (MediaProjection)."],
        ["Control tools", "Tap, swipe, type and launch app run through ADB from the hub, with the phone on USB or wireless debugging."],
        ["Computer", "Windows, macOS or Linux with Node.js 18 or later for the hub (tested with hub %s)." % TESTED_HUB],
        ["Network", "Phone and computer on the same network. The Google Drive fallback is optional."],
        ["AI client", "Any MCP client that runs local stdio servers: Claude Code, Claude Desktop, Cursor or VS Code."],
        ["Browser tools (optional)", 'Chrome or Edge with the <a href="extension.html">ScreenSync browser extension</a> %s.' % TESTED_HUB],
    ], min_width=560))

    add(h2("install-hub", "1", "Install the hub on your computer"))
    add("<p>You need: %s.</p>" % "; ".join(inline(p) for p in hub["prerequisites"]))
    add("<ol>")
    for step in hub["steps"]:
        add("<li>%s</li>" % inline(step))
    add("</ol>")
    add(b.code("Windows", "start-hub.bat"))
    add(b.code("macOS or Linux", "sh start-hub.sh"))
    add('<p>Leave that terminal open: the hub has to keep running while your agent works.</p>')

    add(h2("connect-client", "2", "Connect your AI client"))
    add("<p>Every client below runs the hub the same way: the command <code>node</code> with the path to <code>screensync-hub.js</code> as its "
        "argument. Replace <code>&lt;HUB_DIR&gt;</code> with the folder where you unzipped the hub (on Windows, use forward slashes or doubled "
        "backslashes inside JSON) and <code>&lt;TOKEN&gt;</code> with the hub's <code>SCREEN_SYNC_TOKEN</code> (default: <code>%s</code>).</p>"
        % esc(token_default))
    add("<h3>Claude Code</h3>")
    add("<p>Add the server to %s:</p>" % file_label(mcp["claudeCode"]["file"]))
    add(b.code(mcp["claudeCode"]["file"], mcp["claudeCode"]["template"]))
    add("<p>Or register it from the terminal with one command:</p>")
    add(b.code("Claude Code %s" % mcp["cli"]["file"], mcp["cli"]["template"]))
    add("<h3>Claude Desktop</h3>")
    add("<p>Open %s and add the server:</p>" % file_label(mcp["claudeDesktop"]["file"]))
    add(b.code(mcp["claudeDesktop"]["file"], mcp["claudeDesktop"]["template"]))
    add("<p>Restart the client after saving. Then try a first prompt such as <em>&ldquo;Take a screenshot of my phone and tell me which app is "
        "open.&rdquo;</em></p>")
    add("<h3>Cursor, VS Code and any other stdio MCP client</h3>")
    add("<p>Any client that runs local (stdio) MCP servers needs the same three values: the command <code>node</code>, one argument with the "
        "full path to <code>screensync-hub.js</code>, and the <code>SCREEN_SYNC_TOKEN</code> environment variable. Where the config lives and the "
        "top-level key differ between clients, so check your client's MCP docs. Two common layouts:</p>")
    add("<ul><li><strong>Cursor:</strong> <code>.cursor/mcp.json</code> in your project (or <code>~/.cursor/mcp.json</code> for every project), "
        "using the same <code>mcpServers</code> block as Claude Code above.</li>"
        "<li><strong>VS Code:</strong> <code>.vscode/mcp.json</code> in your workspace, with a <code>servers</code> key and <code>\"type\": \"stdio\"</code>:</li></ul>")
    add(b.code(".vscode/mcp.json", vscode))
    add("<h3>HTTP only (no MCP client)</h3>")
    add("<p>Tools that do not speak MCP can call the hub over HTTP at <code>%s</code> with the header <code>%s</code>. %s</p>"
        % (esc(mcp["httpOnly"]["baseUrl"]), esc(mcp["httpOnly"]["header"]), inline(mcp["httpOnly"]["note"])))
    add('<div class="callout warn"><span class="callout-title">Not supported: ChatGPT web</span>'
        "<p>ChatGPT's web app connects only to remote HTTPS MCP servers. The ScreenSync MCP hub runs on your computer and speaks MCP over "
        "stdio, so ChatGPT web cannot use it today.</p></div>")

    add(h2("pair-phone", "3", "Pair the phone with the hub"))
    add("<p>Open the ScreenSync MCP app and scan the QR code that the hub prints in its terminal (or shows at <code>/pair</code>).</p>")
    add("<p><strong>Automatic discovery</strong> (mDNS service <code>%s</code>): %s</p>"
        % (esc(guide["discovery"]["mdnsType"]), inline(guide["discovery"]["note"])))
    add("<p>If you pair by hand, the app and extension accept any of these formats:</p>")
    add(b.code("Pairing formats", "\n".join(guide["pairingFormats"])))
    add("<p>Grant the screen-capture prompt when the app asks. Frames then stream to the hub, and your agent can call "
        "<code>get_latest_screenshot</code>.</p>")

    add(h2("control", "4", "Turn on the control tools (ADB)"))
    add("<p>Capture needs nothing more. To let the agent tap, swipe, type and launch apps, the hub sends those actions through ADB:</p>")
    add("<ol><li>Install ADB (Android platform-tools) on the computer that runs the hub.</li>"
        "<li>On the phone, turn on developer options, then <strong>USB debugging</strong> or <strong>wireless debugging</strong>.</li>"
        "<li>Connect the phone by cable or pair it for wireless debugging, accept the prompt on the phone, and check that it is listed:</li></ol>")
    add(b.code("Terminal", "adb devices"))
    add("<p>With more than one device attached, set <code>SCREEN_SYNC_ADB_TARGET</code> to the phone's serial. If <code>adb</code> is not on "
        "your PATH, point <code>SCREEN_SYNC_ADB_BIN</code> at it.</p>")

    add(h2("env-vars", "", "Environment variables"))
    rows = []
    for name, desc in env.items():
        text, default = default_of(desc)
        rows.append(["<code>%s</code>" % esc(name), esc(text), "<code>%s</code>" % esc(default) if default else "&mdash;"])
    add(table(["Variable", "What it does", "Default"], rows, min_width=600))
    add('<div class="callout"><p>Change <code>SCREEN_SYNC_TOKEN</code> from its default before you run the hub on a shared network, and use the '
        "same value in the app, the extension and your MCP config.</p></div>")

    add(h2("endpoints", "", "HTTP endpoints"))
    add("<p>The hub serves these on port 3000. Endpoints marked &ldquo;Bearer token&rdquo; need <code>Authorization: Bearer &lt;TOKEN&gt;</code>.</p>")
    add(table(["Endpoint", "Auth", "Purpose"], [
        ["<code>%s %s</code>" % (esc(e["method"]), esc(e["path"])), "Bearer token" if e["auth"] else "None", esc(e["purpose"])]
        for e in guide["httpEndpoints"]
    ], min_width=620))

    add(h2("troubleshooting", "", "Troubleshooting"))
    add("<ul>")
    for item in guide["troubleshooting"]:
        problem, sep, fix = item.partition(" — ")
        add("<li><strong>%s</strong>%s</li>" % (esc(problem), (" &mdash; " + inline(fix)) if sep else ""))
    add("</ul>")
    add('<p>Still stuck? Email <a href="mailto:info@epsoldev.com">info@epsoldev.com</a> with the hub\'s terminal output.</p>')

    add(h2("privacy", "", "Privacy and next steps"))
    add("<p>Frames go from the phone to the hub over your own network with the bearer token, and nothing goes to EpsolDev servers. "
        "Screenshots that your AI agent requests are sent to that agent's model provider, so close sensitive apps before a session. "
        'The <a href="data-policy.html">data policy</a> lists where every byte is stored.</p>')
    add('<ul><li>Learn how capture, control and live streaming work in the <a href="screen-mcp.html">screen MCP guide</a>.</li>'
        '<li>See how ScreenSync MCP stacks up: <a href="android-mcp-servers.html">compare Android MCP servers</a>.</li>'
        '<li>Give the agent your browser too with the <a href="extension.html">ScreenSync browser extension</a>.</li>'
        '<li>Back to the <a href="/">Android MCP server for Claude</a> home page.</li></ul>')
    add("</article></div>")
    return "\n".join(out)


COPY_SCRIPT = """<script>
// Copy buttons on code blocks. Falls back to selecting the text so Ctrl+C / Cmd+C works.
document.addEventListener('click', function (e) {
  var btn = e.target.closest ? e.target.closest('[data-copy-target]') : null;
  if (!btn) return;
  var el = document.getElementById(btn.getAttribute('data-copy-target'));
  if (!el) return;
  var say = function (label) { btn.textContent = label; setTimeout(function () { btn.textContent = 'Copy'; }, 1500); };
  var select = function () {
    var range = document.createRange(); range.selectNodeContents(el);
    var sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(range);
    say('Press Ctrl+C');
  };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(el.textContent).then(function () { say('Copied'); }, select);
  } else { select(); }
});
</script>"""


def render(guide: dict) -> str:
    header, footer = site_chrome(PAGE.name)
    parts = [head(), header, "", '<main id="main">', body(guide), "</main>", "", footer, "",
             '<script src="js/main.js" defer></script>', COPY_SCRIPT, "</body>", "</html>", ""]
    return "\n".join(parts)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true", help="fail if website/setup.html is out of date")
    ap.add_argument("--stdout", action="store_true", help="print the page instead of writing it")
    args = ap.parse_args(argv)

    guide = json.loads(GUIDE.read_text(encoding="utf-8"))
    page = render(guide)

    if args.stdout:
        sys.stdout.write(page)
        return 0
    if args.check:
        if not PAGE.is_file() or PAGE.read_text(encoding="utf-8") != page:
            print("[STALE] setup.html out of date - run: python tools/build_setup_page.py")
            return 1
        print("[OK] setup.html is up to date (%d steps, %d env vars, %d endpoints)"
              % (len(guide["hubInstall"]["steps"]), len(guide["hubInstall"]["envVars"]), len(guide["httpEndpoints"])))
        return 0
    PAGE.write_text(page, encoding="utf-8", newline="")
    print("wrote %s (%d bytes)" % (PAGE.relative_to(REPO), len(page.encode("utf-8"))))
    return 0


if __name__ == "__main__":
    sys.exit(main())
