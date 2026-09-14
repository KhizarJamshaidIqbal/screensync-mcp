// ScreenSync Handle Registry & ExposeFunction Engine (P10)
// Provides Playwright evaluateHandle and exposeFunction parity in the browser DOM.
// Self-contained execution unit for multi-step DOM reference tracking.

/**
 * Page-side executor for DOM handle registry and function binding.
 * Completely self-contained function for chrome.scripting.executeScript.
 * @param {Record<string, any>} args
 */
export function pageHandleExecutor(args) {
  const G = window;
  G.__ssHandles = G.__ssHandles || new Map();
  G.__ssHandleSeq = G.__ssHandleSeq || 0;
  G.__ssExposedFns = G.__ssExposedFns || new Set();

  const action = String(args.action || 'create').toLowerCase();

  // 1. Create Handle: evaluates code or selector, stores raw DOM reference
  if (action === 'create' || action === 'evaluatehandle') {
    let target = null;
    if (args.selector) {
      target = document.querySelector(args.selector);
      if (!target) return { ok: false, error: 'Selector not found for handle: ' + args.selector };
    } else if (args.code) {
      try {
        const fn = new Function('document', 'window', '"use strict"; return (' + args.code + ');');
        target = fn(document, window);
      } catch (e) {
        return { ok: false, error: 'Handle evaluation failed: ' + String((e && e.message) || e) };
      }
    } else {
      return { ok: false, error: 'web_handle {action:"create"} requires selector or code.' };
    }

    const handleId = 'handle_' + (++G.__ssHandleSeq) + '_' + Math.random().toString(36).slice(2, 7);
    const isEl = target instanceof Element;
    G.__ssHandles.set(handleId, {
      id: handleId,
      ref: target,
      createdAt: Date.now(),
      isElement: isEl,
    });

    const info = {
      handleId,
      type: typeof target,
      isElement: isEl,
      tagName: isEl ? target.tagName.toLowerCase() : undefined,
      id: isEl ? target.id || undefined : undefined,
      className: isEl ? target.className || undefined : undefined,
      text: isEl ? (target.innerText || target.textContent || '').trim().slice(0, 100) : undefined,
    };
    return { ok: true, data: info };
  }

  // 2. Eval on Handle: executes function passing the handle as argument
  if (action === 'eval' || action === 'evaluate') {
    const handleId = String(args.handleId || '');
    const entry = G.__ssHandles.get(handleId);
    if (!entry) return { ok: false, error: 'Handle not found or expired: ' + handleId };
    const code = String(args.code || '');
    if (!code) return { ok: false, error: 'web_handle eval requires code.' };

    try {
      const fn = new Function('handle', 'document', 'window', '"use strict"; return (' + code + ')(handle);');
      const res = fn(entry.ref, document, window);
      return { ok: true, data: { result: res === undefined ? null : res } };
    } catch (e) {
      return { ok: false, error: 'Eval on handle failed: ' + String((e && e.message) || e) };
    }
  }

  // 3. Get / Inspect Handle
  if (action === 'get') {
    const handleId = String(args.handleId || '');
    const entry = G.__ssHandles.get(handleId);
    if (!entry) return { ok: false, error: 'Handle not found: ' + handleId };
    const target = entry.ref;
    const isEl = entry.isElement;
    return {
      ok: true,
      data: {
        handleId,
        isElement: isEl,
        type: typeof target,
        tagName: isEl ? target.tagName.toLowerCase() : undefined,
        attributes: isEl ? Array.from(target.attributes || []).map(a => ({ name: a.name, value: a.value })) : undefined,
        text: isEl ? (target.innerText || target.textContent || '').slice(0, 500) : undefined,
        value: isEl && 'value' in target ? target.value : undefined,
        childCount: isEl ? target.children.length : undefined,
      },
    };
  }

  // 4. Dispose Handle
  if (action === 'dispose') {
    const handleId = String(args.handleId || '');
    const deleted = G.__ssHandles.delete(handleId);
    return { ok: true, data: { disposed: deleted, handleId } };
  }

  // 5. List Handles
  if (action === 'list') {
    const list = [];
    for (const [id, val] of G.__ssHandles.entries()) {
      list.push({ handleId: id, isElement: val.isElement, createdAt: val.createdAt });
    }
    return { ok: true, data: { handles: list, count: list.length } };
  }

  // 6. Expose Function (Playwright page.exposeFunction parity)
  if (action === 'exposefunction' || action === 'expose') {
    const name = String(args.name || '').trim();
    if (!name || !/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(name)) {
      return { ok: false, error: 'Valid JS function name required for exposeFunction.' };
    }
    if (G.__ssExposedFns.has(name)) {
      return { ok: true, data: { exposed: true, name, alreadyExposed: true } };
    }

    G[name] = function (...fnArgs) {
      const event = new CustomEvent('screensync_exposed_function', {
        detail: { name, args: fnArgs, timestamp: Date.now() },
      });
      window.dispatchEvent(event);
      return { called: true, name, args: fnArgs };
    };
    G.__ssExposedFns.add(name);

    return { ok: true, data: { exposed: true, name, callableAs: 'window.' + name } };
  }

  return { ok: false, error: 'Unknown web_handle action: ' + action + '. Supported: create, eval, get, dispose, list, exposeFunction.' };
}

/**
 * Dispatches web_handle calls into the tab's page context.
 * @param {chrome.tabs.Tab} tab
 * @param {Record<string, any>} args
 */
export async function handleWebHandle(tab, args) {
  if (!tab || !tab.id) return { ok: false, error: 'No active tab found for web_handle.' };
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: pageHandleExecutor,
      args: [args || {}],
    });
    return results?.[0]?.result || { ok: false, error: 'No response from page handle executor.' };
  } catch (e) {
    return { ok: false, error: 'web_handle execution failed: ' + String((e && e.message) || e) };
  }
}
