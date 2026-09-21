// ScreenSync Offscreen Document
// 1. Keep-Alive: Persistent port + periodic pings to completely eliminate MV3 service worker dormancy.
let keepAlivePort = null;
function connectKeepAlive() {
  try {
    keepAlivePort = chrome.runtime.connect({ name: 'keep-alive' });
    keepAlivePort.onDisconnect.addListener(() => {
      keepAlivePort = null;
      setTimeout(connectKeepAlive, 1000);
    });
  } catch {}
}
connectKeepAlive();
setInterval(() => {
  try {
    if (keepAlivePort) {
      keepAlivePort.postMessage({ type: 'ping', ts: Date.now() });
    } else {
      connectKeepAlive();
    }
    chrome.runtime.sendMessage({ type: 'offscreen-ping', ts: Date.now() }).catch(() => {});
  } catch {}
}, 15000);

// 2. Hardware-accelerated Visual Pixel Diffing
async function dataUrlToImageBitmap(dataUrl) {
  const res = await fetch(dataUrl);
  const blob = await res.blob();
  return createImageBitmap(blob);
}

async function computePixelDiff({ imageA, imageB, threshold = 0.1 }) {
  try {
    const [bmpA, bmpB] = await Promise.all([
      dataUrlToImageBitmap(imageA),
      dataUrlToImageBitmap(imageB)
    ]);

    const width = Math.max(bmpA.width, bmpB.width);
    const height = Math.max(bmpA.height, bmpB.height);

    const canvasA = new OffscreenCanvas(width, height);
    const ctxA = canvasA.getContext('2d');
    ctxA.drawImage(bmpA, 0, 0);
    const dataA = ctxA.getImageData(0, 0, width, height).data;

    const canvasB = new OffscreenCanvas(width, height);
    const ctxB = canvasB.getContext('2d');
    ctxB.drawImage(bmpB, 0, 0);
    const dataB = ctxB.getImageData(0, 0, width, height).data;

    const diffCanvas = new OffscreenCanvas(width, height);
    const diffCtx = diffCanvas.getContext('2d');
    const diffImageData = diffCtx.createImageData(width, height);
    const diffData = diffImageData.data;

    const totalPixels = width * height;
    let mismatched = 0;
    const colorThreshold = Math.max(1, Math.floor(threshold * 255));

    for (let i = 0; i < dataA.length; i += 4) {
      const dr = Math.abs(dataA[i] - dataB[i]);
      const dg = Math.abs(dataA[i + 1] - dataB[i + 1]);
      const db = Math.abs(dataA[i + 2] - dataB[i + 2]);
      const diff = (dr + dg + db) / 3;

      if (diff > colorThreshold) {
        mismatched++;
        diffData[i] = 255;
        diffData[i + 1] = 0;
        diffData[i + 2] = 128;
        diffData[i + 3] = 255;
      } else {
        diffData[i] = Math.floor(dataB[i] * 0.35);
        diffData[i + 1] = Math.floor(dataB[i + 1] * 0.35);
        diffData[i + 2] = Math.floor(dataB[i + 2] * 0.35);
        diffData[i + 3] = 255;
      }
    }

    diffCtx.putImageData(diffImageData, 0, 0);
    const blob = await diffCanvas.convertToBlob({ type: 'image/jpeg', quality: 0.85 });
    const reader = new FileReader();
    const diffDataUrl = await new Promise((resolve) => {
      reader.onloadend = () => resolve(reader.result);
      reader.readAsDataURL(blob);
    });

    const diffPercent = ((mismatched / totalPixels) * 100).toFixed(2);
    return {
      ok: true,
      data: {
        identical: mismatched === 0,
        diffPercent: Number(diffPercent),
        mismatchedPixels: mismatched,
        totalPixels,
        dimensions: { width, height },
        diffImageDataUrl: diffDataUrl
      }
    };
  } catch (err) {
    return { ok: false, error: 'Pixel diff calculation failed: ' + String(err.message || err) };
  }
}

// 3. WebM Video Recorder (Page.screencast frames → canvas → MediaRecorder)
const videoEngine = { canvas: null, ctx: null, recorder: null, chunks: [], frameCount: 0, startedAt: 0 };

async function videoDrawFrame(dataUrl) {
  try {
    const bmp = await dataUrlToImageBitmap(dataUrl);
    if (!videoEngine.canvas) return;
    if (videoEngine.canvas.width !== bmp.width || videoEngine.canvas.height !== bmp.height) {
      videoEngine.canvas.width = bmp.width;
      videoEngine.canvas.height = bmp.height;
    }
    videoEngine.ctx.drawImage(bmp, 0, 0);
    videoEngine.frameCount++;
  } catch {}
}

function videoHandleStart(msg) {
  try {
    if (videoEngine.recorder) {
      try { videoEngine.recorder.stop(); } catch {}
      videoEngine.recorder = null;
    }
    const canvas = document.createElement('canvas');
    canvas.width = msg.width || 1280;
    canvas.height = msg.height || 800;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    videoEngine.canvas = canvas;
    videoEngine.ctx = ctx;
    videoEngine.chunks = [];
    videoEngine.frameCount = 0;
    videoEngine.startedAt = Date.now();
    const stream = canvas.captureStream(msg.fps || 15);
    const mime = ['video/webm;codecs=vp8', 'video/webm'].find((m) => window.MediaRecorder && MediaRecorder.isTypeSupported(m)) || '';
    videoEngine.recorder = new MediaRecorder(stream, mime ? { mimeType: mime, videoBitsPerSecond: 2500000 } : undefined);
    videoEngine.recorder.ondataavailable = (e) => { if (e.data && e.data.size > 0) videoEngine.chunks.push(e.data); };
    videoEngine.recorder.start(250);
    return { ok: true, mimeType: mime || 'video/webm' };
  } catch (e) {
    videoEngine.recorder = null;
    return { ok: false, error: 'video-start failed: ' + String((e && e.message) || e) };
  }
}

async function videoHandleStop() {
  try {
    const rec = videoEngine.recorder;
    if (!rec || rec.state === 'inactive') {
      videoEngine.recorder = null;
      return { ok: false, error: 'No recording is in progress.' };
    }
    await new Promise((r) => setTimeout(r, 350));
    const blob = await new Promise((resolve) => {
      rec.onstop = () => resolve(new Blob(videoEngine.chunks, { type: 'video/webm' }));
      rec.stop();
    });
    videoEngine.recorder = null;
    videoEngine.canvas = null;
    const buf = new Uint8Array(await blob.arrayBuffer());
    let binary = '';
    for (let i = 0; i < buf.length; i += 0x8000) {
      binary += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
    }
    return {
      ok: true,
      webmBase64: btoa(binary),
      bytes: blob.size,
      frameCount: videoEngine.frameCount,
      durationMs: Date.now() - videoEngine.startedAt,
    };
  } catch (e) {
    videoEngine.recorder = null;
    return { ok: false, error: 'video-stop failed: ' + String((e && e.message) || e) };
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // Only the service worker drives this page. Anything that comes from a tab always has a sender.tab, and
  // must not reach the clipboard or the recorder through here.
  if (!sender || sender.id !== chrome.runtime.id || sender.tab) return false;
  if (msg && msg.type === 'pixel-diff') {
    computePixelDiff(msg).then(sendResponse);
    return true;
  }
  if (msg && msg.type === 'video-start') {
    sendResponse(videoHandleStart(msg));
    return true;
  }
  if (msg && msg.type === 'video-feed') {
    if (videoEngine.recorder && msg.data) videoDrawFrame('data:image/jpeg;base64,' + msg.data);
    sendResponse({ ok: true });
    return true;
  }
  if (msg && msg.type === 'video-stop') {
    videoHandleStop().then(sendResponse);
    return true;
  }
  if (msg && msg.type === 'clipboard-write') {
    try {
      const textarea = document.createElement('textarea');
      textarea.value = String(msg.text || '');
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      const ok = document.execCommand('copy');
      textarea.remove();
      sendResponse({ ok: true, length: (msg.text || '').length, execCommand: ok });
    } catch (e) {
      sendResponse({ ok: false, error: String((e && e.message) || e) });
    }
    return true;
  }
  if (msg && msg.type === 'clipboard-read') {
    (async () => {
      try {
        if (navigator.clipboard && navigator.clipboard.readText) {
          try {
            const text = await navigator.clipboard.readText();
            sendResponse({ ok: true, text, length: (text || '').length, method: 'clipboard-api' });
            return;
          } catch {
            // fallback to execCommand below
          }
        }
        const textarea = document.createElement('textarea');
        document.body.appendChild(textarea);
        textarea.focus();
        const ok = document.execCommand('paste');
        const text = textarea.value;
        textarea.remove();
        sendResponse({ ok: true, text, length: (text || '').length, execCommand: ok, method: 'execCommand' });
      } catch (e) {
        sendResponse({ ok: false, error: String((e && e.message) || e) });
      }
    })();
    return true;
  }
});
