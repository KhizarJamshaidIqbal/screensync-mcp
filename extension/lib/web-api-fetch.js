// ScreenSync API Fetch — authenticated HTTP requests using the browser's REAL
// session (Playwright request-context parity). The background service worker's
// fetch automatically attaches the profile's cookies for any host the
// extension has host permissions for — so an agent can call the same JSON
// APIs the logged-in site uses, without ever touching credentials.

export async function apiFetch(args = {}) {
  const url = String(args.url || '');
  if (!/^https?:\/\//i.test(url)) return { ok: false, error: 'web_api_fetch requires an http(s) url.' };
  const method = String(args.method || 'GET').toUpperCase();
  if (!/^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)$/.test(method)) return { ok: false, error: 'Invalid method: ' + method };

  const headers = {};
  if (args.headers && typeof args.headers === 'object') {
    for (const [k, v] of Object.entries(args.headers)) headers[String(k)] = String(v);
  }
  if (args.body !== undefined && !Object.keys(headers).some((h) => h.toLowerCase() === 'content-type') && method !== 'GET' && method !== 'HEAD') {
    headers['Content-Type'] = 'application/json';
  }

  const timeoutMs = Math.min(Number(args.timeoutMs) || 20000, 60000);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method,
      headers,
      body: method === 'GET' || method === 'HEAD' ? undefined : (typeof args.body === 'string' ? args.body : JSON.stringify(args.body ?? {})),
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
