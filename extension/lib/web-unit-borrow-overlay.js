// ScreenSync Tab Borrow Confirmation Overlay (Phase 4)
// Self-contained page-side execution unit for chrome.scripting.executeScript.
// Shows a Shadow DOM approval overlay when an agent wants to use an existing user tab.

export function ssBorrowConfirmation(args = {}) {
  const tabTitle = String(args.tabTitle || document.title || 'this tab');
  const tabUrl = String(args.url || location.href);
  const timeoutMs = Math.min(Math.max(Number(args.timeoutMs) || 30000, 5000), 120000);
  const borrowId = String(args.borrowId || 'borrow_' + Date.now());
  const isActiveTab = args.isActiveTab !== false;

  // Remove existing overlay
  const existing = document.getElementById('screensync-borrow-overlay-host');
  if (existing) existing.remove();

  const host = document.createElement('div');
  host.id = 'screensync-borrow-overlay-host';
  host.style.cssText = 'all:initial;position:fixed;inset:0;z-index:2147483646;pointer-events:none;';
  const shadow = host.attachShadow({ mode: 'closed' });

  const startTime = Date.now();
  let resolved = false;
  let timerInterval = null;

  function resolve(allowed) {
    if (resolved) return;
    resolved = true;
    clearInterval(timerInterval);
    try { host.remove(); } catch {}
    document.dispatchEvent(new CustomEvent('screensync:borrow:result', {
      detail: { borrowId, allowed, elapsedMs: Date.now() - startTime },
    }));
  }

  // Build overlay UI
  if (isActiveTab) {
    // Full modal for active tab
    shadow.innerHTML = `
      <style>
        :host { all: initial; }
        .backdrop {
          position: fixed; inset: 0; background: rgba(0,0,0,0.4);
          display: flex; align-items: center; justify-content: center;
          pointer-events: auto; font-family: system-ui, -apple-system, sans-serif;
        }
        .modal {
          background: #1e293b; color: #f1f5f9; border-radius: 14px;
          padding: 24px 28px; max-width: 420px; width: 90%;
          box-shadow: 0 12px 40px rgba(0,0,0,0.5); text-align: center;
        }
        .icon { font-size: 36px; margin-bottom: 12px; }
        h2 { margin: 0 0 8px; font-size: 17px; font-weight: 600; color: #f8fafc; }
        .detail { font-size: 13px; color: #94a3b8; margin-bottom: 16px; line-height: 1.5; }
        .url { font-size: 11px; color: #64748b; word-break: break-all; margin-bottom: 16px; }
        .timer-bar {
          height: 4px; background: #334155; border-radius: 2px;
          margin-bottom: 18px; overflow: hidden;
        }
        .timer-fill {
          height: 100%; background: linear-gradient(90deg, #f59e0b, #ef4444);
          border-radius: 2px; transition: width 0.1s linear;
        }
        .buttons { display: flex; gap: 12px; justify-content: center; }
        button {
          padding: 10px 24px; border-radius: 8px; border: none;
          font-size: 14px; font-weight: 600; cursor: pointer; transition: all 0.15s;
        }
        .allow { background: #22c55e; color: #fff; }
        .allow:hover { background: #16a34a; }
        .deny { background: #475569; color: #e2e8f0; }
        .deny:hover { background: #64748b; }
        .countdown { font-size: 12px; color: #94a3b8; margin-top: 8px; }
      </style>
      <div class="backdrop">
        <div class="modal">
          <div class="icon">🤖</div>
          <h2>ScreenSync AI wants to use this tab</h2>
          <p class="detail">An AI agent is requesting control of <strong>"${tabTitle.replace(/"/g, '&quot;').slice(0, 80)}"</strong></p>
          <p class="url">${tabUrl.slice(0, 120)}</p>
          <div class="timer-bar"><div class="timer-fill" id="ss-timer"></div></div>
          <div class="buttons">
            <button class="allow" id="ss-allow">Allow</button>
            <button class="deny" id="ss-deny">Deny</button>
          </div>
          <div class="countdown" id="ss-countdown"></div>
        </div>
      </div>
    `;
  } else {
    // Toast notification for background tab
    shadow.innerHTML = `
      <style>
        :host { all: initial; }
        .toast {
          position: fixed; top: 16px; right: 16px; pointer-events: auto;
          background: #1e293b; color: #f1f5f9; border-radius: 12px;
          padding: 14px 18px; max-width: 340px;
          box-shadow: 0 8px 28px rgba(0,0,0,0.4);
          font-family: system-ui, -apple-system, sans-serif;
          display: flex; flex-direction: column; gap: 8px;
          animation: ss-slide-in 0.3s ease-out;
        }
        @keyframes ss-slide-in { from { transform: translateX(100%); opacity: 0; } to { transform: none; opacity: 1; } }
        .title { font-size: 13px; font-weight: 600; }
        .detail { font-size: 11px; color: #94a3b8; }
        .timer-bar { height: 3px; background: #334155; border-radius: 2px; overflow: hidden; }
        .timer-fill { height: 100%; background: #f59e0b; transition: width 0.1s linear; }
        .buttons { display: flex; gap: 8px; }
        button {
          padding: 6px 14px; border-radius: 6px; border: none;
          font-size: 12px; font-weight: 600; cursor: pointer;
        }
        .allow { background: #22c55e; color: #fff; }
        .deny { background: #475569; color: #e2e8f0; }
      </style>
      <div class="toast">
        <div class="title">🤖 AI wants to use this tab</div>
        <div class="detail">${tabTitle.slice(0, 60)}</div>
        <div class="timer-bar"><div class="timer-fill" id="ss-timer"></div></div>
        <div class="buttons">
          <button class="allow" id="ss-allow">Allow</button>
          <button class="deny" id="ss-deny">Deny</button>
        </div>
      </div>
    `;
  }

  document.body.appendChild(host);

  // Bind buttons
  const allowBtn = shadow.getElementById('ss-allow');
  const denyBtn = shadow.getElementById('ss-deny');
  const timerFill = shadow.getElementById('ss-timer');
  const countdownEl = shadow.getElementById('ss-countdown');

  if (allowBtn) allowBtn.addEventListener('click', () => resolve(true));
  if (denyBtn) denyBtn.addEventListener('click', () => resolve(false));

  // Timer countdown
  timerInterval = setInterval(() => {
    const elapsed = Date.now() - startTime;
    const remaining = Math.max(0, timeoutMs - elapsed);
    const pct = (remaining / timeoutMs) * 100;
    if (timerFill) timerFill.style.width = pct + '%';
    if (countdownEl) countdownEl.textContent = `Auto-deny in ${Math.ceil(remaining / 1000)}s`;
    if (remaining <= 0) resolve(false);
  }, 100);

  return { borrowId, overlayCreated: true, timeoutMs };
}

export function ssRemoveBorrowOverlay() {
  const host = document.getElementById('screensync-borrow-overlay-host');
  if (host) host.remove();
  return { removed: true };
}
