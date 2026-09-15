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

REPO = Path(__file__).resolve().parent.parent
SITE = REPO / "website"
PAGE = SITE / "changelog.html"
FEED = SITE / "changelog.json"

SITE_ORIGIN = "https://screensyncmcp.epsoldev.com"

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
    for item in timeline:
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
        "repo": "github.com/KhizarJamshaidIqbal/screensync-mcp",
        "entries": timeline,
        "stats": {
            "releases": len(timeline),
            "appReleases": sum(1 for e in timeline for p in e["parts"] if p["stream"] == "app"),
            "extensionReleases": sum(1 for e in timeline for p in e["parts"] if p["stream"] == "extension"),
            "changes": sum(e["count"] for e in timeline),
        },
    }


def render(data: dict) -> str:
    payload = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
    return (
        TEMPLATE.replace("__DATA__", payload)
        .replace("__GENERATED__", data["generatedAt"])
        .replace("__RELEASES__", str(data["stats"]["releases"]))
        .replace("__CHANGES__", str(data["stats"]["changes"]))
    )


TEMPLATE = r"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Changelog | ScreenSync MCP</title>
<meta name="description" content="Every ScreenSync MCP release in one place: what changed in the Android app and the browser extension, per build.">
<meta name="robots" content="index,follow">
<meta name="theme-color" content="#6541D6">
<link rel="canonical" href="https://screensyncmcp.epsoldev.com/changelog.html">
<meta property="og:type" content="website">
<meta property="og:url" content="https://screensyncmcp.epsoldev.com/changelog.html">
<meta property="og:title" content="Changelog | ScreenSync MCP">
<meta property="og:description" content="Every ScreenSync MCP release: app and extension changes, per build.">
<meta property="og:image" content="https://screensyncmcp.epsoldev.com/assets/logo.png">
<meta property="og:site_name" content="ScreenSync MCP">
<meta property="og:locale" content="en_US">
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" type="image/png" href="assets/favicon.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@200;300;400;500;600;700;800&display=swap" rel="stylesheet">
<script src="https://cdn.tailwindcss.com"></script>
<script src="https://unpkg.com/lucide@latest"></script>
<link rel="stylesheet" href="css/custom.css">
<style>
  :root {
    --cl-accent: #6541D6;
    --cl-ink: #150E27;
    --cl-dim: #6B6482;
    --cl-line: #EDE9F7;
    --cl-lav: #EFEAF9;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    background: #FBFAFE;
    color: var(--cl-ink);
    font-family: 'Plus Jakarta Sans', 'Inter', system-ui, sans-serif;
    font-weight: 400;
    -webkit-font-smoothing: antialiased;
  }
  .cl-shell { max-width: 1080px; margin: 0 auto; padding: 0 24px 140px; }

  /* ---- header: generous, quiet, one accent ---- */
  .cl-hero { padding: 132px 0 64px; }
  .cl-eyebrow {
    font-size: 11px; font-weight: 700; letter-spacing: .22em; text-transform: uppercase;
    color: var(--cl-accent); margin: 0 0 28px;
  }
  .cl-h1 {
    font-size: clamp(2.6rem, 6vw, 4.2rem); line-height: 1.02; font-weight: 200;
    letter-spacing: -.03em; margin: 0 0 26px;
  }
  .cl-h1 b { font-weight: 600; }
  .cl-lede {
    font-size: 1.0625rem; line-height: 1.75; color: var(--cl-dim);
    max-width: 46ch; margin: 0 0 40px; font-weight: 400;
  }
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
    appearance: none; cursor: pointer;
    border: 1px solid var(--cl-line); background: #fff; color: var(--cl-dim);
    padding: 9px 20px; border-radius: 999px; font: inherit; font-size: 13px; font-weight: 600;
    transition: color .25s ease, border-color .25s ease, background .25s ease;
  }
  .cl-chip:hover { border-color: var(--cl-accent); color: var(--cl-accent); }
  .cl-chip[aria-pressed="true"] { background: var(--cl-accent); border-color: var(--cl-accent); color: #fff; }
  .cl-search {
    flex: 1 1 220px; min-width: 180px;
    border: 1px solid var(--cl-line); background: #fff; color: var(--cl-ink);
    padding: 11px 16px; border-radius: 999px; font: inherit; font-size: 14px;
  }
  .cl-search:focus, .cl-chip:focus-visible { outline: 2px solid var(--cl-accent); outline-offset: 2px; }
  .cl-count { font-size: 12px; color: var(--cl-dim); margin-left: auto; white-space: nowrap; }

  /* ---- timeline ---- */
  .cl-list { list-style: none; margin: 0; padding: 0; }
  .cl-entry {
    position: relative; padding: 48px 0 48px 0; border-bottom: 1px solid var(--cl-line);
  }
  .cl-entry:last-child { border-bottom: 0; }
  .cl-when {
    display: flex; flex-wrap: wrap; align-items: baseline; gap: 14px; margin: 0 0 22px;
  }
  .cl-date { font-size: 12px; letter-spacing: .16em; text-transform: uppercase; color: var(--cl-dim); }
  .cl-tag {
    font-size: 11px; font-weight: 700; letter-spacing: .06em;
    padding: 4px 11px; border-radius: 999px; border: 1px solid var(--cl-line);
    background: #fff; color: var(--cl-ink);
  }
  .cl-tag.app { border-color: rgba(101,65,214,.35); color: var(--cl-accent); }
  .cl-tag.ext { border-color: rgba(139,106,236,.4); color: #6F4FD8; background: var(--cl-lav); }
  .cl-title { font-size: 1.5rem; font-weight: 300; letter-spacing: -.02em; margin: 0 0 26px; }
  .cl-title b { font-weight: 600; }
  .cl-group { margin: 0 0 22px; }
  .cl-group h3 {
    font-size: 10px; letter-spacing: .22em; text-transform: uppercase;
    color: var(--cl-dim); font-weight: 700; margin: 0 0 12px;
  }
  .cl-group ul { margin: 0; padding: 0; list-style: none; }
  .cl-group li {
    position: relative; padding-left: 20px; margin: 0 0 10px;
    font-size: 15px; line-height: 1.65; color: #322A46;
  }
  .cl-group li::before {
    content: ""; position: absolute; left: 2px; top: .62em;
    width: 6px; height: 6px; border-radius: 50%; background: var(--cl-accent); opacity: .5;
  }
  .cl-group.new li::before { background: #12A150; opacity: .75; }
  .cl-group.fixed li::before { background: #C2410C; opacity: .7; }
  .cl-actions { display: flex; gap: 18px; flex-wrap: wrap; margin-top: 26px; }
  .cl-link {
    appearance: none; background: none; border: 0; padding: 0; cursor: pointer;
    font: inherit; font-size: 12px; font-weight: 600; color: var(--cl-dim);
    border-bottom: 1px solid transparent; transition: color .25s ease, border-color .25s ease;
  }
  .cl-link:hover { color: var(--cl-accent); border-color: var(--cl-accent); }
  .cl-sha { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; color: var(--cl-dim); }

  /* ---- empty state (the error path a filter can hit) ---- */
  .cl-empty {
    display: none; padding: 96px 0; text-align: center; color: var(--cl-dim);
  }
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

<!-- The site's standard header. The Changelog item carries the active state, so the
     page you are on is obvious, and the mobile menu carries its own copy. -->
<header class="glass-nav fixed top-0 inset-x-0 z-50">
  <nav class="max-w-7xl mx-auto px-5 sm:px-8 h-16 flex items-center justify-between" aria-label="Main">
    <a href="/" class="flex items-center gap-2.5">
      <img src="assets/logo.png" alt="ScreenSync MCP logo" class="w-9 h-9 rounded-xl shadow-md shadow-purple-200">
      <span class="font-extrabold tracking-tight text-lg">ScreenSync <span class="grad-text">MCP</span></span>
    </a>
    <div class="hidden md:flex items-center gap-7 text-[15px] font-medium text-[#4B4460]">
      <a href="/" class="hover:text-[#6541D6] transition">Home</a>
      <a href="about.html" class="hover:text-[#6541D6] transition">About</a>
      <a href="goal.html" class="hover:text-[#6541D6] transition">Goal</a>
      <a href="privacy.html" class="hover:text-[#6541D6] transition">Privacy</a>
      <a href="data-policy.html" class="hover:text-[#6541D6] transition">Data Policy</a>
      <a href="extension.html" class="hover:text-[#6541D6] transition">Extension</a>
      <a href="changelog.html" class="text-[#6541D6] font-semibold" aria-current="page">Changelog</a>
      <a href="/#connect" class="btn-primary px-5 py-2 rounded-full text-sm font-semibold">Get Connected</a>
    </div>
    <button id="burger" class="md:hidden p-2 rounded-lg hover:bg-purple-50" aria-label="Menu" aria-expanded="false"><i data-lucide="menu" class="w-6 h-6"></i></button>
  </nav>
  <div id="mobileMenu" class="md:hidden bg-white/95 border-b border-purple-100">
    <div class="px-6 py-4 flex flex-col gap-3 text-[15px] font-medium">
      <a href="/" class="py-1.5">Home</a><a href="about.html" class="py-1.5">About</a><a href="goal.html" class="py-1.5">Goal</a><a href="privacy.html" class="py-1.5">Privacy</a><a href="data-policy.html" class="py-1.5">Data Policy</a>
      <a href="extension.html" class="py-1.5">Extension</a>
      <a href="changelog.html" class="py-1.5 text-[#6541D6] font-semibold" aria-current="page">Changelog</a>
    </div>
  </div>
</header>

<div class="cl-shell">

  <header class="cl-hero">
    <p class="cl-eyebrow">Changelog</p>
    <h1 class="cl-h1">Every build, <b>written down.</b></h1>
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
    <span class="cl-count" id="cl-count"></span>
  </div>

  <ul class="cl-list" id="cl-list"></ul>

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
</div>

<!-- The site's standard footer. -->
<footer class="bg-[#150E27] text-purple-200/80">
  <div class="max-w-7xl mx-auto px-5 sm:px-8 py-14 grid sm:grid-cols-3 gap-10">
    <div>
      <div class="flex items-center gap-2.5"><img src="assets/logo.png" alt="ScreenSync MCP" class="w-9 h-9 rounded-xl"><span class="font-extrabold text-white text-lg">ScreenSync MCP</span></div>
      <p class="text-sm mt-4 leading-relaxed text-purple-200/60">Your AI, watching over your shoulder. Live Android screen capture &amp; control for MCP agents — LAN-first, privacy-first.</p>
    </div>
    <div>
      <h4 class="text-white font-bold mb-4">Pages</h4>
      <ul class="space-y-2.5 text-sm">
        <li><a href="/" class="hover:text-white transition">Home</a></li>
        <li><a href="about.html" class="hover:text-white transition">About Us</a></li>
        <li><a href="goal.html" class="hover:text-white transition">Goal &amp; Vision</a></li>
        <li><a href="privacy.html" class="hover:text-white transition">Privacy Policy</a></li>
        <li><a href="data-policy.html" class="hover:text-white transition">Data Policy</a></li>
        <li><a href="extension.html" class="hover:text-white transition">Browser Extension</a></li>
        <li><a href="changelog.html" class="text-white transition" aria-current="page">Changelog</a></li>
      </ul>
    </div>
    <div>
      <h4 class="text-white font-bold mb-4">Contact</h4>
      <ul class="space-y-2.5 text-sm">
        <li class="flex items-center gap-2"><i data-lucide="globe" class="w-4 h-4"></i><a href="https://epsoldev.com" class="hover:text-white transition">epsoldev.com</a></li>
        <li class="flex items-center gap-2"><i data-lucide="mail" class="w-4 h-4"></i><a href="mailto:info@epsoldev.com" class="hover:text-white transition">info@epsoldev.com</a></li>
      </ul>
    </div>
  </div>
  <div class="border-t border-white/10 py-6 text-center text-xs text-purple-200/50">© <span class="year"></span> EpsolDev · ScreenSync MCP v2.5 · All rights reserved.</div>
</footer>

<script src="js/main.js"></script>

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

  function entryId(entry) {
    var first = entry.parts[0];
    return (first.stream === 'app' ? 'app-' : 'ext-') + String(first.version).replace(/[^0-9A-Za-z.]+/g, '-');
  }

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

  // Deep link: #app-2.5.4 should reveal and highlight that entry.
  if (location.hash) {
    var target = document.querySelector(location.hash);
    if (target) { target.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
  }
})();
</script>
</body>
</html>
"""


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
