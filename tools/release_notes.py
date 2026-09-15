#!/usr/bin/env python3
"""Build Google Play release notes ("What's new") from this repository's git history.

Play's rule (official):
    "You can enter release notes using up to 500 Unicode characters per language."
    https://support.google.com/googleplay/android-developer/answer/9859348

So the notes must
  * say what actually changed for the user, and
  * fit in 500 characters.

What this tool does:
  * reads the conventional-commit history,
  * keeps only commits that touched the ANDROID APP (lib/ and android/), so hub,
    extension and website work never leaks into the Play listing,
  * drops internal-only types (chore/docs/test/style/build/ci),
  * groups what is left into NEW / IMPROVED / FIXED,
  * enforces the 500-character budget with a balanced trim.

Examples:
    python tools/release_notes.py --list-versions
    python tools/release_notes.py --since-version 2.5.0
    python tools/release_notes.py --from 0805557 --write build/notes.en-US.txt
    python tools/release_notes.py --check build/notes.en-US.txt

Exit codes:
    0  ok (notes produced or validated)
    1  problem (bad range, missing file, notes too long / empty)
    2  usage error
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path

MAX_CHARS = 500
# Paths that belong to the Android app the Play listing describes.
APP_PATHS = ("lib/", "android/")
# Paths that ship separately (hub, extension, website) - off by default.
WEB_PATHS = ("mcp-server/", "extension/", "website/", "assets/")
PLACEHOLDER_PATTERNS = (
    "bug fixes and improvements",
    "bug fixes and performance improvements",
    "bug fixes",
    "minor fixes",
    "various fixes",
    "performance improvements",
    "general improvements",
    "maintenance release",
    "tbd",
    "todo",
    "n/a",
)
GROUP_FOR_TYPE = {
    "feat": "NEW",
    "fix": "FIXED",
    "perf": "IMPROVED",
    "refactor": "IMPROVED",
    "revert": "FIXED",
}
SKIP_TYPES = {"chore", "docs", "test", "style", "build", "ci"}
SKIP_SCOPES = {"release", "ci", "docs", "tooling", "deps", "repo", "website"}
SKIP_SUBJECTS = (
    "rebuild the extension and hub packages",
    "sync the published tool count",
    "version bump",
    "bump version",
    "independent review",
    "catalogue",
    "consistency guard",
    "declared tools",
    "orchestrator",
    "excis",
    "handler",
    "schema",
    "ref-count",
    "monolith",
    "line endings",
)
CONVENTIONAL = re.compile(r"^(?P<type>[a-zA-Z]+)(?:\((?P<scope>[^)]*)\))?!?:\s*(?P<subject>.+)$")
GROUP_ORDER = ("NEW", "IMPROVED", "FIXED")


def run_git(repo: Path, *args: str) -> str:
    result = subprocess.run(
        ["git", *args],
        cwd=str(repo),
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    if result.returncode != 0:
        raise SystemExit("[ERROR] git %s failed: %s" % (" ".join(args), result.stderr.strip()[:300]))
    return result.stdout


def clean(text: str) -> str:
    """Strip BOM artefacts and stray whitespace that git history tends to carry."""
    return text.replace("\ufeff", "").lstrip("\ufeff").strip()


def tidy_subject(subject: str) -> str:
    subject = clean(subject).rstrip(" .")
    if subject and subject[0].islower():
        subject = subject[0].upper() + subject[1:]
    return subject


def version_timeline(repo: Path) -> list[tuple[str, str, str, str]]:
    """(commit, date, subject, version) for every commit that set the version."""
    log = run_git(repo, "log", "--date=short", "--pretty=format:@%h|%ad|%s", "-p", "--", "pubspec.yaml")
    rows: list[tuple[str, str, str, str]] = []
    head: tuple[str, str, str] | None = None
    for line in log.splitlines():
        if line.startswith("@"):
            parts = line[1:].split("|", 2)
            if len(parts) == 3:
                head = (parts[0], parts[1], clean(parts[2]))
        elif line.startswith("+version:") and head:
            rows.append((head[0], head[1], head[2], clean(line[len("+version:") :])))
    return rows


def resolve_since_version(repo: Path, wanted: str) -> str:
    wanted = clean(wanted)
    matches = [r for r in version_timeline(repo) if r[3] == wanted or r[3].startswith(wanted + "+")]
    if not matches:
        raise SystemExit(
            "[ERROR] version '%s' pubspec.yaml history mein nahi mili.\n"
            "        Available: python tools/release_notes.py --list-versions" % wanted
        )
    return matches[0][0]


def collect_commits(repo: Path, revision_range: str):
    """Return [sha, date, subject, changed_paths] for every commit in the range.

    git prints the pretty-format line first and the --name-only list after it, so
    each header line is tagged with \x01 and anything else is a path.
    """
    log = run_git(
        repo,
        "log",
        "--date=short",
        "--name-only",
        "--pretty=format:\x01%h\x1f%ad\x1f%s",
        revision_range,
    )
    commits: list[list] = []
    current: list | None = None
    for line in log.splitlines():
        line = line.rstrip("\r")
        if line.startswith("\x01"):
            parts = line[1:].split("\x1f")
            if len(parts) == 3:
                current = [parts[0], parts[1], clean(parts[2]), []]
                commits.append(current)
            else:
                current = None
        elif line.strip() and current is not None:
            current[3].append(line.strip().replace("\\", "/"))
    return commits


def touches_app(paths: list[str], include_web: bool) -> bool:
    if any(p.startswith(APP_PATHS) for p in paths):
        return True
    if include_web and any(p.startswith(WEB_PATHS) for p in paths):
        return True
    return False


def classify(subject: str) -> str | None:
    low = subject.lower()
    if any(skip in low for skip in SKIP_SUBJECTS):
        return None
    match = CONVENTIONAL.match(subject)
    if not match:
        return "IMPROVED"
    ctype = match.group("type").lower()
    scope = (match.group("scope") or "").lower()
    if ctype in SKIP_TYPES:
        return None
    if scope and scope in SKIP_SCOPES:
        return None
    return GROUP_FOR_TYPE.get(ctype, "IMPROVED")


def build_groups(commits, include_web: bool) -> dict[str, list[str]]:
    groups: dict[str, list[str]] = {name: [] for name in GROUP_ORDER}
    seen: set[str] = set()
    for _sha, _date, subject, paths in commits:
        if not touches_app(paths, include_web):
            continue
        group = classify(subject)
        if group is None:
            continue
        match = CONVENTIONAL.match(subject)
        body = tidy_subject(match.group("subject") if match else subject)
        key = body.lower()
        if not body or key in seen:
            continue
        seen.add(key)
        groups[group].append(body)
    return groups


def compose(groups: dict[str, list[str]], limits: dict[str, int]) -> str:
    blocks: list[str] = []
    for name in GROUP_ORDER:
        items = groups[name][: limits.get(name, 0)]
        if items:
            blocks.append(name + "\n" + "\n".join("- " + item for item in items))
    return "\n\n".join(blocks)


def render(groups: dict[str, list[str]], max_chars: int) -> tuple[str, list[str]]:
    """Fit the notes into the budget, trimming the least important lines.

    Every group that has something gets at least one line, so the result stays
    balanced instead of becoming a wall of new features.
    """
    limits = {name: 0 for name in GROUP_ORDER}
    for name in GROUP_ORDER:
        if groups[name]:
            limits[name] = 1
    if len(compose(groups, limits)) > max_chars:
        # Not even one line per group fits - fall back to NEW only.
        limits = {name: 0 for name in GROUP_ORDER}
        limits["NEW"] = 1

    # Fill the remaining budget: newest items first, groups in priority order.
    progressed = True
    while progressed:
        progressed = False
        for name in GROUP_ORDER:
            if limits[name] < len(groups[name]):
                limits[name] += 1
                if len(compose(groups, limits)) <= max_chars:
                    progressed = True
                else:
                    limits[name] -= 1
    # One more pass lets a later group use budget a full earlier group cannot.
    progressed = True
    while progressed:
        progressed = False
        for name in GROUP_ORDER:
            while limits[name] < len(groups[name]):
                limits[name] += 1
                if len(compose(groups, limits)) <= max_chars:
                    progressed = True
                else:
                    limits[name] -= 1
                    break

    text = compose(groups, limits)
    dropped = [name + ": " + item for name in GROUP_ORDER for item in groups[name][limits[name] :]]
    if len(text) > max_chars:
        text = text[: max_chars - 3].rstrip() + "..."
    return text, dropped


def filler_in(text: str) -> str | None:
    flat = " ".join((text or "").lower().split()).strip(" .!")
    if not flat:
        return "(empty)"
    for pattern in PLACEHOLDER_PATTERNS:
        if pattern in flat and len(flat.replace(pattern, "").strip(" .-,")) < 24:
            return pattern
    return None


def cmd_list_versions(repo: Path) -> int:
    rows = version_timeline(repo)
    if not rows:
        print("(pubspec.yaml history mein koi version nahi mili)")
        return 1
    print("version      commit   date        subject")
    print("-----------  -------  ----------  " + "-" * 40)
    for commit, date, subject, version in rows:
        print("%-11s  %-7s  %-10s  %s" % (version, commit, date, subject[:58]))
    print("")
    print("Base chunnein, phir: python tools/release_notes.py --from <commit>")
    return 0


def cmd_check(path: Path) -> int:
    if not path.is_file():
        print("[ERROR] file nahi mili: %s" % path)
        return 1
    text = path.read_text(encoding="utf-8").replace("\ufeff", "")
    length = len(text)
    print("file        : %s" % path)
    print("characters  : %d / %d" % (length, MAX_CHARS))
    ok = True
    if not text.strip():
        print("[FAIL] notes khali hain.")
        ok = False
    if length > MAX_CHARS:
        print("[FAIL] Play ke rule se zyada: max %d Unicode characters per language." % MAX_CHARS)
        ok = False
    filler = filler_in(text)
    if filler:
        print("[FAIL] notes '%s' hain - ye batati nahi ke kya badla." % filler)
        ok = False
    if ok:
        print("[OK] notes valid hain.")
        return 0
    return 1


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="release_notes.py",
        description="Git history se Google Play release notes ('What's new') banayein.",
    )
    parser.add_argument("--repo", default=None, help="Repository root (default: is script ka parent)")
    parser.add_argument("--list-versions", action="store_true", help="pubspec.yaml ki version timeline dikhao")
    parser.add_argument("--from", dest="from_rev", default=None, help="Is revision ke baad ke changes")
    parser.add_argument("--since-version", default=None, help="Is version ke baad ke changes (misal 2.5.0)")
    parser.add_argument("--max-chars", type=int, default=MAX_CHARS, help="Budget (default: %(default)s)")
    parser.add_argument("--write", default=None, help="Notes ko is file mein likho")
    parser.add_argument("--check", default=None, help="Sirf ek notes file validate karo")
    parser.add_argument("--json", action="store_true", help="JSON output")
    parser.add_argument("--with-version", action="store_true", help="Notes ke shuru mein version likho")
    parser.add_argument(
        "--include-web",
        action="store_true",
        help="Hub / extension / website ke changes bhi shamil karo (Play listing ke liye aam taur par nahi)",
    )
    args = parser.parse_args(argv)

    repo = Path(args.repo).resolve() if args.repo else Path(__file__).resolve().parent.parent

    if args.check:
        return cmd_check(Path(args.check).expanduser())
    if args.list_versions:
        return cmd_list_versions(repo)
    if not args.from_rev and not args.since_version:
        parser.error("--from <rev> ya --since-version <x.y.z> dena zaroori hai (ya --list-versions)")

    base = args.from_rev or resolve_since_version(repo, args.since_version)
    revision_range = "%s..HEAD" % base
    rows = version_timeline(repo)
    version = rows[0][3] if rows else ""

    commits = collect_commits(repo, revision_range)
    if not commits:
        print("[WARN] %s mein koi commit nahi mila." % revision_range)
        return 1

    groups = build_groups(commits, args.include_web)
    text, dropped = render(groups, args.max_chars)
    if args.with_version and version:
        text = "%s\n\n%s" % (version, text)

    if args.json:
        print(
            json.dumps(
                {
                    "version": version,
                    "base": base,
                    "range": revision_range,
                    "characters": len(text),
                    "max_characters": args.max_chars,
                    "notes": text,
                    "groups": groups,
                    "dropped": dropped,
                },
                indent=2,
                ensure_ascii=False,
            )
        )
    else:
        print("base revision : %s" % base)
        print("commits read  : %d" % len(commits))
        print("app-facing    : %d (lib/ + android/)" % sum(1 for c in commits if touches_app(c[3], args.include_web)))
        print("version       : %s" % (version or "(unknown)"))
        print("characters    : %d / %d" % (len(text), args.max_chars))
        print("")
        print("---- What's new ----")
        print(text if text.strip() else "(kuch user-facing changes nahi mile)")
        print("--------------------")

    if dropped:
        print("")
        print("[WARN] %d character budget ki wajah se ye lines shamil nahi hui:" % len(dropped))
        for line in dropped:
            print("   - %s" % line)
        print("        Play ki limit 500 hai - text ko chhota karne ke liye khud edit karein.")

    if args.write:
        target = Path(args.write).expanduser()
        if not target.is_absolute():
            target = (repo / target).resolve()
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(text + "\n", encoding="utf-8")
        print("")
        print("[OK] likh diya: %s" % target)

    if len(text) > args.max_chars:
        print("[FAIL] notes budget se zyada hain.")
        return 1
    if not text.strip():
        print("[FAIL] koi user-facing change nahi mila - notes khali hain.")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
