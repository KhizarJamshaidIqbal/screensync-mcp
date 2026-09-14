// ScreenSync Download Bridge — Playwright page.waitForDownload & download parity
// Modular single-responsibility unit under 150 lines.

import { makeError, ERROR_CODES } from './errors.js';

export async function execDownload(args = {}) {
  const url = String(args.url || '').trim();
  if (!/^https?:\/\//i.test(url) && !/^data:/i.test(url) && !/^blob:/i.test(url)) {
    return makeError(ERROR_CODES.BAD_ARGS, 'web_download requires a valid http(s), data, or blob URL.');
  }

  const timeoutMs = Math.min(Math.max(Number(args.timeoutMs) || 30000, 1000), 120000);

  return new Promise((resolve) => {
    let downloadId = null;
    let timer = null;

    const cleanup = () => {
      if (timer) clearTimeout(timer);
      if (chrome.downloads && chrome.downloads.onChanged) {
        chrome.downloads.onChanged.removeListener(onChanged);
      }
    };

    const onChanged = async (delta) => {
      if (!delta || delta.id !== downloadId) return;
      if (delta.state) {
        if (delta.state.current === 'complete') {
          cleanup();
          const items = await chrome.downloads.search({ id: downloadId }).catch(() => []);
          const item = (items && items[0]) || {};
          resolve({
            ok: true,
            data: {
              downloadId,
              filename: item.filename || args.filename || 'download',
              fileSize: item.fileSize || 0,
              mime: item.mime || 'application/octet-stream',
              url: item.url || url,
              state: 'complete',
            },
          });
        } else if (delta.state.current === 'interrupted') {
          cleanup();
          resolve({
            ok: false,
            error: `Download interrupted: ${delta.error ? delta.error.current : 'unknown error'}`,
            downloadId,
          });
        }
      }
    };

    timer = setTimeout(() => {
      cleanup();
      resolve({ ok: false, error: `Download timed out after ${timeoutMs}ms`, downloadId });
    }, timeoutMs);

    chrome.downloads.onChanged.addListener(onChanged);

    const downloadOpts = { url, saveAs: false };
    if (args.filename) downloadOpts.filename = String(args.filename);

    chrome.downloads.download(downloadOpts, (id) => {
      if (chrome.runtime.lastError || !id) {
        cleanup();
        resolve({ ok: false, error: (chrome.runtime.lastError && chrome.runtime.lastError.message) || 'Failed to start download.' });
      } else {
        downloadId = id;
      }
    });
  });
}

export async function execWaitDownload(args = {}) {
  const filterUrl = args.url ? String(args.url).toLowerCase() : null;
  const filterFilename = args.filename ? String(args.filename).toLowerCase() : null;
  const timeoutMs = Math.min(Math.max(Number(args.timeoutMs) || 30000, 1000), 120000);

  return new Promise((resolve) => {
    let trackedId = null;
    let timer = null;

    const cleanup = () => {
      if (timer) clearTimeout(timer);
      if (chrome.downloads) {
        if (chrome.downloads.onCreated) chrome.downloads.onCreated.removeListener(onCreated);
        if (chrome.downloads.onChanged) chrome.downloads.onChanged.removeListener(onChanged);
      }
    };

    const onCreated = (item) => {
      if (!item) return;
      if (filterUrl && (!item.url || !item.url.toLowerCase().includes(filterUrl))) return;
      if (filterFilename && (!item.filename || !item.filename.toLowerCase().includes(filterFilename))) return;

      trackedId = item.id;
      if (item.state === 'complete') {
        cleanup();
        resolve({
          ok: true,
          data: {
            downloadId: item.id,
            filename: item.filename,
            fileSize: item.fileSize,
            mime: item.mime,
            finalUrl: item.url,
            state: 'complete',
          },
        });
      }
    };

    const onChanged = async (delta) => {
      if (!delta || delta.id !== trackedId) return;
      if (delta.state) {
        if (delta.state.current === 'complete') {
          cleanup();
          const items = await chrome.downloads.search({ id: trackedId }).catch(() => []);
          const item = (items && items[0]) || {};
          resolve({
            ok: true,
            data: {
              downloadId: trackedId,
              filename: item.filename || 'download',
              fileSize: item.fileSize || 0,
              mime: item.mime || 'application/octet-stream',
              finalUrl: item.url,
              state: 'complete',
            },
          });
        } else if (delta.state.current === 'interrupted') {
          cleanup();
          resolve({
            ok: false,
            error: `Download interrupted: ${delta.error ? delta.error.current : 'unknown error'}`,
            downloadId: trackedId,
          });
        }
      }
    };

    timer = setTimeout(() => {
      cleanup();
      resolve({ ok: false, error: `waitForDownload timed out after ${timeoutMs}ms` });
    }, timeoutMs);

    if (chrome.downloads && chrome.downloads.onCreated) {
      chrome.downloads.onCreated.addListener(onCreated);
    }
    if (chrome.downloads && chrome.downloads.onChanged) {
      chrome.downloads.onChanged.addListener(onChanged);
    }
  });
}
