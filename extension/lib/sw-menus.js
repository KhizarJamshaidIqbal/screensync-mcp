// Service-worker context menus and keyboard commands, split out of background.js (500-line limit).
// installMenusAndCommands() must run at service-worker top level so the listeners exist on every wake-up;
// setupContextMenus() (re)creates the menu items on install/startup.

import { getSettings, saveSettings } from './storage.js';
import { api } from './api.js';
import { registerWebBridge } from './web-bridge.js';

const openDashboardTab = () => chrome.tabs.create({ url: chrome.runtime.getURL('pages/dashboard.html') });

export function setupContextMenus() {
  if (!chrome.contextMenus) return;
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: 'screensync-root',
      title: 'ScreenSync MCP',
      contexts: ['all'],
    });
    chrome.contextMenus.create({
      id: 'screensync-send-phone',
      parentId: 'screensync-root',
      title: 'Send text to Phone (Type)',
      contexts: ['selection'],
    });
    chrome.contextMenus.create({
      id: 'screensync-open-phone',
      parentId: 'screensync-root',
      title: 'Open link on Phone',
      contexts: ['link'],
    });
    chrome.contextMenus.create({
      id: 'screensync-sidepanel',
      parentId: 'screensync-root',
      title: 'Open ScreenSync Side Panel',
      contexts: ['page', 'action'],
    });
  });
}

/** Registers the context-menu click and keyboard-command listeners. `broadcast` reaches open pages. */
export function installMenusAndCommands({ broadcast }) {
  if (chrome.contextMenus && chrome.contextMenus.onClicked) {
    chrome.contextMenus.onClicked.addListener(async (info, tab) => {
      try {
        if (info.menuItemId === 'screensync-send-phone' && info.selectionText) {
          await api.control('type', { text: info.selectionText });
        } else if (info.menuItemId === 'screensync-open-phone' && info.linkUrl) {
          await api.control('open_url', { url: info.linkUrl });
        } else if (info.menuItemId === 'screensync-sidepanel') {
          if (chrome.sidePanel && chrome.sidePanel.open && tab) {
            chrome.sidePanel.open({ windowId: tab.windowId }).catch(() => {
              openDashboardTab();
            });
          } else {
            openDashboardTab();
          }
        }
      } catch (e) {
        console.warn('[ss] contextMenu action failed:', e);
      }
    });
  }

  if (chrome.commands && chrome.commands.onCommand) {
    chrome.commands.onCommand.addListener(async (cmd) => {
      if (cmd === 'toggle-web-access') {
        const s = await getSettings();
        const next = !s.webAccessEnabled;
        const updated = await saveSettings({ webAccessEnabled: next });
        await registerWebBridge();
        broadcast({ kind: 'settings', settings: updated });
      } else if (cmd === 'open-side-panel') {
        try {
          const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
          if (tab && chrome.sidePanel && chrome.sidePanel.open) {
            // Await, so a rejection is caught here instead of becoming an unhandled
            // promise rejection that silently drops the keyboard shortcut.
            await chrome.sidePanel.open({ windowId: tab.windowId });
          } else {
            openDashboardTab();
          }
        } catch (e) {
          console.warn('[ss] open sidepanel command failed, opening dashboard tab:', e);
          openDashboardTab();
        }
      }
    });
  }
}
