// ScreenSync In-Page Help Overlay Unit
// Self-contained page-side execution unit for chrome.scripting.executeScript.
// Renders a Shadow DOM overlay for human-in-the-loop intervention.

export function ssShowHelpOverlay(args = {}) {
  const prompt = args.prompt || 'Help needed';
  const targetSelector = args.targetSelector || null;
  const helpRequestId = args.helpRequestId || `help_${Date.now()}`;
  const timeoutMs = args.timeoutMs || 60000;

  // 1. Create Shadow DOM host div, attach shadowRoot
  let host = document.getElementById('screensync-help-overlay-host');
  if (host) host.remove();
  host = document.createElement('div');
  host.id = 'screensync-help-overlay-host';
  // z-index: 2147483646
  host.style.cssText = 'position: fixed; top: 0; left: 0; width: 0; height: 0; z-index: 2147483646; overflow: visible;';
  document.body.appendChild(host);

  const shadow = host.attachShadow({ mode: 'open' });

  // 2. Build overlay HTML inside shadow
  const container = document.createElement('div');
  container.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    width: 420px;
    background: #1e293b;
    color: #f1f5f9;
    border-radius: 12px;
    box-shadow: 0 8px 32px rgba(0,0,0,0.5);
    font-family: system-ui, sans-serif;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  `;

  // 4. Title bar: "ScreenSync — Human Help Needed" with drag handle
  const titleBar = document.createElement('div');
  titleBar.style.cssText = `
    background: #334155;
    padding: 10px 16px;
    font-weight: bold;
    cursor: grab;
    user-select: none;
    display: flex;
    justify-content: space-between;
    align-items: center;
    border-bottom: 1px solid #475569;
  `;
  titleBar.innerText = 'ScreenSync — Human Help Needed';
  container.appendChild(titleBar);

  const content = document.createElement('div');
  content.style.cssText = 'padding: 16px; font-size: 14px; line-height: 1.5;';
  content.innerText = prompt;
  container.appendChild(content);

  const buttonsRow = document.createElement('div');
  buttonsRow.style.cssText = 'display: flex; justify-content: flex-end; gap: 8px; padding: 0 16px 16px 16px;';
  
  const btnCancel = document.createElement('button');
  btnCancel.innerText = 'Cancel';
  btnCancel.style.cssText = `
    background: transparent;
    border: 1px solid #64748b;
    color: #cbd5e1;
    padding: 6px 12px;
    border-radius: 6px;
    cursor: pointer;
    font-size: 14px;
  `;
  const btnDone = document.createElement('button');
  btnDone.innerText = 'Done';
  btnDone.style.cssText = `
    background: #3b82f6;
    border: none;
    color: #fff;
    padding: 6px 16px;
    border-radius: 6px;
    cursor: pointer;
    font-size: 14px;
    font-weight: bold;
  `;

  buttonsRow.appendChild(btnCancel);
  buttonsRow.appendChild(btnDone);
  container.appendChild(buttonsRow);

  const progressContainer = document.createElement('div');
  progressContainer.style.cssText = 'width: 100%; height: 4px; background: #475569;';
  const progressBar = document.createElement('div');
  progressBar.style.cssText = 'width: 100%; height: 100%; background: #3b82f6; transition: width 0.1s linear;';
  progressContainer.appendChild(progressBar);
  container.appendChild(progressContainer);

  shadow.appendChild(container);

  // Target Highlight
  if (targetSelector) {
    try {
      const el = document.querySelector(targetSelector);
      if (el) {
        const rect = el.getBoundingClientRect();
        const highlight = document.createElement('div');
        highlight.className = 'screensync-target-highlight';
        highlight.style.cssText = `
          position: fixed;
          top: ${rect.top}px;
          left: ${rect.left}px;
          width: ${rect.width}px;
          height: ${rect.height}px;
          box-shadow: 0 0 12px 4px rgba(59,130,246,0.5);
          border: 2px solid #3b82f6;
          pointer-events: none;
          z-index: 2147483645;
          border-radius: 4px;
        `;
        document.body.appendChild(highlight);
      }
    } catch {
      // Ignore selector errors
    }
  }

  // 5. Dragging
  let isDragging = false;
  let startX, startY, startLeft, startTop;
  titleBar.addEventListener('mousedown', (e) => {
    isDragging = true;
    startX = e.clientX;
    startY = e.clientY;
    const rect = container.getBoundingClientRect();
    startLeft = rect.left;
    startTop = rect.top;
    titleBar.style.cursor = 'grabbing';
  });
  document.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    container.style.right = 'auto';
    container.style.left = (startLeft + dx) + 'px';
    container.style.top = (startTop + dy) + 'px';
  });
  document.addEventListener('mouseup', () => {
    if (isDragging) {
      isDragging = false;
      titleBar.style.cursor = 'grab';
    }
  });

  // 6 & 7. Buttons
  btnDone.addEventListener('click', () => {
    document.dispatchEvent(new CustomEvent('screensync:help:done', { detail: { helpRequestId } }));
    host.remove();
    for (const el of document.querySelectorAll('.screensync-target-highlight')) el.remove();
  });
  btnCancel.addEventListener('click', () => {
    document.dispatchEvent(new CustomEvent('screensync:help:cancel', { detail: { helpRequestId } }));
    host.remove();
    for (const el of document.querySelectorAll('.screensync-target-highlight')) el.remove();
  });

  // 8. Countdown
  const startTime = Date.now();
  const timer = setInterval(() => {
    const elapsed = Date.now() - startTime;
    const remaining = Math.max(0, timeoutMs - elapsed);
    const pct = (remaining / timeoutMs) * 100;
    progressBar.style.width = pct + '%';
    
    if (remaining <= 0) {
      clearInterval(timer);
      document.dispatchEvent(new CustomEvent('screensync:help:cancel', { detail: { helpRequestId, reason: 'timeout' } }));
      host.remove();
      for (const el of document.querySelectorAll('.screensync-target-highlight')) el.remove();
    }
  }, 100);

  btnDone.addEventListener('click', () => clearInterval(timer));
  btnCancel.addEventListener('click', () => clearInterval(timer));
  
  return { helpRequestId, overlayCreated: true };
}

export function ssCheckCompletionCriteria(args = {}) {
  const { startUrl, selectorGone, selectorAppeared, formSelector } = args;
  let met = false;
  let reason = '';
  
  const currentUrl = typeof location !== 'undefined' ? location.href : '';
  if (startUrl && currentUrl !== startUrl) {
    met = true;
    reason = 'urlChanged';
  } else if (selectorGone) {
    if (typeof document !== 'undefined' && !document.querySelector(selectorGone)) {
      met = true;
      reason = 'selectorGone';
    }
  } else if (selectorAppeared) {
    if (typeof document !== 'undefined' && !!document.querySelector(selectorAppeared)) {
      met = true;
      reason = 'selectorAppeared';
    }
  } else if (formSelector) {
    const form = typeof document !== 'undefined' ? document.querySelector(formSelector) : null;
    if (!form || (form.dataset && form.dataset.ssSubmitted === 'true')) {
      met = true;
      reason = 'formSubmitted';
    }
  }

  return { met, reason, details: { currentUrl } };
}

export function ssRemoveHelpOverlay() {
  const host = document.getElementById('screensync-help-overlay-host');
  if (host) host.remove();
  const highlights = document.querySelectorAll('.screensync-target-highlight');
  for (const el of highlights) el.remove();
  return { removed: true };
}
