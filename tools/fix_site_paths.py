"""Fix the site's internal paths so the URL bar stops showing "/index.html".

Every page links home as `index.html`, so the address bar reads `/index.html`
(and crawlers index that duplicate of the root). Pointing the home link at `/`
gives the canonical URL instead, and the sitemap is realigned to match.

Usage:
    python tools/fix_site_paths.py --dry-run
    python tools/fix_site_paths.py
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
SITE = REPO / "website"

# Every shape the templates use for the home link.
HOME_PATTERNS = [
    (re.compile(r'href="index\.html(#[^"]*)"'), r'href="/\1"'),
    (re.compile(r'href="index\.html"'), 'href="/"'),
    (re.compile(r"href='index\.html'"), "href='/'"),
    (re.compile(r'href="\./index\.html"'), 'href="/"'),
    (re.compile(r'href="/index\.html"'), 'href="/"'),
]


def fix_html(path: Path, dry: bool) -> list[str]:
    text = path.read_text(encoding="utf-8")
    original = text
    notes: list[str] = []
    for pattern, replacement in HOME_PATTERNS:
        found = pattern.findall(text)
        if found:
            text = pattern.sub(replacement, text)
            notes.append('href="/" x%d' % len(found))
    if text != original and not dry:
        path.write_text(text, encoding="utf-8", newline="")
    return notes


def fix_sitemap(path: Path, dry: bool) -> list[str]:
    if not path.is_file():
        return []
    text = path.read_text(encoding="utf-8")
    original = text
    notes: list[str] = []
    base = "https://screensyncmcp.epsoldev.com"
    if ("%s/index.html" % base) in text:
        text = text.replace("%s/index.html" % base, "%s/" % base)
        notes.append("sitemap: home loc -> /")
    if text != original and not dry:
        path.write_text(text, encoding="utf-8", newline="")
    return notes


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args(argv)

    if not SITE.is_dir():
        print("[ERROR] website folder nahi mila: %s" % SITE)
        return 1

    changed = 0
    pages = sorted(SITE.glob("*.html"))
    for page in pages:
        notes = fix_html(page, args.dry_run)
        if notes:
            print("%-20s %s" % (page.name, ", ".join(notes)))
            changed += 1

    for extra in fix_sitemap(SITE / "sitemap.xml", args.dry_run):
        print("%-20s %s" % ("sitemap.xml", extra))
        changed += 1

    print("")
    print("%s: %d file(s) touched out of %d html pages" % ("DRY-RUN" if args.dry_run else "APPLIED", changed, len(pages)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
