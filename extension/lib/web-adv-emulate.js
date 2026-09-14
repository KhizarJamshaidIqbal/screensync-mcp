// ScreenSync CDP emulation executors — viewport/geo/network emulation,
// permissions, timezone, network throttling, color scheme overrides.
import { rawAttach, rawDetach, attachCdp, detachCdp, activeEmulations } from './web-adv-core.js';

export async function cdpEmulate(tab, args = {}) {
  const target = { tabId: tab.id };
  const attached = await attachCdp(tab);
  if (!attached.ok) return attached;
  try {
    if (args.clear === true) {
      try {
        await chrome.debugger.sendCommand(target, 'Emulation.clearDeviceMetricsOverride');
        await chrome.debugger.sendCommand(target, 'Emulation.clearGeolocationOverride');
        await chrome.debugger.sendCommand(target, 'Emulation.setEmulatedMedia', { media: '' });
        await chrome.debugger.sendCommand(target, 'Network.emulateNetworkConditions', {
          offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1,
        });
      } catch {}
      activeEmulations.delete(tab.id);
      await detachCdp(tab);
      return { ok: true, data: { cleared: true } };
    }
    const applied = {};
    if (args.width && args.height) {
      await chrome.debugger.sendCommand(target, 'Emulation.setDeviceMetricsOverride', {
        width: Number(args.width),
        height: Number(args.height),
        deviceScaleFactor: Number(args.deviceScaleFactor) || 1,
        mobile: Boolean(args.mobile),
      });
      applied.viewport = { width: args.width, height: args.height, mobile: Boolean(args.mobile) };
    }
    if (args.colorScheme) {
      await chrome.debugger.sendCommand(target, 'Emulation.setEmulatedMedia', {
        media: 'screen',
        features: [{ name: 'prefers-color-scheme', value: args.colorScheme }],
      });
      applied.colorScheme = args.colorScheme;
    }
    if (args.latitude !== undefined && args.longitude !== undefined) {
      await chrome.debugger.sendCommand(target, 'Emulation.setGeolocationOverride', {
        latitude: Number(args.latitude),
        longitude: Number(args.longitude),
        accuracy: Number(args.accuracy) || 100,
      });
      applied.geolocation = { latitude: args.latitude, longitude: args.longitude };
    }
    if (args.offline !== undefined || args.networkType) {
      await chrome.debugger.sendCommand(target, 'Network.enable', {});
      let latency = 0;
      let download = -1;
      let upload = -1;
      const net = String(args.networkType || '').toLowerCase();
      if (args.offline || net === 'offline') {
        latency = 0; download = 0; upload = 0;
      } else if (net === 'slow3g') {
        latency = 400; download = ((400 * 1024) / 8); upload = ((400 * 1024) / 8);
      } else if (net === 'fast3g') {
        latency = 100; download = ((1.6 * 1024 * 1024) / 8); upload = ((750 * 1024) / 8);
      } else if (net === '4g') {
        latency = 20; download = ((20 * 1024 * 1024) / 8); upload = ((10 * 1024 * 1024) / 8);
      }
      await chrome.debugger.sendCommand(target, 'Network.emulateNetworkConditions', {
        offline: Boolean(args.offline || net === 'offline'),
        latency,
        downloadThroughput: download,
        uploadThroughput: upload,
      });
      applied.network = { offline: Boolean(args.offline || net === 'offline'), type: net || 'custom' };
    }
    activeEmulations.set(tab.id, true);
    return { ok: true, data: { emulated: true, applied, url: tab.url, note: 'Emulation active on this tab until clear:true or tab close.' } };
  } catch (err) {
    activeEmulations.delete(tab.id);
    await detachCdp(tab);
    return { ok: false, error: `CDP emulation error: ${String((err && err.message) || err)}` };
  }
}

export async function cdpGrantPermissions(tab, args = {}) {
  const permissions = Array.isArray(args.permissions) ? args.permissions : [args.permission || 'geolocation'];
  const origin = args.origin || (tab.url ? new URL(tab.url).origin : undefined);

  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    world: 'MAIN',
    func: (perms) => {
      const origQuery = navigator.permissions && navigator.permissions.query;
      if (origQuery) {
        navigator.permissions.query = function (param) {
          if (param && perms.includes(param.name)) {
            return Promise.resolve({ state: 'granted', onchange: null });
          }
          return origQuery.call(this, param);
        };
      }
    },
    args: [permissions],
  }).catch(() => {});

  if (permissions.includes('geolocation')) {
    const target = { tabId: tab.id };
    try {
      await rawAttach(target);
    } catch (e) {
      if (!/already attached/i.test(String((e && e.message) || e))) {
        // ignore
      }
    }
    try {
      await chrome.debugger.sendCommand(target, 'Emulation.setGeolocationOverride', {
        latitude: Number(args.latitude) || 31.5204,
        longitude: Number(args.longitude) || 74.3587,
        accuracy: 100,
      });
      activeEmulations.set(tab.id, true);
    } catch {}
  }

  return { ok: true, data: { granted: permissions, origin: origin || 'activeTab' } };
}

export async function cdpSetTimezone(tab, args = {}) {
  const target = { tabId: tab.id };
  const attached = await attachCdp(tab);
  if (!attached.ok) return attached;
  try {
    if (args.clear === true) {
      await chrome.debugger.sendCommand(target, 'Emulation.setTimezoneOverride', { timezoneId: '' });
      activeEmulations.delete(tab.id);
      await detachCdp(tab);
      return { ok: true, data: { cleared: true } };
    }
    const timezoneId = String(args.timezoneId || args.timezone || 'Asia/Karachi');
    await chrome.debugger.sendCommand(target, 'Emulation.setTimezoneOverride', { timezoneId });
    activeEmulations.set(tab.id, true);
    return { ok: true, data: { timezoneId, note: 'Timezone override active until clear:true or tab close.' } };
  } catch (err) {
    activeEmulations.delete(tab.id);
    await detachCdp(tab);
    return { ok: false, error: `CDP timezone error: ${String((err && err.message) || err)}` };
  }
}

export async function cdpSetGeolocation(tab, args = {}) {
  const target = { tabId: tab.id };
  const attached = await attachCdp(tab);
  if (!attached.ok) return attached;
  try {
    if (args.clear) {
      await chrome.debugger.sendCommand(target, 'Emulation.clearGeolocationOverride', {});
      activeEmulations.delete(tab.id);
      await detachCdp(tab);
      return { ok: true, data: { cleared: true } };
    }
    const latitude = Number(args.latitude ?? 37.7749);
    const longitude = Number(args.longitude ?? -122.4194);
    const accuracy = Number(args.accuracy ?? 100);
    await chrome.debugger.sendCommand(target, 'Emulation.setGeolocationOverride', {
      latitude,
      longitude,
      accuracy,
    });
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: 'MAIN',
      func: (lat, lng, acc) => {
        if (navigator.geolocation) {
          navigator.geolocation.getCurrentPosition = (success) => {
            if (success) success({
              coords: { latitude: lat, longitude: lng, accuracy: acc, altitude: null, altitudeAccuracy: null, heading: null, speed: null },
              timestamp: Date.now(),
            });
          };
        }
      },
      args: [latitude, longitude, accuracy],
    }).catch(() => {});
    activeEmulations.set(tab.id, true);
    return { ok: true, data: { latitude, longitude, accuracy, note: 'Geolocation override active until clear:true.' } };
  } catch (err) {
    activeEmulations.delete(tab.id);
    await detachCdp(tab);
    return { ok: false, error: `CDP setGeolocation error: ${String((err && err.message) || err)}` };
  }
}

export async function cdpThrottleNetwork(tab, args = {}) {
  const target = { tabId: tab.id };
  const attached = await attachCdp(tab);
  if (!attached.ok) return attached;
  try {
    await chrome.debugger.sendCommand(target, 'Network.enable', {});
    const preset = String(args.preset || args.condition || '').toLowerCase();
    let offline = !!args.offline;
    let latency = Number(args.latency ?? 0);
    let downloadThroughput = Number(args.downloadThroughput ?? -1);
    let uploadThroughput = Number(args.uploadThroughput ?? -1);
    const isClear = preset === 'none' || preset === 'online' || preset === 'clear' || args.clear === true;

    if (preset === 'offline') {
      offline = true;
      latency = 0;
      downloadThroughput = 0;
      uploadThroughput = 0;
    } else if (preset === 'slow3g' || preset === 'slow_3g') {
      offline = false;
      latency = 400;
      downloadThroughput = (400 * 1024) / 8;
      uploadThroughput = (400 * 1024) / 8;
    } else if (preset === 'fast3g' || preset === 'fast_3g') {
      offline = false;
      latency = 150;
      downloadThroughput = (1.6 * 1024 * 1024) / 8;
      uploadThroughput = (750 * 1024) / 8;
    } else if (isClear) {
      offline = false;
      latency = 0;
      downloadThroughput = -1;
      uploadThroughput = -1;
    }

    await chrome.debugger.sendCommand(target, 'Network.emulateNetworkConditions', {
      offline,
      latency,
      downloadThroughput,
      uploadThroughput,
    });
    if (isClear) {
      activeEmulations.delete(tab.id);
      await detachCdp(tab);
    } else {
      activeEmulations.set(tab.id, true);
    }
    return {
      ok: true,
      data: {
        preset: preset || 'custom',
        offline,
        latencyMs: latency,
        downloadThroughputKbps: downloadThroughput > 0 ? Math.round((downloadThroughput * 8) / 1024) : 'unlimited',
        uploadThroughputKbps: uploadThroughput > 0 ? Math.round((uploadThroughput * 8) / 1024) : 'unlimited',
        active: !isClear,
      },
    };
  } catch (err) {
    activeEmulations.delete(tab.id);
    await detachCdp(tab);
    return { ok: false, error: `CDP throttleNetwork error: ${String((err && err.message) || err)}` };
  }
}

// ── web_emulate_media: Playwright page.emulateMedia parity — media type +
// prefers-reduced-motion / forced-colors / prefers-contrast feature overrides ──
export async function cdpEmulateMedia(tab, args = {}) {
  const target = { tabId: tab.id };
  const attached = await attachCdp(tab);
  if (!attached.ok) return attached;
  try {
    const params = { media: args.media !== undefined ? String(args.media) : '' };
    const features = [];
    if (args.reducedMotion) features.push({ name: 'prefers-reduced-motion', value: String(args.reducedMotion) });
    if (args.forcedColors) features.push({ name: 'forced-colors', value: String(args.forcedColors) });
    if (args.contrast) features.push({ name: 'prefers-contrast', value: String(args.contrast) });
    if (args.colorScheme) features.push({ name: 'prefers-color-scheme', value: String(args.colorScheme) });
    if (features.length) params.features = features;
    await chrome.debugger.sendCommand(target, 'Emulation.setEmulatedMedia', params);
    const hasOverrides = Boolean(params.media || features.length);
    if (hasOverrides) {
      activeEmulations.set(tab.id, true);
    } else {
      activeEmulations.delete(tab.id);
      await detachCdp(tab);
    }
    return {
      ok: true,
      data: {
        media: params.media || '(none)',
        features,
        note: 'Media emulation active on this tab. Reset by calling again with media set to an empty string and no features.',
      },
    };
  } catch (err) {
    activeEmulations.delete(tab.id);
    await detachCdp(tab);
    return { ok: false, error: 'web_emulate_media failed: ' + String((err && err.message) || err) };
  }
}

export async function cdpSetColorScheme(tab, args = {}) {
  const target = { tabId: tab.id };
  const attached = await attachCdp(tab);
  if (!attached.ok) return attached;
  try {
    const colorScheme = String(args.colorScheme || args.scheme || 'dark').toLowerCase();
    const valid = ['dark', 'light', 'no-preference'];
    const chosen = valid.includes(colorScheme) ? colorScheme : 'dark';
    await chrome.debugger.sendCommand(target, 'Emulation.setEmulatedMedia', {
      media: '',
      features: [{ name: 'prefers-color-scheme', value: chosen }],
    });
    activeEmulations.set(tab.id, true);
    return { ok: true, data: { colorScheme: chosen } };
  } catch (err) {
    activeEmulations.delete(tab.id);
    await detachCdp(tab);
    return { ok: false, error: `CDP setColorScheme error: ${String((err && err.message) || err)}` };
  }
}

