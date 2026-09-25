// ScreenSync Web Bridge - the routes the extension calls that are not tool relays.
//
// Split out of web.ts, which is far over the repo's 500-line limit: the ambient-event route moved here
// unchanged, and the approval hand-shake was added beside it rather than growing web.ts further.

import type { Express, Request, Response } from "express";

type PendingRequest = {
  resolve: (r: { ok: boolean; error?: string; code?: string }) => void;
  timer: ReturnType<typeof setTimeout>;
  /** Set once the extension has asked for more time, so it cannot keep a request alive forever. */
  extended?: boolean;
  /** When the hub stops waiting (epoch ms). A replayed web_request carries it, so it moves whenever the timer does. */
  deadlineAt?: number;
};

export interface ExtensionRouteDeps {
  isAuthorized: (header: string | undefined) => boolean;
  broadcast: (payload: object, name?: string) => void;
  pending: Map<string, PendingRequest>;
}

/** Longest a person may be asked, and the room left after they answer for the action itself to run. */
export const APPROVAL_MAX_MS = 90_000;
export const APPROVAL_RUN_HEADROOM_MS = 20_000;

export function mountExtensionRoutes(app: Express, { isAuthorized, broadcast, pending }: ExtensionRouteDeps): void {
  // Ambient browser events from the extension (navigations, tab switches,
  // page loads) - recorded into the sequenced SSE ring and fanned out live.
  app.post("/api/web/event", (req: Request, res: Response) => {
    if (!isAuthorized(req.header("authorization"))) {
      res.status(401).json({ success: false, error: "Invalid ScreenSync pairing token." });
      return;
    }
    const b = (req.body ?? {}) as Record<string, unknown>;
    const type = typeof b.type === "string" && /^web_[a-z0-9_]+$/.test(b.type) ? b.type : "web_event";
    broadcast({
      type,
      at: new Date().toISOString(),
      source: typeof b.source === "string" ? b.source : "browser",
      data: b.data && typeof b.data === "object" ? b.data : {},
    });
    res.json({ success: true });
  });

  // Is the hub still waiting for this request? The extension asks before running a live web_request that may
  // have sat in a stalled socket past the hub's wait (its remainingMs was measured when the hub wrote it), so
  // an action never runs after the agent was answered TIMEOUT. Read-only: it never extends the wait.
  app.get("/api/web/pending/:id", (req: Request, res: Response) => {
    if (!isAuthorized(req.header("authorization"))) {
      res.status(401).json({ success: false, error: "Invalid ScreenSync pairing token." });
      return;
    }
    const entry = pending.get(String(req.params.id ?? ""));
    if (!entry) {
      res.status(404).json({ success: false, code: "NOT_PENDING", error: "Unknown or already-resolved request id." });
      return;
    }
    const remainingMs = entry.deadlineAt != null ? Math.max(0, entry.deadlineAt - Date.now()) : null;
    res.json({ success: true, remainingMs });
  });

  // A person is being asked about a request the extension is holding. Without this the hub would give up
  // on it after its ordinary timeout - typically before they have finished reading - and the action could
  // then run after the agent had already been told it timed out. One extension per request, and bounded.
  app.post("/api/web/awaiting", (req: Request, res: Response) => {
    if (!isAuthorized(req.header("authorization"))) {
      res.status(401).json({ success: false, error: "Invalid ScreenSync pairing token." });
      return;
    }
    const b = (req.body ?? {}) as { id?: unknown; ms?: unknown };
    const entry = typeof b.id === "string" ? pending.get(b.id) : undefined;
    if (!entry || !b.id) {
      res.status(404).json({ success: false, error: "Unknown or already-resolved request id." });
      return;
    }
    if (entry.extended) {
      res.status(409).json({ success: false, error: "This request was already given more time." });
      return;
    }
    const id = String(b.id);
    const asked = Math.min(Math.max(Number(b.ms) || 0, 1_000), APPROVAL_MAX_MS);
    // More time, never less: a long-wait call (web_takeover's minutes) that also asks a person keeps its own deadline.
    const now = Date.now();
    const waitMs = Math.max(asked + APPROVAL_RUN_HEADROOM_MS, (entry.deadlineAt ?? 0) - now);
    clearTimeout(entry.timer);
    entry.extended = true;
    entry.deadlineAt = now + waitMs;
    entry.timer = setTimeout(() => {
      pending.delete(id);
      // The extension answers APPROVAL_TIMEOUT itself when nobody decides in time; getting here means it went quiet
      // (its service worker restarted, or the approved action is still running). Say so, not "hub unreachable".
      entry.resolve({
        ok: false, code: "TIMEOUT",
        error: `Timed out after ${waitMs}ms waiting for the browser extension, which had asked the user to approve this call. The extension may have restarted, or the approved action may still be running: check web_status and web_events before retrying.`,
      });
    }, waitMs);
    res.json({ success: true, waitMs });
  });
}
