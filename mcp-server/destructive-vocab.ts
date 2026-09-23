// ScreenSync destructive-action vocabulary: what makes the cognitive gate call an action "destructive".
//
// It used to be one substring regex (/delete|remove|...|drop|pay|.../), so it matched INSIDE words and
// identifiers: `dropdown`, `backdrop`, `display` (pay), `removeEventListener`, `deleted`. A read-only web_eval
// that looked up `[data-nav-dropdown]` was queued for a human as destructive. It also missed code that really
// changes things without using one of the words (`.submit()`, a POST fetch, `document.cookie =`).
//
// Now there are two checks, and either one flags the action:
//   words  the text is split into words (on punctuation, and at camelCase humps, so `#buyNowButton` and
//          `deletePost` still count) and a word must BE one of the destructive words, not contain one;
//   code   a short list of JavaScript constructs that change a page, its data or the account behind it.
// When in doubt a construct stays flagged: this is a safety net and a false alarm only costs a click.
//
// The extension keeps a copy (extension/lib/destructive-vocab.js, and inline in the page-side units
// web-unit-interact.js / web-unit-action.js, which must be self-contained). extension/test/destructive_vocab.test.js
// checks that every copy carries the same two patterns below, character for character.

/** One destructive word, whole. `deleted`, `dropped`, `dropdown`, `backdrop`, `undeletable` are not. */
export const DESTRUCTIVE_WORD_RE = /^(?:delet(?:e|es|ing|ion|ions)|remov(?:e|es|ing|al)|destroy(?:s|ing)?|destruction|terminat(?:e|es|ing|ion)|drop(?:s|ping)?|pay(?:s|ing|ment|ments|now|pal)?|purchas(?:e|es|ing)|buy(?:s|ing|now)?|charg(?:e|es|ing))$/;

/** Identifiers that contain a destructive word but do nothing destructive. Taken out before splitting. */
export const BENIGN_IDENTIFIER_RE = /remove(?:All)?(?:Event)?Listeners?|drop[\s_-]?shadow/gi;

/** JavaScript that changes the page, its storage, the session or the server. [label, pattern]. */
const CODE_RULES: ReadonlyArray<readonly [string, RegExp]> = [
  ["form submit", /\.\s*(?:request)?[sS]ubmit\s*\(/],
  ["click()", /\.\s*click\s*\(\s*\)/],
  ["synthetic event", /\bdispatchEvent\s*\(/],
  ["POST/PUT/PATCH/DELETE request", /\bmethod\s*:\s*['"`]\s*(?:post|put|patch|delete)\b/i],
  ["POST/PUT/PATCH/DELETE request", /\.\s*open\s*\(\s*['"`]\s*(?:post|put|patch|delete)\b/i],
  ["beacon", /\bsendBeacon\s*\(/],
  ["storage write", /\b(?:localStorage|sessionStorage)\s*\.\s*(?:clear|removeItem|setItem)\s*\(/],
  ["storage write", /\b(?:localStorage|sessionStorage)\s*\[[^\]]*\]\s*=(?!=)/],
  ["IndexedDB delete", /\bindexedDB\s*\.\s*deleteDatabase\s*\(/],
  ["cache delete", /\bcaches\s*\.\s*delete\s*\(/],
  ["cookie write", /\bdocument\s*\.\s*cookie\s*=(?!=)/],
  ["cookie write", /\bcookieStore\s*\.\s*(?:set|delete)\s*\(/],
  ["navigation", /\blocation\s*(?:\.\s*(?:href|pathname|search|hash|host|hostname|protocol))?\s*=(?!=)/],
  ["navigation", /\blocation\s*\.\s*(?:assign|replace|reload)\s*\(/],
  ["navigation", /\bhistory\s*\.\s*(?:back|forward|go)\s*\(/],
  ["window.open", /\bwindow\s*\.\s*open\s*\(/],
  ["window.close", /\bwindow\s*\.\s*close\s*\(/],
  ["DOM removal", /\.\s*(?:remove|removeChild|replaceChildren|replaceWith)\s*\(/],
  ["DOM rewrite", /\.\s*(?:innerHTML|outerHTML)\s*=(?!=)/],
  ["DOM rewrite", /\bdocument\s*\.\s*(?:write|writeln)\s*\(/],
  ["editing command", /\bexecCommand\s*\(/],
  ["SQL", /\b(?:drop|truncate)\s+(?:table|database|schema)\b/i],
  ["SQL", /\bdelete\s+from\b/i],
];

/** The words of `text`: split at punctuation and camelCase humps, lower-cased. */
function wordsOf(text: string): string[] {
  return text
    .replace(BENIGN_IDENTIFIER_RE, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/** The destructive words in `text`, each once, in order. "cancel subscription" counts as one. */
export function destructiveWords(text: string): string[] {
  const words = wordsOf(String(text ?? ""));
  const found: string[] = [];
  words.forEach((word, i) => {
    let hit: string | null = null;
    if (DESTRUCTIVE_WORD_RE.test(word)) hit = word;
    else if (word === "cancel" && /^subscriptions?$/.test(words[i + 1] ?? "")) hit = "cancel subscription";
    if (hit && !found.includes(hit)) found.push(hit);
  });
  return found;
}

/** Labels of the page-changing JavaScript constructs in `code`, each once. */
export function destructiveCode(code: string): string[] {
  const text = String(code ?? "");
  const found: string[] = [];
  for (const [label, re] of CODE_RULES) {
    if (re.test(text) && !found.includes(label)) found.push(label);
  }
  return found;
}
