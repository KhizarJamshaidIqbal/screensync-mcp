"""Link the changelog from every page's nav and add it to the sitemap.

The nav block is repeated verbatim in each page, so the link is inserted by
anchoring on the existing "Extension" nav item rather than by regenerating the
pages - that keeps the diff to one line per file.

Usage:
    python tools/link_changelog.py --dry-run
    python tools/link_changelog.py
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
SITE = REPO / "website"
ORIGIN = "https://screensyncmcp.epsoldev.com"

NAV_ANCHOR = re.compile(
    r'(<a href="extension\.html" class="hover:text-\[#6541D6\] transition">Extension</a>)'
)
NAV_ADD = (
    r'\1\n      <a href="changelog.html" class="hover:text-[#6541D6] transition">Changelog</a>'
)

SITEMAP_ENTRY = (
    "  <url><loc>%s/changelog.html</loc><lastmod>%s</lastmod>"
    "<changefreq>weekly</changefreq><priority>0.7</priority></url>\n"
)


def add_nav(path: Path, dry: bool, today: str) -> bool:
    text = path.read_text(encoding="utf-8")
    if "changelog.html" in text:
        return False
    new_text, count = NAV_ANCHOR.subn(NAV_ADD, text)
    if count == 0:
        print("  [skip] %s - nav anchor not found" % path.name)
        return False
    if not dry:
        path.write_text(new_text, encoding="utf-8", newline="")
    print("  %s: nav link added" % path.name)
    return True


def add_sitemap(path: Path, dry: bool, today: str) -> bool:
    if not path.is_file():
        return False
    text = path.read_text(encoding="utf-8")
    if "changelog.html" in text:
        return False
    entry = SITEMAP_ENTRY % (ORIGIN, today)
    text = text.replace("</urlset>", entry + "</urlset>")
    if not dry:
        path.write_text(text, encoding="utf-8", newline="")
    print("  sitemap.xml: changelog url added")
    return True


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--lastmod", default=None, help="YYYY-MM-DD (default: today)")
    args = ap.parse_args(argv)

    from datetime import date

    today = args.lastmod or date.today().isoformat()
    touched = 0
    for page in sorted(SITE.glob("*.html")):
        if page.name == "changelog.html":
            continue
        if add_nav(page, args.dry_run, today):
            touched += 1
    if add_sitemap(SITE / "sitemap.xml", args.dry_run, today):
        touched += 1

    print("")
    print("%s: %d target(s) updated" % ("DRY-RUN" if args.dry_run else "APPLIED", touched))
    return 0


if __name__ == "__main__":
    sys.exit(main())
