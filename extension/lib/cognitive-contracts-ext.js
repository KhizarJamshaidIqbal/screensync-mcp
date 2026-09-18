// ScreenSync Extension Cognitive Contracts (AP-CE Tier 1 Client Parity)
// Scans active tab for unsubmitted form fields and contenteditable text before risky navigations

export function scanDirtyFormElements() {
  if (typeof document === 'undefined') return [];
  const dirty = [];

  // 1. Inputs
  const inputs = Array.from(document.querySelectorAll('input:not([type="hidden"]):not([type="submit"]):not([type="button"])'));
  for (const el of inputs) {
    if (el.value && el.value !== el.defaultValue && el.value.trim().length > 0) {
      const sel = el.id ? `#${el.id}` : (el.getAttribute('name') ? `input[name="${el.getAttribute('name')}"]` : 'input');
      dirty.push({
        selector: sel,
        tag: 'input',
        charCount: el.value.length,
        previewText: el.value.slice(0, 30)
      });
    }
  }

  // 2. Textareas
  const textareas = Array.from(document.querySelectorAll('textarea'));
  for (const el of textareas) {
    if (el.value && el.value.trim().length > 0) {
      const sel = el.id ? `#${el.id}` : 'textarea';
      dirty.push({
        selector: sel,
        tag: 'textarea',
        charCount: el.value.length,
        previewText: el.value.slice(0, 30)
      });
    }
  }

  // 3. Contenteditables
  const editables = Array.from(document.querySelectorAll('[contenteditable="true"]'));
  for (const el of editables) {
    const text = (el.textContent || '').trim();
    if (text.length > 0) {
      const testId = el.getAttribute('data-testid');
      const sel = testId ? `[data-testid="${testId}"]` : (el.id ? `#${el.id}` : '[contenteditable="true"]');
      dirty.push({
        selector: sel,
        tag: 'contenteditable',
        charCount: text.length,
        previewText: text.slice(0, 30)
      });
    }
  }

  return dirty;
}
