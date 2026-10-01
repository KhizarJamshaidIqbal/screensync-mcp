import { AUTH_TOKEN, HTTP_PORT } from "./config.js";
import type { SseClientKind } from "./hub-sse.js";
import { listFrames, type FrameMetadata } from "./storage.js";

// What "is the phone connected" means, in ONE place. The HTTP route GET /api/device/status (hub.ts) and the
// get_device_status MCP tool (mcp.ts) both answer through collectDeviceStatus(), so the two cannot drift.
//
// Before this, both reported connected:true as soon as ANY frame file existed on disk, so a phone that had not
// pushed a frame for 15 days (or was not even online) still read as connected. Two independent facts are separated:
//   - the LINK: the phone holds an SSE stream to the hub (`/api/events?client=app`), and
//   - the FLOW: a frame actually arrived recently.
// A phone can be linked and silent (the mirror is not capturing), which is exactly the case that used to hide.

/** A frame newer than this means the mirror is live; older means it is not (the phone pushes about once a second while mirroring). */
export const FRAME_FRESH_MS = 60_000;

/** streaming = frames are arriving; linked_no_frames = the phone is on the hub's stream but nothing arrives; no_phone = no phone stream. */
export type DeviceState = "streaming" | "linked_no_frames" | "no_phone";

export type DeviceStatus = {
  /** A frame arrived within the last FRAME_FRESH_MS. */
  connected: boolean;
  /** At least one frame is retained (it may be old). */
  hasFrames: boolean;
  /** At least one SSE client that identified itself as the phone app is connected right now. */
  phoneOnline: boolean;
  state: DeviceState;
  transport: "local-http";
  lastFrameAt: string | null;
  lastFrameAgeMs: number | null;
  /** The opposite of `connected`; kept for clients written before `state` existed. */
  stale: boolean;
  deviceModel: string | null;
  retainedFrames: number;
};

/** True when the SSE registry (hub-sse.ts clients()) holds at least one stream that opened as `?client=app`. */
export function phoneOnlineFrom(clients: ReadonlyArray<{ kind: SseClientKind }>): boolean {
  return clients.some((c) => c.kind === "app");
}

/** The status for `frames` (newest first, as listFrames() returns them) and the phone's link state. */
export function deviceStatusFrom(frames: readonly FrameMetadata[], phoneOnline: boolean, nowMs: number = Date.now()): DeviceStatus {
  const frame = frames[0];
  const receivedMs = frame ? Date.parse(frame.receivedAt) : NaN;
  const ageMs = Number.isFinite(receivedMs) ? nowMs - receivedMs : null;
  const connected = ageMs !== null && ageMs <= FRAME_FRESH_MS;
  return {
    connected,
    hasFrames: frames.length > 0,
    phoneOnline,
    state: connected ? "streaming" : phoneOnline ? "linked_no_frames" : "no_phone",
    transport: "local-http",
    lastFrameAt: frame?.receivedAt ?? null,
    lastFrameAgeMs: ageMs,
    stale: !connected,
    deviceModel: frame?.deviceModel ?? null,
    retainedFrames: frames.length,
  };
}

/** Reads the retained frames and combines them with the caller's view of the phone's link. */
export async function collectDeviceStatus(phoneOnline: () => boolean | Promise<boolean>): Promise<DeviceStatus> {
  const frames = await listFrames();
  return deviceStatusFrom(frames, await phoneOnline());
}

/**
 * Whether the phone is on the hub's SSE stream, asked of the hub over HTTP. The stdio MCP server cannot read the
 * SSE registry directly: it lives in whichever process owns the port, which may be a different one. A hub that
 * cannot be reached, is an older build that does not report it, or answers anything unexpected counts as "not online".
 */
export async function fetchHubPhoneOnline(baseUrl: string = `http://127.0.0.1:${HTTP_PORT}`, token: string = AUTH_TOKEN): Promise<boolean> {
  try {
    const res = await fetch(`${baseUrl}/api/device/status`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(1500),
    });
    if (!res.ok) return false;
    return ((await res.json()) as { phoneOnline?: unknown }).phoneOnline === true;
  } catch {
    return false;
  }
}
