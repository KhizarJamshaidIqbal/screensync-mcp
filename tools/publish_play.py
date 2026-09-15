#!/usr/bin/env python3
"""Publish an Android App Bundle (.aab) to Google Play via the Play Developer API v3.

Chain:
    edits.insert -> edits.bundles.upload -> edits.tracks.update -> edits.commit
Then a verification pass re-opens the edit, reads the target track back and
confirms the freshly uploaded versionCode is actually listed on it.

Examples:
    python tools/publish_play.py --aab build/app/outputs/bundle/release/app-release.aab
    python tools/publish_play.py --aab ... --track internal --status draft
    python tools/publish_play.py --aab ... --notes-file build/notes.en-US.txt
    python tools/publish_play.py --aab ... --dry-run

    # LIVE rollout (production). Human approval is mandatory, and the release
    # notes must say what actually changed (no "bug fixes and improvements"):
    python tools/publish_play.py --version-code 31 --track production \
        --status completed --notes-file build/notes.en-US.txt \
        --confirm-live-rollout --approved-by "Khizar"

    # Preview a production rollout without publishing anything:
    python tools/publish_play.py --version-code 31 --track production --dry-run

Service account resolution order:
    1. --service-account <path or inline JSON>
    2. env PLAY_SERVICE_ACCOUNT_JSON  (inline JSON if it starts with '{', else a path)
    3. tools/release.config.json      (key: serviceAccountPath)
"""

from __future__ import annotations

import argparse
import json
import os
import socket
import sys
import time
from pathlib import Path
from typing import Any, Callable, TypeVar

from google.oauth2 import service_account
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError
from googleapiclient.http import MediaFileUpload

SCOPES = ["https://www.googleapis.com/auth/androidpublisher"]
DEFAULT_PACKAGE = "com.screensync.mcp"
DEFAULT_TIMEOUT = 600
ALLOWED_STATUSES = ("completed", "draft", "inProgress", "halted")
STAGED_STATUSES = ("inProgress", "halted")
# A release on one of these tracks reaches real users, so it needs an explicit
# human approval before anything is committed to Play.
LIVE_TRACKS = ("production",)
# Play accepts up to 500 Unicode characters per language for "What's new".
# https://support.google.com/googleplay/android-developer/answer/9859348
RELEASE_NOTES_MAX = 500
# Notes that say nothing about what actually changed. Shipping one of these on a
# live release is what we are trying to prevent, so they are rejected there.
GENERIC_NOTE_PATTERNS = (
    "bug fixes and improvements",
    "bug fixes and performance improvements",
    "bug fixes",
    "minor fixes",
    "various fixes",
    "performance improvements",
    "general improvements",
    "maintenance release",
    "internal test build",
    "initial release",
    "tbd",
    "todo",
    "n/a",
)
RETRYABLE_HTTP = (429, 500, 502, 503, 504)
MAX_TRIES = 5

T = TypeVar("T")


# --------------------------------------------------------------------------- #
# helpers
# --------------------------------------------------------------------------- #
def info(message: str) -> None:
    print(message, flush=True)


def warn(message: str) -> None:
    print(message, file=sys.stderr, flush=True)


def is_live_track(track: str) -> bool:
    """True when this track publishes to real users (not a test channel)."""
    return (track or "").strip().lower() in LIVE_TRACKS


def looks_generic(notes: str) -> str | None:
    """Return the matched filler phrase when the notes say nothing useful."""
    flat = " ".join((notes or "").lower().split()).strip(" .!")
    if not flat:
        return "(empty)"
    for pattern in GENERIC_NOTE_PATTERNS:
        cleaned = flat.replace(pattern, "").strip(" .-,")
        if pattern in flat and len(cleaned) < 24:
            return pattern
    return None


def validate_notes(notes: str, args: argparse.Namespace) -> None:
    """Enforce Play's length rule, and refuse filler on a live release."""
    length = len(notes or "")
    if length > RELEASE_NOTES_MAX:
        raise SystemExit(
            "[ERROR] Release notes are %d characters; Play allows at most %d per language.\n"
            "        Generate them with: python tools/release_notes.py --from <rev> --write <file>"
            % (length, RELEASE_NOTES_MAX)
        )
    if is_live_track(args.track) and not args.dry_run:
        if not (notes or "").strip():
            raise SystemExit(
                "[ERROR] LIVE rollout ke liye release notes lazmi hain.\n"
                "        python tools/release_notes.py --list-versions\n"
                "        python tools/release_notes.py --from <rev> --write build/notes.en-US.txt"
            )
        filler = looks_generic(notes)
        if filler and not args.allow_generic_notes:
            raise SystemExit(
                "[ERROR] Release notes '%s' hain, jo batati nahi ke kya badla.\n"
                "        Play par 'What's new' asli changes dikhne chahiye.\n"
                "        Behtar notes: python tools/release_notes.py --from <rev> --write <file>\n"
                "        Sirf jaan boojh kar bhejna ho to: --allow-generic-notes" % filler
            )


def announce_live_rollout(args: argparse.Namespace, version_code: str) -> None:
    """Print an unmissable banner right before anything goes live."""
    if args.user_fraction is not None:
        fraction = "%d%% (staged)" % round(float(args.user_fraction) * 100)
    else:
        fraction = "100% (full rollout)"
    info("")
    info("================================================================")
    info(" LIVE ROLLOUT  -  ye real users ko publish hoga")
    info("================================================================")
    info("  package       : %s" % args.package)
    info("  track         : %s" % args.track)
    info("  versionCode   : %s" % version_code)
    info("  status        : %s" % args.status)
    info("  userFraction  : %s" % fraction)
    info("  approved by   : %s" % args.approved_by)
    info("================================================================")


def describe_http_error(exc: HttpError) -> str:
    """Turn an HttpError into one readable line with Play's own reason codes."""
    status = getattr(getattr(exc, "resp", None), "status", "?")
    raw = getattr(exc, "content", b"") or b""
    message = ""
    reasons: list[str] = []
    try:
        payload = json.loads(raw.decode("utf-8"))
        error = payload.get("error", {}) or {}
        message = str(error.get("message", "")).strip()
        for item in error.get("errors") or []:
            reason = item.get("reason")
            if reason:
                reasons.append(str(reason))
    except Exception:  # noqa: BLE001 - fall back to raw body
        message = raw[:400].decode("utf-8", "replace").strip()
    line = "HTTP %s: %s" % (status, message or "(no message)")
    if reasons:
        line += "  [reasons: %s]" % ", ".join(reasons)
    return line


def call_with_retry(factory: Callable[[], T], label: str) -> T:
    """Execute a googleapiclient request with exponential backoff on transient faults."""
    delay = 2.0
    last_error: Exception | None = None
    for attempt in range(1, MAX_TRIES + 1):
        try:
            if attempt > 1:
                info("    [retry %d/%d] %s" % (attempt, MAX_TRIES, label))
            return factory().execute(num_retries=2)  # type: ignore[attr-defined]
        except HttpError as exc:
            status = getattr(getattr(exc, "resp", None), "status", None)
            if status in RETRYABLE_HTTP and attempt < MAX_TRIES:
                last_error = exc
                info("    [retry] %s -> HTTP %s, waiting %ds" % (label, status, int(delay)))
                time.sleep(delay)
                delay *= 2
                continue
            raise
        except (OSError, TimeoutError, socket.timeout) as exc:  # type: ignore[misc]
            if attempt < MAX_TRIES:
                last_error = exc
                info("    [retry] %s -> %s, waiting %ds" % (label, exc, int(delay)))
                time.sleep(delay)
                delay *= 2
                continue
            raise
    raise RuntimeError("unreachable: exhausted retries for %s (%s)" % (label, last_error))


def build_credentials(source: str):
    """Build service-account credentials from a file path or an inline JSON blob."""
    value = (source or "").strip()
    if not value:
        raise SystemExit("[ERROR] Empty service account source.")
    if value.startswith("{"):
        try:
            blob = json.loads(value)
        except json.JSONDecodeError as exc:
            raise SystemExit("[ERROR] PLAY_SERVICE_ACCOUNT_JSON is not valid JSON: %s" % exc)
        return service_account.Credentials.from_service_account_info(blob, scopes=SCOPES)
    path = Path(value).expanduser()
    if not path.is_file():
        raise SystemExit("[ERROR] Service account file not found: %s" % path)
    return service_account.Credentials.from_service_account_file(str(path), scopes=SCOPES)


def resolve_service_account(explicit: str | None, repo_root: Path) -> str:
    if explicit and explicit.strip():
        return explicit.strip()

    env_value = os.environ.get("PLAY_SERVICE_ACCOUNT_JSON", "").strip()
    if env_value:
        return env_value

    config = repo_root / "tools" / "release.config.json"
    if config.is_file():
        try:
            # utf-8-sig: PowerShell's Out-File -Encoding UTF8 writes a BOM, and a
            # leading BOM makes plain utf-8 decoding fail. Stripping it is harmless
            # for a normal file and fixes a BOM-prefixed one.
            data = json.loads(config.read_text(encoding="utf-8-sig"))
        except json.JSONDecodeError as exc:
            raise SystemExit("[ERROR] %s is not valid JSON: %s" % (config, exc))
        candidate = str(data.get("serviceAccountPath") or "").strip()
        if candidate:
            return candidate

    raise SystemExit(
        "[ERROR] No service account found.\n"
        "        Pass --service-account, or set the PLAY_SERVICE_ACCOUNT_JSON\n"
        "        environment variable, or add \"serviceAccountPath\" to\n"
        "        tools/release.config.json."
    )


def delete_edit(service, package: str, edit_id: str) -> None:
    """Best-effort cleanup so no stale edit is left open on the Play side."""
    try:
        service.edits().delete(packageName=package, editId=edit_id).execute()
        info("    [cleanup] deleted edit %s" % edit_id)
    except Exception as exc:  # noqa: BLE001
        warn("    [cleanup] could not delete edit %s: %s" % (edit_id, exc))


def read_notes(args: argparse.Namespace) -> str:
    if args.notes_file:
        path = Path(args.notes_file).expanduser()
        if not path.is_file():
            raise SystemExit("[ERROR] --notes-file not found: %s" % path)
        return path.read_text(encoding="utf-8-sig").strip()
    return (args.notes or "").strip()


# --------------------------------------------------------------------------- #
# Play operations
# --------------------------------------------------------------------------- #
def open_edit(service, package: str) -> str:
    edit = call_with_retry(
        lambda: service.edits().insert(body={}, packageName=package),
        "edits.insert",
    )
    return str(edit["id"])


def upload_bundle(service, package: str, edit_id: str, aab: Path) -> int:
    media = MediaFileUpload(str(aab), mimetype="application/octet-stream", resumable=True)
    result = call_with_retry(
        lambda: service.edits().bundles().upload(
            editId=edit_id, packageName=package, media_body=media
        ),
        "edits.bundles.upload",
    )
    if "versionCode" not in result:
        raise SystemExit("[ERROR] Upload response had no versionCode: %s" % result)
    return int(result["versionCode"])


def update_track(service, package: str, edit_id: str, args: argparse.Namespace, version_code: int, notes: str) -> dict[str, Any]:
    release: dict[str, Any] = {
        "versionCodes": [str(version_code)],
        "status": args.status,
    }
    if args.release_name:
        release["name"] = args.release_name
    if args.user_fraction is not None:
        release["userFraction"] = float(args.user_fraction)
    if notes:
        # The language must match a language the store listing actually uses, or
        # Play has no listing to attach the notes to and they never display.
        # This app's default listing language is en-GB (see `play_api.py details-get`).
        release["releaseNotes"] = [{"language": args.notes_language, "text": notes}]

    body = {"releases": [release]}
    result = call_with_retry(
        lambda: service.edits().tracks().update(
            editId=edit_id, packageName=package, track=args.track, body=body
        ),
        "edits.tracks.update",
    )
    return result


def commit_edit(service, package: str, edit_id: str) -> None:
    call_with_retry(
        lambda: service.edits().commit(editId=edit_id, packageName=package),
        "edits.commit",
    )


def verify_track(service, package: str, track: str, version_code: int) -> bool:
    """Open a fresh edit and confirm the new versionCode is really on the track."""
    edit_id = open_edit(service, package)
    try:
        track_obj = call_with_retry(
            lambda: service.edits().tracks().get(
                packageName=package, editId=edit_id, track=track
            ),
            "edits.tracks.get",
        )
        found: list[str] = []
        for release in track_obj.get("releases", []) or []:
            for code in release.get("versionCodes", []) or []:
                found.append(str(code))
        info("    [verify] track '%s' versionCodes = %s" % (track, found if found else "[]"))
        ok = str(version_code) in found
        info("    [verify] new versionCode %s present on track: %s" % (version_code, "YES" if ok else "NO"))
        return ok
    finally:
        delete_edit(service, package, edit_id)


# --------------------------------------------------------------------------- #
# CLI
# --------------------------------------------------------------------------- #
def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        prog="publish_play.py",
        description="Upload an .aab to Google Play and attach it to a track.",
    )
    parser.add_argument("--aab", default=None, help="Path to the .aab file to upload (omit when using --version-code)")
    parser.add_argument(
        "--version-code",
        type=int,
        default=None,
        help="Reuse a versionCode already uploaded to Play instead of uploading again (promote)",
    )
    parser.add_argument("--package", default=DEFAULT_PACKAGE, help="Application id (default: %(default)s)")
    parser.add_argument("--track", default="internal", help="Play track (default: %(default)s)")
    parser.add_argument(
        "--status",
        default="completed",
        choices=ALLOWED_STATUSES,
        help="Release status (default: %(default)s)",
    )
    parser.add_argument("--notes", default="", help="Release notes text")
    parser.add_argument("--notes-file", default=None, help="File containing release notes")
    parser.add_argument("--release-name", default=None, help="Optional release name")
    parser.add_argument(
        "--notes-language",
        default="en-GB",
        help="Release notes language; must match a store listing language (default: %(default)s)",
    )
    parser.add_argument("--user-fraction", type=float, default=None, help="Staged rollout fraction, 0 < f < 1")
    parser.add_argument("--service-account", default=None, help="Service account JSON path or inline JSON")
    parser.add_argument("--dry-run", action="store_true", help="Validate only; never uploads or commits")
    parser.add_argument(
        "--confirm-live-rollout",
        action="store_true",
        help="Confirm a rollout that goes live to real users (required for the production track)",
    )
    parser.add_argument(
        "--approved-by",
        default=None,
        help="Name of the human who approved this live rollout (required for the production track)",
    )
    parser.add_argument(
        "--allow-generic-notes",
        action="store_true",
        help="Allow 'bug fixes and improvements' style notes on a live track (not recommended)",
    )
    parser.add_argument("--timeout", type=int, default=DEFAULT_TIMEOUT, help="Socket timeout in seconds (default: %(default)s)")

    args = parser.parse_args(argv)

    if args.user_fraction is not None and args.status not in STAGED_STATUSES:
        parser.error(
            "--user-fraction is only valid when --status is one of %s (got '%s')"
            % ("|".join(STAGED_STATUSES), args.status)
        )
    if args.user_fraction is not None and not (0.0 < args.user_fraction < 1.0):
        parser.error("--user-fraction must be between 0 and 1 (exclusive)")
    if not args.aab and args.version_code is None:
        parser.error("provide --aab (to upload) or --version-code (to promote an existing upload)")
    if args.version_code is not None and args.version_code <= 0:
        parser.error("--version-code must be a positive integer")

    # Live-rollout gate. A production release reaches real users, so it needs an
    # explicit human approval. This runs before any credential or network use, so
    # a missing approval can never be discovered halfway through a publish.
    if is_live_track(args.track) and not args.dry_run:
        if not args.confirm_live_rollout:
            parser.error(
                "PRODUCTION rollout ke liye human approval lazmi hai.\n"
                "Ye change users ko turant live ho jayega, is liye pehle user se saaf ijazat lein.\n"
                "Ijazat milne ke baad dobara chalayein:\n"
                '    --confirm-live-rollout --approved-by "<user ka naam>"\n'
                "Sirf preview dekhna ho to: --dry-run"
            )
        if not (args.approved_by or "").strip():
            parser.error(
                "--track production ke saath --approved-by \"<naam>\" bhi dena zaroori hai "
                "(kaun ne approval di - ye log mein likha jata hai)."
            )
    return args


def run_dry(service, args: argparse.Namespace, aab: Path | None, notes: str) -> bool:
    info("")
    info("[dry-run] Validating, nothing will be uploaded.")
    info("    package       : %s" % args.package)
    info("    track         : %s" % args.track)
    info("    status        : %s" % args.status)
    if aab is not None:
        info("    aab           : %s (%.2f MB)" % (aab, aab.stat().st_size / (1024 * 1024)))
    else:
        info("    aab           : (none - promoting versionCode %s)" % args.version_code)
    info("    notes         : %s" % (notes[:100] + ("..." if len(notes) > 100 else "") if notes else "(none)"))
    info("    notes language: %s" % args.notes_language)
    info("    notes length  : %d / %d characters" % (len(notes or ""), RELEASE_NOTES_MAX))
    if is_live_track(args.track):
        info("    [dry-run] NOTE: ye production track ka PREVIEW hai - kuch bhi live nahi jayega.")
    if args.user_fraction is not None:
        info("    userFraction  : %s" % args.user_fraction)
    edit_id = open_edit(service, args.package)
    info("    [ok] edits.insert works (edit id %s)" % edit_id)
    delete_edit(service, args.package, edit_id)
    info("")
    info("[dry-run] OK - credentials, package and API access all valid.")
    return True


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    repo_root = Path(__file__).resolve().parent.parent

    aab: Path | None = None
    if args.aab:
        aab = Path(args.aab).expanduser()
        if not aab.is_absolute():
            aab = (Path.cwd() / aab).resolve()
        if not aab.is_file():
            raise SystemExit("[ERROR] AAB not found: %s" % aab)
        if aab.suffix.lower() != ".aab":
            warn("[WARN] %s does not end with .aab - Play expects an Android App Bundle." % aab.name)

    notes = read_notes(args)
    validate_notes(notes, args)
    socket.setdefaulttimeout(float(args.timeout))

    source = resolve_service_account(args.service_account, repo_root)
    credentials = build_credentials(source)
    email = getattr(credentials, "service_account_email", "(unknown)")
    info("[auth] service account : %s" % email)
    info("[auth] package         : %s" % args.package)

    service = build("androidpublisher", "v3", credentials=credentials, cache_discovery=False)

    if args.dry_run:
        return 0 if run_dry(service, args, aab, notes) else 1

    if is_live_track(args.track):
        announce_live_rollout(args, args.version_code if aab is None else "pending upload")

    info("")
    info("[1/4] Opening an edit ...")
    edit_id = open_edit(service, args.package)
    info("    edit id: %s" % edit_id)

    try:
        if aab is not None:
            info("[2/4] Uploading %s (this can take a while) ..." % aab.name)
            version_code = upload_bundle(service, args.package, edit_id, aab)
            info("    uploaded versionCode: %s" % version_code)
            if is_live_track(args.track):
                info("")
                info(
                    ">>> LIVE ROLLOUT: versionCode %s ab '%s' par attach ho raha hai (approved by %s)."
                    % (version_code, args.track, args.approved_by)
                )
                info("")
        else:
            version_code = int(args.version_code)
            info("[2/4] Reusing versionCode %s already on Play (no upload)." % version_code)
            existing = call_with_retry(
                lambda: service.edits().bundles().list(packageName=args.package, editId=edit_id),
                "edits.bundles.list",
            )
            available = [str(b.get("versionCode")) for b in existing.get("bundles", []) or []]
            if str(version_code) not in available:
                raise SystemExit(
                    "[ERROR] versionCode %s is not on Play. Available: %s" % (version_code, available or "[]")
                )
            info("    confirmed versionCode %s exists on Play (available: %s)." % (version_code, available))

        info("[3/4] Attaching versionCode %s to track '%s' (status=%s) ..." % (version_code, args.track, args.status))
        update_track(service, args.package, edit_id, args, version_code, notes)

        info("[4/4] Committing the edit ...")
        commit_edit(service, args.package, edit_id)
        info("    committed.")
    except HttpError as exc:
        warn("")
        warn("[FAILED] %s" % describe_http_error(exc))
        delete_edit(service, args.package, edit_id)
        return 1
    except SystemExit:
        delete_edit(service, args.package, edit_id)
        raise
    except Exception as exc:  # noqa: BLE001
        warn("")
        warn("[FAILED] %s: %s" % (type(exc).__name__, exc))
        delete_edit(service, args.package, edit_id)
        return 1

    info("")
    info("[verify] Re-reading track '%s' to confirm the release landed ..." % args.track)
    if not verify_track(service, args.package, args.track, version_code):
        warn("[FAILED] versionCode %s was not found on track '%s' after commit." % (version_code, args.track))
        return 1

    info("")
    info("DONE - versionCode %s is live on track '%s' (status=%s)." % (version_code, args.track, args.status))
    return 0


if __name__ == "__main__":
    sys.exit(main())
