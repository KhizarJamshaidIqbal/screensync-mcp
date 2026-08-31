// Realtime frame streaming (web_watch). Loops chrome.tabs.captureVisibleTab
// at 500ms — the browser's hard 2fps ceiling for this API — and pixel-diffs
// consecutive frames on an OffscreenCanvas so identical frames are skipped
// (idle costs nothing, visual changes are never missed). Kept frames are
// POSTed live to the hub (/api/web/frame → SSE web_frame broadcast) and also
// returned in the tool result so the MCP layer can hand every changed frame
// to the AI as image content.

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function downsampledPixels(dataUrl) {
  try {
    const blob = await (await fetch(dataUrl)).blob();
    // Decode straight to the sample size — far cheaper than a full-res
    // decode + drawImage, and decode cost is what eats the capture budget.
    const bmp = await createImageBitmap(blob, { resizeWidth: 64, resizeHeight: 36, resizeQuality: 'low' });
    const canvas = new OffscreenCanvas(bmp.width, bmp.height);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(bmp, 0, 0);
    const px = ctx.getImageData(0, 0, bmp.width, bmp.height).data;
    if (bmp.close) bmp.close();
    return px;
  } catch {
    return null;
  }
}

function diffRatio(a, b) {
  if (!a || !b || a.length !== b.length) return 1;
  let sum = 0;
  let n = 0;
  for (let i = 0; i < a.length; i += 16) { sum += Math.abs(a[i] - b[i]); n += 1; }
  return sum / (n * 255);
}

export async function execWatch(tab, args, hubFetch) {
  const durationMs = Math.min(Math.max(Number(args.durationMs) || 6000, 1000), 10000);
  const maxFrames = Math.min(Math.max(Number(args.maxFrames) || 12, 1), 20);
  const quality = Math.min(Math.max(Number(args.quality) || 60, 20), 90);
  let intervalMs = 500;
  const watchId = `${tab.id}-${Date.now()}`;
  const frames = [];
  let captured = 0;
  let changedSkipped = 0;
  let quotaHits = 0;
  let prev = null;
  const t0 = Date.now();
  while (Date.now() - t0 < durationMs && frames.length < maxFrames) {
    const cycleStart = Date.now();
    let dataUrl = null;
    try {
      dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'jpeg', quality });
    } catch { dataUrl = null; }
    if (chrome.runtime.lastError) { quotaHits += 1; intervalMs = 600; }
    if (!dataUrl) {
      quotaHits += 1;
    } else {
      captured += 1;
      const px = await downsampledPixels(dataUrl);
      const ratio = diffRatio(prev, px);
      if (px) prev = px;
      if (frames.length === 0 || ratio >= 0.01) {
        const frame = { index: frames.length, ts: Date.now() - t0, imageDataUrl: dataUrl };
        frames.push(frame);
        // Stream live without blocking the capture cadence; the tool result
        // still carries every frame if the hub is slow or offline.
        hubFetch('/api/web/frame', { method: 'POST', body: { watchId, frame } }).catch(() => {});
      } else {
        changedSkipped += 1;
      }
    }
    await sleep(Math.max(60, intervalMs - (Date.now() - cycleStart)));
  }
  return {
    ok: true,
    data: {
      watchId,
      frames,
      captured,
      changedSkipped,
      quotaHits,
      intervalMs,
      fps: +(1000 / intervalMs).toFixed(2),
      durationMs: Date.now() - t0,
      url: tab.url,
      title: tab.title,
    },
  };
}
