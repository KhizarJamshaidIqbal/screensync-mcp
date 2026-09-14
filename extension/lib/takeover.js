// ScreenSync Takeover & Hand-off Engine (Rev 4 Item D2 / A3)
// Allows an AI agent to pause and request human intervention for logins,
// 2FA, and CAPTCHAs, then cleanly resume when the user confirms completion.

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
