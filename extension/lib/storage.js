import { DEFAULT_TOKEN } from './constants.js';

const DEFAULTS = {
  hubUrl: 'http://127.0.0.1:3000',
  token: DEFAULT_TOKEN,
  onboardingComplete: true,
  webAccessEnabled: true,
  setupGuideCache: null,
  setupGuideFetchedAt: null,
};

export function getSettings() {
  return chrome.storage.sync.get(DEFAULTS);
}

export async function saveSettings(patch) {
  await chrome.storage.sync.set(patch);
  return getSettings();
}
