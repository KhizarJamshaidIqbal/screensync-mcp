#!/usr/bin/env python3
"""One header and one footer for every page of the website.

website/index.html holds the canonical header (desktop nav + #mobileMenu) and footer. Everything
else is a copy, so the navigation cannot drift between pages:

  * hand-written pages (about, goal, extension, 404, ...): this script rewrites their copies
  * generated pages (setup.html, changelog.html): their generators call site_chrome()

Edit the header or footer in index.html only, then run this script and both generators.

The only per-page difference is aria-current="page": it sits on every menu and footer link to the
page you are on (never on the logo). Links are page-relative because every page is top-level;
404.html is served at any URL depth, so it must carry <base href="/">, which --check enforces.

Usage:
    python tools/site_chrome.py            # copy index.html's header + footer into the other pages
    python tools/site_chrome.py --check    # exit 1 if any page's copy differs (no writes)
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

SITE = Path(__file__).resolve().parent.parent / "website"
INDEX = SITE / "index.html"
GENERATED = {"setup.html", "changelog.html"}  # tools/build_setup_page.py, tools/build_changelog.py
# Search-engine ownership files (google<hex>.html) must stay byte-exact, or verification breaks.
VERIFICATION = re.compile(r"^google[0-9a-f]+\.html$")
HEADER = re.compile(r'<header class="glass-nav.*?</header>', re.S)
FOOTER = re.compile(r'<footer class="bg-\[#150E27\].*?</footer>', re.S)
CURRENT = ' aria-current="page"'


def _blocks(text: str, name: str) -> tuple[str, str]:
    header, footer = HEADER.findall(text), FOOTER.findall(text)
    if len(header) != 1 or len(footer) != 1:
        raise SystemExit("[ERROR] %s: expected one site header and one footer, found %d and %d"
                         % (name, len(header), len(footer)))
    return header[0], footer[0]


def _mark(block: str, page: str) -> str:
    """Move aria-current="page" onto the links that point at `page` (the logo link is skipped)."""
    href = "/" if page == "index.html" else page
    block = block.replace(CURRENT, "")
    return re.sub(r'<a href="%s"(?= class="(?!flex ))' % re.escape(href), lambda m: m.group(0) + CURRENT, block)


def site_chrome(page: str) -> tuple[str, str]:
    """(header, footer) from index.html, marked for `page` (a file name such as "setup.html")."""
    header, footer = _blocks(INDEX.read_text(encoding="utf-8"), INDEX.name)
    return _mark(header, page), _mark(footer, page)


def synced(path: Path) -> str:
    """The page's text with its header and footer replaced by the canonical copies."""
    text = path.read_text(encoding="utf-8")
    old_header, old_footer = _blocks(text, path.name)
    header, footer = site_chrome(path.name)
    return text.replace(old_header, header, 1).replace(old_footer, footer, 1)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true", help="report pages whose header/footer differ; write nothing")
    args = ap.parse_args(argv)

    problems: list[str] = []
    pages = [p for p in sorted(SITE.glob("*.html")) if p.name not in GENERATED and not VERIFICATION.match(p.name)]
    for path in pages:
        text = path.read_text(encoding="utf-8")
        if path.name == "404.html" and '<base href="/">' not in text:
            problems.append('404.html: missing <base href="/"> (its page-relative links break below the root)')
        new = synced(path)
        if new == text:
            continue
        if args.check:
            problems.append("%s: header/footer differ from index.html" % path.name)
        else:
            path.write_text(new, encoding="utf-8", newline="")
            print("  synced %s" % path.name)

    if problems:
        print("\n".join(problems))
        print("run: python tools/site_chrome.py, then python tools/build_setup_page.py and python tools/build_changelog.py")
        return 1
    print("[OK] header and footer match index.html on %d hand-written pages" % len(pages))
    return 0


if __name__ == "__main__":
    sys.exit(main())
