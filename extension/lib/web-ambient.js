// ScreenSync Ambient Collector — live browser-side activity pushed into the
// hub's sequenced SSE ring so agents can tail real page behavior via web_events
// (and every reconnecting client replays missed events via Last-Event-ID).
// Event types pushed: web_navigation, web_page_loaded, web_tab_activated.

import { hubFetch } from './api.js';

const HTTP_URL = /^https?:/i;
let started = false;
const lastNav = new Map(); // tabId -> last committed url (dedupe hash-only commits)

function push(type, data = {}) {
  try {
    hubFetch('/api/web/event', {
      method: 'POST',
      body: { type, source: 'browser', data },
    });
  } catch { /* hub offline — ambient events are best-effort */ }
}

function onCommitted(details) {
  try {
    if (details.frameId !== 0) return;
    const url = details.url || '';
    if (!HTTP_URL.test(url)) return;
    if (lastNav.get(details.tabId) === url) return;
    lastNav.set(details.tabId, url);
    if (lastNav.size > 50) {
      const oldest = lastNav.keys().next().value;
      lastNav.delete(oldest);
    }
    push('web_navigation', { tabId: details.tabId, url, transition: details.transitionType });
  } catch { /* never let ambient collection break the SW */ }
}

function onTabActivated(info) {
  try {
    chrome.tabs.get(info.tabId)
      .then((t) => {
        if (t && t.url && HTTP_URL.test(t.url)) {
          push('web_tab_activated', { tabId: t.id, url: t.url, title: t.title });
        }
      })
      .catch(() => {});
  } catch { /* tab may be gone */ }
}

function onTabUpdated(tabId, info, tab) {
  try {
    if (info.status !== 'complete') return;
    const url = (tab && tab.url) || '';
    if (!HTTP_URL.test(url)) return;
    push('web_page_loaded', { tabId, url, title: (tab && tab.title) || undefined });
  } catch { /* never break the SW */ }
}

export function startAmbientCollector() {
  if (started) return;
  if (!chrome.webNavigation || !chrome.webNavigation.onCommitted) return;
  started = true;
  try {
    chrome.webNavigation.onCommitted.addListener(onCommitted);
  } catch {}
  try {
    if (chrome.tabs && chrome.tabs.onActivated) chrome.tabs.onActivated.addListener(onTabActivated);
  } catch {}
  try {
    if (chrome.tabs && chrome.tabs.onUpdated) chrome.tabs.onUpdated.addListener(onTabUpdated);
  } catch {}
}
