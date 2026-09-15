#!/usr/bin/env python3
"""Google Play API helper for the ScreenSync project.

Covers the Play API work that is not a release: store listing text, closed-testing
testers, app details, user reviews, and (when the API is enabled) crash / ANR /
install metrics from the Play Developer Reporting API.

Everything is READ-ONLY by default. A command that changes anything needs
--confirm-write as well, so a typo cannot edit a live store listing.

Examples:
    python tools/play_api.py tracks
    python tools/play_api.py bundles
    python tools/play_api.py listings-get
    python tools/play_api.py listings-get --language en-US
    python tools/play_api.py listings-set --language en-US --short "..." --full "..." --confirm-write

    python tools/play_api.py testers-get --track internal
    python tools/play_api.py testers-set --track internal --emails a@b.com,c@d.com --confirm-write

    python tools/play_api.py details-get
    python tools/play_api.py reviews-list
    python tools/play_api.py reviews-reply --review <reviewId> --text "Fixed in 2.5.5" --confirm-write

    python tools/play_api.py reporting-apps
    python tools/play_api.py reporting-crash-rate

Service account resolution (same as publish_play.py):
    1. --service-account <path or inline JSON>
    2. env PLAY_SERVICE_ACCOUNT_JSON
    3. tools/release.config.json -> serviceAccountPath

Exit codes: 0 ok, 1 failure, 2 usage error.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from typing import Any

from google.oauth2 import service_account
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError

PUBLISHER_SCOPE = "https://www.googleapis.com/auth/androidpublisher"
REPORTING_SCOPE = "https://www.googleapis.com/auth/playdeveloperreporting"
DEFAULT_PACKAGE = "com.screensync.mcp"
DEFAULT_SA = r"C:\Users\epsol\OneDrive\Desktop\advance-archery-505415-r2-bebbb831a92d.json"


# --------------------------------------------------------------------------- #
# auth
# --------------------------------------------------------------------------- #
def resolve_source(explicit: str | None, repo_root: Path) -> str:
    if explicit and explicit.strip():
        return explicit.strip()
    env = os.environ.get("PLAY_SERVICE_ACCOUNT_JSON", "").strip()
    if env:
        return env
    config = repo_root / "tools" / "release.config.json"
    if config.is_file():
        try:
            data = json.loads(config.read_text(encoding="utf-8-sig"))
        except json.JSONDecodeError as exc:
            raise SystemExit("[ERROR] %s is not valid JSON: %s" % (config, exc))
        candidate = str(data.get("serviceAccountPath") or "").strip()
        if candidate:
            return candidate
    if Path(DEFAULT_SA).is_file():
        return DEFAULT_SA
    raise SystemExit(
        "[ERROR] No service account found. Pass --service-account, set "
        "PLAY_SERVICE_ACCOUNT_JSON, or add serviceAccountPath to tools/release.config.json."
    )


def credentials_for(source: str, scope: str):
    value = (source or "").strip()
    if value.startswith("{"):
        info = json.loads(value)
        return service_account.Credentials.from_service_account_info(info, scopes=[scope])
    path = Path(value).expanduser()
    if not path.is_file():
        raise SystemExit("[ERROR] Service account file not found: %s" % path)
    return service_account.Credentials.from_service_account_file(str(path), scopes=[scope])


def publisher(source: str):
    return build("androidpublisher", "v3", credentials=credentials_for(source, PUBLISHER_SCOPE), cache_discovery=False)


def reporting(source: str):
    return build(
        "playdeveloperreporting",
        "v1beta1",
        credentials=credentials_for(source, REPORTING_SCOPE),
        cache_discovery=False,
    )


def http_failure(exc: HttpError) -> str:
    status = getattr(getattr(exc, "resp", None), "status", "?")
    body = (getattr(exc, "content", b"") or b"").decode("utf-8", "replace")
    try:
        payload = json.loads(body)
        message = str(payload.get("error", {}).get("message", "")).strip()
        status_text = payload.get("error", {}).get("status")
    except Exception:  # noqa: BLE001
        message, status_text = body[:300], None
    if status_text == "PERMISSION_DENIED" and "has not been used in project" in message:
        message += (
            "\n        -> ye API is project par ENABLE nahi hai."
            "\n        -> gcloud services enable playdeveloperreporting.googleapis.com"
            " --project advance-archery-505415-r2"
        )
    return "HTTP %s: %s" % (status, message)


def edit(service, package: str):
    """Context manager style helper: open an edit, run, commit only if asked."""
    return service.edits().insert(body={}, packageName=package).execute()


def drop_edit(service, package: str, edit_id: str) -> None:
    try:
        service.edits().delete(packageName=package, editId=edit_id).execute()
        print("    [cleanup] edit delete kar diya (kuch change nahi hua)")
    except Exception as exc:  # noqa: BLE001
        print("    [cleanup] edit delete nahi hua: %s" % exc)


def require_write(args: argparse.Namespace, what: str) -> None:
    if args.dry_run:
        print("[dry-run] %s - kuch change nahi hoga." % what)
        return
    if not args.confirm_write:
        raise SystemExit(
            "[ERROR] Ye command %s badal deti hai.\n"
            "        Yaqeen ho to --confirm-write lagayein, ya preview ke liye --dry-run." % what
        )


# --------------------------------------------------------------------------- #
# read commands
# --------------------------------------------------------------------------- #
def cmd_tracks(service, args) -> int:
    edit_id = edit(service, args.package)["id"]
    try:
        tracks = service.edits().tracks().list(packageName=args.package, editId=edit_id).execute()
        for t in tracks.get("tracks", []) or []:
            releases = t.get("releases") or []
            if not releases:
                print("track: %-12s (koi release nahi)" % t.get("track"))
                continue
            print("track: %s" % t.get("track"))
            for r in releases:
                print("   name         : %s" % r.get("name", "(none)"))
                print("   status       : %s" % r.get("status"))
                print("   versionCodes : %s" % r.get("versionCodes"))
                if r.get("userFraction") is not None:
                    print("   userFraction : %s" % r.get("userFraction"))
                for n in r.get("releaseNotes") or []:
                    print("   notes[%s]   : %s" % (n.get("language"), (n.get("text") or "")[:90]))
            print("")
    finally:
        drop_edit(service, args.package, edit_id)
    return 0


def cmd_bundles(service, args) -> int:
    edit_id = edit(service, args.package)["id"]
    try:
        data = service.edits().bundles().list(packageName=args.package, editId=edit_id).execute()
        rows = data.get("bundles") or []
        if not rows:
            print("(koi bundle nahi)")
        for b in rows:
            print("versionCode %-6s sha256=%s..." % (b.get("versionCode"), (b.get("sha256") or "")[:16]))
    finally:
        drop_edit(service, args.package, edit_id)
    return 0


def cmd_listings_get(service, args) -> int:
    edit_id = edit(service, args.package)["id"]
    try:
        if args.language:
            data = service.edits().listings().get(
                packageName=args.package, editId=edit_id, language=args.language
            ).execute()
            print(json.dumps(data, indent=2, ensure_ascii=False))
            return 0
        data = service.edits().listings().list(packageName=args.package, editId=edit_id).execute()
        for item in data.get("listings") or []:
            print("language: %s" % item.get("language"))
            print("   title       : %s" % item.get("title"))
            print("   short       : %s" % (item.get("shortDescription") or "")[:90])
            full = item.get("fullDescription") or ""
            print("   full        : %d characters" % len(full))
            print("")
    finally:
        drop_edit(service, args.package, edit_id)
    return 0


def cmd_details_get(service, args) -> int:
    edit_id = edit(service, args.package)["id"]
    try:
        data = service.edits().details().get(packageName=args.package, editId=edit_id).execute()
        print(json.dumps(data, indent=2, ensure_ascii=False))
    finally:
        drop_edit(service, args.package, edit_id)
    return 0


def cmd_testers_get(service, args) -> int:
    edit_id = edit(service, args.package)["id"]
    try:
        data = service.edits().testers().get(
            packageName=args.package, editId=edit_id, track=args.track
        ).execute()
        print(json.dumps(data, indent=2, ensure_ascii=False))
    finally:
        drop_edit(service, args.package, edit_id)
    return 0


def cmd_reviews_list(service, args) -> int:
    data = service.reviews().list(packageName=args.package, maxResults=args.limit).execute()
    rows = data.get("reviews") or []
    if not rows:
        print("(koi review nahi)")
    for r in rows:
        rid = r.get("reviewId")
        for c in r.get("comments") or []:
            ua = c.get("userComment") or {}
            print("review %s  stars=%s  %s" % (rid, ua.get("starRating"), ua.get("reviewerLanguage")))
            print("   %s" % (ua.get("text") or "")[:200])
            if c.get("developerComment"):
                print("   [dev reply] %s" % (c["developerComment"].get("text") or "")[:160])
            print("")
    return 0


# --------------------------------------------------------------------------- #
# write commands
# --------------------------------------------------------------------------- #
def cmd_listings_set(service, args) -> int:
    require_write(args, "store listing")
    if not args.language:
        raise SystemExit("[ERROR] --language lazmi hai (misal en-US)")
    if args.dry_run:
        print("    language: %s" % args.language)
        print("    title   : %s" % (args.title or "(unchanged)"))
        print("    short   : %s" % (args.short or "(unchanged)"))
        print("    full    : %d characters" % len(args.full or ""))
        return 0

    edit_id = edit(service, args.package)["id"]
    try:
        current = service.edits().listings().get(
            packageName=args.package, editId=edit_id, language=args.language
        ).execute()
        body = {
            "language": args.language,
            "title": args.title or current.get("title") or "",
            "shortDescription": args.short or current.get("shortDescription") or "",
            "fullDescription": args.full or current.get("fullDescription") or "",
        }
        service.edits().listings().update(
            packageName=args.package, editId=edit_id, language=args.language, body=body
        ).execute()
        service.edits().commit(packageName=args.package, editId=edit_id).execute()
        print("[OK] listing %s update ho gayi aur commit ho gayi." % args.language)
        print("     NOTE: Play aam taur par store listing change ka review karta hai.")
    except HttpError as exc:
        drop_edit(service, args.package, edit_id)
        print("[FAILED] %s" % http_failure(exc))
        return 1
    return 0


def cmd_testers_set(service, args) -> int:
    require_write(args, "closed-testing testers")
    if args.emails:
        raise SystemExit(
            "[ERROR] Play ka testers API sirf Google Groups leta hai (individual emails nahi).\n"
            "        Ek Google Group banayein, members add karein, phir den: --groups naam@googlegroups.com"
        )
    groups = [g.strip() for g in (args.groups or "").split(",") if g.strip()]
    if not groups:
        raise SystemExit("[ERROR] --groups dena zaroori hai")
    if args.dry_run:
        print("    track  : %s" % args.track)
        print("    groups : %s" % groups)
        return 0

    edit_id = edit(service, args.package)["id"]
    try:
        body: dict[str, Any] = {"googleGroups": groups}
        service.edits().testers().update(
            packageName=args.package, editId=edit_id, track=args.track, body=body
        ).execute()
        service.edits().commit(packageName=args.package, editId=edit_id).execute()
        print("[OK] testers update ho gaye: %s" % ", ".join(groups))
    except HttpError as exc:
        drop_edit(service, args.package, edit_id)
        print("[FAILED] %s" % http_failure(exc))
        return 1
    return 0


def cmd_reviews_reply(service, args) -> int:
    require_write(args, "review reply")
    if not args.review or not args.text:
        raise SystemExit("[ERROR] --review aur --text dono lazmi hain")
    if args.dry_run:
        print("    review: %s" % args.review)
        print("    reply : %s" % args.text)
        return 0
    try:
        service.reviews().reply(
            packageName=args.package, reviewId=args.review, body={"replyText": args.text}
        ).execute()
        print("[OK] reply bhej diya.")
    except HttpError as exc:
        print("[FAILED] %s" % http_failure(exc))
        return 1
    return 0


# --------------------------------------------------------------------------- #
# reporting commands
# --------------------------------------------------------------------------- #
def cmd_reporting_apps(service, args) -> int:
    """Reporting API mein `apps.list` nahi hota - `apps.search` hota hai."""
    data = service.apps().search(pageSize=args.limit).execute()
    rows = data.get("apps") or []
    if not rows:
        print("(koi app nahi mili)")
    for a in rows:
        print(a.get("name"))
    return 0


def cmd_reporting_anomalies(service, args) -> int:
    """anomalies.list - crash/ANR mein achanak badhat."""
    data = service.anomalies().list(parent="apps/%s" % args.package, pageSize=args.limit).execute()
    print(json.dumps(data, indent=2, ensure_ascii=False)[:4000])
    return 0


def _vitals_query(service, args, method: str, metric_set: str, metrics: list[str]) -> int:
    """Shared query for the vitals metric sets.

    The `name` must be exactly `apps/<package>/<metricSet>` - the API validates it
    with ^apps/[^/]+/<metricSet>$ and rejects anything else.
    """
    parent = "apps/%s/%s" % (args.package, metric_set)
    request = {
        "timelineSpec": {
            "aggregationPeriod": "DAILY",
            "startTime": {"year": args.year, "month": args.month, "day": args.day},
            # DAILY aggregation: hours/minutes/seconds MUST be unset, warna API
            # "Minutes, seconds and nanos should be unset" keh kar reject kar deti hai.
            "endTime": {"year": args.year, "month": args.month, "day": args.day},
        },
        "metrics": metrics,
        "dimensions": ["versionCode"],
        "pageSize": 100,
    }
    print("metric set: %s" % parent)
    resource = getattr(service.vitals(), method)()
    data = resource.query(name=parent, body=request).execute()
    rows = data.get("rows") or []
    if not rows:
        print("(is range mein koi data nahi - Play ka data 1-2 din late aata hai)")
    for row in rows:
        start = row.get("startTime") or {}
        dims = ", ".join(
            "%s=%s" % (d.get("dimension"), d.get("int64Value") or d.get("stringValue"))
            for d in (row.get("dimensions") or [])
        )
        values = ", ".join(
            "%s=%s" % (m.get("metric"), m.get("decimalValue", {}).get("value"))
            for m in (row.get("metrics") or [])
        )
        print("  %04d-%02d-%02d  %-22s %s" % (start.get("year", 0), start.get("month", 0), start.get("day", 0), dims, values))
    return 0


def cmd_reporting_crash_rate(service, args) -> int:
    return _vitals_query(
        service,
        args,
        "crashrate",
        "crashRateMetricSet",
        ["crashRate", "userPerceivedCrashRate", "distinctUsers"],
    )


def cmd_reporting_anr_rate(service, args) -> int:
    return _vitals_query(
        service,
        args,
        "anrrate",
        "anrRateMetricSet",
        ["anrRate", "userPerceivedAnrRate", "distinctUsers"],
    )


def cmd_reporting_freshness(service, args) -> int:
    """Kaun se din tak ka data mojood hai - is se pata chalta hai kon sa range maangna hai."""
    # Har metric set ka apna method hai, aur har ek apne `name` pattern ko khud
    # validate karta hai - ANR set ke liye crashrate() call karna parameter check par
    # fail ho jata hai.
    for method, metric_set in (("crashrate", "crashRateMetricSet"), ("anrrate", "anrRateMetricSet")):
        name = "apps/%s/%s" % (args.package, metric_set)
        data = getattr(service.vitals(), method)().get(name=name).execute()
        fresh = data.get("freshnessInfo") or {}
        print("%s" % metric_set)
        print("  freshness: %s" % json.dumps(fresh.get("freshnesses") or [], ensure_ascii=False))
    return 0


# --------------------------------------------------------------------------- #
# CLI
# --------------------------------------------------------------------------- #
def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="play_api.py",
        description="ScreenSync ke liye Google Play API helper (read-only by default).",
    )
    parser.add_argument("--package", default=DEFAULT_PACKAGE, help="Application id (default: %(default)s)")
    parser.add_argument("--service-account", default=None, help="Service account JSON path or inline JSON")
    parser.add_argument("--dry-run", action="store_true", help="Preview only")
    parser.add_argument("--confirm-write", action="store_true", help="Confirm a change")

    sub = parser.add_subparsers(dest="command", required=True)

    sub.add_parser("tracks", help="Tracks aur unke releases")
    sub.add_parser("bundles", help="Uploaded versionCodes")

    p = sub.add_parser("listings-get", help="Store listing parhna")
    p.add_argument("--language", default=None, help="Sirf ek language (misal en-US)")

    p = sub.add_parser("listings-set", help="Store listing likhna (review hoga)")
    p.add_argument("--language", required=True)
    p.add_argument("--title", default=None)
    p.add_argument("--short", default=None)
    p.add_argument("--full", default=None)

    sub.add_parser("details-get", help="Default language + contact details")

    p = sub.add_parser("testers-get", help="Closed testing testers")
    p.add_argument("--track", default="internal")

    p = sub.add_parser("testers-set", help="Closed testing testers set karna (sirf Google Groups)")
    p.add_argument("--track", default="internal")
    p.add_argument("--emails", default=None, help="Support nahi - dekhein --groups")
    p.add_argument("--groups", default=None, help="Google Group emails, comma separated")

    p = sub.add_parser("reviews-list", help="User reviews")
    p.add_argument("--limit", type=int, default=20)

    p = sub.add_parser("reviews-reply", help="Ek review ka jawab")
    p.add_argument("--review", default=None)
    p.add_argument("--text", default=None)

    p = sub.add_parser("reporting-apps", help="Reporting API: apps search (API enable honi chahiye)")
    p.add_argument("--limit", type=int, default=50)

    p = sub.add_parser("reporting-anomalies", help="Reporting API: crash / ANR anomalies")
    p.add_argument("--limit", type=int, default=50)

    p = sub.add_parser("reporting-crash-rate", help="Reporting API: crash rates")
    p.add_argument("--year", type=int, default=2026)
    p.add_argument("--month", type=int, default=9)
    p.add_argument("--day", type=int, default=1)

    p = sub.add_parser("reporting-anr-rate", help="Reporting API: ANR rates")
    p.add_argument("--year", type=int, default=2026)
    p.add_argument("--month", type=int, default=9)
    p.add_argument("--day", type=int, default=1)

    sub.add_parser("reporting-freshness", help="Reporting API: kis din tak ka data mojood hai")

    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    repo_root = Path(__file__).resolve().parent.parent
    source = resolve_source(args.service_account, repo_root)

    reporting_cmds = {
        "reporting-apps",
        "reporting-anomalies",
        "reporting-crash-rate",
        "reporting-anr-rate",
        "reporting-freshness",
    }
    try:
        if args.command in reporting_cmds:
            service = reporting(source)
            print("[auth] reporting API | package: %s" % args.package)
            handler = {
                "reporting-apps": cmd_reporting_apps,
                "reporting-anomalies": cmd_reporting_anomalies,
                "reporting-crash-rate": cmd_reporting_crash_rate,
                "reporting-anr-rate": cmd_reporting_anr_rate,
                "reporting-freshness": cmd_reporting_freshness,
            }[args.command]
            return handler(service, args)

        service = publisher(source)
        print("[auth] androidpublisher | package: %s" % args.package)
        handler = {
            "tracks": cmd_tracks,
            "bundles": cmd_bundles,
            "listings-get": cmd_listings_get,
            "listings-set": cmd_listings_set,
            "details-get": cmd_details_get,
            "testers-get": cmd_testers_get,
            "testers-set": cmd_testers_set,
            "reviews-list": cmd_reviews_list,
            "reviews-reply": cmd_reviews_reply,
        }[args.command]
        return handler(service, args)
    except HttpError as exc:
        print("[FAILED] %s" % http_failure(exc))
        return 1
    except SystemExit:
        raise
    except Exception as exc:  # noqa: BLE001
        print("[FAILED] %s: %s" % (type(exc).__name__, exc))
        return 1


if __name__ == "__main__":
    sys.exit(main())
