import { DEFAULT_TOKEN } from './constants.js';

// Mirrors the app's PairingService.parse(): accepts the custom scheme,
// a JSON blob, or a plain http(s) URL with an optional #token fragment.
export function parsePairing(input) {
  const raw = (input || '').trim();
  if (!raw) return null;

  if (raw.startsWith('screensync://pair')) {
    try {
      const u = new URL(raw);
      const url = u.searchParams.get('url');
      if (!url) return null;
      return { url: url.replace(/\/$/, ''), token: u.searchParams.get('token') || DEFAULT_TOKEN };
    } catch {
      return null;
    }
  }

  if (raw.startsWith('{')) {
    try {
      const j = JSON.parse(raw);
      if (typeof j.url === 'string' && j.url) {
        return { url: j.url.replace(/\/$/, ''), token: j.token || DEFAULT_TOKEN };
      }
    } catch {
      return null;
    }
    return null;
  }

  if (/^https?:\/\//i.test(raw)) {
    try {
      const u = new URL(raw);
      const token = u.hash ? decodeURIComponent(u.hash.slice(1)) : DEFAULT_TOKEN;
      u.hash = '';
      return { url: u.toString().replace(/\/$/, ''), token };
    } catch {
      return null;
    }
  }

  return null;
}
