// ScreenSync CDP input executors — trusted input, file upload, keyboard and
// mouse combos, touch, human emulation (Bézier/Gaussian), clipboard.
import { rawAttach, rawDetach, activeFileChoosers } from './web-adv-core.js';
import { ssWebUnitInteract } from './web-unit.js';
export async function cdpInput(tab, action, params = {}) {
  const target = { tabId: tab.id };
  try {
    await rawAttach(target);
  } catch (e) {
    if (!String((e && e.message) || e).includes('Already attached')) {
      return { ok: false, error: `CDP attach failed: ${String((e && e.message) || e)}` };
    }
  }
  try {
    if (action === 'click') {
      const x = Number(params.x || 0);
      const y = Number(params.y || 0);
      await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
      await new Promise((r) => setTimeout(r, 60));
      await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
      return { ok: true, data: { cdpClicked: { x, y } } };
    }
    if (action === 'type') {
      const text = String(params.text || '');
      for (const char of text) {
        if (char === '\n') {
          await chrome.debugger.sendCommand(target, 'Input.dispatchKeyEvent', { type: 'rawKeyDown', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, macCharCode: 13, unmodifiedText: '\r', text: '\r' });
          await chrome.debugger.sendCommand(target, 'Input.dispatchKeyEvent', { type: 'char', text: '\r', unmodifiedText: '\r' });
          await chrome.debugger.sendCommand(target, 'Input.dispatchKeyEvent', { type: 'keyUp', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, macCharCode: 13, unmodifiedText: '\r', text: '\r' });
        } else {
          await chrome.debugger.sendCommand(target, 'Input.dispatchKeyEvent', { type: 'keyDown', text: char, unmodifiedText: char });
          await chrome.debugger.sendCommand(target, 'Input.dispatchKeyEvent', { type: 'keyUp' });
        }
      }
      return { ok: true, data: { cdpTyped: text.length } };
    }
    return { ok: false, error: `Unknown CDP action: ${action}` };
  } catch (err) {
    return { ok: false, error: `CDP command error: ${String((err && err.message) || err)}` };
  } finally {
    await rawDetach(target);
  }
}




export async function cdpUploadFile(tab, args = {}) {
  // If base64 data was supplied, use DOM injection via ssWebUnit directly
  if (args.base64Data) {
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: ssWebUnitInteract,
        args: [{ ...args, __tool: 'web_upload_file' }],
      });
      return (results && results[0] && results[0].result) || { ok: false, error: 'File upload script returned no result.' };
    } catch (e) {
      return { ok: false, error: `File injection error: ${String((e && e.message) || e)}` };
    }
  }

  // Otherwise, use CDP DOM.setFileInputFiles for native absolute file paths on disk
  const target = { tabId: tab.id };
  let attached = false;
  try {
    await rawAttach(target);
    attached = true;
  } catch (e) {
    if (String((e && e.message) || e).includes('Already attached')) attached = true;
    else return { ok: false, error: `CDP attach failed: ${String((e && e.message) || e)}` };
  }
  try {
    const files = Array.isArray(args.files) ? args.files : [String(args.filePath || args.file || '')];
    const pendingChooser = activeFileChoosers.get(tab.id);
    if (pendingChooser && pendingChooser.backendNodeId && (!args.selector || args.selector === 'input[type="file"]')) {
      activeFileChoosers.delete(tab.id);
      try {
        await chrome.debugger.sendCommand(target, 'DOM.setFileInputFiles', {
          backendNodeId: pendingChooser.backendNodeId,
          files,
        });
        return { ok: true, data: { uploadedFiles: files, via: 'intercepted_file_chooser', backendNodeId: pendingChooser.backendNodeId } };
      } catch {}
    }

    await chrome.debugger.sendCommand(target, 'DOM.enable', {});
    const doc = await chrome.debugger.sendCommand(target, 'DOM.getDocument', {});
    const selector = String(args.selector || 'input[type="file"]');
    const nodeRes = await chrome.debugger.sendCommand(target, 'DOM.querySelector', {
      nodeId: doc.root.nodeId,
      selector,
    });
    if (!nodeRes || !nodeRes.nodeId) {
      return { ok: false, error: `File input element matching selector "${selector}" not found in DOM.` };
    }
    await chrome.debugger.sendCommand(target, 'DOM.setFileInputFiles', {
      nodeId: nodeRes.nodeId,
      files,
    });
    return { ok: true, data: { uploadedFiles: files, selector, nodeId: nodeRes.nodeId } };
  } catch (err) {
    return { ok: false, error: `CDP file upload error: ${String((err && err.message) || err)}` };
  } finally {
    if (attached) {
      await rawDetach(target);
    }
  }
}


export async function cdpKeyCombo(tab, args = {}) {
  const target = { tabId: tab.id };
  try { await rawAttach(target); } catch (e) {
    if (!String((e && e.message) || e).includes('Already attached')) return { ok: false, error: `CDP attach: ${e.message || e}` };
  }
  try {
    const combo = String(args.combo || args.key || '');
    if (!combo) return { ok: false, error: 'combo is required (e.g. "Control+A", "Shift+Tab").' };
    const parts = combo.split('+');
    const modifiers = { Control: 1, Alt: 2, Shift: 8, Meta: 4 };
    let modBitmask = 0;
    const mainKey = parts[parts.length - 1];
    for (let i = 0; i < parts.length - 1; i++) {
      const m = parts[i].charAt(0).toUpperCase() + parts[i].slice(1).toLowerCase();
      if (modifiers[m]) modBitmask |= modifiers[m];
      await chrome.debugger.sendCommand(target, 'Input.dispatchKeyEvent', { type: 'rawKeyDown', key: m, modifiers: modBitmask });
    }
    await chrome.debugger.sendCommand(target, 'Input.dispatchKeyEvent', { type: 'rawKeyDown', key: mainKey, modifiers: modBitmask });
    await chrome.debugger.sendCommand(target, 'Input.dispatchKeyEvent', { type: 'keyUp', key: mainKey, modifiers: modBitmask });
    for (let i = parts.length - 2; i >= 0; i--) {
      const m = parts[i].charAt(0).toUpperCase() + parts[i].slice(1).toLowerCase();
      modBitmask &= ~(modifiers[m] || 0);
      await chrome.debugger.sendCommand(target, 'Input.dispatchKeyEvent', { type: 'keyUp', key: m, modifiers: modBitmask });
    }
    return { ok: true, data: { combo, pressed: true } };
  } finally {
    await rawDetach(target);
  }
}


export async function cdpMouse(tab, args = {}) {
  const target = { tabId: tab.id };
  try { await rawAttach(target); } catch (e) {
    if (!String((e && e.message) || e).includes('Already attached')) return { ok: false, error: `CDP attach: ${e.message || e}` };
  }
  try {
    const action = String(args.action || 'click');
    const x = Number(args.x || 100);
    const y = Number(args.y || 100);
    const button = args.button || 'left';

    if (action === 'move') {
      await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
      return { ok: true, data: { action: 'move', x, y } };
    }
    if (action === 'down') {
      await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button, clickCount: 1 });
      return { ok: true, data: { action: 'down', x, y, button } };
    }
    if (action === 'up') {
      await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button, clickCount: 1 });
      return { ok: true, data: { action: 'up', x, y, button } };
    }
    if (action === 'dblclick') {
      await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
      await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
      await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 2 });
      await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 2 });
      return { ok: true, data: { action: 'dblclick', x, y } };
    }
    if (action === 'wheel') {
      const deltaX = Math.round(Number(args.deltaX || 0));
      const deltaY = Math.round(Number(args.deltaY || 120));
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: (dx, dy) => { window.scrollBy({ left: dx, top: dy, behavior: 'smooth' }); },
        args: [deltaX, deltaY],
      }).catch(() => {});
      return { ok: true, data: { action: 'wheel', x, y, deltaX, deltaY } };
    }
    if (action === 'contextmenu' || action === 'right-click') {
      await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'right', clickCount: 1 });
      await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'right', clickCount: 1 });
      return { ok: true, data: { action: 'contextmenu', x, y } };
    }
    // default click
    await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button, clickCount: 1 });
    await new Promise((r) => setTimeout(r, 50));
    await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button, clickCount: 1 });
    return { ok: true, data: { action: 'click', x, y, button } };
  } catch (err) {
    return { ok: false, error: `CDP mouse error: ${String((err && err.message) || err)}` };
  } finally {
    await rawDetach(target);
  }
}


export async function cdpTouch(tab, args = {}) {
  const action = String(args.action || 'tap');
  const x = Number(args.x || 100);
  const y = Number(args.y || 100);

  if (action === 'tap') {
    const res = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: (tx, ty) => {
        const el = document.elementFromPoint(tx, ty) || document.body;
        el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        try {
          const touch = new Touch({ identifier: Date.now(), target: el, clientX: tx, clientY: ty, screenX: tx, screenY: ty, pageX: tx + window.scrollX, pageY: ty + window.scrollY });
          el.dispatchEvent(new TouchEvent('touchstart', { touches: [touch], targetTouches: [touch], changedTouches: [touch], bubbles: true, cancelable: true }));
          el.dispatchEvent(new TouchEvent('touchend', { touches: [], targetTouches: [], changedTouches: [touch], bubbles: true, cancelable: true }));
        } catch {}
        el.dispatchEvent(new PointerEvent('pointerdown', { clientX: tx, clientY: ty, pointerType: 'touch', bubbles: true }));
        el.dispatchEvent(new PointerEvent('pointerup', { clientX: tx, clientY: ty, pointerType: 'touch', bubbles: true }));
        el.click();
        return { tag: el.tagName.toLowerCase(), text: (el.innerText || el.textContent || '').trim().slice(0, 50) };
      },
      args: [x, y],
    });
    return { ok: true, data: { action: 'tap', x, y, target: res && res[0] && res[0].result } };
  }
  if (action === 'swipe') {
    const endX = Number(args.endX || x);
    const endY = Number(args.endY || (y - 150));
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: (sx, sy, ex, ey) => {
        const el = document.elementFromPoint(sx, sy) || document.body;
        try {
          const t1 = new Touch({ identifier: Date.now(), target: el, clientX: sx, clientY: sy });
          el.dispatchEvent(new TouchEvent('touchstart', { touches: [t1], targetTouches: [t1], changedTouches: [t1], bubbles: true, cancelable: true }));
          const t2 = new Touch({ identifier: Date.now(), target: el, clientX: ex, clientY: ey });
          el.dispatchEvent(new TouchEvent('touchmove', { touches: [t2], targetTouches: [t2], changedTouches: [t2], bubbles: true, cancelable: true }));
          el.dispatchEvent(new TouchEvent('touchend', { touches: [], targetTouches: [], changedTouches: [t2], bubbles: true, cancelable: true }));
        } catch {}
        window.scrollBy({ left: sx - ex, top: sy - ey, behavior: 'smooth' });
      },
      args: [x, y, endX, endY],
    });
    return { ok: true, data: { action: 'swipe', from: { x, y }, to: { x: endX, y: endY } } };
  }
  return { ok: false, error: `Unknown touch action: ${action}. Supported: tap, swipe.` };
}


export async function cdpClipboard(tab, args = {}) {
  const action = String(args.action || 'read').toLowerCase();

  try {
    const offscreenRes = await chrome.runtime.sendMessage({
      type: action === 'write' ? 'clipboard-write' : 'clipboard-read',
      text: args.text,
    });
    if (offscreenRes && offscreenRes.ok) {
      return { ok: true, data: { action, ...offscreenRes, via: 'offscreen' } };
    }
  } catch {}

  if (action === 'write') {
    const text = String(args.text || '');
    try {
      const res = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: async (val) => {
          try {
            await navigator.clipboard.writeText(val);
            return { ok: true, length: val.length };
          } catch (e) {
            const ta = document.createElement('textarea');
            ta.value = val;
            ta.style.position = 'fixed';
            ta.style.opacity = '0';
            document.body.appendChild(ta);
            ta.focus();
            ta.select();
            const copied = document.execCommand('copy');
            ta.remove();
            return { ok: copied, length: val.length, via: 'execCommand' };
          }
        },
        args: [text],
      });
      return { ok: true, data: { action: 'write', text: text.slice(0, 100), length: text.length, result: res && res[0] && res[0].result } };
    } catch (err) {
      return { ok: false, error: `Clipboard write error: ${String((err && err.message) || err)}` };
    }
  }

  if (action === 'read') {
    try {
      const res = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: async () => {
          try {
            const text = await navigator.clipboard.readText();
            return { ok: true, text };
          } catch (e) {
            return { ok: false, error: String(e.message || e) };
          }
        },
      });
      const result = res && res[0] && res[0].result;
      if (result && result.ok) {
        return { ok: true, data: { action: 'read', text: result.text, length: result.text.length } };
      }
      return { ok: false, error: result ? result.error : 'Failed to read clipboard.' };
    } catch (err) {
      return { ok: false, error: `Clipboard read error: ${String((err && err.message) || err)}` };
    }
  }

  return { ok: false, error: `Unknown clipboard action: ${action}. Supported: read, write.` };
}





