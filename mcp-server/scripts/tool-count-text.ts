// The text rules behind scripts/sync-tool-count.ts, kept pure so a test can pin them.
//
// The published tool count is quoted three ways: "225 MCP tools", "225 tools", and an animated counter
// (data-count="225") whose label says "MCP tools". Only the counter with THAT label may be touched. goal.html
// also carries counters for the built-in prompts (17) and for "servers holding your data" (0); a rewrite that
// matched every data-count once published "225 servers holding your data" on a privacy-first product's site,
// and the check passed because every counter agreed with the number it had just been given.

// data-count="N" on a <div> or <p> counter whose next element is labelled "MCP tools" (goal.html labels with a
// <p>; index.html's counter is itself a <p> since 133c876). Matching on the label, not on the attribute, is the
// whole point. The counter's text is the number too, so the page reads right without JS or with reduced motion:
// group 1 is the attribute, group 2 the rest of the tag, group 3 the number shown.
const COUNTER_LABELLED_MCP_TOOLS = /data-count="(\d+)"([^>]*>)(\d*)(?=<\/(?:div|p)>\s*<(?:p|div)[^>]*>[^<]*\bMCP tools\b)/gi;

/** Every place the tool count is quoted, as the number that is currently written there. */
export const quoted = (text: string): string[] => [
  ...[...text.matchAll(/(\d{2,4})(?= MCP tools)/g)].map((m) => m[1]),
  ...[...text.matchAll(/(\d{2,4})(?= tools)/g)].map((m) => m[1]),
  ...[...text.matchAll(COUNTER_LABELLED_MCP_TOOLS)].flatMap((m) => (m[3] ? [m[1], m[3]] : [m[1]])),
];

/** The text with every quoted tool count replaced by `count`. Counters for anything else are left alone. */
export const rewrite = (text: string, count: number): string =>
  text
    .replace(/(\d{2,4})(?= MCP tools)/g, String(count))
    .replace(/(\d{2,4})(?= tools)/g, String(count))
    .replace(COUNTER_LABELLED_MCP_TOOLS, (_m, _n, tag: string, shown: string) => `data-count="${count}"${tag}${shown ? count : ""}`);
