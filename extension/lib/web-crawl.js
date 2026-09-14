// ScreenSync Multi-Tab & Crawler Engine (batch crawl & multi-tab sync)
// Modular single-responsibility unit under 250 lines.

import { waitForTabComplete, groupAgentTab } from './tab-resolve.js';
import { makeError, ERROR_CODES } from './errors.js';

async function extractFromTab(tabId, mode, schema, expression) {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: (m, s, expr) => {
        if (m === 'eval' && expr) {
          try {
            return { ok: true, evalResult: (0, eval)(expr) };
          } catch (e) {
            return { ok: false, error: e.message };
          }
        }
        if (m === 'schema' && s && typeof s === 'object') {
          const data = {};
          for (const [key, sel] of Object.entries(s)) {
            const el = document.querySelector(String(sel));
            data[key] = el ? (el.innerText || el.value || el.textContent || '').trim() : null;
          }
          return { ok: true, schemaData: data, title: document.title, url: location.href };
        }
        // default markdown / readable summary
        const h1 = document.querySelector('h1')?.innerText?.trim() || '';
        const bodyText = (document.body?.innerText || '').slice(0, 5000);
        return {
          ok: true,
          title: document.title,
          url: location.href,
          heading: h1,
          textSample: bodyText.slice(0, 1000),
        };
      },
      args: [mode, schema || null, expression || null],
    });
    return (results && results[0] && results[0].result) || { ok: false, error: 'Extraction returned empty result' };
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err) };
  }
}

export async function execBatchCrawl(args = {}) {
  const urls = Array.isArray(args.urls) ? args.urls.filter((u) => typeof u === 'string' && /^https?:\/\//i.test(u)) : [];
  if (!urls.length) {
    return makeError(ERROR_CODES.BAD_ARGS, 'web_batch_crawl requires a non-empty array of http(s) urls.');
  }

  const maxConcurrency = Math.min(Math.max(Number(args.maxConcurrency) || 3, 1), 10);
  const timeoutMs = Math.min(Math.max(Number(args.timeoutMs) || 20000, 2000), 60000);
  const delayMs = Math.min(Math.max(Number(args.delayMs) || 500, 0), 10000);
  const discardAfter = args.discardAfter !== false;
  const schema = args.schema && typeof args.schema === 'object' ? args.schema : null;

  const results = [];
  for (let i = 0; i < urls.length; i += maxConcurrency) {
    const batch = urls.slice(i, i + maxConcurrency);
    const batchPromises = batch.map(async (url) => {
      let createdTab = null;
      try {
        createdTab = await chrome.tabs.create({ url, active: false });
        if (createdTab && createdTab.id) groupAgentTab(createdTab.id);
        await waitForTabComplete(createdTab.id, timeoutMs);
        const extractRes = await extractFromTab(createdTab.id, schema ? 'schema' : 'markdown', schema, null);
        return {
          url,
          ok: extractRes.ok,
          data: extractRes,
          tabId: createdTab.id,
        };
      } catch (e) {
        return { url, ok: false, error: String((e && e.message) || e) };
      } finally {
        if (discardAfter && createdTab && createdTab.id) {
          try { await chrome.tabs.remove(createdTab.id); } catch {}
        }
      }
    });

    const batchResults = await Promise.all(batchPromises);
    results.push(...batchResults);

    if (i + maxConcurrency < urls.length && delayMs > 0) {
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }

  return {
    ok: true,
    data: {
      total: urls.length,
      crawled: results.length,
      successful: results.filter((r) => r.ok).length,
      results,
    },
  };
}

export async function execMultiTabSync(args = {}) {
  const tasks = Array.isArray(args.tasks) ? args.tasks.filter((t) => t && typeof t.url === 'string' && /^https?:\/\//i.test(t.url)) : [];
  if (!tasks.length) {
    return makeError(ERROR_CODES.BAD_ARGS, 'web_multi_tab_sync requires an array of tasks with valid urls.');
  }

  const concurrency = Math.min(Math.max(Number(args.concurrency) || 3, 1), 6);
  const timeoutMs = Math.min(Math.max(Number(args.timeoutMs) || 25000, 5000), 60000);

  const results = [];
  for (let i = 0; i < tasks.length; i += concurrency) {
    const chunk = tasks.slice(i, i + concurrency);
    const chunkPromises = chunk.map(async (task) => {
      let createdTab = null;
      try {
        createdTab = await chrome.tabs.create({ url: task.url, active: false });
        if (createdTab && createdTab.id) groupAgentTab(createdTab.id);
        await waitForTabComplete(createdTab.id, timeoutMs);
        const mode = task.extract || (task.expression ? 'eval' : task.schema ? 'schema' : 'markdown');
        const extractRes = await extractFromTab(createdTab.id, mode, task.schema, task.expression);
        return {
          taskUrl: task.url,
          ok: extractRes.ok,
          data: extractRes,
        };
      } catch (err) {
        return { taskUrl: task.url, ok: false, error: String((err && err.message) || err) };
      } finally {
        if (createdTab && createdTab.id) {
          try { await chrome.tabs.remove(createdTab.id); } catch {}
        }
      }
    });

    const chunkResults = await Promise.all(chunkPromises);
    results.push(...chunkResults);
  }

  return {
    ok: true,
    data: {
      tasksCount: tasks.length,
      completed: results.length,
      results,
    },
  };
}
