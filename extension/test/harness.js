// Minimal in-memory Chrome extension API mock for automated unit testing (Plan §6.1)

export function createChromeMock() {
  const localStorageMap = new Map();
  const syncStorageMap = new Map();

  return {
    runtime: {
      id: 'test-mock-extension-id',
      getURL: (path = '') => `chrome-extension://test-mock-extension-id/${path}`,
      getManifest: () => ({ name: 'ScreenSync MCP', version: '1.8.0' }),
      onMessage: { addListener: () => {} },
      onConnect: { addListener: () => {} },
      onInstalled: { addListener: () => {} },
      onStartup: { addListener: () => {} },
      reload: () => {},
    },
    storage: {
      local: {
        get: (keys) => {
          if (keys === null) return Promise.resolve(Object.fromEntries(localStorageMap.entries()));
          if (typeof keys === 'string') return Promise.resolve({ [keys]: localStorageMap.get(keys) });
          if (Array.isArray(keys)) {
            const out = {};
            for (const k of keys) if (localStorageMap.has(k)) out[k] = localStorageMap.get(k);
            return Promise.resolve(out);
          }
          if (typeof keys === 'object') {
            const out = { ...keys };
            for (const [k, v] of Object.entries(keys)) {
              if (localStorageMap.has(k)) out[k] = localStorageMap.get(k);
            }
            return Promise.resolve(out);
          }
          return Promise.resolve({});
        },
        set: (items) => {
          for (const [k, v] of Object.entries(items)) localStorageMap.set(k, v);
          return Promise.resolve();
        },
        _map: localStorageMap,
      },
      sync: {
        get: (keys) => {
          if (keys === null) return Promise.resolve(Object.fromEntries(syncStorageMap.entries()));
          if (typeof keys === 'string') return Promise.resolve({ [keys]: syncStorageMap.get(keys) });
          if (Array.isArray(keys)) {
            const out = {};
            for (const k of keys) if (syncStorageMap.has(k)) out[k] = syncStorageMap.get(k);
            return Promise.resolve(out);
          }
          if (typeof keys === 'object') {
            const out = { ...keys };
            for (const [k, v] of Object.entries(keys)) {
              if (syncStorageMap.has(k)) out[k] = syncStorageMap.get(k);
            }
            return Promise.resolve(out);
          }
          return Promise.resolve({});
        },
        set: (items) => {
          for (const [k, v] of Object.entries(items)) syncStorageMap.set(k, v);
          return Promise.resolve();
        },
        _map: syncStorageMap,
      },
    },
    tabs: {
      get: (id) => Promise.resolve({ id: Number(id), url: 'https://example.com', title: 'Example', status: 'complete', active: true }),
      query: () => Promise.resolve([{ id: 1, url: 'https://example.com', title: 'Example', status: 'complete', active: true }]),
      create: (opts) => Promise.resolve({ id: 2, url: opts?.url || 'about:blank', status: 'complete', active: false }),
      remove: () => Promise.resolve(),
      onUpdated: { addListener: () => {}, removeListener: () => {} },
      onRemoved: { addListener: () => {}, removeListener: () => {} },
      onReplaced: { addListener: () => {}, removeListener: () => {} },
    },
    alarms: {
      create: () => {},
      clear: () => {},
      onAlarm: { addListener: () => {} },
    },
  };
}

if (typeof globalThis.self === 'undefined') {
  globalThis.self = globalThis;
}
if (typeof globalThis.addEventListener === 'undefined') {
  globalThis.addEventListener = () => {};
}

