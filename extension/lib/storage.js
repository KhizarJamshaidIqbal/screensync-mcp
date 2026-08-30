import { DEFAULT_TOKEN } from './constants.js';

const DEFAULTS = {
  hubUrl: 'http://localhost:3000',
  token: DEFAULT_TOKEN,
  onboardingComplete: false,
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
