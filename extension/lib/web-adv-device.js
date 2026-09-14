// ScreenSync Device Emulation Unit — Playwright devices / viewport / UA parity
// Uses the SHARED refcounted CDP lifecycle (web-adv.js attachCdp/detachCdp) and
// keeps the debugger session alive while an emulation is active — Chromium
// clears Emulation.* overrides when the debugger detaches, so persistence
// requires holding the session until web_resize/web_set_user_agent clear it.

import { attachCdp, detachCdp, activeEmulations } from './web-adv-core.js';

const DEVICE_PRESETS = {
  iphone_se: { width: 375, height: 667, dpr: 2, mobile: true, touch: true, ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1' },
  iphone_15: { width: 393, height: 852, dpr: 3, mobile: true, touch: true, ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1' },
  iphone_15_pro_max: { width: 430, height: 932, dpr: 3, mobile: true, touch: true, ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1' },
  pixel_7: { width: 412, height: 915, dpr: 2.625, mobile: true, touch: true, ua: 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36' },
  pixel_8: { width: 412, height: 915, dpr: 2.625, mobile: true, touch: true, ua: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36' },
  galaxy_s24: { width: 384, height: 832, dpr: 3, mobile: true, touch: true, ua: 'Mozilla/5.0 (Linux; Android 14; SM-S921B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36' },
  ipad_mini: { width: 768, height: 1024, dpr: 2, mobile: true, touch: true, ua: 'Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1' },
  ipad_pro: { width: 1024, height: 1366, dpr: 2, mobile: true, touch: true, ua: 'Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1' },
  laptop_13: { width: 1280, height: 800, dpr: 1, mobile: false, touch: false, ua: null },
  desktop_1080p: { width: 1920, height: 1080, dpr: 1, mobile: false, touch: false, ua: null },
  desktop_1440p: { width: 2560, height: 1440, dpr: 1, mobile: false, touch: false, ua: null },
  desktop_4k: { width: 3840, height: 2160, dpr: 1, mobile: false, touch: false, ua: null },
};

function cdpSend(tabId, method, params = {}) {
  return chrome.debugger.sendCommand({ tabId }, method, params);
}

const origWindowBounds = new Map(); // tabId -> window bounds before device emulation resized it

async function applyViewport(tabId, { width, height, dpr, mobile, touch }) {
  await cdpSend(tabId, 'Emulation.setDeviceMetricsOverride', {
    width: Math.max(0, Math.round(width)),
    height: Math.max(0, Math.round(height)),
    deviceScaleFactor: dpr || 1,
    mobile: !!mobile,
  });
  if (touch) {
    await cdpSend(tabId, 'Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  } else {
    try { await cdpSend(tabId, 'Emulation.setTouchEmulationEnabled', { enabled: false }); } catch {}
  }
}

async function applyUserAgent(tabId, { userAgent, acceptLanguage, platform }) {
  const params = { userAgent };
  if (acceptLanguage) params.acceptLanguage = acceptLanguage;
  if (platform) params.platform = platform;
  // Emulation.setUserAgentOverride (not Network.*) so navigator.userAgent /
  // userAgentData are patched for the page's JS too, not just HTTP headers.
  await cdpSend(tabId, 'Emulation.setUserAgentOverride', params);
}

async function clearEmulation(tab, tabId) {
  const had = activeEmulations.get(tabId);
  try {
    await cdpSend(tabId, 'Emulation.clearDeviceMetricsOverride');
    try { await cdpSend(tabId, 'Emulation.setTouchEmulationEnabled', { enabled: false }); } catch {}
    await cdpSend(tabId, 'Emulation.setUserAgentOverride', { userAgent: navigator.userAgent });
  } catch { /* session may already be gone */ }
  activeEmulations.delete(tabId);
  if (had) await detachCdp(tab);
  // Device metrics physically resize the Chrome window in headful mode —
  // restore the bounds captured before the first emulate on this tab.
  const orig = origWindowBounds.get(tabId);
  if (orig) {
    origWindowBounds.delete(tabId);
    try {
      await chrome.windows.update(orig.windowId, {
        left: orig.left, top: orig.top, width: orig.width, height: orig.height,
        state: orig.state === 'maximized' ? 'maximized' : 'normal',
      });
    } catch { /* window may be gone */ }
  }
}

async function captureWindowBounds(tabId) {
  try {
    const tab = await chrome.tabs.get(tabId);
    if (!tab || !tab.windowId) return;
    const win = await chrome.windows.get(tab.windowId);
    origWindowBounds.set(tabId, { windowId: win.id, left: win.left, top: win.top, width: win.width, height: win.height, state: win.state });
  } catch { /* best effort */ }
}

export async function execDeviceTool(tool, tab, args) {
  const tabId = tab.id;
  switch (tool) {
    // ── web_device_emulate: Playwright device descriptors ──
    case 'web_device_emulate': {
      const name = String(args.device || '').toLowerCase();
      const preset = DEVICE_PRESETS[name];
      if (!preset) {
        return {
          ok: false,
          error: `Unknown device preset: ${name}. Available: ${Object.keys(DEVICE_PRESETS).join(', ')}.`,
        };
      }
      if (!activeEmulations.has(tabId)) await captureWindowBounds(tabId);
      const landscape = args.orientation === 'landscape';
      const spec = {
        width: landscape ? preset.height : preset.width,
        height: landscape ? preset.width : preset.height,
        dpr: preset.dpr,
        mobile: preset.mobile,
        touch: preset.touch,
      };
      const attached = await attachCdp(tab);
      if (!attached.ok) return attached;
      try {
        await applyViewport(tabId, spec);
        if (preset.ua) await applyUserAgent(tabId, { userAgent: preset.ua });
        activeEmulations.set(tabId, true);
        return {
          ok: true,
          data: {
            emulated: name, ...spec,
            userAgent: preset.ua || '(native desktop UA)',
            viewport: { width: spec.width, height: spec.height, deviceScaleFactor: spec.dpr, isMobile: spec.mobile, hasTouch: spec.touch },
            note: 'Override persists for this tab (across navigations) until web_resize {clear:true} or tab close.',
          },
        };
      } catch (e) {
        return { ok: false, error: `Device emulation failed: ${String((e && e.message) || e)}` };
      }
    }

    // ── web_resize: Playwright viewport.setViewportSize ──
    case 'web_resize': {
      if (args.clear === true) {
        const attached = await attachCdp(tab);
        if (!attached.ok) return attached;
        await clearEmulation(tab, tabId);
        return { ok: true, data: { cleared: true, message: 'Device metrics + UA overrides cleared; the tab uses its real viewport and identity again.' } };
      }
      const width = Number(args.width);
      const height = Number(args.height);
      if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) {
        return { ok: false, error: 'web_resize requires positive width and height (or clear:true).' };
      }
      if (!activeEmulations.has(tabId)) await captureWindowBounds(tabId);
      const attached = await attachCdp(tab);
      if (!attached.ok) return attached;
      const spec = { width, height, dpr: Number(args.deviceScaleFactor) || 1, mobile: args.mobile === true, touch: args.hasTouch === true };
      try {
        await applyViewport(tabId, spec);
        activeEmulations.set(tabId, true);
        return { ok: true, data: { resized: { width: spec.width, height: spec.height, deviceScaleFactor: spec.dpr, isMobile: spec.mobile, hasTouch: spec.touch } } };
      } catch (e) {
        return { ok: false, error: `Resize failed: ${String((e && e.message) || e)}` };
      }
    }

    // ── web_set_user_agent: Playwright userAgent override ──
    case 'web_set_user_agent': {
      const attached = await attachCdp(tab);
      if (!attached.ok) return attached;
      if (args.clear === true) {
        await clearEmulation(tab, tabId);
        return { ok: true, data: { cleared: true, userAgent: navigator.userAgent } };
      }
      const userAgent = String(args.userAgent || '');
      if (!userAgent.trim()) return { ok: false, error: 'web_set_user_agent requires userAgent (or clear:true).' };
      try {
        await applyUserAgent(tabId, { userAgent, acceptLanguage: args.acceptLanguage, platform: args.platform });
        activeEmulations.set(tabId, true);
        return { ok: true, data: { userAgent, acceptLanguage: args.acceptLanguage || undefined, platform: args.platform || undefined, persistsAcrossNavigations: true } };
      } catch (e) {
        return { ok: false, error: `UA override failed: ${String((e && e.message) || e)}` };
      }
    }

    default:
      return { ok: false, error: `Unknown device tool: ${tool}` };
  }
}

export function listDevicePresets() {
  return Object.fromEntries(Object.entries(DEVICE_PRESETS).map(([k, v]) => [k, { width: v.width, height: v.height, dpr: v.dpr, mobile: v.mobile, touch: v.touch }]));
}
