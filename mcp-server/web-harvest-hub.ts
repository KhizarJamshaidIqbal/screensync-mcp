import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DATA_DIR, log } from "./config.js";
import type { WebToolResult } from "./web.js";

const VAULT_DIR = path.join(DATA_DIR, "vault");
const HARVEST_DIR = path.join(DATA_DIR, "harvest");

function ensureDirs() {
  if (!existsSync(VAULT_DIR)) mkdirSync(VAULT_DIR, { recursive: true });
  if (!existsSync(HARVEST_DIR)) mkdirSync(HARVEST_DIR, { recursive: true });
}

function sanitizeDomain(domain: string): string {
  return domain.toLowerCase().replace(/[^a-z0-9._-]+/g, "_");
}

export type HarvestTarget = {
  platform: string;
  task?: string;
  url?: string;
  limit?: number;
  scrollPages?: number;
  useExistingTab?: boolean;
};

export async function executeParallelHarvest(
  targets: HarvestTarget[],
  request: (tool: string, args: Record<string, unknown>, timeoutMs: number) => Promise<WebToolResult>,
  broadcast: (payload: object, name?: string) => void,
  timeoutMs = 45_000,
  concurrency = 3,
): Promise<{ success: boolean; totalTargets: number; successfulTargets: number; results: Array<Record<string, unknown>> }> {
  ensureDirs();
  const clampedConcurrency = Math.min(Math.max(concurrency, 1), 6);
  const results: Array<Record<string, unknown>> = [];

  for (let i = 0; i < targets.length; i += clampedConcurrency) {
    const batch = targets.slice(i, i + clampedConcurrency);
    const batchResults = await Promise.all(
      batch.map(async (t) => {
        broadcast({ type: "web_harvest_progress", at: new Date().toISOString(), platform: t.platform, task: t.task || "feed" });
        const res = await request("web_authenticated_harvest", t as Record<string, unknown>, timeoutMs);
        return {
          target: t,
          ok: res.ok,
          data: res.data,
          error: res.error,
        };
      })
    );
    results.push(...batchResults);
  }

  // Persist harvest dataset
  const successful = results.filter((r) => r.ok).length;
  const datasetName = `harvest-${Date.now()}.json`;
  try {
    writeFileSync(path.join(HARVEST_DIR, datasetName), JSON.stringify({
      timestamp: new Date().toISOString(),
      totalTargets: targets.length,
      successful,
      results,
    }, null, 2));
  } catch (err) {
    log("WARN", "Failed to persist harvest dataset", { error: String(err) });
  }

  return {
    success: successful > 0,
    totalTargets: targets.length,
    successfulTargets: successful,
    results,
  };
}

export async function executeSessionVault(
  action: string,
  args: Record<string, unknown>,
  request: (tool: string, args: Record<string, unknown>, timeoutMs: number) => Promise<WebToolResult>,
  broadcast: (payload: object, name?: string) => void,
  timeoutMs = 45_000,
): Promise<WebToolResult> {
  ensureDirs();
  const act = String(action || "list").toLowerCase();

  // ── Action: Save session to vault ─────────────────────────────────────────
  if (act === "save") {
    const domain = String(args.domain || "").trim();
    if (!domain) return { ok: false, error: "web_session_vault save requires 'domain' (e.g. 'github.com')." };

    const exportRes = await request("web_session_vault_export", { domain, includeStorage: args.includeStorage !== false, __browser: args.__browser }, timeoutMs);
    if (!exportRes.ok || !exportRes.data) {
      return { ok: false, error: exportRes.error || "Failed to export session from browser." };
    }

    const filename = `${sanitizeDomain(domain)}.json`;
    const filePath = path.join(VAULT_DIR, filename);
    const payload = {
      ...(exportRes.data as Record<string, unknown>),
      vaultName: args.name || domain,
      savedAt: new Date().toISOString(),
    };
    writeFileSync(filePath, JSON.stringify(payload, null, 2));

    broadcast({ type: "web_session_vault_saved", domain, savedAt: payload.savedAt });
    return {
      ok: true,
      data: {
        saved: true,
        domain,
        vaultFile: filename,
        cookieCount: (exportRes.data as { cookieCount?: number }).cookieCount || 0,
        savedAt: payload.savedAt,
      },
    };
  }

  // ── Action: Restore session from vault ───────────────────────────────────
  if (act === "restore") {
    const domain = String(args.domain || "").trim();
    if (!domain) return { ok: false, error: "web_session_vault restore requires 'domain'." };

    const filename = `${sanitizeDomain(domain)}.json`;
    const filePath = path.join(VAULT_DIR, filename);
    if (!existsSync(filePath)) {
      return { ok: false, error: `No saved vault session found for domain "${domain}". Call web_session_vault {action:'list'} to see available sessions.` };
    }

    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(readFileSync(filePath, "utf8"));
    } catch {
      return { ok: false, error: `Corrupted vault file for domain "${domain}".` };
    }

    const importRes = await request("web_session_vault_import", { session: payload, __browser: args.__browser }, timeoutMs);
    if (!importRes.ok) {
      return { ok: false, error: importRes.error || "Failed to restore session into browser." };
    }

    broadcast({ type: "web_session_vault_restored", domain, restoredAt: new Date().toISOString() });
    return {
      ok: true,
      data: {
        restored: true,
        domain,
        importResult: importRes.data,
      },
    };
  }

  // ── Action: List sessions in vault ───────────────────────────────────────
  if (act === "list") {
    const files = readdirSync(VAULT_DIR).filter((f) => f.endsWith(".json"));
    const vaults = files.map((f) => {
      try {
        const content = JSON.parse(readFileSync(path.join(VAULT_DIR, f), "utf8"));
        return {
          domain: content.domain || f.replace(".json", ""),
          vaultName: content.vaultName || null,
          savedAt: content.savedAt || null,
          cookieCount: content.cookieCount || 0,
          localStorageCount: content.localStorageCount || 0,
          sessionStorageCount: content.sessionStorageCount || 0,
        };
      } catch {
        return { domain: f.replace(".json", ""), error: "corrupted" };
      }
    });

    return {
      ok: true,
      data: {
        vaultCount: vaults.length,
        vaults,
      },
    };
  }

  // ── Action: Delete session from vault ─────────────────────────────────────
  if (act === "delete") {
    const domain = String(args.domain || "").trim();
    if (!domain) return { ok: false, error: "web_session_vault delete requires 'domain'." };
    const filename = `${sanitizeDomain(domain)}.json`;
    const filePath = path.join(VAULT_DIR, filename);
    if (existsSync(filePath)) {
      unlinkSync(filePath);
      return { ok: true, data: { deleted: true, domain } };
    }
    return { ok: false, error: `Vault file for domain "${domain}" does not exist.` };
  }

  // ── Action: Sync between browsers via vault ───────────────────────────────
  if (act === "sync") {
    const domain = String(args.domain || "").trim();
    if (!domain) return { ok: false, error: "web_session_vault sync requires 'domain'." };

    // Export from source browser
    const fromBrowser = args.from ? String(args.from) : undefined;
    const toBrowser = args.to ? String(args.to) : undefined;

    const exportRes = await request("web_session_vault_export", { domain, includeStorage: args.includeStorage !== false, __browser: fromBrowser }, timeoutMs);
    if (!exportRes.ok || !exportRes.data) {
      return { ok: false, error: `Failed to export session from source browser: ${exportRes.error || "unknown error"}` };
    }

    // Save to hub vault
    const filename = `${sanitizeDomain(domain)}.json`;
    const filePath = path.join(VAULT_DIR, filename);
    const payload: Record<string, unknown> = {
      ...(exportRes.data as Record<string, unknown>),
      vaultName: domain,
      savedAt: new Date().toISOString(),
    };
    writeFileSync(filePath, JSON.stringify(payload, null, 2));

    // Import into target browser
    const importRes = await request("web_session_vault_import", { session: payload, __browser: toBrowser }, timeoutMs);
    if (!importRes.ok) {
      return { ok: false, error: `Saved to vault, but failed to restore into target browser: ${importRes.error || "unknown error"}` };
    }

    return {
      ok: true,
      data: {
        synced: true,
        domain,
        from: fromBrowser || "default",
        to: toBrowser || "default",
        cookieCount: Number(payload.cookieCount) || 0,
        importResult: importRes.data,
      },
    };
  }

  return { ok: false, error: `Unknown web_session_vault action: "${act}". Supported: save, restore, list, delete, sync.` };
}
