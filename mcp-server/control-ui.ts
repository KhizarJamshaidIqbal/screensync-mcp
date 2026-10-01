// The phone's UI tree: a uiautomator dump that is never stale, a stack-based parser that keeps every
// state flag and the hierarchy, the query and projection behind get_ui_hierarchy, and the text matcher
// behind control_tap_text and control_swipe_until. Split out of control.ts.
//
// Why the dump is strict: it used to swallow a failed `uiautomator dump` and read the file back anyway,
// so during an animation ("could not get idle state") the PREVIOUS screen's tree came back and tap_text
// tapped where a button used to be. Now the file is removed first, Android's own "UI hierchary dumped"
// line (its spelling) is required, one retry follows after 400 ms, and then UiDumpError is thrown.
import { log } from "./config.js";
import { adb } from "./control-adb.js";
import { isFractionPoint, scroll } from "./control.js";

export type UiBounds = { x1: number; y1: number; x2: number; y2: number };

export type UiNode = {
  text: string;
  desc: string;
  resourceId: string;
  className: string;
  clickable: boolean;
  bounds: UiBounds;
  center: { x: number; y: number };
  enabled: boolean;
  checkable: boolean;
  checked: boolean;
  focusable: boolean;
  focused: boolean;
  scrollable: boolean;
  longClickable: boolean;
  password: boolean;
  selected: boolean;
  package: string;
  /** uiautomator's own index: the position among its siblings. */
  index: number;
  /** Nesting level in the full dump (the root is 0), even when ancestors are filtered out. */
  depth: number;
  /** Position of the nearest ancestor in the SAME returned list, or null when none is listed. */
  parent: number | null;
};

/** Every key of a UiNode, in output order; `fields` projects onto these. */
export const UI_NODE_FIELDS = [
  "text", "desc", "resourceId", "className", "clickable", "bounds", "center", "enabled", "checkable", "checked",
  "focusable", "focused", "scrollable", "longClickable", "password", "selected", "package", "index", "depth", "parent",
] as const;
export type UiField = (typeof UI_NODE_FIELDS)[number];

/** A reply key: a node field, or `state`, the flags that apply to a node as a short list (see uiState). */
export type UiOutputField = UiField | "state";

/**
 * The keys of a node in a reply without `fields`: the seven it always had, plus `state`. A bare call pays
 * for every node of every dump, so the other twelve keys (each flag as a boolean, package, index, depth,
 * parent) come only with `fields: ["all"]` or by name.
 */
export const UI_DEFAULT_FIELDS: readonly UiOutputField[] = ["text", "desc", "resourceId", "className", "clickable", "bounds", "center", "state"];

export type UiRegion = UiBounds & { mode?: "inside" | "intersect" };

/** get_ui_hierarchy's view and filters. Every filter narrows (they combine with AND). */
export type UiQuery = {
  /** Every node instead of the default view (text, desc, clickable, scrollable, checkable or an EditText). */
  all?: boolean;
  onlyClickable?: boolean;
  /** Case-insensitive substring of text + content-desc. */
  filter?: string;
  enabled?: boolean;
  checked?: boolean;
  scrollable?: boolean;
  /** Case-insensitive substring of the class name. */
  className?: string;
  region?: UiRegion;
  maxDepth?: number;
};

/** How control_tap_text and control_swipe_until pick a node. */
export type UiMatch = {
  exact?: boolean;
  /** The Nth match (0-based) in hierarchy order, instead of the best one. */
  index?: number;
  className?: string;
  /** Defaults to true: a disabled node is not a target unless asked for with false. */
  enabled?: boolean;
  clickableOnly?: boolean;
};

export class UiDumpError extends Error {
  readonly code = "UI_DUMP_FAILED";
  readonly retryable = true;
  constructor(readonly attempts: number, readonly lastOutput: string) {
    super(
      `UI_DUMP_FAILED: uiautomator could not dump the screen in ${attempts} attempts (${lastOutput || "no output"}). ` +
        "The screen is probably still animating: wait a moment and retry. No older screen's tree was used.",
    );
    this.name = "UiDumpError";
  }
}

const UI_DUMP_PATH = "/sdcard/screensync_ui.xml";
const DUMPED = /UI hie(?:rchary|rarchy) dumped/;
const DUMP_ATTEMPTS = 2;
const RETRY_DELAY_MS = 400;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const oneLine = (text: string) => text.replace(/\s+/g, " ").trim().slice(0, 200);

/** Dumps the screen with uiautomator and returns the XML of THIS screen, or throws UiDumpError. */
export async function dumpUiXml(): Promise<string> {
  let last = "";
  for (let attempt = 1; attempt <= DUMP_ATTEMPTS; attempt++) {
    if (attempt > 1) await sleep(RETRY_DELAY_MS);
    // Removed first: a dump that fails can then never leave the previous screen's file to be read back.
    await adb(["shell", "rm", "-f", UI_DUMP_PATH]);
    const out = await adb(["shell", "uiautomator", "dump", UI_DUMP_PATH]).catch((e: unknown) =>
      e instanceof Error ? e.message : String(e));
    if (DUMPED.test(out)) {
      const xml = await adb(["shell", "cat", UI_DUMP_PATH]);
      if (xml.includes("<hierarchy")) return xml;
      last = "the dump file was empty or not XML";
    } else {
      last = oneLine(out);
    }
    log("WARN", "control uiautomator dump failed", { attempt, output: last });
  }
  throw new UiDumpError(DUMP_ATTEMPTS, last);
}

/** Dumps the screen and returns the nodes `query` selects (the default view when it is empty). */
export async function uiHierarchy(query: UiQuery = {}): Promise<UiNode[]> {
  return queryUiTree(parseUiTree(await dumpUiXml()), query);
}

/** Back-compatible parse: the nodes `query` selects from one dump (the default view when it is empty). */
export function parseUiAutomatorXml(xml: string, query: UiQuery = {}): UiNode[] {
  return queryUiTree(parseUiTree(xml), query);
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

/** Decodes the XML entities uiautomator writes (&amp; &lt; &#10; ...), so text matches what the screen shows. */
export function decodeXml(value: string): string {
  if (!value.includes("&")) return value;
  return value.replace(/&(#[xX][0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (whole, name: string) => {
    if (name[0] !== "#") return ENTITIES[name];
    const code = name[1] === "x" || name[1] === "X" ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
    return code <= 0x10ffff ? String.fromCodePoint(code) : whole;
  });
}

const TAG = /<(\/?)node\b([^>]*?)(\/?)>/g;
// Both XML quote styles: Android 16 writes a value that holds a double quote in single quotes (text='say "hi"').
const ATTR = /([\w:-]+)=(?:"([^"]*)"|'([^']*)')/g;
const BOUNDS = /\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]/;

/**
 * Every node of a dump in document order, with depth and parent (an index into the returned list).
 * A stack of open <node> tags gives both; a node whose bounds cannot be read is left out, but it still
 * counts for its children's depth, and their parent becomes its nearest listed ancestor.
 */
export function parseUiTree(xml: string): UiNode[] {
  const nodes: UiNode[] = [];
  const open: number[] = []; // index in `nodes` of each open tag, -1 for one that was left out
  for (const tag of xml.matchAll(TAG)) {
    if (tag[1]) {
      open.pop();
      continue;
    }
    const attrs = new Map<string, string>();
    for (const a of tag[2].matchAll(ATTR)) attrs.set(a[1], decodeXml(a[2] ?? a[3]));
    let up = open.length - 1;
    while (up >= 0 && open[up] < 0) up--;
    const node = toNode(attrs, open.length, up >= 0 ? open[up] : null);
    if (node) nodes.push(node);
    if (!tag[3]) open.push(node ? nodes.length - 1 : -1);
  }
  return nodes;
}

function toNode(attrs: Map<string, string>, depth: number, parent: number | null): UiNode | null {
  const b = BOUNDS.exec(attrs.get("bounds") ?? "");
  if (!b) return null;
  const [x1, y1, x2, y2] = b.slice(1, 5).map(Number);
  const flag = (name: string) => attrs.get(name) === "true";
  return {
    text: attrs.get("text") ?? "",
    desc: attrs.get("content-desc") ?? "",
    resourceId: attrs.get("resource-id") ?? "",
    className: attrs.get("class") ?? "",
    clickable: flag("clickable"),
    bounds: { x1, y1, x2, y2 },
    center: { x: Math.round((x1 + x2) / 2), y: Math.round((y1 + y2) / 2) },
    enabled: attrs.get("enabled") !== "false", // an OEM dump without the attribute must not disable everything
    checkable: flag("checkable"),
    checked: flag("checked"),
    focusable: flag("focusable"),
    focused: flag("focused"),
    scrollable: flag("scrollable"),
    longClickable: flag("long-clickable"),
    password: flag("password"),
    selected: flag("selected"),
    package: attrs.get("package") ?? "",
    index: Number(attrs.get("index")) || 0,
    depth,
    parent,
  };
}

/**
 * The default view: what an agent can read or act on. Today's rule (text, desc or clickable) plus scroll
 * containers, EditText fields and checkable toggles, whose state is the point even when the row, not
 * the switch, takes the click. Layout-only containers are left out.
 */
function inDefaultView(n: UiNode): boolean {
  return Boolean(n.text || n.desc || n.clickable || n.scrollable || n.checkable || /EditText/i.test(n.className));
}

/** A region in pixels: fractions (all four values in 0..1) scale by the dump's own root size. */
function regionPixels(r: UiRegion, tree: UiNode[]): Required<UiRegion> {
  const fraction = isFractionPoint(r.x1, r.y1) && isFractionPoint(r.x2, r.y2);
  const roots = tree.filter((n) => n.depth === 0);
  const w = fraction ? Math.max(0, ...roots.map((n) => n.bounds.x2)) : 1;
  const h = fraction ? Math.max(0, ...roots.map((n) => n.bounds.y2)) : 1;
  return {
    x1: Math.min(r.x1, r.x2) * w, y1: Math.min(r.y1, r.y2) * h,
    x2: Math.max(r.x1, r.x2) * w, y2: Math.max(r.y1, r.y2) * h,
    mode: r.mode === "inside" ? "inside" : "intersect",
  };
}

function inRegion(b: UiBounds, r: Required<UiRegion>): boolean {
  if (r.mode === "inside") return b.x1 >= r.x1 && b.y1 >= r.y1 && b.x2 <= r.x2 && b.y2 <= r.y2;
  return b.x1 < r.x2 && b.x2 > r.x1 && b.y1 < r.y2 && b.y2 > r.y1;
}

/** Selects from a parseUiTree() list and re-points each parent at the nearest ancestor that is kept. */
export function queryUiTree(tree: UiNode[], q: UiQuery = {}): UiNode[] {
  const text = q.filter?.toLowerCase();
  const cls = q.className?.toLowerCase();
  const region = q.region ? regionPixels(q.region, tree) : null;
  const keep = (n: UiNode): boolean =>
    (q.all || inDefaultView(n)) &&
    (!q.onlyClickable || n.clickable) &&
    (!text || `${n.text} ${n.desc}`.toLowerCase().includes(text)) &&
    (q.enabled === undefined || n.enabled === q.enabled) &&
    (q.checked === undefined || n.checked === q.checked) &&
    (q.scrollable === undefined || n.scrollable === q.scrollable) &&
    (!cls || n.className.toLowerCase().includes(cls)) &&
    (q.maxDepth === undefined || n.depth <= q.maxDepth) &&
    (!region || inRegion(n.bounds, region));

  const out: UiNode[] = [];
  const at: number[] = []; // tree index -> index in `out`, undefined when not kept
  tree.forEach((n, i) => {
    if (!keep(n)) return;
    let p = n.parent;
    while (p !== null && at[p] === undefined) p = tree[p].parent;
    at[i] = out.length;
    out.push({ ...n, parent: p === null ? null : at[p] });
  });
  return out;
}

/**
 * The flags that apply to a node, as short words: "disabled" when it is not enabled, then each of these
 * that is true. `focusable` is left out: nearly every clickable node is, so it would only add bytes.
 */
export function uiState(n: UiNode): string[] {
  const state = n.enabled ? [] : ["disabled"];
  for (const flag of ["checkable", "checked", "focused", "scrollable", "longClickable", "password", "selected"] as const) {
    if (n[flag]) state.push(flag);
  }
  return state;
}

export type UiReplyNode = Partial<UiNode> & { state?: string[] };
export type UiTreeNode = UiReplyNode & { children?: UiTreeNode[] };

/**
 * Shapes the reply. Without `fields` a node carries UI_DEFAULT_FIELDS; `fields: "all"` keeps every key and a
 * list keeps only those (`state` is left out when no flag applies). `format: "tree"` nests children under
 * their parent (and drops `parent`, which indexes a flat list that is then not returned).
 */
export function shapeUiNodes(
  nodes: UiNode[],
  opts: { fields?: readonly UiOutputField[] | "all"; format?: "flat" | "tree" } = {},
): { count: number; nodes: UiReplyNode[] } | { count: number; tree: UiTreeNode[] } {
  const fields = opts.fields === "all" ? null : opts.fields?.length ? opts.fields : UI_DEFAULT_FIELDS;
  const pick = (n: UiNode): UiReplyNode => {
    if (!fields) return { ...n };
    const out: Record<string, unknown> = {};
    for (const f of fields) {
      if (f !== "state") {
        out[f] = n[f];
        continue;
      }
      const state = uiState(n);
      if (state.length) out.state = state;
    }
    return out as UiReplyNode;
  };
  if (opts.format !== "tree") return { count: nodes.length, nodes: nodes.map(pick) };

  const made: UiTreeNode[] = nodes.map((n) => {
    const { parent: _parent, ...rest } = pick(n);
    return rest;
  });
  const roots: UiTreeNode[] = [];
  nodes.forEach((n, i) => (n.parent === null ? roots : (made[n.parent].children ??= [])).push(made[i]));
  return { count: nodes.length, tree: roots };
}

// ── Loose MCP arguments -> typed options (the MCP server does not validate against the schema) ──
type Args = Record<string, unknown> | undefined;
const bool = (v: unknown) => (typeof v === "boolean" ? v : undefined);
const str = (v: unknown) => (typeof v === "string" && v ? v : undefined);
const count = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.floor(v) : undefined);

function readRegion(v: unknown): UiRegion | undefined {
  if (!v || typeof v !== "object") return undefined;
  const r = v as Record<string, unknown>;
  const [x1, y1, x2, y2] = [r.x1, r.y1, r.x2, r.y2].map(Number);
  if (![x1, y1, x2, y2].every(Number.isFinite)) return undefined;
  return { x1, y1, x2, y2, mode: r.mode === "inside" ? "inside" : "intersect" };
}

/**
 * get_ui_hierarchy's arguments. `fields` is "all" (also ["all"]) for every key, or a list: unknown names are
 * dropped, and none left means the default keys.
 */
export function readUiArgs(args: Args): { query: UiQuery; fields?: UiOutputField[] | "all"; format: "flat" | "tree" } {
  const a = args ?? {};
  const asked: unknown[] = Array.isArray(a.fields) ? a.fields : a.fields === "all" ? ["all"] : [];
  const fields: UiOutputField[] | "all" = asked.includes("all")
    ? "all"
    : [...UI_NODE_FIELDS, "state" as const].filter((f) => asked.includes(f));
  return {
    query: {
      all: bool(a.all), onlyClickable: bool(a.onlyClickable), filter: str(a.filter),
      enabled: bool(a.enabled), checked: bool(a.checked), scrollable: bool(a.scrollable),
      className: str(a.className), region: readRegion(a.region), maxDepth: count(a.maxDepth),
    },
    fields: fields === "all" || fields.length ? fields : undefined,
    format: a.format === "tree" ? "tree" : "flat",
  };
}

/** control_tap_text / control_swipe_until matcher arguments. */
export function readMatchArgs(args: Args): UiMatch {
  const a = args ?? {};
  return {
    exact: bool(a.exact), index: count(a.index), className: str(a.className),
    enabled: bool(a.enabled), clickableOnly: bool(a.clickableOnly),
  };
}

// ── Matching and acting ──

const area = (n: UiNode) => (n.bounds.x2 - n.bounds.x1) * (n.bounds.y2 - n.bounds.y1);

/**
 * Picks the node for `query` (text or content-desc, case-insensitive) from a default-view list.
 * Without `index`: clickable first, then the smallest (most specific). With it: the Nth in hierarchy
 * order. `skipped` counts text matches the enabled rule left out.
 */
export function pickNode(
  view: UiNode[],
  query: string,
  m: UiMatch = {},
): { node: UiNode | null; matches: number; skipped: number } {
  const q = query.toLowerCase();
  const cls = m.className?.toLowerCase();
  const wantEnabled = m.enabled ?? true;
  const hits = view.filter((n) => {
    const text = n.text.toLowerCase();
    const desc = n.desc.toLowerCase();
    return (m.exact ? text === q || desc === q : `${text} ${desc}`.includes(q)) &&
      (!cls || n.className.toLowerCase().includes(cls)) &&
      (!m.clickableOnly || n.clickable);
  });
  const usable = hits.filter((n) => n.enabled === wantEnabled);
  const node = m.index !== undefined
    ? usable[m.index] ?? null
    : [...usable].sort((a, b) => (a.clickable !== b.clickable ? (a.clickable ? -1 : 1) : area(a) - area(b)))[0] ?? null;
  return { node, matches: usable.length, skipped: hits.length - usable.length };
}

async function findNode(query: string, m: UiMatch) {
  return pickNode(await uiHierarchy(), query, m);
}

function noMatch(query: string, m: UiMatch, r: { matches: number; skipped: number }): Error {
  let msg = `No on-screen element matching "${query}"`;
  if (m.index !== undefined && r.matches) msg += ` at index ${m.index} (${r.matches} match(es), counted from 0)`;
  if (r.skipped) {
    msg += m.enabled === false
      ? `; ${r.skipped} enabled match(es) left out (enabled:false targets disabled ones)`
      : `; ${r.skipped} disabled match(es) skipped (pass enabled:false to target one)`;
  }
  return new Error(`${msg}. Try get_ui_hierarchy to list what's visible.`);
}

/** Taps the node `query` picks (see pickNode) at its center. */
export async function tapText(query: string, m: UiMatch = {}): Promise<{ tapped: UiNode; matches: number }> {
  const r = await findNode(query, m);
  if (!r.node) throw noMatch(query, m, r);
  await adb(["shell", "input", "tap", String(r.node.center.x), String(r.node.center.y)]);
  log("INFO", "control tapText", { query, x: r.node.center.x, y: r.node.center.y });
  return { tapped: r.node, matches: r.matches };
}

/** Scrolls in `direction` up to `maxSwipes` times until `query` (matched as tapText does) is on screen. */
export async function swipeUntil(
  query: string,
  direction: "up" | "down" | "left" | "right" = "down",
  maxSwipes = 8,
  m: UiMatch = {},
): Promise<{ found: boolean; swipes: number; node: UiNode | null }> {
  for (let i = 0; i <= maxSwipes; i++) {
    const { node } = await findNode(query, m);
    if (node) return { found: true, swipes: i, node };
    if (i < maxSwipes) {
      await scroll(direction, 0.7);
      await sleep(600);
    }
  }
  return { found: false, swipes: maxSwipes, node: null };
}
