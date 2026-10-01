#!/usr/bin/env python3
"""Keep website/sitemap.xml <lastmod> dates honest.

Each <url>'s <lastmod> becomes the date of the last git commit that touched the
page's file, or today's date when the file has uncommitted changes (or is not
committed yet). Only the <lastmod> text changes; everything else in the file,
including <image:image> entries, is left byte-for-byte as it was.

URL -> file:  https://www.screensyncmcp.tech/           -> website/index.html
              https://www.screensyncmcp.tech/about.html -> website/about.html

Usage:
    python tools/update_sitemap_lastmod.py           # rewrite the dates in place
    python tools/update_sitemap_lastmod.py --check   # exit 1 if any date is stale
"""

from __future__ import annotations

import argparse
import re
import subprocess
import sys
from datetime import date
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
SITE = REPO / "website"
SITEMAP = SITE / "sitemap.xml"
ORIGIN = "https://www.screensyncmcp.tech"

URL_BLOCK = re.compile(r"<url>.*?</url>", re.S)
LOC = re.compile(r"<loc>\s*([^<\s]+)\s*</loc>")
LASTMOD = re.compile(r"<lastmod>[^<]*</lastmod>")


def git(*args: str) -> str:
    result = subprocess.run(
        ["git", *args], cwd=str(REPO), capture_output=True, text=True, encoding="utf-8", errors="replace"
    )
    if result.returncode != 0:
        raise SystemExit("[ERROR] git %s failed: %s" % (" ".join(args), result.stderr.strip()[:200]))
    return result.stdout


def file_for(loc: str) -> Path | None:
    """Map a sitemap URL on this site to the HTML file that serves it."""
    if not loc.startswith(ORIGIN + "/"):
        return None
    path = loc[len(ORIGIN):].split("#", 1)[0].split("?", 1)[0]
    if path.endswith("/"):
        path += "index.html"
    return SITE / path.lstrip("/")


def lastmod_for(page: Path, today: str) -> tuple[str, str]:
    """Return (date, reason) for one page file."""
    if not page.is_file():
        return today, "missing file"
    rel = page.relative_to(REPO).as_posix()
    if git("status", "--porcelain", "--", rel).strip():
        return today, "uncommitted changes"
    stamp = git("log", "-1", "--format=%cd", "--date=short", "--", rel).strip()
    if not stamp:
        return today, "not committed"
    return stamp, "last commit"


def update(text: str, today: str) -> tuple[str, list[tuple[str, str, str, str]], list[str]]:
    """Rewrite every <lastmod>. Returns (new text, rows, problems)."""
    rows: list[tuple[str, str, str, str]] = []
    problems: list[str] = []

    def fix(match: re.Match) -> str:
        block = match.group(0)
        loc = LOC.search(block)
        if not loc:
            problems.append("a <url> without <loc>")
            return block
        page = file_for(loc.group(1))
        if page is None:
            problems.append("%s is not on %s" % (loc.group(1), ORIGIN))
            return block
        stamp, reason = lastmod_for(page, today)
        if reason == "missing file":
            problems.append("%s -> %s does not exist" % (loc.group(1), page.relative_to(REPO).as_posix()))
        old = LASTMOD.search(block)
        rows.append((loc.group(1), old.group(0)[9:-10] if old else "-", stamp, reason))
        tag = "<lastmod>%s</lastmod>" % stamp
        if old:
            return block[: old.start()] + tag + block[old.end():]
        return block[: loc.end()] + tag + block[loc.end():]

    return URL_BLOCK.sub(fix, text), rows, problems


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--check", action="store_true", help="exit 1 if any <lastmod> is stale")
    args = ap.parse_args(argv)

    text = SITEMAP.read_text(encoding="utf-8")
    new_text, rows, problems = update(text, date.today().isoformat())

    for loc, old, new, reason in rows:
        mark = "  " if old == new else "->"
        print("%s %-52s %s %s %s (%s)" % (mark, loc, old, "->" if old != new else "==", new, reason))
    for problem in problems:
        print("[WARN] %s" % problem, file=sys.stderr)

    stale = new_text != text
    if args.check:
        if problems:
            print("[ERROR] sitemap.xml has %d problem(s), see the warnings above" % len(problems))
        if stale:
            print("[STALE] sitemap.xml lastmod dates are out of date - run: python tools/update_sitemap_lastmod.py")
        if stale or problems:
            return 1
        print("[OK] sitemap.xml lastmod dates are current (%d urls)" % len(rows))
        return 0

    if stale:
        SITEMAP.write_text(new_text, encoding="utf-8", newline="")
        print("wrote %s (%d urls)" % (SITEMAP.relative_to(REPO).as_posix(), len(rows)))
    else:
        print("sitemap.xml already current (%d urls)" % len(rows))
    return 0


if __name__ == "__main__":
    sys.exit(main())
