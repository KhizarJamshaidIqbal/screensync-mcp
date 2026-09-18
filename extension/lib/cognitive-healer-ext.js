// ScreenSync Extension Cognitive Healer (AP-CE Tier 3 Client Parity)
// In-tab semantic candidate locator and auto-healing dispatch

export function findDomSemanticCandidate(failingSelector, intent = 'general') {
  if (typeof document === 'undefined') return null;

  const isTextInput =
    /textarea|input|editor|compose|tweet|text/i.test(failingSelector) ||
    /post|comment|compose|message/i.test(intent);

  const isButton =
    /button|submit|send|tweetButton|publish/i.test(failingSelector) ||
    /submit|click|publish/i.test(intent);

  // 1. Text input recovery
  if (isTextInput) {
    const candidates = Array.from(
      document.querySelectorAll('div[role="textbox"], div[contenteditable="true"], textarea, input[type="text"]')
    );
    for (const el of candidates) {
      if (el.offsetParent !== null) {
        // Visible in DOM
        const testId = el.getAttribute('data-testid');
        if (testId) return `div[data-testid="${testId}"]`;
        if (el.id) return `#${el.id}`;
        if (el.getAttribute('role') === 'textbox') return 'div[role="textbox"]';
        if (el.tagName.toLowerCase() === 'textarea') return 'textarea';
      }
    }
  }

  // 2. Button recovery
  if (isButton) {
    const candidates = Array.from(
      document.querySelectorAll('button, div[role="button"]')
    );
    for (const el of candidates) {
      if (el.offsetParent !== null) {
        const testId = el.getAttribute('data-testid');
        if (testId) return `button[data-testid="${testId}"]`;
        if (el.id) return `#${el.id}`;
      }
    }
  }

  return null;
}
