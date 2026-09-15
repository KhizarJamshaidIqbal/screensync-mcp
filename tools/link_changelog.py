"""Link the Changelog page from every page, in the header and the footer.

Each page repeats three blocks verbatim, and each one links "Extension" as its
last item before the CTA:

  1. the desktop nav bar        (`hidden md:flex`, class `hover:text-[#6541D6] transition`)
  2. the mobile menu panel      (`#mobileMenu`, class `py-1.5`)
  3. the footer "Pages" group   (`hover:text-white transition`, label "Browser Extension")

The Changelog link is inserted after each of those anchors, so it inherits the
exact typography, spacing and hover behaviour of its neighbours instead of
introducing new styles. Every insertion is guarded by its own exact string, so
re-running the tool is idempotent, and `--audit` reports any region that is still
missing a link.

Usage:
    python tools/link_changelog.py --audit
    python tools/link_changelog.py --dry-run
    python tools/link_changelog.py
"""

from __future__ import annotations

import argparse
import re
import sys
from datetime import date
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
SITE = REPO / "website"
ORIGIN = "https://screensyncmcp.epsoldev.com"
SKIP_PAGES = {"changelog.html"}  # has its own header/footer with the link already

# (region key, label, anchor regex, insertion, fragment used as the idempotency guard)
INSERTIONS = [
    (
        "desktop-nav",
        "desktop nav",
        [
            re.compile(
                r'(<a href="extension\.html" class="hover:text-\[#6541D6\] transition">Extension</a>)'
            )
        ],
        '\n      <a href="changelog.html" class="hover:text-[#6541D6] transition">Changelog</a>',
        '<a href="changelog.html" class="hover:text-[#6541D6] transition">Changelog</a>',
    ),
    (
        "mobile-menu",
        "mobile menu",
        [
            re.compile(r'(<a href="extension\.html" class="py-1\.5">Extension</a>)'),
            re.compile(
                r'(<a href="extension\.html" class="py-1\.5 text-\[#6541D6\] font-semibold">Extension</a>)'
            ),
        ],
        '\n      <a href="changelog.html" class="py-1.5">Changelog</a>',
        '<a href="changelog.html" class="py-1.5">Changelog</a>',
    ),
    (
        "footer",
        "footer",
        [
            re.compile(
                r'(<li><a href="extension\.html" class="hover:text-white transition">Browser Extension</a></li>)'
            )
        ],
        '\n        <li><a href="changelog.html" class="hover:text-white transition">Changelog</a></li>',
        '<li><a href="changelog.html" class="hover:text-white transition">Changelog</a></li>',
    ),
]

SITEMAP_ENTRY = (
    "  <url><loc>%s/changelog.html</loc><lastmod>%s</lastmod>"
    "<changefreq>weekly</changefreq><priority>0.7</priority></url>\n"
)

# A short, reading-first pointer on the pages where a visitor is most likely to wonder
# what changed. Deliberately NOT added to the legal pages (privacy / data policy), where a
# release-note promo would read as noise.
CONTEXTUAL_PAGES = {"index.html", "about.html", "goal.html", "extension.html"}
CONTEXTUAL_GUARD = "read the changelog"
CONTEXTUAL_MARKUP = (
    '<section class="max-w-4xl mx-auto px-5 sm:px-8 pb-14">\n'
    '  <p class="text-sm text-[#4B4460] leading-relaxed">Every release is written down &mdash;\n'
    '    <a href="changelog.html" class="text-[#6541D6] font-semibold underline decoration-dotted">read the changelog</a>\n'
    '    for what changed in the Android app and the browser extension, build by build.</p>\n'
    '</section>\n\n'
)


def apply_page(path: Path, dry: bool) -> list[str]:
    text = path.read_text(encoding="utf-8")
    added: list[str] = []
    for key, _label, anchors, insertion, guard in INSERTIONS:
        if guard in text:
            continue
        for anchor in anchors:
            new_text, count = anchor.subn(lambda m: m.group(1) + insertion, text, count=1)
            if count:
                text = new_text
                added.append(key)
                break

    if path.name in CONTEXTUAL_PAGES and CONTEXTUAL_GUARD not in text and "<footer" in text:
        text = text.replace("<footer", CONTEXTUAL_MARKUP + "<footer", 1)
        added.append("contextual")

    if added and not dry:
        path.write_text(text, encoding="utf-8", newline="")
    return added


def audit() -> list[str]:
    problems: list[str] = []
    for page in sorted(SITE.glob("*.html")):
        if page.name in SKIP_PAGES:
            continue
        text = page.read_text(encoding="utf-8")
        missing = [label for _key, label, _a, _i, guard in INSERTIONS if guard not in text]
        if page.name in CONTEXTUAL_PAGES and CONTEXTUAL_GUARD not in text:
            missing.append("contextual")
        if missing:
            problems.append("%s: missing %s" % (page.name, ", ".join(missing)))
    return problems


def add_sitemap(path: Path, dry: bool, today: str) -> bool:
    if not path.is_file():
        return False
    text = path.read_text(encoding="utf-8")
    if "changelog.html" in text:
        return False
    text = text.replace("</urlset>", SITEMAP_ENTRY % (ORIGIN, today) + "</urlset>")
    if not dry:
        path.write_text(text, encoding="utf-8", newline="")
    return True


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--audit", action="store_true", help="report coverage only")
    ap.add_argument("--lastmod", default=None, help="YYYY-MM-DD (default: today)")
    args = ap.parse_args(argv)

    if args.audit:
        problems = audit()
        if problems:
            print("\n".join(problems))
            return 1
        print("OK: header (desktop + mobile) and footer link the changelog on every page")
        return 0

    today = args.lastmod or date.today().isoformat()
    touched = 0
    for page in sorted(SITE.glob("*.html")):
        if page.name in SKIP_PAGES:
            continue
        added = apply_page(page, args.dry_run)
        if added:
            print("  %-20s +%s" % (page.name, " +".join(added)))
            touched += 1
    if add_sitemap(SITE / "sitemap.xml", args.dry_run, today):
        print("  %-20s +sitemap url" % "sitemap.xml")
        touched += 1

    print("")
    print("%s: %d file(s) updated" % ("DRY-RUN" if args.dry_run else "APPLIED", touched))
    problems = audit()
    print("audit: %s" % ("all three regions linked on every page" if not problems else " / ".join(problems)))
    return 0 if not problems else 1


if __name__ == "__main__":
    sys.exit(main())
