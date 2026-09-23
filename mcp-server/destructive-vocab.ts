// ScreenSync destructive-action vocabulary: what makes the cognitive gate call an action "destructive".
//
// It used to be one substring regex (/delete|remove|...|drop|pay|.../), so it matched INSIDE words and
// identifiers: `dropdown`, `backdrop`, `display` (pay), `removeEventListener`, `deleted`. A read-only web_eval
// that looked up `[data-nav-dropdown]` was queued for a human as destructive. It also missed code that really
// changes things without using one of the words (`.submit()`, a POST fetch, `document.cookie =`).
//
// Now there are two checks, and either one flags the action:
//   words  the text is split into words (on punctuation, and at camelCase humps) and a destructive stem must
//          START a word, at a word boundary: `deleteAccount`, `#deleteaccount`, `#buyNowButton`, `Payment`,
//          `autopay` count; a stem inside a word (`backdrop`, `display`, `undeletable`) does not, nor do the
//          look-alikes `dropdown`, `dropped`, `deleted`, `payload`, `drop-shadow`, `removeEventListener`;
//   code   a short list of JavaScript constructs that change a page, its data or the account behind it.
// When in doubt a construct stays flagged: this is a safety net and a false alarm only costs a click.
//
// The extension keeps a copy (extension/lib/destructive-vocab.js, and inline in the page-side units
// web-unit-interact.js / web-unit-action.js, which must be self-contained). extension/test/destructive_vocab.test.js
// checks that every copy carries the same three patterns below, character for character.

/** A word that STARTS with one of these is destructive (payment words also after auto-/re-/pre-/over-/up-/sur-). */
export const DESTRUCTIVE_WORD_RE = /^(?:(?:auto|re|pre|over|up|sur)?(?:pay|charg|buy)|delet|remov|destroy|terminat|drop|purchas|cancelsubscription)/;

/** ...unless it is one of these look-alikes: a state or a thing, not an action. */
export const BENIGN_WORD_RE = /^(?:dropdowns?|dropped|deleted|removed|payloads?|purchased|destroyed|terminated|charged|buyers?)$/;

/** Identifiers that contain a destructive word but do nothing destructive. Taken out before splitting. */
export const BENIGN_IDENTIFIER_RE = /(?:remove(?:All)?(?:Event)?Listeners?|drop[\s_-]?(?:shadow|down)s?)(?![a-z0-9])/gi;

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
    if (DESTRUCTIVE_WORD_RE.test(word) && !BENIGN_WORD_RE.test(word)) hit = word;
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
