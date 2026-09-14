// ScreenSync evidence recorders — real CDP HAR (optional response bodies),
// WebM video via offscreen MediaRecorder, fake clock, CDP Tracing.
import { attachCdp, detachCdp, rawAttach, rawDetach, activeHars, activeTraces, activeVideoRecs, activeClocks, activeWsBuffers } from './web-adv-core.js';
export async function cdpHarRecord(tab, args) {
  const action = String(args.action || 'start').toLowerCase();
  if (action === 'start') {
    if (activeHars.has(tab.id)) return { ok: false, error: 'HAR recording is already active on this tab — stop it first.' };
    const attached = await attachCdp(tab);
    if (!attached.ok) return attached;
    try {
      await chrome.debugger.sendCommand({ tabId: tab.id }, 'Network.enable');
    } catch (e) {
      await detachCdp(tab);
      return { ok: false, error: `Network.enable failed: ${String((e && e.message) || e)}` };
    }
    activeHars.set(tab.id, {
      startedAt: Date.now(),
      pending: new Map(),
      entries: [],
      maxEntries: Math.min(Number(args.maxEntries) || 500, 2000),
      filter: args.filter ? String(args.filter) : '',
      bodies: args.bodies === true,
      bodyBytes: 0,
    });
    const rec = activeHars.get(tab.id);
    return { ok: true, data: { recording: true, filter: rec.filter || null, maxEntries: rec.maxEntries, bodies: rec.bodies, startedAt: new Date().toISOString(), note: 'Navigate or interact with the page; stop to assemble the HAR.' } };
  }
  if (action === 'get') {
    const rec = activeHars.get(tab.id);
    if (!rec) return { ok: false, error: 'No HAR recording is active on this tab. Start one first.' };
    return { ok: true, data: { recording: true, elapsedMs: Date.now() - rec.startedAt, captured: rec.entries.length, inFlight: rec.pending.size } };
  }
  if (action === 'stop') {
    const rec = activeHars.get(tab.id);
    if (!rec) return { ok: false, error: 'No HAR recording is active on this tab.' };
    if (!activeWsBuffers.has(tab.id)) {
      try { await chrome.debugger.sendCommand({ tabId: tab.id }, 'Network.disable'); } catch {}
    }
    activeHars.delete(tab.id);
    await detachCdp(tab);
    const har = {
      log: {
        version: '1.2',
        creator: { name: 'ScreenSync MCP Extension', version: (chrome.runtime && chrome.runtime.getManifest) ? chrome.runtime.getManifest().version : '1.2.0' },
        pages: [{
          startedDateTime: new Date(rec.startedAt).toISOString(),
          id: 'page_1',
          title: 'ScreenSync HAR recording',
          pageTimings: { onContentLoad: -1, onLoad: -1 },
        }],
        entries: rec.entries,
      },
    };
    const out = { entryCount: rec.entries.length, elapsedMs: Date.now() - rec.startedAt, droppedInFlight: rec.pending.size, bodyBytes: rec.bodyBytes || 0, bodiesWithText: rec.entries.filter((e) => e.response.content && e.response.content.text).length, bodyErrors: rec.bodyErrors || [] };
    if (args.download === true) {
      try {
        const b64 = btoa(unescape(encodeURIComponent(JSON.stringify(har))));
        await chrome.downloads.download({ url: 'data:application/json;base64,' + b64, filename: args.filename || ('screensync-har-' + Date.now() + '.har'), saveAs: false });
        out.downloaded = true;
      } catch (e) { out.downloadError = String((e && e.message) || e); }
    }
    out.har = har;
    return { ok: true, data: out };
  }
  return { ok: false, error: 'Unknown web_har_record action: ' + action + '. Supported: start, get, stop.' };
}

// ── web_video_record: screencast frames → offscreen MediaRecorder → WebM ───

export async function cdpVideoRecord(tab, args) {
  const action = String(args.action || 'start').toLowerCase();
    if (action === 'start') {
    if (activeVideoRecs.has(tab.id)) return { ok: false, error: 'Already recording this tab — call web_video_record {action:"stop"} first.' };
    const attached = await attachCdp(tab);
    if (!attached.ok) return attached;
    // Register BEFORE startScreencast so the initial frame(s) are captured —
    // a screencast only emits frames on page paints.
    activeVideoRecs.set(tab.id, { startedAt: Date.now(), fps: Math.min(Math.max(Number(args.fps) || 15, 5), 30), frameCount: 0 });
    try { await chrome.debugger.sendCommand({ tabId: tab.id }, 'Page.enable'); } catch {}
    const fps = Math.min(Math.max(Number(args.fps) || 15, 5), 30);
    const maxWidth = Math.min(Number(args.maxWidth) || 1280, 1920);
    const maxHeight = Math.min(Number(args.maxHeight) || 800, 1080);
    try {
      await chrome.debugger.sendCommand({ tabId: tab.id }, 'Page.startScreencast', { format: 'jpeg', quality: 60, maxWidth, maxHeight, everyNthFrame: 1 });
    } catch (e) {
      activeVideoRecs.delete(tab.id);
      await detachCdp(tab);
      return { ok: false, error: `Screencast start failed: ${String((e && e.message) || e)}` };
    }
    let off = null;
    try { off = await chrome.runtime.sendMessage({ type: 'video-start', fps, width: maxWidth, height: maxHeight }); } catch (e) { off = { ok: false, error: String((e && e.message) || e) }; }
    if (!off || !off.ok) {
      try { await chrome.debugger.sendCommand({ tabId: tab.id }, 'Page.stopScreencast'); } catch {}
      activeVideoRecs.delete(tab.id);
      await detachCdp(tab);
      return { ok: false, error: 'Offscreen video engine failed to start: ' + ((off && off.error) || 'no response') };
    }
    return { ok: true, data: { recording: true, fps, maxWidth, maxHeight, mimeType: off.mimeType || 'video/webm', startedAt: new Date().toISOString(), note: 'Frames are streaming to the recorder. Stop within 60s.' } };
  }
  if (action === 'stop') {
    const rec = activeVideoRecs.get(tab.id);
    if (!rec) return { ok: false, error: 'No active recording on this tab.' };
    try { await chrome.debugger.sendCommand({ tabId: tab.id }, 'Page.stopScreencast'); } catch {}
    let res = null;
    try { res = await chrome.runtime.sendMessage({ type: 'video-stop' }); } catch (e) { res = { ok: false, error: String((e && e.message) || e) }; }
    activeVideoRecs.delete(tab.id);
    await detachCdp(tab);
    if (!res || !res.ok) return { ok: false, error: 'Offscreen video assembly failed: ' + ((res && res.error) || 'no response') };
    const out = {
      durationMs: res.durationMs || (Date.now() - rec.startedAt),
      frameCount: res.frameCount != null ? res.frameCount : rec.frameCount,
      bytes: res.bytes || 0,
      mimeType: 'video/webm',
    };
    if (args.download === true && res.webmBase64) {
      try {
        await chrome.downloads.download({ url: 'data:video/webm;base64,' + res.webmBase64, filename: args.filename || ('screensync-video-' + Date.now() + '.webm'), saveAs: false });
        out.downloaded = true;
      } catch (e) { out.downloadError = String((e && e.message) || e); }
    }
    if (args.returnData === true || (res.webmBase64 && res.webmBase64.length < 3000000)) {
      out.webmBase64 = res.webmBase64;
    } else {
      out.preview = (res.webmBase64 || '').slice(0, 64) + '... (use download:true or returnData:true to receive the full WebM)';
    }
    return { ok: true, data: out };
  }
  return { ok: false, error: 'Unknown web_video_record action: ' + action + '. Supported: start, stop.' };
}

// ── web_clock_set / web_clock_clear: Playwright clock parity ───────────────

function clockScriptSource(offsetMs, fixedMs) {
  const fixed = Number.isFinite(fixedMs) ? `const F=${Math.round(fixedMs)};` : 'const F=null;';
  return `(function(){${fixed}const O=${Number(offsetMs) | 0};if(!window.__ssOriginalDate)window.__ssOriginalDate=window.Date;const D=window.__ssOriginalDate;function SSD(...a){if(F!==null&&a.length===0)return new D(F);return a.length===0?new D(D.now()+O):new D(...a);}SSD.now=function(){return F!==null?F:D.now()+O;};SSD.parse=D.parse;SSD.UTC=D.UTC;SSD.prototype=D.prototype;window.Date=SSD;})();`;
}


export async function cdpClockSet(tab, args) {
  const offsetMs = Math.round(Number(args.offsetMs) || 0);
  const fixed = args.fixed === true;
  let effective = args.iso ? (Date.parse(String(args.iso)) - Date.now()) : offsetMs;
  let fixedMs = null;
  if (fixed) {
    fixedMs = args.iso ? Date.parse(String(args.iso)) : (Date.now() + effective);
    if (!Number.isFinite(fixedMs)) return { ok: false, error: 'web_clock_set requires a valid ISO timestamp when fixed:true.' };
    effective = fixedMs - Date.now();
  } else if (!Number.isFinite(effective)) {
    return { ok: false, error: 'web_clock_set requires a finite offsetMs or a valid ISO timestamp.' };
  }
  const target = { tabId: tab.id };
  let attachedHere = false;
  try {
    try {
      await rawAttach(target);
      attachedHere = true;
    } catch (e) {
      if (!/already attached/i.test(String((e && e.message) || e))) throw e;
    }
    const src = clockScriptSource(effective, fixedMs);
    const res = await chrome.debugger.sendCommand(target, 'Page.addScriptToEvaluateOnNewDocument', { source: src, runImmediately: true });
    const prev = activeClocks.get(tab.id);
    if (prev && prev.scriptId) {
      try { await chrome.debugger.sendCommand(target, 'Page.removeScriptToEvaluateOnNewDocument', { identifier: prev.scriptId }); } catch {}
    }
    activeClocks.set(tab.id, { scriptId: res.identifier, offsetMs: effective, fixedMs });
    try { await chrome.debugger.sendCommand(target, 'Runtime.evaluate', { expression: src }); } catch {}
    return { ok: true, data: { clockShifted: true, offsetMs: effective, fixed: fixed || undefined, fixedAt: fixedMs ? new Date(fixedMs).toISOString() : (args.iso || undefined), pageNowIso: new Date((fixedMs !== null ? fixedMs : Date.now() + effective)).toISOString(), persistsAcrossNavigations: true } };
  } catch (e) {
    return { ok: false, error: `web_clock_set failed: ${String((e && e.message) || e)}` };
  } finally {
    if (attachedHere) { await rawDetach(target); }
  }
}


export async function cdpClockFastForward(tab, args) {
  const delta = Math.round(Number(args.ms) || 0);
  if (!delta) return { ok: false, error: 'web_clock_fast_forward requires ms (positive advances, negative rewinds).' };
  const rec = activeClocks.get(tab.id);
  if (!rec) return { ok: false, error: 'No clock override active on this tab — call web_clock_set first.' };
  const newOffset = rec.offsetMs + delta;
  const newFixed = rec.fixedMs != null ? rec.fixedMs + delta : null;
  const target = { tabId: tab.id };
  let attachedHere = false;
  try {
    try {
      await rawAttach(target);
      attachedHere = true;
    } catch (e) {
      if (!/already attached/i.test(String((e && e.message) || e))) throw e;
    }
    const src = clockScriptSource(newOffset, newFixed);
    const res = await chrome.debugger.sendCommand(target, 'Page.addScriptToEvaluateOnNewDocument', { source: src, runImmediately: true });
    if (rec.scriptId) {
      try { await chrome.debugger.sendCommand(target, 'Page.removeScriptToEvaluateOnNewDocument', { identifier: rec.scriptId }); } catch {}
    }
    activeClocks.set(tab.id, { scriptId: res.identifier, offsetMs: newOffset, fixedMs: newFixed });
    try { await chrome.debugger.sendCommand(target, 'Runtime.evaluate', { expression: src }); } catch {}
    return { ok: true, data: { advancedByMs: delta, offsetMs: newOffset, fixed: newFixed != null, pageNowIso: new Date((newFixed !== null ? newFixed : Date.now() + newOffset)).toISOString(), persistsAcrossNavigations: true } };
  } catch (e) {
    return { ok: false, error: `web_clock_fast_forward failed: ${String((e && e.message) || e)}` };
  } finally {
    if (attachedHere) { await rawDetach(target); }
  }
}


export async function cdpClockClear(tab) {
  const target = { tabId: tab.id };
  const rec = activeClocks.get(tab.id);
  let attachedHere = false;
  try {
    try {
      await rawAttach(target);
      attachedHere = true;
    } catch (e) {
      if (!/already attached/i.test(String((e && e.message) || e))) throw e;
    }
    if (rec && rec.scriptId) {
      try { await chrome.debugger.sendCommand(target, 'Page.removeScriptToEvaluateOnNewDocument', { identifier: rec.scriptId }); } catch {}
    }
    try {
      await chrome.debugger.sendCommand(target, 'Runtime.evaluate', { expression: 'if(window.__ssOriginalDate){window.Date=window.__ssOriginalDate;delete window.__ssOriginalDate;}' });
    } catch {}
    activeClocks.delete(tab.id);
    return { ok: true, data: { clockRestored: true } };
  } catch (e) {
    return { ok: false, error: `web_clock_clear failed: ${String((e && e.message) || e)}` };
  } finally {
    if (attachedHere) { await rawDetach(target); }
  }
}

// ── web_run_code: Playwright run_code — CDP Runtime.evaluate with the user
// code inlined (no inner eval), so it works on pages whose CSP forbids eval ──

const TRACE_CATEGORIES = [
  'devtools.timeline',
  'v8.execute',
  'disabled-by-default-devtools.timeline',
  'disabled-by-default-devtools.timeline.frame',
  'toplevel',
  'javascript',
];


export async function cdpTraceRecord(tab, args) {
  const action = String(args.action || 'start').toLowerCase();
  if (action === 'start') {
    if (activeTraces.has(tab.id)) return { ok: false, error: 'A trace is already being recorded on this tab — stop it first.' };
    const attached = await attachCdp(tab);
    if (!attached.ok) return attached;
    const categories = Array.isArray(args.categories) && args.categories.length
      ? args.categories.map(String)
      : TRACE_CATEGORIES;
    try {
      await chrome.debugger.sendCommand({ tabId: tab.id }, 'Tracing.start', {
        traceConfig: { recordMode: args.recordMode || 'recordContinuously', categories: { included: categories, excluded: [] } },
      });
    } catch (e) {
      await detachCdp(tab);
      return { ok: false, error: `Tracing.start failed: ${String((e && e.message) || e)}` };
    }
    activeTraces.set(tab.id, {
      startedAt: Date.now(),
      chunks: [],
      eventCount: 0,
      complete: false,
      maxEvents: Math.min(Number(args.maxEvents) || 20000, 100000),
    });
    return { ok: true, data: { recording: true, categories, maxEvents: activeTraces.get(tab.id).maxEvents, startedAt: new Date().toISOString(), note: 'Trace is capturing timeline/v8 events. Stop to assemble the Chrome trace JSON.' } };
  }
  if (action === 'get') {
    const rec = activeTraces.get(tab.id);
    if (!rec) return { ok: false, error: 'No trace recording active on this tab. Start one first.' };
    return { ok: true, data: { recording: true, elapsedMs: Date.now() - rec.startedAt, eventCount: rec.eventCount, complete: rec.complete } };
  }
  if (action === 'stop') {
    const rec = activeTraces.get(tab.id);
    if (!rec) return { ok: false, error: 'No trace recording active on this tab.' };
    try { await chrome.debugger.sendCommand({ tabId: tab.id }, 'Tracing.end'); } catch {}
    // Tracing delivers the remaining chunks before tracingComplete fires.
    const deadline = Date.now() + 6000;
    while (!rec.complete && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 150));
    }
    activeTraces.delete(tab.id);
    await detachCdp(tab);
    const trace = { traceEvents: rec.chunks, metadata: { tabId: tab.id, recordedBy: 'ScreenSync MCP Extension', durationMs: Date.now() - rec.startedAt } };
    const out = { eventCount: rec.eventCount, durationMs: Date.now() - rec.startedAt, complete: rec.complete, truncated: rec.eventCount >= rec.maxEvents };
    if (args.download === true) {
      try {
        const b64 = btoa(unescape(encodeURIComponent(JSON.stringify(trace))));
        await chrome.downloads.download({ url: 'data:application/json;base64,' + b64, filename: args.filename || ('screensync-trace-' + Date.now() + '.json'), saveAs: false });
        out.downloaded = true;
      } catch (e) { out.downloadError = String((e && e.message) || e); }
    }
    if (args.returnData === true || JSON.stringify(trace).length < 3000000) {
      out.trace = trace;
    } else {
      out.trace = undefined;
      out.preview = 'trace too large to inline — use download:true (saved as Chrome trace JSON, openable in chrome://tracing / DevTools Performance)';
    }
    return { ok: true, data: out };
  }
  return { ok: false, error: 'Unknown web_trace_record action: ' + action + '. Supported: start, get, stop.' };
}

