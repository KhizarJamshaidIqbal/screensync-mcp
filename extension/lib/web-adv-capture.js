// ScreenSync CDP capture executors — screenshots, PDF, a11y tree, hook-based HAR export, coverage, screencast.
import { rawAttach, rawDetach, attachCdp, detachCdp, main, activeScreencasts, activeCoverage } from './web-adv-core.js';
import { ensureHooks, ssReadBuffer } from './web-adv-units.js';
import { ssWebUnitExtract } from './web-unit.js';
export async function cdpScreenshot(tab, args = {}) {
  const target = { tabId: tab.id };
  let attached = false;
  try {
    await rawAttach(target);
    attached = true;
  } catch (e) {
    if (String((e && e.message) || e).includes('Already attached')) {
      attached = true;
    } else {
      return { ok: false, error: `CDP attach failed: ${String((e && e.message) || e)}` };
    }
  }
  try {
    await chrome.debugger.sendCommand(target, 'Page.enable', {});
    const full = args.fullPage !== false;
    const format = args.format === 'png' ? 'png' : 'jpeg';
    const quality = typeof args.quality === 'number' ? Math.min(100, Math.max(1, args.quality)) : 80;
    
    const captureOpts = { format, captureBeyondViewport: full };
    if (format === 'jpeg') captureOpts.quality = quality;

    const res = await chrome.debugger.sendCommand(target, 'Page.captureScreenshot', captureOpts);
    const mime = format === 'png' ? 'image/png' : 'image/jpeg';
    const dataUrl = `data:${mime};base64,${res.data}`;
    return {
      ok: true,
      data: {
        imageDataUrl: dataUrl,
        fullPage: full,
        format,
        url: tab.url,
        title: tab.title,
      },
    };
  } catch (err) {
    return { ok: false, error: `CDP screenshot error: ${String((err && err.message) || err)}` };
  } finally {
    if (attached) {
      await rawDetach(target);
    }
  }
}


export async function cdpPdf(tab, args = {}) {
  const target = { tabId: tab.id };
  let attached = false;
  try {
    await rawAttach(target);
    attached = true;
  } catch (e) {
    if (String((e && e.message) || e).includes('Already attached')) {
      attached = true;
    } else {
      return { ok: false, error: `CDP attach failed: ${String((e && e.message) || e)}` };
    }
  }
  try {
    await chrome.debugger.sendCommand(target, 'Page.enable', {});
    // Playwright pdf() option parity: named formats, scale, page ranges,
    // per-side margins, header/footer templates, CSS page size, outline.
    const FORMATS = {
      letter: [8.5, 11], legal: [8.5, 14], tabloid: [11, 17], ledger: [17, 11],
      a0: [33.1, 46.8], a1: [23.4, 33.1], a2: [16.5, 23.4], a3: [11.7, 16.5],
      a4: [8.27, 11.7], a5: [5.83, 8.27], a6: [4.13, 5.83],
    };
    let paperWidth = args.paperWidth || 8.5;
    let paperHeight = args.paperHeight || 11;
    if (args.format && FORMATS[String(args.format).toLowerCase()]) {
      const [w, h] = FORMATS[String(args.format).toLowerCase()];
      paperWidth = args.landscape ? h : w;
      paperHeight = args.landscape ? w : h;
    }
    const margin = Number(args.margin);
    const printOpts = {
      printBackground: args.printBackground !== false,
      landscape: !!args.landscape,
      paperWidth,
      paperHeight,
      marginTop: args.marginTop ?? (Number.isFinite(margin) ? margin : 0.4),
      marginBottom: args.marginBottom ?? (Number.isFinite(margin) ? margin : 0.4),
      marginLeft: args.marginLeft ?? (Number.isFinite(margin) ? margin : 0.4),
      marginRight: args.marginRight ?? (Number.isFinite(margin) ? margin : 0.4),
    };
    if (args.scale !== undefined) printOpts.scale = Math.min(Math.max(Number(args.scale) || 1, 0.1), 2);
    if (args.pageRanges) printOpts.pageRanges = String(args.pageRanges);
    if (args.preferCSSPageSize === true) printOpts.preferCSSPageSize = true;
    if (args.generateDocumentOutline === true) printOpts.generateDocumentOutline = true;
    if (args.generateTaggedPDF === true) printOpts.generateTaggedPDF = true;
    if (args.headerTemplate || args.footerTemplate) {
      printOpts.displayHeaderFooter = true;
      if (args.headerTemplate) printOpts.headerTemplate = String(args.headerTemplate);
      if (args.footerTemplate) printOpts.footerTemplate = String(args.footerTemplate);
    }
    const res = await chrome.debugger.sendCommand(target, 'Page.printToPDF', printOpts);
    const dataUrl = `data:application/pdf;base64,${res.data}`;
    return {
      ok: true,
      data: {
        pdfDataUrl: dataUrl,
        url: tab.url,
        title: tab.title,
      },
    };
  } catch (err) {
    return { ok: false, error: `CDP PDF error: ${String((err && err.message) || err)}` };
  } finally {
    if (attached) {
      await rawDetach(target);
    }
  }
}



// ── web_mhtml: full-page MHTML archive (DevTools Page.captureSnapshot parity) ──
export async function cdpMhtml(tab, args = {}) {
  const target = { tabId: tab.id };
  let attached = false;
  try {
    await rawAttach(target);
    attached = true;
  } catch (e) {
    if (!/already attached/i.test(String((e && e.message) || e))) return { ok: false, error: 'CDP attach failed: '+ String((e && e.message) || e) };
  }
  try {
    let mhtml = '';
    try {
      await chrome.debugger.sendCommand(target, "Page.enable", {}).catch(() => {});
      const res = await chrome.debugger.sendCommand(target, "Page.captureSnapshot", { format: 'mhtml' });
      mhtml = String(res.data || '');
    } catch (_cdpErr) {
      const domResult = await main(tab, () => document.documentElement.outerHTML);
      const html = (domResult && typeof domResult === 'string') ? domResult : '<!DOCTYPE html><html><body></body></html>';
      const boundary = '----=_NextPart_ScreenSync_' + Date.now() + '_' + Math.random().toString(36).slice(2);
      mhtml = [
        'From: <Saved by ScreenSync MCP>',
        'Snapshot-Content-Location: ' + (tab.url || 'about:blank'),
        'Subject: ' + (tab.title || 'Page Snapshot'),
        'Date: ' + new Date().toUTCString(),
        'MIME-Version: 1.0',
        'Content-Type: multipart/related; type="text/html"; boundary="' + boundary + '"',
        '',
        '--' + boundary,
        'Content-Type: text/html; charset="utf-8"',
        'Content-Transfer-Encoding: 8bit',
        'Content-Location: ' + (tab.url || 'about:blank'),
        '',
        html,
        '',
        '--' + boundary + '--',
        '',
      ].join('\r\n');
    }
    const out = { bytes: mhtml.length, url: tab.url, title: tab.title };
    if (args.download === true) {
      try {
        const b64 = btoa(unescape(encodeURIComponent(mhtml)));
        await chrome.downloads.download({ url: 'data:application/mhtml;base64,' + b64, filename: args.filename || ('screensync-page-' + Date.now() + '.mhtml'), saveAs: false });
        out.downloaded = true;
      } catch (e2) { out.downloadError = String((e2 && e2.message) || e2); }
    }
    if (args.returnData === true || mhtml.length < 2000000) out.mhtml = mhtml;
    else out.preview = mhtml.slice(0, 200) + "… (use download:true or returnData:true for the full archive)";
    return { ok: true, data: out };
  } catch (err) {
    return { ok: false, error: 'web_mhtml failed: ' + String((err && err.message) || err) };
  } finally {
    if (attached) { await rawDetach(target); }
  }
}
export async function cdpAXTree(tab, args = {}) {
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
    await chrome.debugger.sendCommand(target, 'Accessibility.enable', {});
    const res = await chrome.debugger.sendCommand(target, 'Accessibility.getFullAXTree', {});
    const maxNodes = Math.min(Number(args.maxNodes) || 120, 300);
    const simplified = [];

    for (const node of (res.nodes || [])) {
      if (node.ignored) continue;
      const role = node.role ? (node.role.value || node.role) : '';
      const name = node.name ? (node.name.value || node.name) : '';
      if (!role && !name) continue;
      if (['generic', 'none', 'StaticText', 'InlineTextBox', 'LineBreak'].includes(role) && !name) continue;

      const item = { role, name: String(name).slice(0, 100) };
      if (node.value && node.value.value) item.value = String(node.value.value).slice(0, 100);
      if (node.description && node.description.value) item.description = String(node.description.value).slice(0, 100);
      if (node.disabled && node.disabled.value) item.disabled = true;
      if (node.focused && node.focused.value) item.focused = true;
      if (node.expanded && node.expanded.value) item.expanded = true;

      simplified.push(item);
      if (simplified.length >= maxNodes) break;
    }

    return {
      ok: true,
      data: {
        totalNodes: (res.nodes || []).length,
        nodeCount: simplified.length,
        nodes: simplified,
        url: tab.url,
        title: tab.title,
      },
    };
  } catch (err) {
    return { ok: false, error: `CDP AXTree error: ${String((err && err.message) || err)}` };
  } finally {
    if (attached) {
      await rawDetach(target);
    }
  }
}

export async function cdpExportHar(tab, args = {}) {
  await ensureHooks(tab);
  const bufRes = await main(tab, ssReadBuffer, { kind: 'network', clear: !!args.clear });
  const entries = (bufRes && bufRes.data && bufRes.data.entries) || [];
  
  const harEntries = entries.map((e, idx) => {
    const startedDateTime = new Date(e.ts || Date.now()).toISOString();
    const time = e.durationMs || 0;
    return {
      pageref: 'page_1',
      startedDateTime,
      time,
      request: {
        method: e.method || 'GET',
        url: e.url || '',
        httpVersion: 'HTTP/1.1',
        cookies: [],
        headers: [],
        queryString: [],
        headersSize: -1,
        bodySize: -1,
      },
      response: {
        status: e.status || (e.error ? 0 : 200),
        statusText: e.error ? 'Error' : 'OK',
        httpVersion: 'HTTP/1.1',
        cookies: [],
        headers: [],
        content: {
          size: 0,
          mimeType: 'application/json',
          text: e.error || '',
        },
        redirectURL: '',
        headersSize: -1,
        bodySize: -1,
      },
      cache: {},
      timings: { send: 0, wait: time, receive: 0 },
      connection: String(idx + 1),
    };
  });

  const har = {
    log: {
      version: '1.2',
      creator: { name: 'ScreenSync MCP', version: '1.1.0' },
      browser: { name: 'Chrome', version: navigator.userAgent },
      pages: [{ startedDateTime: new Date().toISOString(), id: 'page_1', title: tab.title || '', pageTimings: { onContentLoad: -1, onLoad: -1 } }],
      entries: harEntries,
    },
  };

  return {
    ok: true,
    data: {
      har,
      totalEntries: harEntries.length,
      url: tab.url,
      title: tab.title,
    },
  };
}


export async function cdpElementScreenshot(tab, args = {}) {
  let bounds = null;
  try {
    const bRes = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: ssWebUnitExtract,
      args: [{ ...args, __tool: 'web_element_bounds' }],
    });
    if (bRes && bRes[0] && bRes[0].result && bRes[0].result.ok) {
      bounds = bRes[0].result.data;
    }
  } catch {}
  if (!bounds) {
    return { ok: false, error: 'Could not calculate bounds for element screenshot. Make sure element is visible on page.' };
  }

  const padding = Number(args.padding) || 4;
  const useFullPage = args.fullPage === true;
  const clipX = useFullPage ? (bounds.pageX ?? bounds.x) : bounds.x;
  const clipY = useFullPage ? (bounds.pageY ?? bounds.y) : bounds.y;
  const clip = {
    x: Math.max(0, clipX - padding),
    y: Math.max(0, clipY - padding),
    width: bounds.width + padding * 2,
    height: bounds.height + padding * 2,
    scale: 1,
  };

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
    await chrome.debugger.sendCommand(target, 'Page.enable', {});
    const format = args.format === 'png' ? 'png' : 'jpeg';
    const quality = typeof args.quality === 'number' ? Math.min(100, Math.max(1, args.quality)) : 85;
    const captureOpts = { format, clip, captureBeyondViewport: useFullPage };
    if (format === 'jpeg') captureOpts.quality = quality;

    const res = await chrome.debugger.sendCommand(target, 'Page.captureScreenshot', captureOpts);
    const mime = format === 'png' ? 'image/png' : 'image/jpeg';
    return {
      ok: true,
      data: {
        imageDataUrl: `data:${mime};base64,${res.data}`,
        format,
        clip,
        bounds,
        url: tab.url,
      },
    };
  } catch (err) {
    return { ok: false, error: `CDP element screenshot error: ${String((err && err.message) || err)}` };
  } finally {
    if (attached) {
      await rawDetach(target);
    }
  }
}


export async function cdpCoverage(tab, args = {}) {
  const target = { tabId: tab.id };
  const action = String(args.action || 'start').toLowerCase();

  if (action === 'start') {
    const attachRes = await attachCdp(tab);
    if (!attachRes.ok) return attachRes;
    try {
      await chrome.debugger.sendCommand(target, 'Profiler.enable');
      await chrome.debugger.sendCommand(target, 'Profiler.startPreciseCoverage', { callCount: false, detailed: true });
      await chrome.debugger.sendCommand(target, 'CSS.enable').catch(() => {});
      await chrome.debugger.sendCommand(target, 'CSS.startRuleUsageTracking').catch(() => {});
      activeCoverage.set(tab.id, true);
      return { ok: true, data: { action: 'start', tracking: true } };
    } catch (err) {
      activeCoverage.delete(tab.id);
      await detachCdp(tab);
      return { ok: false, error: `CDP coverage start error: ${String((err && err.message) || err)}` };
    }
  }

  if (action === 'stop' || action === 'get') {
    if (!activeCoverage.get(tab.id)) {
      return { ok: false, error: 'Coverage tracking is not active on this tab. Call action: "start" first.' };
    }
    try {
      const profRes = await chrome.debugger.sendCommand(target, 'Profiler.takePreciseCoverage').catch(() => ({ result: [] }));
      const cssRes = await chrome.debugger.sendCommand(target, 'CSS.stopRuleUsageTracking').catch(() => ({ ruleUsage: [] }));
      await chrome.debugger.sendCommand(target, 'Profiler.stopPreciseCoverage').catch(() => {});
      await chrome.debugger.sendCommand(target, 'Profiler.disable').catch(() => {});
      await chrome.debugger.sendCommand(target, 'CSS.disable').catch(() => {});
      activeCoverage.delete(tab.id);
      await detachCdp(tab);

      let totalJsBytes = 0;
      let usedJsBytes = 0;
      const scripts = (profRes.result || []).map((s) => {
        let scriptTotal = 0;
        let scriptUsed = 0;
        for (const func of s.functions || []) {
          for (const range of func.ranges || []) {
            const bytes = range.endOffset - range.startOffset;
            scriptTotal += bytes;
            if (range.count > 0) scriptUsed += bytes;
          }
        }
        totalJsBytes += scriptTotal;
        usedJsBytes += scriptUsed;
        return { url: s.url, totalBytes: scriptTotal, usedBytes: scriptUsed };
      }).filter((s) => s.totalBytes > 0);

      const jsPct = totalJsBytes > 0 ? Math.round((usedJsBytes / totalJsBytes) * 100) : 100;

      return {
        ok: true,
        data: {
          jsCoverage: {
            totalBytes: totalJsBytes,
            usedBytes: usedJsBytes,
            unusedBytes: totalJsBytes - usedJsBytes,
            percentUsed: jsPct,
            scriptsSample: scripts.slice(0, 10),
          },
          cssRulesTracked: (cssRes.ruleUsage || []).length,
        },
      };
    } catch (err) {
      await detachCdp(tab);
      return { ok: false, error: `CDP coverage stop error: ${String((err && err.message) || err)}` };
    }
  }

  return { ok: false, error: `Unknown web_coverage action: ${action}. Supported: start, stop.` };
}


export async function cdpScreencast(tab, args = {}) {
  const target = { tabId: tab.id };
  const action = String(args.action || 'start').toLowerCase();

  if (action === 'start') {
    const attached = await attachCdp(tab);
    if (!attached.ok) return attached;
    try {
      await chrome.debugger.sendCommand(target, 'Page.enable', {});
      activeScreencasts.set(tab.id, []);
      const format = args.format === 'png' ? 'png' : 'jpeg';
      const quality = Math.min(100, Math.max(1, Number(args.quality) || 75));
      const everyNthFrame = Math.max(1, Number(args.everyNthFrame) || 2);

      await chrome.debugger.sendCommand(target, 'Page.startScreencast', {
        format,
        quality,
        maxWidth: 1024,
        maxHeight: 768,
        everyNthFrame,
      });

      return { ok: true, data: { action: 'start', recording: true, format, quality, tabId: tab.id } };
    } catch (err) {
      activeScreencasts.delete(tab.id);
      await detachCdp(tab);
      return { ok: false, error: `Failed to start screencast: ${err.message}` };
    }
  }

  if (action === 'stop' || action === 'get') {
    const frames = activeScreencasts.get(tab.id) || [];
    if (action === 'stop') {
      try { await chrome.debugger.sendCommand(target, 'Page.stopScreencast', {}); } catch {}
      activeScreencasts.delete(tab.id);
      await detachCdp(tab);
    }
    return {
      ok: true,
      data: {
        tabId: tab.id,
        frameCount: frames.length,
        durationMs: frames.length > 1 ? frames[frames.length - 1].ts - frames[0].ts : 0,
        sampleFrames: frames.slice(0, 5).map((f) => ({ ts: f.ts, metadata: f.metadata, preview: f.data ? f.data.slice(0, 80) + '...' : '' })),
      },
    };
  }

  return { ok: false, error: `Unknown web_screencast action: ${action}. Supported: start, get, stop.` };
}

// ── web_har_record: real CDP Network capture assembled into HAR 1.2 ────────
