import { EventEmitter } from "node:events";

export type HubEventType = "frame" | "inspection" | "patch" | "tool" | "agent_connect";
export type HubEvent = { type: HubEventType; at: string; label?: string; ok?: boolean; agentName?: string };

/**
 * In-process bus for live hub events. The SSE endpoint (/api/events)
 * subscribes so the phone gets pushed updates instead of polling.
 */
export const hubEvents = new EventEmitter();
hubEvents.setMaxListeners(20);

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
}
