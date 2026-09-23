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
   * If hint is omitted, defaults to currently selected profile, or the latest active instance.
   */
  const resolveTarget = (hint?: string | null): BrowserInstance | null => {
    const online = listOnline();
    if (!online.length) return null;

    const query = (hint || selectedProfile || "").trim().toLowerCase();
    if (!query || query === "any" || query === "default") {
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
    statusPayload,
  };
}
