// ScreenSync CDP network executors — mocks, routes, dialog rules, network
// idle waits, websocket traffic, response/request waits, network auth.
import { rawAttach, rawDetach, attachCdp, detachCdp, activeMocks, activeRoutes, activeDialogRules, activeWsBuffers, activeAuths } from './web-adv-core.js';

// ── web_network_auth: Playwright page.authenticate parity — supply credentials
// for HTTP basic/proxy auth challenges via CDP Fetch.authRequired handling ──
export async function cdpNetworkAuth(tab, args = {}) {
  const action = String(args.action || 'set').toLowerCase();
  if (action === 'set') {
    const username = String(args.username ?? '');
    const password = String(args.password ?? '');
    if (!username && !password) return { ok: false, error: 'web_network_auth requires username/password (or action:"clear").' };
    const attached = await attachCdp(tab);
    if (!attached.ok) return attached;
    const had = activeAuths.has(tab.id);
    try {
      // Re-enable Fetch with auth handling; patterns default to all URLs.
      await chrome.debugger.sendCommand({ tabId: tab.id }, 'Fetch.enable', {
        handleAuthRequests: true,
        patterns: [{ urlPattern: args.urlPattern || '*' }],
      });
      activeAuths.set(tab.id, { username, password });
      return {
        ok: true,
        data: {
          authHandling: true,
          username,
          urlPattern: args.urlPattern || '*',
          persisted: had,
          note: 'Auth challenges on this tab are answered automatically. Clear with action:"clear".',
        },
      };
    } catch (e) {
      return { ok: false, error: `Fetch.enable(handleAuthRequests) failed: ${String((e && e.message) || e)}` };
    }
  }
  if (action === 'clear') {
    const had = activeAuths.has(tab.id);
    try { await chrome.debugger.sendCommand({ tabId: tab.id }, 'Fetch.disable'); } catch {}
    activeAuths.delete(tab.id);
    if (had) await detachCdp(tab);
    return { ok: true, data: { cleared: true } };
  }
  return { ok: false, error: 'Unknown web_network_auth action: ' + action + '. Supported: set, clear.' };
}

export async function cdpNetworkMock(tab, args = {}) {
  const target = { tabId: tab.id };
  let attached = false;
  try {
    await rawAttach(target);
    attached = true;
  } catch (e) {
    if (String((e && e.message) || e).includes('Already attached')) attached = true;
    else return { ok: false, error: `CDP attach failed: ${String((e && e.message) || e)}` };
  }
  try {
    const action = String(args.action || 'mock_response');
    if (action === 'disable') {
      activeMocks.delete(tab.id);
      await chrome.debugger.sendCommand(target, 'Fetch.disable', {}).catch(() => {});
      return { ok: true, data: { networkMockDisabled: true } };
    }

    const patterns = Array.isArray(args.patterns) ? args.patterns : [{ urlPattern: args.urlPattern || '*' }];
    await chrome.debugger.sendCommand(target, 'Fetch.enable', { patterns });

    const mockStatus = Number(args.status) || 200;
    const mockHeaders = Array.isArray(args.headers) ? args.headers : [{ name: 'Content-Type', value: 'application/json' }];
    const mockBody = typeof args.body === 'object' ? JSON.stringify(args.body) : String(args.body || '{"mocked": true}');

    activeMocks.set(tab.id, {
      action,
      status: mockStatus,
      headers: mockHeaders,
      body: mockBody,
      errorReason: args.errorReason || 'Failed',
    });

    return {
      ok: true,
      data: {
        action,
        fetchInterceptionEnabled: true,
        patterns,
        mockResponseConfig: action === 'fail_request' ? undefined : {
          responseCode: mockStatus,
          responseHeaders: mockHeaders,
          bodyLength: mockBody.length,
        },
        faultInjectionConfig: action === 'fail_request' ? {
          errorReason: args.errorReason || 'Failed',
        } : undefined,
      },
    };
  } catch (err) {
    if (attached) {
      await rawDetach(target);
    }
    return { ok: false, error: `CDP network mock error: ${String((err && err.message) || err)}` };
  } finally {
    if (args.action === 'disable' && attached) {
      await rawDetach(target);
    }
  }
}


export async function cdpWaitNetworkIdle(tab, timeoutMs = 15000, idleMs = 500) {
  const target = { tabId: tab.id };
  let attached = false;
  try {
    await rawAttach(target);
    attached = true;
  } catch (e) {
    if (String((e && e.message) || e).includes('Already attached')) attached = true;
    else return { ok: false, error: `CDP attach failed: ${String((e && e.message) || e)}` };
  }

  return new Promise((resolve) => {
    let inflight = 0;
    let timer = null;
    const t0 = Date.now();

    const cleanup = async () => {
      clearTimeout(maxTimer);
      if (timer) clearTimeout(timer);
      chrome.debugger.onEvent.removeListener(onEvent);
      try { await chrome.debugger.sendCommand(target, 'Network.disable', {}); } catch {}
      if (attached) {
        await rawDetach(target);
      }
    };

    const done = async (ok, err) => {
      await cleanup();
      resolve(ok ? { ok: true, data: { state: 'networkidle', elapsedMs: Date.now() - t0 } } : { ok: false, error: err });
    };

    const checkIdle = () => {
      if (inflight <= 0) {
        inflight = 0;
        if (!timer) {
          timer = setTimeout(() => done(true), idleMs);
        }
      } else if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    };

    const onEvent = (source, method) => {
      if (source.tabId !== tab.id) return;
      if (method === 'Network.requestWillBeSent') {
        inflight++;
        checkIdle();
      } else if (method === 'Network.loadingFinished' || method === 'Network.loadingFailed') {
        inflight = Math.max(0, inflight - 1);
        checkIdle();
      }
    };

    const maxTimer = setTimeout(() => done(false, `Timeout of ${timeoutMs}ms exceeded waiting for networkidle`), timeoutMs);

    chrome.debugger.onEvent.addListener(onEvent);
    chrome.debugger.sendCommand(target, 'Network.enable', {}).then(() => {
      checkIdle();
    }).catch((e) => {
      done(false, String(e));
    });
  });
}


export async function cdpRoute(tab, args = {}) {
  const target = { tabId: tab.id };
  const action = String(args.action || 'route').toLowerCase();

  if (action === 'clear' || action === 'unroute') {
    activeRoutes.delete(tab.id);
    try { await chrome.debugger.sendCommand(target, 'Fetch.disable'); } catch {}
    await detachCdp(tab);
    return { ok: true, data: { cleared: true, tabId: tab.id } };
  }

  if (action === 'list') {
    return { ok: true, data: { routes: activeRoutes.get(tab.id) || [] } };
  }

  const pattern = String(args.urlPattern || args.pattern || '*');
  const mode = String(args.mode || 'fulfill').toLowerCase();

  const attachRes = await attachCdp(tab);
  if (!attachRes.ok) return attachRes;

  try {
    await chrome.debugger.sendCommand(target, 'Fetch.enable', {
      patterns: [{ urlPattern: pattern, requestStage: 'Request' }],
    });

    const routeConfig = {
      pattern,
      mode,
      headers: args.headers || null,
      postData: args.postData || null,
      response: args.response || null,
      errorReason: args.errorReason || 'Failed',
    };

    let routes = activeRoutes.get(tab.id);
    if (!routes) {
      routes = [];
      activeRoutes.set(tab.id, routes);
    }
    routes.push(routeConfig);

    return { ok: true, data: { routed: pattern, mode, totalActiveRoutes: routes.length } };
  } catch (err) {
    await detachCdp(tab);
    return { ok: false, error: `CDP route error: ${String((err && err.message) || err)}` };
  }
}


export async function cdpDialogRule(tab, args = {}) {
  const target = { tabId: tab.id };
  const action = String(args.action || args.rule || 'accept').toLowerCase();
  if (action === 'clear') {
    activeDialogRules.delete(tab.id);
    await detachCdp(tab);
    return { ok: true, data: { dialogRule: 'cleared', tabId: tab.id } };
  }
  const attachRes = await attachCdp(tab);
  if (!attachRes.ok) return attachRes;
  try {
    await chrome.debugger.sendCommand(target, 'Page.enable');
    activeDialogRules.set(tab.id, {
      rule: action,
      promptText: args.promptText || '',
    });
    return { ok: true, data: { dialogRule: action, promptText: args.promptText || null } };
  } catch (err) {
    await detachCdp(tab);
    return { ok: false, error: `CDP dialog rule error: ${String((err && err.message) || err)}` };
  }
}


export async function cdpWaitForResponse(tab, args = {}) {
  const target = { tabId: tab.id };
  const pattern = String(args.urlPattern || args.url || '*');
  const expectedStatus = args.status !== undefined ? Number(args.status) : null;
  const expectedMethod = args.method ? String(args.method).toUpperCase() : null;
  const timeoutMs = Math.min(Number(args.timeoutMs) || 15000, 60000);

  const attached = await attachCdp(tab);
  if (!attached.ok) return attached;

  return new Promise((resolve) => {
    let timer = null;
    let resolved = false;

    const cleanup = async () => {
      if (timer) clearTimeout(timer);
      chrome.debugger.onEvent.removeListener(onEvent);
      await detachCdp(tab);
    };

    const isMatch = (url, method, status) => {
      if (expectedMethod && method && method.toUpperCase() !== expectedMethod) return false;
      if (expectedStatus !== null && status !== expectedStatus) return false;
      if (pattern === '*' || !pattern) return true;
      if (pattern.startsWith('/') && pattern.endsWith('/')) {
        try { return new RegExp(pattern.slice(1, -1)).test(url); } catch {}
      }
      return url.includes(pattern);
    };

    const onEvent = async (source, method, params) => {
      if (source.tabId !== tab.id) return;
      if (method === 'Network.responseReceived') {
        const resp = params.response;
        if (resp && isMatch(resp.url, resp.requestHeaders?.[':method'] || 'GET', resp.status)) {
          resolved = true;
          let body = null;
          let base64Encoded = false;
          try {
            const bodyRes = await chrome.debugger.sendCommand(target, 'Network.getResponseBody', { requestId: params.requestId });
            body = bodyRes.body;
            base64Encoded = !!bodyRes.base64Encoded;
          } catch (e) {
            body = `[Response body unavailable: ${e.message}]`;
          }

          let parsedJson = null;
          if (!base64Encoded && typeof body === 'string' && (resp.mimeType?.includes('json') || body.trim().startsWith('{') || body.trim().startsWith('['))) {
            try { parsedJson = JSON.parse(body); } catch {}
          }

          await cleanup();
          resolve({
            ok: true,
            data: {
              url: resp.url,
              status: resp.status,
              statusText: resp.statusText,
              headers: resp.headers,
              mimeType: resp.mimeType,
              body: parsedJson !== null ? parsedJson : body,
              base64Encoded,
            },
          });
        }
      }
    };

    timer = setTimeout(async () => {
      if (!resolved) {
        await cleanup();
        resolve({ ok: false, error: `Timeout of ${timeoutMs}ms waiting for network response matching "${pattern}"` });
      }
    }, timeoutMs);

    chrome.debugger.onEvent.addListener(onEvent);
    chrome.debugger.sendCommand(target, 'Network.enable', {}).catch(async (err) => {
      await cleanup();
      resolve({ ok: false, error: `Failed to enable CDP Network: ${err.message}` });
    });
  });
}


export async function cdpWaitForRequest(tab, args = {}) {
  const target = { tabId: tab.id };
  const pattern = String(args.urlPattern || args.url || '*');
  const expectedMethod = args.method ? String(args.method).toUpperCase() : null;
  const timeoutMs = Math.min(Number(args.timeoutMs) || 15000, 60000);

  const attached = await attachCdp(tab);
  if (!attached.ok) return attached;

  return new Promise((resolve) => {
    let timer = null;
    let resolved = false;

    const cleanup = async () => {
      if (timer) clearTimeout(timer);
      chrome.debugger.onEvent.removeListener(onEvent);
      await detachCdp(tab);
    };

    const isMatch = (url, method) => {
      if (expectedMethod && method && method.toUpperCase() !== expectedMethod) return false;
      if (pattern === '*' || !pattern) return true;
      return url.includes(pattern);
    };

    const onEvent = async (source, method, params) => {
      if (source.tabId !== tab.id) return;
      if (method === 'Network.requestWillBeSent') {
        const req = params.request;
        if (req && isMatch(req.url, req.method)) {
          resolved = true;
          await cleanup();
          resolve({
            ok: true,
            data: {
              url: req.url,
              method: req.method,
              headers: req.headers,
              postData: req.postData || null,
              hasPostData: req.hasPostData || false,
            },
          });
        }
      }
    };

    timer = setTimeout(async () => {
      if (!resolved) {
        await cleanup();
        resolve({ ok: false, error: `Timeout of ${timeoutMs}ms waiting for request matching "${pattern}"` });
      }
    }, timeoutMs);

    chrome.debugger.onEvent.addListener(onEvent);
    chrome.debugger.sendCommand(target, 'Network.enable', {}).catch(async (err) => {
      await cleanup();
      resolve({ ok: false, error: `Failed to enable CDP Network: ${err.message}` });
    });
  });
}


export async function cdpWebSocketTraffic(tab, args = {}) {
  const target = { tabId: tab.id };
  const action = String(args.action || 'get').toLowerCase();

  if (action === 'start') {
    const attached = await attachCdp(tab);
    if (!attached.ok) return attached;
    try {
      await chrome.debugger.sendCommand(target, 'Network.enable', {});
      activeWsBuffers.set(tab.id, []);
      return { ok: true, data: { action: 'start', tracking: true, tabId: tab.id } };
    } catch (err) {
      await detachCdp(tab);
      return { ok: false, error: `Failed to start WebSocket tracking: ${err.message}` };
    }
  }

  if (action === 'get' || action === 'stop') {
    const frames = activeWsBuffers.get(tab.id) || [];
    if (action === 'stop') {
      activeWsBuffers.delete(tab.id);
      await detachCdp(tab);
    }
    return { ok: true, data: { tabId: tab.id, frameCount: frames.length, frames: frames.slice(-50) } };
  }

  return { ok: false, error: `Unknown web_websocket_traffic action: ${action}. Supported: start, get, stop.` };
}

