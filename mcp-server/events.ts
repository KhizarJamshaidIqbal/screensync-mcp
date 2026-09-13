import { EventEmitter } from "node:events";

export type HubEventType = "frame" | "inspection" | "patch" | "tool" | "agent_connect" | "web_event";
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
const eventRing: Array<{ seq: number; at: string; payload: Record<string, unknown> }> = [];
let eventSeq = 0;

export function recordHubEvent(payload: Record<string, unknown>): number {
  eventSeq += 1;
  eventRing.push({ seq: eventSeq, at: new Date().toISOString(), payload });
  if (eventRing.length > EVENT_RING_MAX) eventRing.splice(0, eventRing.length - EVENT_RING_MAX);
  return eventSeq;
}

export function recentHubEvents(
  since = 0,
  types?: string[],
  limit = 100,
): Array<{ seq: number; at: string; payload: Record<string, unknown> }> {
  const filtered = eventRing.filter(
    (e) => e.seq > since && (!types || types.length === 0 || types.includes(String(e.payload.type))),
  );
  return filtered.slice(Math.max(0, filtered.length - limit));
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
