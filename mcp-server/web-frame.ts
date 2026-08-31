import type { Express, Request, Response } from "express";
import { isAuthorized } from "./config.js";

// Live frame relay for web_watch: while a watch loop runs, the extension
// POSTs each kept frame here; the hub buffers a small per-watch ring and
// broadcasts it as the named SSE event `web_frame` so any subscriber
// (dashboard live view, future clients) can render the stream in realtime.
// The final web_watch tool result also carries the frames, so the AI reviews
// every changed frame even without an SSE client.

export type FrameEntry = { index: number; ts: number; imageDataUrl: string };

type Session = {
  watchId: string;
  frames: FrameEntry[];
  timer: ReturnType<typeof setTimeout>;
};

const FRAME_RING_CAP = 20;
const SESSION_IDLE_MS = 60_000;

export type FrameStore = {
  registerRoutes: (app: Express) => void;
};

export function createFrameStore(broadcast: (payload: object, name?: string) => void): FrameStore {
  const sessions = new Map<string, Session>();

  const touch = (watchId: string): Session => {
    let s = sessions.get(watchId);
    if (!s) {
      s = { watchId, frames: [], timer: setTimeout(() => sessions.delete(watchId), SESSION_IDLE_MS) };
      sessions.set(watchId, s);
    }
    clearTimeout(s.timer);
    s.timer = setTimeout(() => sessions.delete(watchId), SESSION_IDLE_MS);
    return s;
  };

  const registerRoutes = (app: Express) => {
    app.post("/api/web/frame", (req: Request, res: Response) => {
      if (!isAuthorized(req.header("authorization"))) {
        res.status(401).json({ success: false, error: "Invalid ScreenSync pairing token." });
        return;
      }
      const b = (req.body ?? {}) as { watchId?: string; frame?: FrameEntry };
      if (!b.watchId || !b.frame || typeof b.frame.imageDataUrl !== "string") {
        res.status(400).json({ success: false, error: "watchId and frame.imageDataUrl are required." });
        return;
      }
      const s = touch(String(b.watchId));
      s.frames.push(b.frame);
      if (s.frames.length > FRAME_RING_CAP) s.frames.shift();
      broadcast({ type: "web_frame", watchId: s.watchId, frame: b.frame }, "web_frame");
      res.json({ success: true, buffered: s.frames.length });
    });

    app.get("/api/web/watch/:id/frames", (req: Request, res: Response) => {
      if (!isAuthorized(req.header("authorization"))) {
        res.status(401).json({ success: false, error: "Invalid ScreenSync pairing token." });
        return;
      }
      const id = String(req.params.id);
      const s = sessions.get(id);
      res.json({ success: true, watchId: id, frames: s ? s.frames : [] });
    });
  };

  return { registerRoutes };
}
