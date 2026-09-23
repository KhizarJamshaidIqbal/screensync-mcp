// ScreenSync destructive-action vocabulary (extension copy of mcp-server/destructive-vocab.ts).
//
// The hub decides what the cognitive gate calls "destructive" with the same two checks: a destructive word must
// BE a word of the text (split at punctuation and camelCase humps), never sit inside one (`dropdown`, `backdrop`,
// `display`, `removeEventListener`, `deleted`); and a short list of JavaScript constructs that change a page,
// its data or the account behind it (`.submit()`, a POST fetch, `document.cookie =`, ...). The page-side units
// web-unit-interact.js and web-unit-action.js carry the word check inline (they must be self-contained).
// extension/test/destructive_vocab.test.js keeps all copies identical to the hub.

/** One destructive word, whole. `deleted`, `dropped`, `dropdown`, `backdrop`, `undeletable` are not. */
export const DESTRUCTIVE_WORD_RE = /^(?:delet(?:e|es|ing|ion|ions)|remov(?:e|es|ing|al)|destroy(?:s|ing)?|destruction|terminat(?:e|es|ing|ion)|drop(?:s|ping)?|pay(?:s|ing|ment|ments|now|pal)?|purchas(?:e|es|ing)|buy(?:s|ing|now)?|charg(?:e|es|ing))$/;

/** Identifiers that contain a destructive word but do nothing destructive. Taken out before splitting. */
export const BENIGN_IDENTIFIER_RE = /remove(?:All)?(?:Event)?Listeners?|drop[\s_-]?shadow/gi;

/** JavaScript that changes the page, its storage, the session or the server. [label, pattern]. */
const CODE_RULES = [
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
function wordsOf(text) {
  return text
    .replace(BENIGN_IDENTIFIER_RE, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/** The destructive words in `text`, each once, in order. "cancel subscription" counts as one. */
export function destructiveWords(text) {
  const words = wordsOf(String(text ?? ""));
  const found = [];
  words.forEach((word, i) => {
    let hit = null;
    if (DESTRUCTIVE_WORD_RE.test(word)) hit = word;
    else if (word === "cancel" && /^subscriptions?$/.test(words[i + 1] ?? "")) hit = "cancel subscription";
    if (hit && !found.includes(hit)) found.push(hit);
  });
  return found;
}

/** Labels of the page-changing JavaScript constructs in `code`, each once. */
export function destructiveCode(code) {
  const text = String(code ?? "");
  const found = [];
  for (const [label, re] of CODE_RULES) {
    if (re.test(text) && !found.includes(label)) found.push(label);
  }
  return found;
}
