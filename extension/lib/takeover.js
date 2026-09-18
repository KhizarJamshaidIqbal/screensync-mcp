// ScreenSync Takeover & Hand-off Engine (Rev 4 Item D2 / A3)
// Allows an AI agent to pause and request human intervention for logins,
// 2FA, and CAPTCHAs, then cleanly resume when the user confirms completion.

import { ssShowHelpOverlay, ssCheckCompletionCriteria, ssRemoveHelpOverlay } from './web-unit-help-overlay.js';

let activeTakeover = null; // { id, reason, message, tabId, startedAt, resolve, reject, timer }

function notifyTakeover(state) {
  try {
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
      chrome.runtime.sendMessage({ type: 'takeover_state_changed', state }).catch(() => {});
    }
  } catch {}
}

export function getTakeoverStatus() {
  if (!activeTakeover) return { active: false };
  return {
    active: true,
    id: activeTakeover.id,
    reason: activeTakeover.reason,
    message: activeTakeover.message,
    tabId: activeTakeover.tabId,
    startedAt: activeTakeover.startedAt,
    elapsedMs: Date.now() - activeTakeover.startedAt,
  };
}

export async function requestTakeover({ reason = 'login', message = 'Please log in to continue', tabId = null, timeoutMs = 300000 } = {}) {
  // If an existing takeover is running, cancel it first
  if (activeTakeover) {
    activeTakeover.resolve({ resumed: false, cancelled: true, reason: 'superseded' });
    clearTimeout(activeTakeover.timer);
    activeTakeover = null;
  }

  const id = `takeover_${Date.now()}`;
  return new Promise((resolve, reject) => {
    const takeover = {
      id,
      reason: String(reason),
      message: String(message),
      tabId,
      startedAt: Date.now(),
      resolve,
      reject,
      timer: null,
    };

    takeover.timer = setTimeout(() => {
      if (activeTakeover === takeover) {
        activeTakeover = null;
        notifyTakeover({ active: false });
        resolve({ ok: false, error: 'TAKEOVER_TIMEOUT', durationMs: timeoutMs });
      }
    }, Math.min(timeoutMs, 600000)); // up to 10 min

    activeTakeover = takeover;
    notifyTakeover(getTakeoverStatus());
  });
}

export function resumeTakeover({ userNotes = 'User completed action', success = true } = {}) {
  if (!activeTakeover) {
    return { ok: false, error: 'No active takeover in progress.' };
  }
  const current = activeTakeover;
  activeTakeover = null;
  clearTimeout(current.timer);
  const durationMs = Date.now() - current.startedAt;

  notifyTakeover({ active: false });
  current.resolve({
    ok: true,
    data: {
      resumed: true,
      reason: current.reason,
      durationMs,
      userNotes,
      success,
    },
  });

  return { ok: true, durationMs };
}

export async function execWebTakeover(tabId, args = {}) {
  const reason = String(args.reason || 'login');
  const message = String(args.message || 'Please complete human verification (login/2FA/CAPTCHA) and click Resume.');
  const timeoutMs = Number(args.timeoutMs) || 300000;
  return requestTakeover({ reason, message, tabId, timeoutMs });
}

export async function execWebRequestHelp(tabId, args = {}) {
  const prompt = args.prompt || 'Human help requested.';
  const targetSelector = args.targetSelector || null;
  const timeoutMs = args.timeoutMs || 120000;
  const completionCriteria = args.completionCriteria || null;
  
  const helpRequestId = `help_${Date.now()}`;
  
  // Inject overlay
  await chrome.scripting.executeScript({
    target: { tabId },
    func: ssShowHelpOverlay,
    args: [{ prompt, targetSelector, helpRequestId, timeoutMs }]
  });
  
  // Notification
  try {
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icon128.png',
      title: 'ScreenSync Help Needed',
      message: prompt,
      priority: 2
    });
  } catch {}
  
  return new Promise((resolve) => {
    let checkInterval = null;
    let listener = null;
    let isDone = false;
    
    const cleanup = () => {
      if (isDone) return;
      isDone = true;
      if (checkInterval) clearInterval(checkInterval);
      if (listener) chrome.runtime.onMessage.removeListener(listener);
      chrome.scripting.executeScript({
        target: { tabId },
        func: ssRemoveHelpOverlay
      }).catch(() => {});
    };

    // Need a content script relayer to relay the custom event from document to background script,
    // since CustomEvent is in page context. We can inject a small listener that sends chrome.runtime.sendMessage.
    const relayCode = (reqId) => {
      document.addEventListener('screensync:help:done', (e) => {
        if(e.detail && e.detail.helpRequestId === reqId) {
          try { chrome.runtime.sendMessage({ type: 'help_overlay_done', helpRequestId: reqId }); } catch {}
        }
      });
      document.addEventListener('screensync:help:cancel', (e) => {
        if(e.detail && e.detail.helpRequestId === reqId) {
          try { chrome.runtime.sendMessage({ type: 'help_overlay_cancel', helpRequestId: reqId, reason: e.detail.reason }); } catch {}
        }
      });
    };

    chrome.scripting.executeScript({
      target: { tabId },
      func: relayCode,
      args: [helpRequestId]
    }).catch(()=>{});
    
    listener = (msg, _sender, _sendResponse) => {
      if (msg.helpRequestId !== helpRequestId) return;
      if (msg.type === 'help_overlay_done') {
        cleanup();
        resolve({ ok: true, reason: 'user_done' });
      } else if (msg.type === 'help_overlay_cancel') {
        cleanup();
        resolve({ ok: false, error: 'USER_CANCELLED', reason: msg.reason || 'user_cancel' });
      }
    };
    chrome.runtime.onMessage.addListener(listener);
    
    if (completionCriteria) {
      checkInterval = setInterval(async () => {
        try {
          const res = await chrome.scripting.executeScript({
            target: { tabId },
            func: ssCheckCompletionCriteria,
            args: [completionCriteria]
          });
          if (res && res[0] && res[0].result && res[0].result.met) {
            cleanup();
            resolve({ ok: true, reason: 'criteria_met', details: res[0].result });
          }
        } catch {}
      }, 500);
    }
  });
}

