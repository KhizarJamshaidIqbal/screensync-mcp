// ScreenSync Multi-Profile & Multi-Window Registry (Plan §3)
// Maintains separate, isolated records for each connected browser instance/profile,
// auto-correlates with local Chrome profiles from Local State, and handles zero-cross-talk routing.

import { readFileSync, existsSync } from "fs";
import path from "path";

const PRESENCE_TTL_MS = 600_000;

export type BrowserWindowInfo = {
  id: number;
  focused: boolean;
  state?: string;
  type?: string;
  tabCount?: number;
  activeTab?: { tabId?: number; url?: string; title?: string } | null;
};

export type BrowserInstance = {
  instanceId: string;
  browserId: string;
  name: string;
  profileEmail: string | null;
  profileName: string | null;
  profileDir: string | null;
  webAccessEnabled: boolean;
  /** The extension can put a request in front of a person before a risky action runs (1.11.0+). */
  approvals: boolean;
  lastSeenAt: string;
  tab: { url?: string; title?: string } | null;
  windows: BrowserWindowInfo[];
  userAgent: string | null;
};

export type LocalChromeProfile = {
  dir: string;
  name: string;
  email: string;
};

/** Where one web_* call goes, or why it goes nowhere. `status` is the HTTP status the tool route answers with. */
export type DispatchDecision =
  | { ok: true; target: BrowserInstance }
  | { ok: false; status: number; code: string; error: string; onlineProfiles: string[] };

/** A web_fanout run: one pass per chosen browser, each pinned to it or skipped with the reason; or why none runs. */
export type FanoutPlan =
  | { ok: true; passes: Array<{ target: BrowserInstance; decision?: DispatchDecision; skipped?: string }> }
  | Extract<DispatchDecision, { ok: false }>;

/** The arguments that name a browser for a call, in precedence order. `any`/`default` name none. */
const ROUTING_KEYS = ["__profile", "profile", "__email", "email", "__instance", "instanceId", "__browser"] as const;

function routingHint(args: Record<string, unknown>): string | null {
  for (const key of ROUTING_KEYS) {
    if (typeof args[key] === "string") return args[key] as string;
  }
  return null;
}

const isWildcard = (v: string) => ["", "any", "default"].includes(v.trim().toLowerCase());
const label = (b: BrowserInstance) => `${b.profileEmail || b.profileName || b.instanceId} (${b.name}, instanceId ${b.instanceId})`;
/** "tabId 7 / windowId 5" for the ids a call names, "" when it names none. */
const idsNamed = (args: Record<string, unknown>) =>
  ["tabId", "windowId"].filter((k) => args[k] !== undefined && args[k] !== null && args[k] !== "").map((k) => `${k} ${args[k]}`).join(" / ");

let cachedChromeProfiles: LocalChromeProfile[] | null = null;
let lastCacheTimeMs = 0;

export function readLocalChromeProfiles(): LocalChromeProfile[] {
  if (cachedChromeProfiles && Date.now() - lastCacheTimeMs < 60_000) {
    return cachedChromeProfiles;
  }
  const localAppData = process.env.LOCALAPPDATA || "";
  if (!localAppData) return [];
  const localStatePath = path.join(localAppData, "Google", "Chrome", "User Data", "Local State");
  if (!existsSync(localStatePath)) return [];

  try {
    const raw = readFileSync(localStatePath, "utf8");
    const json = JSON.parse(raw);
    const infoCache = json?.profile?.info_cache || {};
    const profiles: LocalChromeProfile[] = [];
    for (const [dir, data] of Object.entries<any>(infoCache)) {
      profiles.push({
        dir,
        name: String(data?.name || data?.shortcut_name || dir),
        email: String(data?.user_name || "").toLowerCase(),
      });
    }
    cachedChromeProfiles = profiles;
    lastCacheTimeMs = Date.now();
    return profiles;
  } catch {
    return [];
  }
}

export function createProfileRegistry() {
  const instances = new Map<string, BrowserInstance>();
  let selectedProfile: string | null = null;

  const isOnline = (b: BrowserInstance) => Date.now() - Date.parse(b.lastSeenAt) < PRESENCE_TTL_MS;

  const listOnline = (): BrowserInstance[] =>
    [...instances.values()]
      .filter(isOnline)
      .sort((a, b) => Date.parse(b.lastSeenAt) - Date.parse(a.lastSeenAt));

  const register = (body: Record<string, unknown>): BrowserInstance => {
    const instanceId =
      typeof body.instanceId === "string" && body.instanceId.trim()
        ? body.instanceId.trim()
        : typeof body.browserId === "string" && body.browserId.trim()
          ? body.browserId.trim()
          : "default";

    let email = typeof body.profileEmail === "string" && body.profileEmail.trim()
      ? body.profileEmail.trim().toLowerCase()
      : null;
    let profName = typeof body.profileName === "string" && body.profileName.trim()
      ? body.profileName.trim()
      : null;

    // Correlate with local Chrome metadata if available
    let profDir: string | null = null;
    const localProfiles = readLocalChromeProfiles();
    if (email) {
      const match = localProfiles.find((p) => p.email && p.email === email);
      if (match) {
        profDir = match.dir;
        if (!profName) profName = match.name;
      }
    }

    const rawWindows = Array.isArray(body.windows) ? body.windows : [];
    const windows: BrowserWindowInfo[] = rawWindows.map((w: any) => ({
      id: Number(w?.id || 0),
      focused: w?.focused === true,
      state: typeof w?.state === "string" ? w.state : undefined,
      type: typeof w?.type === "string" ? w.type : undefined,
      tabCount: Number(w?.tabCount || 0),
      activeTab: w?.activeTab && typeof w.activeTab === "object" ? w.activeTab : null,
    }));

    const entry: BrowserInstance = {
      instanceId,
      browserId: typeof body.browserId === "string" ? body.browserId : "default",
      name: typeof body.browserName === "string" && body.browserName.trim() ? body.browserName.trim().toLowerCase() : "chrome",
      profileEmail: email,
      profileName: profName,
      profileDir: profDir,
      webAccessEnabled: body.webAccessEnabled === true,
      approvals: body.approvals === true,
      lastSeenAt: new Date().toISOString(),
      tab: body.tab && typeof body.tab === "object" ? (body.tab as { url?: string; title?: string }) : null,
      windows,
      userAgent: typeof body.userAgent === "string" ? body.userAgent : null,
    };

    if (typeof body.webAccessEnabled !== "boolean" && instances.has(instanceId)) {
      entry.webAccessEnabled = instances.get(instanceId)!.webAccessEnabled;
    }

    instances.set(instanceId, entry);
    return entry;
  };

  const get = (instanceId: string): BrowserInstance | undefined => instances.get(instanceId);

  const setSelectedProfile = (target: string | null) => {
    selectedProfile = target ? target.trim() : null;
  };

  const getSelectedProfile = (): string | null => selectedProfile;

  /**
   * The first of `candidates` that a lowercased `query` names: 1. exact instanceId, 2. email (exact or substring),
   * 3. profile name or directory, 4. browser name (e.g. 'chrome', 'edge').
   */
  const findNamed = (candidates: BrowserInstance[], query: string): BrowserInstance | null =>
    candidates.find((inst) => inst.instanceId.toLowerCase() === query) ??
    candidates.find((inst) => inst.profileEmail?.toLowerCase().includes(query)) ??
    candidates.find((inst) => inst.profileName?.toLowerCase() === query || inst.profileDir?.toLowerCase() === query) ??
    candidates.find((inst) => inst.name === query) ??
    null;

  /**
   * Resolves a target browser instance based on an optional hint (email, profile name, instanceId, or browser name).
   * If hint is omitted (or `any`/`default`, which name no browser), defaults to currently selected profile, or
   * the latest active instance.
   */
  const resolveTarget = (hint?: string | null): BrowserInstance | null => {
    const online = listOnline();
    if (!online.length) return null;

    const query = ((hint && !isWildcard(hint) ? hint : null) || selectedProfile || "").trim().toLowerCase();
    if (isWildcard(query)) {
      // Return focused window instance first, or latest active
      const focusedInstance = online.find((inst) => inst.windows.some((w) => w.focused));
      return focusedInstance || online[0];
    }
    return findNamed(online, query);
  };

  /**
   * Finds which online instance actually owns a given tab or window, by scanning each
   * instance's `windows[]` snapshot (populated from the extension's heartbeat, see
   * web-bridge.js registerWebBridge). A windowId is matched against `windows[].id`; a tabId
   * is matched against `windows[].activeTab.tabId` (the only per-window tab id the heartbeat
   * tracks). This is precise ground truth for routing — unlike resolveTarget()'s hint, which
   * falls back to "whichever profile has a focused window" or "most recently seen" and can
   * silently pick the wrong Chrome profile when two are connected at once.
   * Returns EVERY online instance that claims the id: ids are only unique inside one browser process, so Chrome
   * and Edge (or two profiles) can both report tab 7, and taking the first would be a guess (resolveDispatch()
   * breaks that tie only with a hint or the selected profile). Empty when none claims it, so callers fall back
   * to resolveTarget()'s heuristic unchanged (never regresses the no-hint case).
   */
  const resolveOwnerByTabOrWindow = (tabId?: unknown, windowId?: unknown): BrowserInstance[] => {
    const toId = (v: unknown): number | null => {
      if (v === undefined || v === null || v === "") return null;
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    };
    const wantTab = toId(tabId);
    const wantWindow = toId(windowId);
    if (wantTab === null && wantWindow === null) return [];
    return listOnline().filter((inst) =>
      inst.windows.some((w) => (wantWindow !== null && w.id === wantWindow) || (wantTab !== null && w.activeTab?.tabId === wantTab)));
  };

  /**
   * The one routing decision for a web_* call: tab/window owner, else an explicit profile hint, else
   * selectedProfile, else resolveTarget()'s heuristic. It never answers "no target": the extension runs a
   * web_request that names no instance in EVERY connected profile, so an untargeted click with two logged-in
   * profiles online happens in both accounts. A selectedProfile that is offline is an error, never a reason
   * to fall back to whichever other profile is online, and so is a tab/window id that several browsers report
   * and neither the hint nor the selection picks out (AMBIGUOUS_TAB_OWNER).
   */
  const resolveDispatch = (args: Record<string, unknown>): DispatchDecision => {
    const online = listOnline();
    const onlineProfiles = online.map((b) => b.profileEmail || b.profileName || b.instanceId);
    const listed = onlineProfiles.join(", ") || "none";
    const refuse = (status: number, code: string, error: string): DispatchDecision => ({ ok: false, status, code, error, onlineProfiles });

    const hint = routingHint(args);
    const explicit = hint !== null && !isWildcard(hint);
    const hinted = explicit ? resolveTarget(hint) : null;
    if (explicit && !hinted) {
      return refuse(400, "PROFILE_NOT_CONNECTED", `No connected browser matches '${hint}'. Connected: ${listed}. Call web_status or web_profile to list browsers.`);
    }
    // Several browsers claiming the tab/window id is a tie that only the caller's hint, else the selected profile,
    // may break - and only by naming one of the claimants. Anything else would be a guess between two accounts.
    const owners = resolveOwnerByTabOrWindow(args.tabId, args.windowId);
    let owner = owners.length === 1 ? owners[0] : null;
    if (owners.length > 1) {
      const pick = explicit ? hint : selectedProfile && !isWildcard(selectedProfile) ? selectedProfile : null;
      owner = pick ? findNamed(owners, pick.trim().toLowerCase()) : null;
      if (!owner) {
        return refuse(409, "AMBIGUOUS_TAB_OWNER",
          `${idsNamed(args)} is reported by ${owners.length} connected browsers: ${owners.map(label).join(", ")}. Tab and window ids are only unique within one browser, so the hub will not guess. Retry with a profile hint naming one of them (profile / __profile, or __instance with its instanceId), or select one with web_profile {action:'select'}.`);
      }
    }
    const target = owner || hinted || resolveTarget(null);
    if (target) return { ok: true, target };

    if (!explicit && selectedProfile && !isWildcard(selectedProfile)) {
      return refuse(409, "SELECTED_PROFILE_OFFLINE",
        `selected profile '${selectedProfile}' is offline; reconnect it, or call web_profile {action:'select', profile:'<online profile>'} with an online profile, or web_profile {action:'select'} with no profile to clear the selection. Online profiles: ${listed}.`);
    }
    if (online.length === 0) {
      return refuse(503, "NO_BROWSER_ONLINE", "No browser is online: no ScreenSync extension has sent this hub a heartbeat in the last 10 minutes. Open the extension so it reconnects, then retry.");
    }
    // Unreachable while resolveTarget() picks some instance whenever one is online; kept so a future change
    // to that heuristic fails closed instead of broadcasting.
    return refuse(409, "TARGET_AMBIGUOUS", `No target browser could be chosen and ${online.length} are online (${listed}). Pass a profile hint (__profile / __email / __browser) or call web_profile {action:'select'}.`);
  };

  /**
   * web_fanout's routing: every pass is pinned to its own browser, so nothing inside the forwarded args may pick
   * another one. A profile hint there is refused (it would send every pass to one browser, or a pass meant for
   * one browser into all of them); `browsers` is how a fanout chooses. A tab or window id names a tab in ONE
   * browser, so only that browser's pass runs and the others are skipped with the reason. An id no heartbeat
   * reports (a background tab: heartbeats list each window's active tab) or that several chosen browsers report
   * is refused unless exactly one browser was chosen, the same guess resolveDispatch() refuses to make.
   */
  const planFanout = (targets: BrowserInstance[], args: Record<string, unknown>): FanoutPlan => {
    const onlineProfiles = listOnline().map((b) => b.profileEmail || b.profileName || b.instanceId);
    const refuse = (status: number, code: string, error: string): FanoutPlan => ({ ok: false, status, code, error, onlineProfiles });
    const hint = ROUTING_KEYS.find((k) => typeof args[k] === "string" && !isWildcard(args[k] as string));
    if (hint) {
      return refuse(400, "FANOUT_ROUTING_HINT",
        `web_fanout runs one pass in each chosen browser, so ${hint}: '${args[hint]}' in its arguments cannot pick one. Choose the browsers with web_fanout {browsers: [...]} (names, instanceIds or emails from web_status.browsers), or call the tool directly with the hint to run it in one browser.`);
    }
    const ids = idsNamed(args);
    if (!ids) return { ok: true, passes: targets.map((target) => ({ target, decision: { ok: true, target } })) };
    const owners = resolveOwnerByTabOrWindow(args.tabId, args.windowId);
    const chosen = owners.filter((o) => targets.some((t) => t.instanceId === o.instanceId));
    const owner = chosen.length === 1 ? chosen[0] : !owners.length && targets.length === 1 ? targets[0] : null;
    if (!owner && chosen.length > 1) {
      return refuse(409, "AMBIGUOUS_TAB_OWNER",
        `${ids} is reported by ${chosen.length} of the chosen browsers: ${chosen.map(label).join(", ")}. Tab and window ids are only unique within one browser; narrow the fanout to one of them with browsers: [...].`);
    }
    if (!owner && !owners.length) {
      return refuse(409, "TAB_OWNER_UNKNOWN",
        `No connected browser reports ${ids} (heartbeats list only each window's active tab), so the hub cannot tell whose it is, and the same id may be a different tab in another browser. Narrow the fanout to the browser that has it with browsers: [...].`);
    }
    const whose = (owner ? [owner] : owners).map(label).join(", ");
    return {
      ok: true,
      passes: targets.map((target) => target.instanceId === owner?.instanceId
        ? { target, decision: { ok: true, target } }
        : { target, skipped: `${ids} belongs to ${whose}; an id means nothing in another browser, so this browser's pass was skipped.` }),
    };
  };

  const statusPayload = (sseClients: number) => {
    const online = listOnline();
    // The top level describes the browser a call with no routing hints is sent to: the same
    // resolveTarget() that request() in web.ts uses. Not online[0] - with two profiles connected the
    // latest heartbeat is often the OTHER logged-in account. null when selectedProfile matches nothing.
    const target = resolveTarget();
    return {
      online: sseClients > 0 && online.length > 0,
      sseConnected: sseClients > 0,
      sseClients,
      webAccessEnabled: [...instances.values()].some((b) => b.webAccessEnabled),
      selectedProfile,
      targetInstanceId: target ? target.instanceId : null,
      targetProfile: target ? (target.profileEmail ?? target.profileName) : null,
      lastSeenAt: target ? target.lastSeenAt : null,
      activeTab: target ? target.tab : null,
      browserCount: instances.size,
      browsers: [...instances.values()].map((b) => ({
        instanceId: b.instanceId,
        browserId: b.browserId,
        name: b.name,
        profileEmail: b.profileEmail,
        profileName: b.profileName,
        profileDir: b.profileDir,
        online: isOnline(b),
        webAccessEnabled: b.webAccessEnabled,
        approvals: b.approvals,
        lastSeenAt: b.lastSeenAt,
        activeTab: b.tab,
        windowCount: b.windows.length,
        windows: b.windows,
        userAgent: b.userAgent,
      })),
    };
  };

  return {
    register,
    get,
    listOnline,
    setSelectedProfile,
    getSelectedProfile,
    resolveTarget,
    resolveOwnerByTabOrWindow,
    resolveDispatch,
    planFanout,
    statusPayload,
  };
}
