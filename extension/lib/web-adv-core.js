// ScreenSync CDP Core — shared debugger lifecycle, registries, event router.
// Everything long-lived (mocks, routes, dialogs, ws buffers, screencasts, HAR,
// traces, video, clocks, emulation) registers here so rawDetach/cdpBusy can
// never drop the debugger out from under a live session.
const cdpRefCounts = new Map(); // tabId -> refcount of live CDP debug sessions
async function runScript(tab, func, args, world) {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id }, func, args: [args], ...(world ? { world } : {}),
    });
    return (results && results[0] && results[0].result) || { ok: false, error: 'Injection returned no result.' };
  } catch (e) {
    return { ok: false, error: `Cannot access that page: ${String((e && e.message) || e)}` };
  }
}


export const main = (tab, func, args) => runScript(tab, func, args, 'MAIN');

export const isolated = (tab, func, args) => runScript(tab, func, args, null);


export async function attachCdp(tab) {
  const target = { tabId: tab.id };
  const cur = cdpRefCounts.get(tab.id) || 0;
  cdpRefCounts.set(tab.id, cur + 1);
  if (cur > 0) return { ok: true, target };
  try {
    await rawAttach(target);
    return { ok: true, target };
  } catch (e) {
    const msg = String((e && e.message) || e);
    if (/already attached/i.test(msg)) {
      return { ok: true, target };
    }
    cdpRefCounts.set(tab.id, 0);
    return { ok: false, error: `CDP attach failed: ${msg}` };
  }
}


export async function detachCdp(tab) {
  const target = { tabId: tab.id };
  const cur = cdpRefCounts.get(tab.id) || 0;
  const next = Math.max(0, cur - 1);
  cdpRefCounts.set(tab.id, next);
  // Only physically detach when NO long-lived session (mocks, routes, dialogs,
  // websocket buffers, screencasts, coverage, HAR, trace, video, emulation) still
  // needs the debugger on this tab — otherwise a one-off CDP call kills it.
  if (next === 0 && !cdpBusy(target.tabId)) {
    await rawDetach(target);
  }
}

// Raw per-call attach/detach used by one-off CDP executors. rawAttach tolerates
// an existing session; rawDetach refuses to drop the debugger while a
// long-lived session (emulation, mocks, HAR, screencast, …) is active on the tab.

export async function rawAttach(target) {
  try {
    await chrome.debugger.attach(target, '1.3');
  } catch (e) {
    if (!/already attached/i.test(String((e && e.message) || e))) throw e;
  }
}


function cdpBusy(tabId) {
  const busy = (m) => m && m.has(tabId);
  return Boolean(busy(activeMocks) || busy(activeRoutes) || busy(activeDialogRules)
    || busy(activeWsBuffers) || busy(activeScreencasts) || busy(activeCoverage)
    || busy(activeHars) || busy(activeTraces) || busy(activeVideoRecs) || busy(activeEmulations)
    || busy(activeAuths));
}


export async function rawDetach(target) {
  if (cdpBusy(target.tabId)) return;
  try { await chrome.debugger.detach(target); } catch {}
}


if (chrome.tabs && chrome.tabs.onRemoved) {
  chrome.tabs.onRemoved.addListener((tabId) => {
    cdpRefCounts.delete(tabId);
  });
}


export const activeMocks = new Map();

export const activeRoutes = new Map(); // tabId -> Array<{ pattern, mode, response, headers, postData, errorReason }>

export const activeDialogRules = new Map(); // tabId -> { rule, promptText }

export const activeWsBuffers = new Map(); // tabId -> Array<{ direction, opcode, payload, ts }>

export const activeScreencasts = new Map(); // tabId -> Array<{ data, metadata, ts }>

export const activeHars = new Map(); // tabId -> { startedAt, pending: Map, entries: [], maxEntries, filter, bodies, bodyBytes }

export const activeTraces = new Map(); // tabId -> { startedAt, chunks: [], eventCount, complete, maxEvents }

export const activeVideoRecs = new Map(); // tabId -> { startedAt, fps, frameCount }

export const activeClocks = new Map(); // tabId -> { scriptId, offsetMs }

export const activeEmulations = new Map(); // tabId -> true while device/UA emulation is live
export const activeAuths = new Map(); // tabId -> { username, password } while network auth handling is live
export const activeCoverage = new Map(); // tabId -> JS/CSS coverage session (cdpBusy guard + capture module)


if (chrome.debugger && chrome.debugger.onEvent) {
  chrome.debugger.onEvent.addListener(async (source, method, params) => {
    if (method === 'Page.javascriptDialogOpening' && source && source.tabId) {
      const rule = activeDialogRules.get(source.tabId);
      if (rule) {
        try {
          await chrome.debugger.sendCommand(source, 'Page.handleJavaScriptDialog', {
            accept: rule.rule !== 'dismiss',
            promptText: rule.promptText || undefined,
          });
        } catch {}
      }
    }

    if ((method === 'Network.webSocketFrameReceived' || method === 'Network.webSocketFrameSent') && source && source.tabId) {
      const buf = activeWsBuffers.get(source.tabId);
      if (buf) {
        buf.push({
          direction: method.includes('Received') ? 'in' : 'out',
          opcode: params.response ? params.response.opcode : undefined,
          payload: params.response ? params.response.payloadData : undefined,
          ts: Date.now(),
        });
        if (buf.length > 200) buf.shift();
      }
    }

    if (method === 'Page.screencastFrame' && source && source.tabId) {
      const screencast = activeScreencasts.get(source.tabId);
      if (screencast) {
        screencast.push({
          data: params.data,
          metadata: params.metadata,
          ts: Date.now(),
        });
        if (screencast.length > 300) screencast.shift();
      }
      const videoRec = activeVideoRecs.get(source.tabId);
      if (videoRec) {
        videoRec.frameCount++;
        try {
          chrome.runtime.sendMessage({
            type: 'video-feed',
            data: params.data,
            width: params.metadata ? params.metadata.offsetWidth : undefined,
            height: params.metadata ? params.metadata.offsetHeight : undefined,
          }).catch(() => {});
        } catch {}
      }
      // ALWAYS ack — Chrome pauses the screencast stream until every frame is
      // acked, even when the only consumer is the video recorder.
      try {
        await chrome.debugger.sendCommand(source, 'Page.screencastFrameAck', { sessionId: params.sessionId });
      } catch {}
    }

    // ── Real CDP HAR capture: Network domain events → HAR 1.2 entries ──
    const harRec = source && source.tabId ? activeHars.get(source.tabId) : null;
    if (harRec) {
      if (method === 'Network.requestWillBeSent' && params.request) {
        const url = params.request.url || '';
        if ((!harRec.filter || url.includes(harRec.filter)) && harRec.entries.length + harRec.pending.size < harRec.maxEntries) {
          let query = [];
          try { query = [...new URL(url).searchParams].map(([name, value]) => ({ name, value })); } catch {}
          harRec.pending.set(params.requestId, {
            startedDateTime: new Date().toISOString(),
            startedMs: Date.now(),
            request: {
              method: params.request.method || 'GET',
              url,
              httpVersion: 'HTTP/1.1',
              headers: Object.entries(params.request.headers || {}).map(([name, value]) => ({ name, value: String(value) })),
              queryString: query,
              cookies: [],
              headersSize: -1,
              bodySize: params.request.postData ? String(params.request.postData).length : 0,
            },
            response: null,
            remoteIp: null,
            resourceType: params.type || undefined,
          });
        }
      } else if (method === 'Network.responseReceived' && params.response) {
        const entry = harRec.pending.get(params.requestId);
        if (entry) {
          entry.respondedMs = Date.now();
          entry.remoteIp = params.response.remoteIPAddress || null;
          entry.response = {
            status: params.response.status || 0,
            statusText: params.response.statusText || '',
            httpVersion: params.response.protocol || 'HTTP/1.1',
            headers: Object.entries(params.response.headers || {}).map(([name, value]) => ({ name, value: String(value) })),
            cookies: [],
            content: { size: params.response.encodedDataLength || 0, mimeType: params.response.mimeType || '', compression: 0 },
            redirectURL: params.response.location || '',
            headersSize: -1,
            bodySize: -1,
          };
        }
      } else if (method === 'Network.loadingFinished' || method === 'Network.loadingFailed') {
        const entry = harRec.pending.get(params.requestId);
        if (entry) {
          harRec.pending.delete(params.requestId);
          const now = Date.now();
          const wait = entry.respondedMs ? entry.respondedMs - entry.startedMs : now - entry.startedMs;
          const receive = method === 'Network.loadingFinished' ? Math.max(0, now - (entry.respondedMs || entry.startedMs)) : 0;
          if (!entry.response) {
            entry.response = {
              status: 0,
              statusText: params.errorText || (method === 'Network.loadingFailed' ? 'failed' : 'no response'),
              httpVersion: 'HTTP/1.1',
              headers: [], cookies: [],
              content: { size: 0, mimeType: '', compression: 0 },
              redirectURL: '', headersSize: -1, bodySize: -1,
            };
          } else if (method === 'Network.loadingFinished' && params.encodedDataLength != null) {
            entry.response.content.size = params.encodedDataLength;
          }
          // bodies:true — pull small response bodies into the HAR content block.
          if (harRec.bodies && method === 'Network.loadingFinished' && entry.response.status >= 200
            && entry.response.status < 300 && harRec.bodyBytes < 4194304
            && entry.response.content.size > 0 && entry.response.content.size <= 262144) {
            chrome.debugger.sendCommand(source, 'Network.getResponseBody', { requestId: params.requestId })
              .then((bodyRes) => {
                if (bodyRes && bodyRes.body) {
                  harRec.bodyBytes += entry.response.content.size;
                  entry.response.content.text = bodyRes.body;
                  entry.response.content.encoding = bodyRes.base64Encoded ? 'base64' : 'text';
                }
              })
              .catch((err) => {
                if (!harRec.bodyErrors) harRec.bodyErrors = [];
                if (harRec.bodyErrors.length < 3) harRec.bodyErrors.push(String((err && err.message) || err).slice(0, 120));
              });
          }
          harRec.entries.push({
            startedDateTime: entry.startedDateTime,
            time: now - entry.startedMs,
            request: entry.request,
            response: entry.response,
            cache: {},
            timings: { blocked: -1, dns: -1, connect: -1, ssl: -1, send: 0, wait, receive },
            _resourceType: entry.resourceType,
            _serverIPAddress: entry.remoteIp,
          });
        }
      }
    }

    // ── CDP Tracing collector: Tracing domain events → Chrome trace JSON ──
    const traceRec = source && source.tabId ? activeTraces.get(source.tabId) : null;
    if (traceRec) {
      if (method === 'Tracing.dataCollected' && Array.isArray(params.value)) {
        for (const ev of params.value) {
          if (traceRec.eventCount >= traceRec.maxEvents) break;
          traceRec.chunks.push(ev);
          traceRec.eventCount++;
        }
      } else if (method === 'Tracing.tracingComplete') {
        traceRec.complete = true;
      }
    }

    // ── Network auth: answer Fetch.authRequired with stored credentials ──
    if (method === 'Fetch.authRequired' && source && source.tabId) {
      const auth = activeAuths.get(source.tabId);
      if (auth) {
        try {
          await chrome.debugger.sendCommand(source, 'Fetch.continueWithAuth', {
            requestId: params.requestId,
            authChallengeResponse: {
              response: auth.username ? 'ProvideCredentials' : 'CancelAuth',
              username: auth.username || undefined,
              password: auth.password || undefined,
            },
          });
        } catch {}
      } else {
        try {
          await chrome.debugger.sendCommand(source, 'Fetch.continueWithAuth', {
            requestId: params.requestId,
            authChallengeResponse: { response: 'Default' },
          });
        } catch {}
      }
    }

    if (method === 'Fetch.requestPaused' && source && source.tabId) {
      const routes = activeRoutes.get(source.tabId);
      if (routes && routes.length > 0) {
        const reqUrl = params.request ? params.request.url : '';
        const matched = routes.find((r) => {
          if (r.pattern === '*' || !r.pattern) return true;
          return reqUrl.includes(r.pattern);
        });
        if (matched) {
          if (matched.mode === 'abort') {
            try {
              await chrome.debugger.sendCommand(source, 'Fetch.failRequest', {
                requestId: params.requestId,
                errorReason: matched.errorReason || 'Failed',
              });
            } catch {}
            return;
          }
          if (matched.mode === 'fulfill') {
            try {
              const bodyStr = typeof matched.response?.body === 'string'
                ? matched.response.body
                : JSON.stringify(matched.response?.body || { mocked: true });
              const bodyBase64 = btoa(unescape(encodeURIComponent(bodyStr)));
              await chrome.debugger.sendCommand(source, 'Fetch.fulfillRequest', {
                requestId: params.requestId,
                responseCode: matched.response?.status || 200,
                responseHeaders: matched.response?.headers || [{ name: 'Content-Type', value: 'application/json' }],
                body: bodyBase64,
              });
            } catch {}
            return;
          }
          if (matched.mode === 'continue') {
            try {
              const continueParams = { requestId: params.requestId };
              if (matched.headers) continueParams.headers = matched.headers;
              if (matched.postData) continueParams.postData = btoa(unescape(encodeURIComponent(matched.postData)));
              await chrome.debugger.sendCommand(source, 'Fetch.continueRequest', continueParams);
            } catch {}
            return;
          }
        }
      }

      const config = activeMocks.get(source.tabId);
      if (!config) {
        try { await chrome.debugger.sendCommand(source, 'Fetch.continueRequest', { requestId: params.requestId }); } catch {}
        return;
      }
      if (config.action === 'fail_request') {
        try {
          await chrome.debugger.sendCommand(source, 'Fetch.failRequest', {
            requestId: params.requestId,
            errorReason: config.errorReason || 'Failed',
          });
        } catch {}
      } else {
        try {
          const bodyStr = config.body || '{"mocked": true}';
          const bodyBase64 = btoa(unescape(encodeURIComponent(bodyStr)));
          await chrome.debugger.sendCommand(source, 'Fetch.fulfillRequest', {
            requestId: params.requestId,
            responseCode: config.status || 200,
            responseHeaders: config.headers || [{ name: 'Content-Type', value: 'application/json' }],
            body: bodyBase64,
          });
        } catch {}
      }
    }
  });
}


if (chrome.tabs && chrome.tabs.onRemoved) {
  chrome.tabs.onRemoved.addListener((tabId) => {
    activeMocks.delete(tabId);
    activeRoutes.delete(tabId);
    activeDialogRules.delete(tabId);
    activeWsBuffers.delete(tabId);
    activeScreencasts.delete(tabId);
    activeHars.delete(tabId);
    activeTraces.delete(tabId);
    activeVideoRecs.delete(tabId);
    activeClocks.delete(tabId);
    activeEmulations.delete(tabId);
    activeAuths.delete(tabId);
  });
}

