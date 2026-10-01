import type { Express } from "express";
import { controlToolDefinitions } from "./catalog-control.js";
import { isAuthorized } from "./config.js";
import { emitHubEvent } from "./events.js";
import { isControlTool, runControlAction, type ControlResult } from "./mcp-control.js";

// POST /api/control/:action, the phone control plane over HTTP: the app's in-app tool runner, the extension's
// control pad and HTTP-only agents. Mounted by hub.ts via mountControlRoutes(). It runs the very handler an MCP
// client reaches (runControlAction in mcp-control.ts), so every control_* tool in catalog-control.ts works here,
// named without its prefix (tap, tap_text, open_url, launch_app, ...) or in full (control_tap). `launch` is the
// short name older app and extension builds send for control_launch_app, and keeps working.
//
// Arguments are checked against the tool's catalogue inputSchema before anything reaches adb: a missing required
// one is 400 {code: "MISSING_ARG"}, never `input tap NaN NaN`. The replies keep the shapes this route always had:
// {success, device} for status, {success, imageDataUrl} for screenshot, the handler's {success, detail, ...}
// for the rest, and the handler's typed refusals ({success: false, code, ...}) as 400, or 503 when retryable.

/** The part of a catalogue inputSchema this route reads. A property can be absent from one tool's literal type. */
type JsonSchema = { required?: string[]; properties?: Record<string, { type?: string } | undefined> };

/** Short names older clients send, and the tool each one means. */
const LEGACY_ACTIONS: Readonly<Record<string, string>> = { launch: "control_launch_app" };

/** Every control_* tool's input schema, from the catalogue: the one source of its required arguments. */
const SCHEMAS = new Map<string, JsonSchema>(
  controlToolDefinitions()
    .filter((t) => t.name.startsWith("control_"))
    .map((t) => [t.name, t.inputSchema as JsonSchema]),
);

const own = (o: object, key: string) => Object.prototype.hasOwnProperty.call(o, key);

/** The control_* tool an /api/control/:action path names, or null when it names none. */
export function resolveControlAction(action: string): string | null {
  const name = own(LEGACY_ACTIONS, action) ? LEGACY_ACTIONS[action] : action.startsWith("control_") ? action : `control_${action}`;
  return SCHEMAS.has(name) && isControlTool(name) ? name : null;
}

/** The short action names the route answers (plus the legacy `launch`), in catalogue order. */
export function controlRouteActions(): string[] {
  return [...[...SCHEMAS.keys()].map((n) => n.slice("control_".length)), ...Object.keys(LEGACY_ACTIONS)];
}

export type ArgCheck = { args: Record<string, unknown> } | { error: Record<string, unknown> };

/**
 * Checks a request body against the tool's schema. A null value counts as absent (an empty optional form field
 * then gets the tool's default). Every required argument must be present, and every number or integer argument a
 * finite number; a numeric string ("120") is taken as its number, as this route's old Number() calls did. Nothing
 * else is coerced or rejected here: the handler validates the rest, exactly as it does for an MCP call.
 */
export function checkControlArgs(name: string, body: unknown): ArgCheck {
  if (body !== undefined && body !== null && (typeof body !== "object" || Array.isArray(body))) {
    return { error: { code: "INVALID_ARG", error: "The request body must be a JSON object of arguments. Nothing was sent to the phone." } };
  }
  const args: Record<string, unknown> = {};
  for (const [key, value] of Object.entries((body ?? {}) as Record<string, unknown>)) if (value !== null) args[key] = value;

  const schema = SCHEMAS.get(name) ?? {};
  const missing = (schema.required ?? []).filter((key) => args[key] === undefined);
  if (missing.length) {
    return { error: { code: "MISSING_ARG", missing, error: `${name} needs ${missing.join(", ")}. Nothing was sent to the phone.` } };
  }
  for (const [key, prop] of Object.entries(schema.properties ?? {})) {
    if ((prop?.type !== "number" && prop?.type !== "integer") || args[key] === undefined) continue;
    const raw = args[key];
    const value = typeof raw === "string" && raw.trim() !== "" ? Number(raw) : raw;
    if (typeof value !== "number" || !Number.isFinite(value)) {
      return { error: { code: "INVALID_ARG", field: key, expected: "number", error: `${name}: ${key} must be a finite number. Nothing was sent to the phone.` } };
    }
    args[key] = value;
  }
  return { args };
}

/** The JSON this route answers with, built from the handler's ControlResult in the route's historical shapes. */
export function controlHttpBody(name: string, result: ControlResult): Record<string, unknown> {
  if (name === "control_status") return { success: true, device: result.data };
  const { data } = result;
  const body: Record<string, unknown> =
    data !== null && typeof data === "object" && !Array.isArray(data) ? { ...(data as Record<string, unknown>) } : { success: !result.isError };
  const image = result.images?.[0];
  if (image) body.imageDataUrl = `data:${image.mimeType};base64,${image.data}`;
  return body;
}

/** 200, or for a typed refusal 400 (fix the input) or 503 (retryable: the phone was busy, call again). */
function statusOf(result: ControlResult): number {
  if (!result.isError) return 200;
  return (result.data as { retryable?: unknown } | undefined)?.retryable === true ? 503 : 400;
}

export function mountControlRoutes(app: Express): void {
  app.post("/api/control/:action", async (req, res) => {
    if (!isAuthorized(req.header("authorization"))) {
      res.status(401).json({ success: false, error: "Invalid ScreenSync pairing token." });
      return;
    }
    const { action } = req.params;
    const name = resolveControlAction(action);
    if (!name) {
      res.status(404).json({ success: false, code: "UNKNOWN_ACTION", error: `Unknown control action: ${action}`, actions: controlRouteActions() });
      return;
    }
    const checked = checkControlArgs(name, req.body);
    if ("error" in checked) {
      res.status(400).json({ success: false, ...checked.error });
      return;
    }
    // B3: control actions also show on the phone's AI activity timeline, under the tool's own name.
    emitHubEvent("tool", name, true);
    try {
      const result = await runControlAction(name, checked.args);
      res.status(statusOf(result)).json(controlHttpBody(name, result));
    } catch (error) {
      // An untyped failure (adb missing, an unsupported key, ...): the route's reply for it since before the split.
      res.status(400).json({ success: false, error: String(error) });
    }
  });
}
