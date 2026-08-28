import { EventEmitter } from "node:events";

export type HubEventType = "frame" | "inspection" | "patch";
export type HubEvent = { type: HubEventType; at: string };

/**
 * In-process bus for live hub events. The SSE endpoint (/api/events)
 * subscribes so the phone gets pushed updates instead of polling.
 */
export const hubEvents = new EventEmitter();
hubEvents.setMaxListeners(20);

export function emitHubEvent(type: HubEventType): void {
  hubEvents.emit("event", { type, at: new Date().toISOString() } satisfies HubEvent);
}
