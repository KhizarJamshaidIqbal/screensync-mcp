// THIS browser's entry in the hub's /api/web/status payload. The payload's top-level `online`/`sseConnected`
// describe the browser an untargeted call is routed to (the selected profile, else the focused window, else the
// latest heartbeat: profile-registry.ts statusPayload), which with two profiles connected is often ANOTHER
// browser. Onboarding and the Web Access tab ask "can agents reach me?", so they read this instead.

/**
 * @param {object|null|undefined} status the hub's web status payload
 * @param {string|null|undefined} instanceId this browser's instanceId (profile-identity.js getInstanceId)
 * @returns {{ known: boolean, registered: boolean, online: boolean, sseConnected: boolean|null, activeTab: object|null }}
 *   known: false when the hub lists no browsers (an older hub): the top-level values are the best there is.
 */
export function selfBridgeStatus(status, instanceId) {
  const s = status && typeof status === 'object' ? status : {};
  const id = typeof instanceId === 'string' ? instanceId.trim().toLowerCase() : '';
  if (!Array.isArray(s.browsers) || !id) {
    return { known: false, registered: false, online: s.online === true, sseConnected: typeof s.sseConnected === 'boolean' ? s.sseConnected : null, activeTab: s.activeTab || null };
  }
  const me = s.browsers.find((b) => b && typeof b.instanceId === 'string' && b.instanceId.trim().toLowerCase() === id);
  if (!me) return { known: true, registered: false, online: false, sseConnected: false, activeTab: null };
  // A hub that does not report per-browser streams (sseConnected absent) is judged by the heartbeat alone.
  const sseConnected = typeof me.sseConnected === 'boolean' ? me.sseConnected : null;
  return { known: true, registered: true, online: me.online === true && sseConnected !== false, sseConnected, activeTab: me.activeTab || null };
}
