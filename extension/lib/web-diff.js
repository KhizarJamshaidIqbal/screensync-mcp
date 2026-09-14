// ScreenSync Pixel Diff Unit — hardware-accelerated visual regression comparison
// using an Offscreen Canvas (powers web_pixel_diff & web_visual_baseline).

async function ensureOffscreenDoc() {
  if (typeof chrome === 'undefined' || !chrome.offscreen || !chrome.offscreen.createDocument) return false;
  try {
    if (chrome.offscreen.hasDocument && (await chrome.offscreen.hasDocument())) return true;
    await chrome.offscreen.createDocument({
      url: 'pages/offscreen.html',
      reasons: ['BLOBS'],
      justification: 'Hardware-accelerated visual pixel diffing',
    });
    return true;
  } catch (e) {
    if (String(e).includes('Only a single offscreen')) return true;
    return false;
  }
}

export async function execPixelDiff(tab, args = {}) {
  const imageA = args.imageA;
  if (!imageA || typeof imageA !== 'string') {
    return { ok: false, error: 'imageA data URL is required for web_pixel_diff.' };
  }

  let imageB = args.imageB;
  if (!imageB && tab && typeof tab.windowId === 'number') {
    try {
      imageB = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
    } catch (err) {
      return { ok: false, error: 'Failed to capture comparison tab: ' + String((err && err.message) || err) };
    }
  }

  if (!imageB || typeof imageB !== 'string') {
    return { ok: false, error: 'imageB is required or active tab must be capturable.' };
  }

  await ensureOffscreenDoc();
  const threshold = typeof args.threshold === 'number' ? Math.min(1, Math.max(0, args.threshold)) : 0.1;

  const res = await new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: 'pixel-diff', imageA, imageB, threshold }, (r) => {
      if (chrome.runtime.lastError) {
        resolve({ ok: false, error: chrome.runtime.lastError.message });
      } else {
        resolve(r || { ok: false, error: 'Offscreen pixel diff returned no response.' });
      }
    });
  });

  if (!res || !res.ok) return res || { ok: false, error: 'Pixel diff failed.' };

  const identical = res.identical ?? (res.diffPixels === 0);
  return {
    ok: true,
    data: {
      identical,
      diffPercent: typeof res.diffPercent === 'number' ? res.diffPercent : Number(res.diffPercent || 0),
      diffPixels: res.diffPixels ?? 0,
      totalPixels: res.totalPixels ?? 0,
      width: res.width,
      height: res.height,
      diffImageDataUrl: res.diffImageDataUrl || null,
    },
  };
}
