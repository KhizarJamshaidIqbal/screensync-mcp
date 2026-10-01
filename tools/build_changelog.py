#!/usr/bin/env python3
"""Generate the site's changelog from git history - app and extension together.

Why this exists
---------------
The site ships a `website/downloads/*` zip and a Play build, and both had no
public record of what changed. This writes:

    website/changelog.html   the page (self-contained, filter + search, no build step)
    website/changelog.json   the same data as a feed, for the app or an agent to read

Where the versions come from
----------------------------
  * app        -> `version:` in pubspec.yaml           (2.5.4+32 -> 2.5.4 (build 32))
  * extension  -> `"version"` in extension/version.json (1.8.0)

A release entry lists the commits that landed since that stream's previous
version bump, filtered to the paths that stream owns, and classified with the
repo's Conventional Commit convention (feat -> NEW, fix -> FIXED, perf/refactor
-> IMPROVED). Housekeeping types (chore/docs/test/style/build/ci) are skipped
because a user reading the changelog cannot act on them.

Usage:
    python tools/build_changelog.py              # write both files
    python tools/build_changelog.py --check      # fail if the page is stale
    python tools/build_changelog.py --stdout     # print the JSON only
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

from changelog_template import TEMPLATE
from site_chrome import site_chrome

REPO = Path(__file__).resolve().parent.parent
SITE = REPO / "website"
PAGE = SITE / "changelog.html"
FEED = SITE / "changelog.json"

SITE_ORIGIN = "https://www.screensyncmcp.tech"

SKIP_TYPES = {"chore", "docs", "test", "style", "build", "ci"}
SKIP_SCOPES = {"release", "ci", "docs", "tooling", "deps", "repo"}
GROUP_FOR_TYPE = {"feat": "NEW", "fix": "FIXED", "perf": "IMPROVED", "refactor": "IMPROVED", "revert": "FIXED"}
GROUP_ORDER = ("NEW", "IMPROVED", "FIXED")
SKIP_SUBJECTS = (
    "rebuild the extension and hub packages",
    "re-ccut the extension",
    "re-cut the extension",
    "version bump",
    "bump version",
    "sync from main@",
    "line endings",
    "tool count",
)
CONVENTIONAL = re.compile(r"^(?P<type>[a-zA-Z]+)(?:\((?P<scope>[^)]*)\))?!?:\s*(?P<subject>.+)$")

STREAMS = {
    "app": {"paths": ("lib/", "android/"), "label": "App"},
    "extension": {"paths": ("extension/",), "label": "Extension"},
}


def git(*args: str) -> str:
    result = subprocess.run(
        ["git", *args], cwd=str(REPO), capture_output=True, text=True, encoding="utf-8", errors="replace"
    )
    if result.returncode != 0:
        raise SystemExit("[ERROR] git %s failed: %s" % (" ".join(args), result.stderr.strip()[:200]))
    return result.stdout


def clean(text: str) -> str:
    return text.replace("\ufeff", "").lstrip("\ufeff").strip()


def version_markers(stream: str) -> list[dict]:
    """Commits that bumped a stream's version, newest first."""
    markers: list[dict] = []
    if stream == "app":
        log = git("log", "--date=short", "--pretty=format:@%h|%ct|%ad|%s", "-p", "--", "pubspec.yaml")
        head = None
        for line in log.splitlines():
            if line.startswith("@"):
                parts = line[1:].split("|", 3)
                if len(parts) == 4:
                    head = parts
            elif line.startswith("+version:") and head:
                raw = clean(line[len("+version:") :])
                name, _, build = raw.partition("+")
                markers.append(
                    {"stream": stream, "sha": head[0], "ts": int(head[1]), "date": head[2], "subject": clean(head[3]),
                     "version": name, "build": build or "", "display": "%s (build %s)" % (name, build) if build else name}
                )
    else:
        log = git("log", "--date=short", "--pretty=format:@%h|%ct|%ad|%s", "-p", "--", "extension/version.json")
        head = None
        for line in log.splitlines():
            if line.startswith("@"):
                parts = line[1:].split("|", 3)
                if len(parts) == 4:
                    head = parts
            elif line.startswith('+  "version"') or line.startswith('+"version"'):
                found = re.search(r'"version"\s*:\s*"([^"]+)"', line)
                if found and head:
                    markers.append(
                        {"stream": stream, "sha": head[0], "ts": int(head[1]), "date": head[2], "subject": clean(head[3]),
                         "version": found.group(1), "build": "", "display": found.group(1)}
                    )
    return markers


def commits_between(paths: tuple[str, ...], newest: str, oldest: str | None) -> list[tuple[str, str, str]]:
    # For the oldest marker there is no previous bump, so take everything reachable
    # from it. `A^..A` is rejected by git for a marker whose parent is a merge root.
    rng = newest if oldest is None else "%s..%s" % (oldest, newest)
    log = git("log", "--date=short", "--pretty=format:%h\x1f%ad\x1f%s", rng, "--", *paths)
    out = []
    for line in log.splitlines():
        parts = line.split("\x1f")
        if len(parts) == 3:
            out.append((parts[0], parts[1], clean(parts[2])))
    return out


def classify(subject: str) -> tuple[str, str] | None:
    low = subject.lower()
    if any(skip in low for skip in SKIP_SUBJECTS):
        return None
    match = CONVENTIONAL.match(subject)
    if not match:
        return "IMPROVED", subject
    ctype = match.group("type").lower()
    scope = (match.group("scope") or "").lower()
    if ctype in SKIP_TYPES:
        return None
    if scope and scope.split(",")[0] in SKIP_SCOPES:
        return None
    body = clean(match.group("subject")).rstrip(" .")
    if body and body[0].islower():
        body = body[0].upper() + body[1:]
    return GROUP_FOR_TYPE.get(ctype, "IMPROVED"), body


def build() -> dict:
    entries: list[dict] = []
    for stream, cfg in STREAMS.items():
        markers = version_markers(stream)
        for index, marker in enumerate(markers):
            previous = markers[index + 1]["sha"] if index + 1 < len(markers) else None
            groups: dict[str, list[str]] = {name: [] for name in GROUP_ORDER}
            seen: set[str] = set()
            for _sha, _date, subject in commits_between(cfg["paths"], marker["sha"], previous):
                verdict = classify(subject)
                if verdict is None:
                    continue
                group, body = verdict
                key = body.lower()
                if not body or key in seen:
                    continue
                seen.add(key)
                groups[group].append(body)
            if not any(groups.values()):
                continue
            entries.append(
                {
                    "stream": stream,
                    "streamLabel": cfg["label"],
                    "version": marker["version"],
                    "build": marker["build"],
                    "display": marker["display"],
                    "date": marker["date"],
                    "ts": marker["ts"],
                    "sha": marker["sha"],
                    "groups": groups,
                    "count": sum(len(v) for v in groups.values()),
                }
            )

    # One release can bump both streams on the same commit - merge those.
    merged: dict[str, dict] = {}
    for entry in entries:
        key = entry["sha"]
        if key in merged:
            merged[key]["parts"].append(entry)
        else:
            merged[key] = {
                "sha": entry["sha"],
                "date": entry["date"],
                "ts": entry["ts"],
                "parts": [entry],
                "count": entry["count"],
            }
    # Newest first by commit time: several bumps share a date, so sorting on the
    # date alone puts 32 above 31 and reads backwards.
    timeline = sorted(merged.values(), key=lambda e: (e["ts"], e["sha"]), reverse=True)
    # Anchors must be unique: several builds can share a version (App 2.5.4 = builds 32, 31, 29).
    # The newest keeps the plain id so old "#app-2.5.4" links still land; older ones get "-b<build>".
    seen: set[str] = set()
    for item in timeline:
        first = item["parts"][0]
        anchor = ("app-" if first["stream"] == "app" else "ext-") + re.sub(r"[^0-9A-Za-z.]+", "-", str(first["version"]))
        if anchor in seen:
            anchor += ("-b%s" % first["build"]) if first.get("build") else "-" + item["sha"][:7]
        if anchor in seen:
            anchor += "-" + item["sha"][:7]
        seen.add(anchor)
        item["id"] = anchor
        item["count"] = sum(p["count"] for p in item["parts"])
        title_bits = []
        for part in item["parts"]:
            if part["stream"] == "app":
                title_bits.append("App %s" % part["display"])
            else:
                title_bits.append("Extension %s" % part["display"])
        item["title"] = " + ".join(title_bits)

    return {
        "generatedAt": datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
        "entries": timeline,
        "stats": {
            "releases": len(timeline),
            "appReleases": sum(1 for e in timeline for p in e["parts"] if p["stream"] == "app"),
            "extensionReleases": sum(1 for e in timeline for p in e["parts"] if p["stream"] == "extension"),
            "changes": sum(e["count"] for e in timeline),
        },
    }


def esc(value: object) -> str:
    """Same escaping as the page's client-side esc(), so both renders match."""
    table = {"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}
    return "".join(table.get(ch, ch) for ch in str(value))


def entry_html(entry: dict) -> str:
    """Static twin of entryHtml() in the page script: crawlers get the list without JS."""
    anchor = esc(entry["id"])
    tags, titles, groups = [], [], []
    for part in entry["parts"]:
        app = part["stream"] == "app"
        build_note = " &middot; build " + part["build"] if part["build"] else ""
        tags.append('<span class="cl-tag %s">%s</span>' % ("app" if app else "ext",
                    ("App " + part["version"] + build_note) if app else "Extension " + part["version"]))
        titles.append(part["version"] if app else "Extension " + part["version"])
        for name in GROUP_ORDER:
            items = part["groups"].get(name) or []
            if items:
                groups.append('<div class="cl-group %s"><h3>%s &middot; %s</h3><ul>%s</ul></div>' % (
                    name.lower(), name, esc(part["streamLabel"]), "".join("<li>%s</li>" % esc(i) for i in items)))
    count = entry["count"]
    return ('<li class="cl-entry" id="%s"><div class="cl-when"><span class="cl-date">%s</span>%s</div>'
            '<h2 class="cl-title">%s <b>&middot;</b> %d change%s</h2>%s<div class="cl-actions">'
            '<button class="cl-link" type="button" data-copy="%s">Copy link</button><span class="cl-sha">%s</span></div></li>') % (
        anchor, esc(entry["date"]), "".join(tags), " <b>+</b> ".join(titles), count, "" if count == 1 else "s",
        "".join(groups), anchor, esc(entry["sha"]))


def render(data: dict) -> str:
    # "</" is escaped so a commit subject can never close the JSON <script> block.
    payload = json.dumps(data, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/")
    header, footer = site_chrome(PAGE.name)
    return (
        TEMPLATE.replace("__HEADER__", header)
        .replace("__FOOTER__", footer)
        .replace("__ENTRIES__", "\n".join(entry_html(e) for e in data["entries"]))
        .replace("__DATA__", payload)
        .replace("__GENERATED__", data["generatedAt"])
        .replace("__RELEASES__", str(data["stats"]["releases"]))
        .replace("__CHANGES__", str(data["stats"]["changes"]))
    )


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--stdout", action="store_true", help="print the JSON feed only")
    ap.add_argument("--check", action="store_true", help="fail if the page is out of date")
    args = ap.parse_args(argv)

    data = build()
    page = render(data)
    feed = json.dumps(data, indent=2, ensure_ascii=False) + "\n"

    if args.stdout:
        print(feed, end="")
        return 0

    if args.check:
        if FEED.is_file():
            try:
                disk_feed = json.loads(FEED.read_text(encoding="utf-8"))
                if disk_feed.get("generatedAt"):
                    data["generatedAt"] = disk_feed["generatedAt"]
                    page = render(data)
                    feed = json.dumps(data, indent=2, ensure_ascii=False) + "\n"
            except Exception:
                pass
        stale = []
        if not PAGE.is_file() or PAGE.read_text(encoding="utf-8") != page:
            stale.append(PAGE.name)
        if not FEED.is_file() or FEED.read_text(encoding="utf-8") != feed:
            stale.append(FEED.name)
        if stale:
            print("[STALE] %s out of date - run: python tools/build_changelog.py" % ", ".join(stale))
            return 1
        print("[OK] changelog is up to date (%d releases, %d changes)" % (data["stats"]["releases"], data["stats"]["changes"]))
        return 0

    PAGE.write_text(page, encoding="utf-8", newline="")
    FEED.write_text(feed, encoding="utf-8", newline="")
    print("wrote %s (%d bytes)" % (PAGE.relative_to(REPO), len(page.encode('utf-8'))))
    print("wrote %s (%d bytes)" % (FEED.relative_to(REPO), len(feed.encode('utf-8'))))
    print("releases=%d app=%d extension=%d changes=%d" % (
        data["stats"]["releases"], data["stats"]["appReleases"], data["stats"]["extensionReleases"], data["stats"]["changes"]))
    return 0


if __name__ == "__main__":
    sys.exit(main())
