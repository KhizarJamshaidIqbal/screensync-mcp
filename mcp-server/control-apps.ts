// The phone's app list and launch-by-name for control_launch_app.
//
// Apps are found by PACKAGE name over adb as the shell user, which may see every package, so the phone app
// never needs QUERY_ALL_PACKAGES. The list is the launcher-visible apps (`cmd package query-activities` for
// MAIN/LAUNCHER, the apps a home screen shows); an older Android without that command falls back to the
// user-installed packages (`pm list packages -3`), and the reply says so. Labels ("WhatsApp") are not
// available cheaply over adb, so a query is matched against package names only, and a query that matches
// several apps is refused with the candidates (AMBIGUOUS): it never guesses which one was meant.
import { log } from "./config.js";
import { adb } from "./control-adb.js";
import { ControlInputError, launchApp } from "./control.js";

/** Every element is a constant: nothing user-supplied is sent to the phone to list apps. */
const LAUNCHER_QUERY = [
  "shell", "cmd", "package", "query-activities", "--brief",
  "-a", "android.intent.action.MAIN", "-c", "android.intent.category.LAUNCHER",
];
const THIRD_PARTY_QUERY = ["shell", "pm", "list", "packages", "-3"];

/** At most this many candidates are listed in an AMBIGUOUS reply (`count` still says how many matched). */
const MAX_CANDIDATES = 20;

/** launcher: the apps a home screen shows; third-party: `pm list packages -3`, the fallback on older Android. */
export type AppSource = "launcher" | "third-party";

export type AppList = { packages: string[]; source: AppSource; thirdPartyOnly: boolean; note?: string };

const FALLBACK_NOTE =
  "The launcher query found nothing on this phone (an older Android has no `cmd package query-activities`), so these are the user-installed packages (pm list packages -3). System apps such as Settings are not in the list: launch them by package.";

const PACKAGE = /^[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)+$/;

const sortedUnique = (packages: string[]) => [...new Set(packages)].sort();

/**
 * Package names from `cmd package query-activities` output. --brief prints a `package/class` line per
 * activity (and --components only those lines); a full dump has `packageName=` lines. Headers, `Activity #N:`
 * and the priority lines are skipped. Sorted, each package once (an app can have several launcher activities).
 */
export function parseLauncherPackages(stdout: string): string[] {
  const found: string[] = [];
  for (const raw of stdout.split("\n")) {
    const line = raw.trim();
    const component = line.match(/^([^\s/]+)\/\S+$/);
    const named = line.match(/^packageName=(\S+)$/);
    const pkg = component?.[1] ?? named?.[1];
    if (pkg && PACKAGE.test(pkg)) found.push(pkg);
  }
  return sortedUnique(found);
}

/** Package names from `pm list packages` output (`package:com.example` lines), sorted, each once. */
export function parsePmPackages(stdout: string): string[] {
  const found: string[] = [];
  for (const raw of stdout.split("\n")) {
    const pkg = raw.trim().match(/^package:(\S+)$/)?.[1];
    if (pkg && PACKAGE.test(pkg)) found.push(pkg);
  }
  return sortedUnique(found);
}

/**
 * The launcher-visible apps, or only the user-installed ones with `thirdPartyOnly`. When the launcher query
 * fails or finds nothing (an Android without `cmd package query-activities`), the user-installed packages
 * are returned instead, with source "third-party" and a note.
 */
export async function listApps(thirdPartyOnly = false): Promise<AppList> {
  const launcher = parseLauncherPackages(await adb(LAUNCHER_QUERY).catch(() => ""));
  if (!launcher.length) {
    log("WARN", "control apps: no launcher query on this phone, using pm list packages -3");
    const packages = parsePmPackages(await adb(THIRD_PARTY_QUERY));
    return { packages, source: "third-party", thirdPartyOnly: true, note: FALLBACK_NOTE };
  }
  if (!thirdPartyOnly) return { packages: launcher, source: "launcher", thirdPartyOnly: false };
  const thirdParty = new Set(parsePmPackages(await adb(THIRD_PARTY_QUERY)));
  return { packages: launcher.filter((p) => thirdParty.has(p)), source: "launcher", thirdPartyOnly: true };
}

/**
 * The packages `query` names: a case-insensitive substring of the package name. A package equal to the
 * query wins on its own (com.whatsapp is not ambiguous with com.whatsapp.w4b); otherwise every match.
 */
export function matchApps(packages: string[], query: string): string[] {
  const q = query.trim().toLowerCase();
  const exact = packages.filter((p) => p.toLowerCase() === q);
  return exact.length ? exact : packages.filter((p) => p.toLowerCase().includes(q));
}

const invalid = (detail: string) => new ControlInputError("INVALID_ARGUMENTS", `${detail} Nothing was launched.`);

/**
 * control_launch_app: {package} launches that package (or package/activity) exactly as before; {query}
 * launches the one launcher app whose package name contains it (AMBIGUOUS with the candidates when several
 * do, NOT_FOUND when none does); {list: true} returns the package names instead (only the matches when a
 * query is given). `thirdPartyOnly` narrows query and list to user-installed apps. Returns the reply's
 * fields besides `success`.
 */
export async function runLaunchApp(args: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  const { package: pkg, query } = args;
  const list = args.list === true;
  if (pkg !== undefined) {
    if (query !== undefined || list) throw invalid("Give package, or query / list: true, not both.");
    if (typeof pkg !== "string") throw invalid("package must be a string.");
    return { detail: await launchApp(pkg) };
  }
  if (query !== undefined && (typeof query !== "string" || !query.trim())) throw invalid("query must be a non-empty string.");
  if (query === undefined && !list) throw invalid("control_launch_app needs package, query or list: true.");

  const apps = await listApps(args.thirdPartyOnly === true);
  const about = { source: apps.source, ...(apps.note ? { note: apps.note } : {}) };
  const q = typeof query === "string" ? query.trim() : "";
  if (list) {
    const packages = q ? matchApps(apps.packages, q) : apps.packages;
    return { count: packages.length, packages, ...(q ? { query: q } : {}), thirdPartyOnly: apps.thirdPartyOnly, ...about };
  }

  const matches = matchApps(apps.packages, q);
  if (matches.length === 1) {
    const detail = await launchApp(matches[0]);
    return { detail, package: matches[0], query: q, ...about };
  }
  if (matches.length > 1) {
    const shown = matches.slice(0, MAX_CANDIDATES);
    const more = matches.length > shown.length ? ` and ${matches.length - shown.length} more` : "";
    throw new ControlInputError(
      "AMBIGUOUS",
      `"${q}" matches ${matches.length} apps: ${shown.join(", ")}${more}. Pass the one you mean as package (or a longer query). Nothing was launched.`,
      { query: q, count: matches.length, candidates: shown, ...about },
    );
  }
  throw new ControlInputError(
    "NOT_FOUND",
    `No app's package name contains "${q}" (searched ${apps.packages.length} ${apps.source} packages). The match is on package names, not the labels on the home screen (Gmail is com.google.android.gm): control_launch_app {list: true} lists them. Nothing was launched.`,
    { query: q, searched: apps.packages.length, ...about },
  );
}
