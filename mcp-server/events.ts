import { EventEmitter } from "node:events";

export type HubEventType = "frame" | "inspection" | "patch" | "tool" | "agent_connect" | "web_event" | "web_replay_step" | "web_flow_scheduled_run";
export type HubEvent = { type: HubEventType; at: string; label?: string; ok?: boolean; agentName?: string };

/**
 * In-process bus for live hub events. The SSE endpoint (/api/events)
 * subscribes so the phone gets pushed updates instead of polling.
 */
export const hubEvents = new EventEmitter();
hubEvents.setMaxListeners(20);

// ── Real-time observability ring ────────────────────────────────────────────
// Every SSE-broadcast payload is sequenced and buffered (id: lines on the wire,
// Last-Event-ID replay on reconnect) so agents can tail or replay hub activity
// through web_events / /api/events/recent without a persistent stream.
const EVENT_RING_MAX = 500;
const EVENT_RING_MAX_BYTES = 5 * 1024 * 1024; // 5MB total memory cap
const eventRing: Array<{ seq: number; at: string; payload: Record<string, unknown> }> = [];
let currentRingBytes = 0;
let eventSeq = Date.now() * 1000;

function sanitizePayload(obj: unknown, depth = 0): unknown {
  if (depth > 5) return obj;
  if (typeof obj === "string") {
    if (obj.length > 512 && (obj.startsWith("data:image/") || /^[A-Za-z0-9+/=]{512,}$/.test(obj.slice(0, 100)))) {
      return obj.slice(0, 96) + `... [base64 truncated, ${obj.length} bytes]`;
    }
    return obj;
  }
  if (Array.isArray(obj)) {
    return obj.map((item) => sanitizePayload(item, depth + 1));
  }
  if (obj && typeof obj === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      out[k] = sanitizePayload(v, depth + 1);
    }
    return out;
  }
  return obj;
}

export function recordHubEvent(payload: Record<string, unknown>): number {
  eventSeq += 1;
  const sanitized = (sanitizePayload(payload) || {}) as Record<string, unknown>;
  const entryBytes = JSON.stringify(sanitized).length;
  currentRingBytes += entryBytes;
  eventRing.push({ seq: eventSeq, at: new Date().toISOString(), payload: sanitized });

  while (eventRing.length > EVENT_RING_MAX || (currentRingBytes > EVENT_RING_MAX_BYTES && eventRing.length > 1)) {
    const dropped = eventRing.shift();
    if (dropped) {
      currentRingBytes = Math.max(0, currentRingBytes - JSON.stringify(dropped.payload).length);
    }
  }
  return eventSeq;
}

type RingEvent = { seq: number; at: string; payload: Record<string, unknown> };

function matchingEvents(since: number, types?: string[]): RingEvent[] {
  return eventRing.filter(
    (e) => e.seq > since && (!types || types.length === 0 || types.includes(String(e.payload.type))),
  );
}

/**
 * Buffered events after `since`, oldest first. `newest` (the default) keeps the LAST `limit` of them, the live
 * tail; `newest: false` keeps the FIRST `limit`, so a caller can page forward without gaps.
 */
export function recentHubEvents(since = 0, types?: string[], limit = 100, newest = true): RingEvent[] {
  const filtered = matchingEvents(since, types);
  return newest ? filtered.slice(Math.max(0, filtered.length - limit)) : filtered.slice(0, limit);
}

/**
 * The web_events tool's reply, answered from the ring with no browser round trip. The default is unchanged:
 * the most recent `limit` events, ascending. `newest: true` asks for that explicitly; `newest: false` returns
 * the first `limit` after `since` instead (continue with since = the last seq returned). `skipped` counts the
 * matching events this reply left out, older ones for newest, newer ones otherwise.
 */
export function webEventsReply(args: Record<string, unknown>) {
  const since = Number(args.since) || 0;
  const limit = Math.min(Number(args.limit) || 100, 500);
  const types = Array.isArray(args.types)
    ? args.types.map(String)
    : typeof args.types === "string"
      ? String(args.types).split(",").map((s) => s.trim()).filter(Boolean)
      : undefined;
  const newest = !(args.newest === false || args.newest === "false");
  const matched = matchingEvents(since, types).length;
  const events = recentHubEvents(since, types, limit, newest);
  return {
    lastSeq: lastEventSeq(),
    count: events.length,
    since,
    types: types ?? null,
    newest,
    skipped: matched - events.length,
    events: events.map((e) => ({ seq: e.seq, at: e.at, ...e.payload })),
  };
}

export function lastEventSeq(): number {
  return eventSeq;
}

export function emitHubEvent(
  type: HubEventType,
  label?: string,
  ok?: boolean,
  agentName?: string,
): void {
  hubEvents.emit("event", {
    type,
    at: new Date().toISOString(),
    ...(label !== undefined ? { label } : {}),
    ...(ok !== undefined ? { ok } : {}),
    ...(agentName !== undefined ? { agentName } : {}),
  } satisfies HubEvent);
}
