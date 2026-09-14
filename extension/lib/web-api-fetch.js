// ScreenSync API Fetch — authenticated HTTP requests using the browser's REAL
// session (Playwright request-context parity). The background service worker's
// fetch automatically attaches the profile's cookies for any host the
// extension has host permissions for — so an agent can call the same JSON
// APIs the logged-in site uses, without ever touching credentials.

import { isLoopbackOrTestOrigin, getOriginGrant } from './consent.js';

export async function apiFetch(args = {}) {
  const url = String(args.url || '');
  if (!/^https?:\/\//i.test(url)) return { ok: false, error: 'web_api_fetch requires an http(s) url.' };
  const method = String(args.method || 'GET').toUpperCase();
  if (!/^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)$/.test(method)) return { ok: false, error: 'Invalid method: ' + method };

  if (method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS') {
    const origin = new URL(url).origin;
    if (!isLoopbackOrTestOrigin(origin) && !args.confirmed && !args.force) {
      const grant = await getOriginGrant(origin);
      if (!grant.act) {
        return { ok: false, code: 'USER_CONFIRMATION_REQUIRED', risk: 'destructive', error: `Authenticated ${method} request to ${origin} requires user confirmation or act grant.` };
      }
    }
  }

  const headers = {};
  if (args.headers && typeof args.headers === 'object') {
    for (const [k, v] of Object.entries(args.headers)) headers[String(k)] = String(v);
  }
  // Multipart/form-data parity: fields are strings or file objects
  // {filename, base64, contentType} — real FormData so the browser sets the
  // boundary automatically (posting images/files to APIs with the session).
  let bodyOut2;
  if (args.formData && typeof args.formData === 'object') {
    const fd = new FormData();
    for (const [field, spec] of Object.entries(args.formData)) {
      if (spec && typeof spec === 'object' && spec.base64) {
        const bytes = Uint8Array.from(atob(String(spec.base64)), (c) => c.charCodeAt(0));
        fd.append(field, new Blob([bytes], { type: spec.contentType || 'application/octet-stream' }), spec.filename || 'file');
      } else {
        fd.append(field, typeof spec === 'object' ? JSON.stringify(spec) : String(spec));
      }
    }
    bodyOut2 = fd;
  }
  if (args.body !== undefined && !bodyOut2 && !Object.keys(headers).some((h) => h.toLowerCase() === 'content-type') && method !== 'GET' && method !== 'HEAD') {
    headers['Content-Type'] = 'application/json';
  }

  const timeoutMs = Math.min(Number(args.timeoutMs) || 20000, 60000);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method,
      headers,
      body: method === 'GET' || method === 'HEAD' ? undefined : (bodyOut2 !== undefined ? bodyOut2 : (typeof args.body === 'string' ? args.body : JSON.stringify(args.body ?? {}))),
      // Session cookies attach automatically (host permissions cover http(s)).
      credentials: args.noCookies === true ? 'omit' : 'include',
      signal: controller.signal,
    });
    const rawBody = await res.text();
    const MAX = Math.min(Number(args.maxBodyChars) || 200000, 1000000);
    const bodyOut = rawBody.length > MAX ? rawBody.slice(0, MAX) + `…[truncated ${rawBody.length - MAX} chars]` : rawBody;
    let json = null;
    const ct = res.headers.get('content-type') || '';
    if (ct.includes('json') || /^[\s]*[[{]/.test(rawBody)) {
      try { json = JSON.parse(rawBody); } catch { /* keep null */ }
    }
    const resHeaders = {};
    res.headers.forEach((v, k) => { resHeaders[k] = v; });
    return {
      ok: res.ok,
      data: {
        status: res.status,
        statusText: res.statusText,
        headers: resHeaders,
        contentType: ct,
        json,
        body: bodyOut,
        bytes: rawBody.length,
        cookiesAttached: args.noCookies !== true,
        url: res.url || url,
      },
      error: res.ok ? undefined : `HTTP ${res.status} ${res.statusText}`,
    };
  } catch (e) {
    const msg = String((e && e.message) || e);
    return { ok: false, error: `web_api_fetch failed: ${msg.includes('abort') ? 'timed out after ' + timeoutMs + 'ms' : msg}` };
  } finally {
    clearTimeout(timer);
  }
}
