// ScreenSync Live Mutation Streaming & Smart Reactive Form Filler
// High-fidelity page DOM observers and reactive form automation for React, Vue, Angular, and vanilla web apps.

// ── 1. Live Stream Mutation Sync ──────────────────────────────────────────
export async function execLiveStreamSync(args = {}) {
  const action = String(args.action || 'start').toLowerCase();
  const [activeTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true }).catch(() => []);
  const tabId = args.tabId ? Number(args.tabId) : (activeTab ? activeTab.id : null);
  if (!tabId) return { ok: false, error: 'No active tab found for live stream sync.' };

  if (action === 'start') {
    const selector = String(args.selector || 'article, [role="article"], .tweet, .post, .message');

    const [init] = await chrome.scripting.executeScript({
      target: { tabId },
      func: (sel) => {
        window.__ssStreamItems = window.__ssStreamItems || [];
        window.__ssSeenHashes = window.__ssSeenHashes || new Set();

        if (window.__ssStreamObserver) window.__ssStreamObserver.disconnect();

        const collect = () => {
          const els = Array.from(document.querySelectorAll(sel));
          for (const el of els) {
            const text = (el.innerText || '').trim();
            if (!text) continue;
            // Simple string hash
            const hash = text.slice(0, 150) + text.length;
            if (!window.__ssSeenHashes.has(hash)) {
              window.__ssSeenHashes.add(hash);
              const link = el.querySelector('a')?.href || null;
              window.__ssStreamItems.push({
                text: text.slice(0, 500),
                url: link,
                time: new Date().toISOString(),
              });
            }
          }
        };

        collect();
        window.__ssStreamObserver = new MutationObserver(() => collect());
        window.__ssStreamObserver.observe(document.body, { childList: true, subtree: true });
        return { started: true, initialCount: window.__ssStreamItems.length };
      },
      args: [selector],
    });

    return {
      ok: true,
      data: {
        streaming: true,
        tabId,
        selector,
        initialItems: init?.result?.initialCount || 0,
      },
    };
  }

  if (action === 'poll') {
    const [pollRes] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const items = window.__ssStreamItems ? [...window.__ssStreamItems] : [];
        if (window.__ssStreamItems) window.__ssStreamItems.length = 0; // drain
        return { count: items.length, items };
      },
    });

    const result = pollRes?.result || { count: 0, items: [] };
    return { ok: true, data: { tabId, newItemsCount: result.count, items: result.items } };
  }

  if (action === 'stop') {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        if (window.__ssStreamObserver) {
          window.__ssStreamObserver.disconnect();
          delete window.__ssStreamObserver;
        }
        delete window.__ssStreamItems;
        delete window.__ssSeenHashes;
        return true;
      },
    }).catch(() => {});

    return { ok: true, data: { streaming: false, tabId } };
  }

  return { ok: false, error: `Unknown liveStreamSync action: "${action}". Supported: start, poll, stop.` };
}

// ── 2. Smart Reactive Form Auto-Filler ─────────────────────────────────────
export async function smartFormFill(args = {}) {
  const [activeTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true }).catch(() => []);
  const tabId = args.tabId ? Number(args.tabId) : (activeTab ? activeTab.id : null);
  if (!tabId) return { ok: false, error: 'No active tab found for smart form fill.' };

  const formData = args.fields && typeof args.fields === 'object' ? args.fields : {};
  if (Object.keys(formData).length === 0) {
    return { ok: false, error: 'smartFormFill requires a non-empty "fields" dictionary (e.g. {email: "...", name: "..."}).' };
  }

  const [res] = await chrome.scripting.executeScript({
    target: { tabId },
    func: (data) => {
      const inputs = Array.from(document.querySelectorAll('input:not([type="hidden"]):not([type="submit"]):not([type="button"]), textarea, select, [contenteditable="true"]'));
      const filled = [];

      for (const [key, rawVal] of Object.entries(data)) {
        const val = String(rawVal ?? '');
        const valLower = val.toLowerCase();
        const kLower = key.toLowerCase();

        // Best match search across inputs
        let matchedInput = null;
        for (const inp of inputs) {
          const name = (inp.getAttribute('name') || '').toLowerCase();
          const id = (inp.getAttribute('id') || '').toLowerCase();
          const placeholder = (inp.getAttribute('placeholder') || '').toLowerCase();
          const ariaLabel = (inp.getAttribute('aria-label') || '').toLowerCase();
          const autocomplete = (inp.getAttribute('autocomplete') || '').toLowerCase();
          let labelText = '';
          if (inp.id) {
            const l = document.querySelector(`label[for="${inp.id}"]`);
            if (l) labelText = l.innerText.toLowerCase();
          }

          if (name.includes(kLower) || id.includes(kLower) || placeholder.includes(kLower) ||
              ariaLabel.includes(kLower) || autocomplete.includes(kLower) || labelText.includes(kLower)) {
            matchedInput = inp;
            break;
          }
        }

        if (matchedInput) {
          try { matchedInput.focus(); } catch {}

          if (matchedInput.isContentEditable) {
            matchedInput.textContent = val;
            matchedInput.dispatchEvent(new InputEvent('input', { bubbles: true, data: val, inputType: 'insertText' }));
          } else if (matchedInput.tagName === 'SELECT') {
            const opts = Array.from(matchedInput.options);
            // Match option by user-provided value (or fallback to key)
            const optMatch = opts.find((o) =>
              o.value.toLowerCase() === valLower ||
              o.text.toLowerCase().includes(valLower) ||
              o.value.toLowerCase().includes(valLower)
            );
            if (optMatch) {
              matchedInput.value = optMatch.value;
              matchedInput.dispatchEvent(new Event('input', { bubbles: true }));
              matchedInput.dispatchEvent(new Event('change', { bubbles: true }));
            }
          } else if (matchedInput.type === 'checkbox' || matchedInput.type === 'radio') {
            const shouldCheck = rawVal === true || valLower === 'true' || valLower === '1' || valLower === 'yes';
            if (matchedInput.checked !== shouldCheck) {
              matchedInput.click();
            }
          } else {
            // React / Vue input tracker bypass
            const proto = matchedInput.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
            const setter = Object.getOwnPropertyDescriptor(proto, 'value');
            if (setter && setter.set) {
              setter.set.call(matchedInput, val);
            } else {
              matchedInput.value = val;
            }
            matchedInput.dispatchEvent(new Event('input', { bubbles: true }));
            matchedInput.dispatchEvent(new Event('change', { bubbles: true }));
          }

          try { matchedInput.blur(); } catch {}
          filled.push({ field: key, value: val, elementTag: matchedInput.tagName.toLowerCase() });
        }
      }

      return { totalFields: Object.keys(data).length, filledCount: filled.length, filled };
    },
    args: [formData],
  });

  return { ok: true, data: res?.result || { filledCount: 0, filled: [] } };
}
