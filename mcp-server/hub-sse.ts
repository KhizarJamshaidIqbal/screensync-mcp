import type { Express, Request, Response } from "express";
import { log } from "./config.js";
import { recentHubEvents, recordHubEvent } from "./events.js";

// The hub's live push channel (/api/events). The phone and every browser extension keep one stream each; the
// hub sequences every broadcast (id: lines) into the event ring so a reconnecting client can replay what it
// missed with Last-Event-ID.
//
// Wire format (unchanged): ": connected" on open, then any replayed events, then the agent_connect welcome
// (data only, no id), then "id: <seq>\ndata: <json>\n\n" per broadcast and ": keepalive" every keepaliveMs.
//
// Every write goes through safeWrite(): a client whose socket is gone is dropped instead of throwing into the
// broadcaster, and a client that stops reading (a stalled phone, a frozen service worker) is evicted once more
// than maxBufferedBytes is queued for it, so one dead reader cannot make the hub buffer every web_frame image.

export type SseClientKind = "extension" | "app" | null;

export type SseClientInfo = {
  kind: SseClientKind;
  instanceId: string | null;
  connectedAt: number;
  bufferedBytes: number;
};

/** One sequenced event from the ring, as recentHubEvents() returns it. */
export type SseRingEvent = { seq: number; at: string; payload: Record<string, unknown> };

/** What a replayed event is sent as, or null to skip it (e.g. a web_request that has since been answered). */
export type ReplayPayloadFn = (e: SseRingEvent) => Record<string, unknown> | null;

export type SseHubOptions = {
  keepaliveMs: number;
  maxClients?: number;
  maxBufferedBytes?: number;
  isAuthorized: (header: string | undefined) => boolean;
  onConnect?: (client: SseClientInfo) => void;
  /** Sent to every new stream after any replay (the agent_connect identity). */
  welcome?: () => object | null;
};

export type SseHub = {
  mount: (app: Express) => void;
  broadcast: (payload: object, name?: string) => number;
  count: () => number;
  extensionCount: () => number;
  hasInstance: (instanceId: string) => boolean;
  clients: () => SseClientInfo[];
  setReplayPayload: (fn: ReplayPayloadFn) => void;
  close: () => void;
};

type Client = { res: Response; kind: SseClientKind; instanceId: string | null; connectedAt: number };

export const REPLAY_LIMIT = 500;
const INSTANCE_ID_MAX = 128;

/** `?client=` names who is on the other end; anything else is anonymous (an older client). */
export function clientKindOf(raw: unknown): SseClientKind {
  return raw === "extension" || raw === "app" ? raw : null;
}

/** `?instanceId=` reduced to [A-Za-z0-9._:-], at most 128 chars; null when nothing is left. */
export function sanitizeInstanceId(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const clean = raw.replace(/[^A-Za-z0-9._:-]/g, "").slice(0, INSTANCE_ID_MAX);
  return clean || null;
}

export function createSseHub(opts: SseHubOptions): SseHub {
  const maxClients = opts.maxClients ?? 50;
  const maxBufferedBytes = opts.maxBufferedBytes ?? 8 << 20;
  const clients = new Set<Client>();
  let replayPayload: ReplayPayloadFn = (e) => e.payload;
  let closed = false;

  const info = (c: Client): SseClientInfo => ({
    kind: c.kind,
    instanceId: c.instanceId,
    connectedAt: c.connectedAt,
    bufferedBytes: c.res.writableLength ?? 0,
  });

  /** Forgets a client. Safe to call any number of times, from any of its close/error paths. */
  const drop = (c: Client, reason: string) => {
    if (!clients.delete(c)) return;
    log("INFO", "SSE client disconnected", { reason, kind: c.kind, instanceId: c.instanceId, totalClients: clients.size });
  };

  const evict = (c: Client, reason: string) => {
    drop(c, reason);
    try { c.res.destroy(); } catch { /* already gone */ }
  };

  /**
   * Writes one chunk; false (and the client dropped) when it is gone or has stopped reading. `judgeBacklog` is
   * false for the writes of a stream's own handshake (connected, replay, welcome): they run in one synchronous
   * burst, so whatever is queued then is what the hub just wrote, not what the reader failed to take.
   */
  const safeWrite = (c: Client, chunk: string, judgeBacklog = true): boolean => {
    const { res } = c;
    if (res.writableEnded || res.destroyed) {
      drop(c, "gone");
      return false;
    }
    // Measured BEFORE this write: what is still queued from earlier writes is what the reader failed to take.
    // (Right after a write the queue always holds that chunk, so one large frame must not evict a healthy reader,
    // and nor must a replay of a large pending web_request followed by the welcome: see handle().)
    if (judgeBacklog && res.writableLength > maxBufferedBytes) {
      log("WARN", "SSE client evicted: not reading its stream", {
        kind: c.kind, instanceId: c.instanceId, bufferedBytes: res.writableLength, maxBufferedBytes,
      });
      evict(c, "backpressure");
      return false;
    }
    try {
      res.write(chunk);
      (res as unknown as { flush?: () => void }).flush?.();
    } catch (err) {
      log("WARN", "SSE write failed", { error: String(err), kind: c.kind, instanceId: c.instanceId });
      evict(c, "write_failed");
      return false;
    }
    return true;
  };

  const broadcast = (payload: object, name = "event"): number => {
    const seq = recordHubEvent(payload as Record<string, unknown>);
    log("INFO", "SSE broadcast", { name, seq, clientsCount: clients.size });
    const line = `id: ${seq}\ndata: ${JSON.stringify(payload)}\n\n`;
    for (const c of [...clients]) safeWrite(c, line);
    return seq;
  };

  const keepalive = setInterval(() => {
    for (const c of [...clients]) safeWrite(c, ": keepalive\n\n");
  }, opts.keepaliveMs);
  keepalive.unref();

  const handle = (req: Request, res: Response) => {
    if (!opts.isAuthorized(req.header("authorization"))) {
      res.status(401).json({ success: false, error: "Invalid ScreenSync pairing token." });
      return;
    }
    if (closed) {
      res.status(503).json({ success: false, error: "The hub is shutting down." });
      return;
    }
    if (clients.size >= maxClients) {
      const oldest = clients.values().next().value;
      if (oldest) {
        drop(oldest, "max_clients");
        try { oldest.res.end(); } catch { /* already gone */ }
      }
    }
    const c: Client = {
      res,
      kind: clientKindOf(req.query.client),
      instanceId: sanitizeInstanceId(req.query.instanceId),
      connectedAt: Date.now(),
    };
    // Every way a stream can end removes it exactly once; 'error' must have a listener or a reset socket
    // becomes an uncaught exception, which index.ts turns into a hub exit.
    res.on("error", (err) => drop(c, `error: ${String(err)}`));
    res.on("close", () => drop(c, "closed"));
    req.on("close", () => drop(c, "closed"));

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    res.flushHeaders?.();
    res.socket?.setNoDelay(true);
    clients.add(c);
    opts.onConnect?.(info(c));
    // The handshake writes (connected, replay, welcome) skip the backlog check: the socket has had no event-loop
    // turn to drain yet, so a replayed web_request carrying a large upload would otherwise evict the very client
    // it is replayed to, which would reconnect, get the same replay and be evicted again until the request expired.
    if (!safeWrite(c, ": connected\n\n", false)) return;

    // Last-Event-ID replay: a reconnecting client tells us the last seq it saw (SSE standard header or
    // ?lastEventId=) and we replay what it missed, oldest first, before the welcome event.
    const lastId = Number(req.headers["last-event-id"] ?? (req.query.lastEventId as string | undefined) ?? 0) || 0;
    if (lastId > 0) {
      let sent = 0;
      let skipped = 0;
      for (const e of recentHubEvents(lastId, undefined, REPLAY_LIMIT, false)) {
        let p: Record<string, unknown> | null;
        try {
          p = replayPayload(e);
        } catch (err) {
          log("WARN", "SSE replay payload failed", { seq: e.seq, error: String(err) });
          p = null;
        }
        if (!p) { skipped += 1; continue; }
        if (!safeWrite(c, `id: ${e.seq}\ndata: ${JSON.stringify({ ...p, replayed: true })}\n\n`, false)) return;
        sent += 1;
      }
      log("INFO", "SSE replay", { fromSeq: lastId, events: sent, skipped });
    }
    // Immediately replay agent identity so the phone always sees the name
    // even if it connects after the one-time startup event was emitted.
    const welcome = opts.welcome?.();
    if (welcome && !safeWrite(c, `data: ${JSON.stringify(welcome)}\n\n`, false)) return;
    log("INFO", "SSE client connected", { kind: c.kind, instanceId: c.instanceId, totalClients: clients.size });
  };

  return {
    mount: (app) => { app.get("/api/events", handle); },
    broadcast,
    count: () => clients.size,
    extensionCount: () => [...clients].filter((c) => c.kind === "extension").length,
    hasInstance: (instanceId) => {
      const want = String(instanceId ?? "").toLowerCase();
      return want !== "" && [...clients].some((c) => c.instanceId?.toLowerCase() === want);
    },
    clients: () => [...clients].map(info),
    setReplayPayload: (fn) => { replayPayload = fn; },
    close: () => {
      closed = true;
      clearInterval(keepalive);
      for (const c of [...clients]) {
        clients.delete(c);
        try { c.res.end(); } catch { /* already gone */ }
      }
    },
  };
}
