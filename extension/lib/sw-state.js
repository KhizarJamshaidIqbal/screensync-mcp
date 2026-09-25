// Service-worker state registry. ZERO imports on purpose: background.js registers
// getters here and leaf modules (web-diag, diagnostics) read them without importing
// background.js (which would create an import cycle through web-bridge/web-tools).
// Known keys: 'sse' -> SSE client snapshot, 'health' -> { ok, latencyMs, checkedAt }.

export const SW_STARTED_AT = Date.now();

const providers = new Map();

// Register (or replace) the getter that supplies the current value for `key`.
export function provideSwState(key, getter) {
  if (typeof getter === 'function') providers.set(key, getter);
  else providers.delete(key);
}

// Current value for `key`, or null when no provider is registered or it throws.
export function readSwState(key) {
  const getter = providers.get(key);
  if (!getter) return null;
  try {
    const value = getter();
    return value === undefined ? null : value;
  } catch {
    return null;
  }
}

// Whole seconds since this service-worker instance loaded (never negative).
export function swUptimeSeconds(now = Date.now()) {
  return Math.max(0, Math.floor((now - SW_STARTED_AT) / 1000));
}
