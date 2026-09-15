"""Round 2 of the dialog fix: answer an already-open dialog BEFORE anything renderer-bound.

Reproduced problem
------------------
With the native `beforeunload` dialog open, `web_dialog_rule` still timed out after 45s.
The reason is ordering: the old body ran `attachCdp()` first, which sends
`Target.setAutoAttach` and `Page.enable` - both of which can wait on the renderer, and the
renderer is blocked while a modal dialog is up. So the call never reached the part that
answers the dialog.

Fix
---
Answer the dialog first, with a bare `chrome.debugger.attach` (browser process only) and a
time-boxed `Page.handleJavaScriptDialog`, then do the bookkeeping and the rule.
"""

from __future__ import annotations

import sys
from pathlib import Path

REPO = Path(r"D:\Local SEO\Site\Khizar\screensync_flutter_mcp_project")
NET = REPO / "extension" / "lib" / "web-adv-net.js"

NEW_FUNCTION = """export async function cdpDialogRule(tab, args = {}) {
  const target = { tabId: tab.id };
  const action = String(args.action || args.rule || 'dismiss').toLowerCase();
  if (action === 'clear') {
    activeDialogRules.delete(tab.id);
    await detachCdp(tab);
    return { ok: true, data: { dialogRule: 'cleared', tabId: tab.id } };
  }

  // Answer a dialog that is ALREADY open before anything else. While a native dialog is
  // up the renderer is blocked, so Target.setAutoAttach and Page.enable can hang and the
  // call dies on the caller's timeout - which is exactly how a stuck beforeunload used to
  // present. A bare attach plus a time-boxed Page.handleJavaScriptDialog is handled by the
  // browser process, so it cannot hang.
  let clearedOpenDialog = false;
  try {
    await chrome.debugger.attach(target, '1.3').catch((e) => {
      if (!/already attached/i.test(String((e && e.message) || e))) throw e;
    });
    await Promise.race([
      chrome.debugger.sendCommand(target, 'Page.handleJavaScriptDialog', { accept: action === 'accept' }),
      new Promise((_res, rej) => setTimeout(() => rej(new Error('dialog answer timed out')), 4000)),
    ]);
    clearedOpenDialog = true;
  } catch (_err) {
    // No dialog open, or the page cannot answer. Not fatal: the rule below still applies
    // to the next dialog that opens.
  }

  const attachRes = await attachCdp(tab);
  if (!attachRes.ok) return attachRes;
  try {
    await chrome.debugger.sendCommand(target, 'Page.enable');
    activeDialogRules.set(tab.id, {
      rule: action,
      promptText: args.promptText || '',
    });
    return {
      ok: true,
      data: { dialogRule: action, promptText: args.promptText || null, clearedOpenDialog },
    };
  } catch (err) {
    await detachCdp(tab);
    return { ok: false, error: `CDP dialog rule error: ${String((err && err.message) || err)}` };
  }
}
"""


def main() -> int:
    text = NET.read_text(encoding="utf-8")
    start = text.find("export async function cdpDialogRule(")
    if start < 0:
        print("[ERROR] cdpDialogRule not found")
        return 1
    end = text.find("\n}\n", start)
    if end < 0:
        print("[ERROR] end of cdpDialogRule not found")
        return 1
    end += len("\n}\n")
    old = text[start:end]
    print("old function: %d chars, %d lines" % (len(old), old.count("\n")))
    text = text[:start] + NEW_FUNCTION + text[end:]
    NET.write_bytes(text.encode("utf-8"))
    print("rewrote cdpDialogRule -> %d chars" % len(NEW_FUNCTION))
    return 0


if __name__ == "__main__":
    sys.exit(main())
