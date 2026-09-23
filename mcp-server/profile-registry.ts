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

/** The argument that names a browser for a call, in precedence order. `any`/`default` name none. */
function routingHint(args: Record<string, unknown>): string | null {
  for (const key of ["__profile", "profile", "__email", "email", "__instance", "instanceId", "__browser"]) {
    if (typeof args[key] === "string") return args[key] as string;
  }
  return null;
}

const isWildcard = (v: string) => ["", "any", "default"].includes(v.trim().toLowerCase());

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

    // 1. Exact instanceId
    const byInst = online.find((inst) => inst.instanceId.toLowerCase() === query);
    if (byInst) return byInst;

    // 2. Exact or substring email match
    const byEmail = online.find((inst) => inst.profileEmail && (inst.profileEmail.toLowerCase() === query || inst.profileEmail.toLowerCase().includes(query)));
    if (byEmail) return byEmail;

    // 3. Profile name or directory match
    const byName = online.find(
      (inst) =>
        (inst.profileName && inst.profileName.toLowerCase() === query) ||
        (inst.profileDir && inst.profileDir.toLowerCase() === query)
    );
    if (byName) return byName;

    // 4. Browser name match (e.g. 'chrome', 'edge')
    const byBrowserName = online.find((inst) => inst.name === query);
    if (byBrowserName) return byBrowserName;

    return null;
  };

  /**
   * Finds which online instance actually owns a given tab or window, by scanning each
   * instance's `windows[]` snapshot (populated from the extension's heartbeat, see
   * web-bridge.js registerWebBridge). A windowId is matched against `windows[].id`; a tabId
   * is matched against `windows[].activeTab.tabId` (the only per-window tab id the heartbeat
   * tracks). This is precise ground truth for routing — unlike resolveTarget()'s hint, which
   * falls back to "whichever profile has a focused window" or "most recently seen" and can
   * silently pick the wrong Chrome profile when two are connected at once.
   * Returns null when no online instance claims the id, so callers can fall back to
   * resolveTarget()'s heuristic unchanged (never regresses the no-hint case).
   */
  const resolveOwnerByTabOrWindow = (tabId?: unknown, windowId?: unknown): BrowserInstance | null => {
    const toId = (v: unknown): number | null => {
      if (v === undefined || v === null || v === "") return null;
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    };
    const wantTab = toId(tabId);
    const wantWindow = toId(windowId);
    if (wantTab === null && wantWindow === null) return null;

    for (const inst of listOnline()) {
      for (const w of inst.windows) {
        if (wantWindow !== null && w.id === wantWindow) return inst;
        if (wantTab !== null && w.activeTab && w.activeTab.tabId === wantTab) return inst;
      }
    }
    return null;
  };

  /**
   * The one routing decision for a web_* call: tab/window owner, else an explicit profile hint, else
   * selectedProfile, else resolveTarget()'s heuristic. It never answers "no target": the extension runs a
   * web_request that names no instance in EVERY connected profile, so an untargeted click with two logged-in
   * profiles online happens in both accounts. A selectedProfile that is offline is an error, never a reason
   * to fall back to whichever other profile is online.
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
    const target = resolveOwnerByTabOrWindow(args.tabId, args.windowId) || hinted || resolveTarget(null);
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
    statusPayload,
  };
}
