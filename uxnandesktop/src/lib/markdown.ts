// In-house Markdown → typed-AST renderer for the file viewer's Preview mode.
//
// Built on `@lezer/markdown` (already installed, transitive dep of
// `@codemirror/lang-markdown`) configured with GFM — so there is **no new
// dependency** and, crucially, **no raw-HTML injection**: `renderMarkdown` walks
// the Lezer concrete syntax tree and emits a small, typed block/inline AST that
// `MarkdownView.svelte` renders with plain Svelte markup (never `{@html}`), so a
// document from an untrusted repo can't script the webview. Raw HTML blocks are
// carried as escaped text, not executed.
//
// Pure + data-returning, so every branch is unit-testable (see `markdown.test.ts`),
// matching the `diff.ts` pattern.

import { parser as baseParser, GFM } from "@lezer/markdown";
import type { SyntaxNode } from "@lezer/common";

/** Markdown parser with GitHub-flavored extensions (tables, task lists,
 *  strikethrough, autolinks). Configured once and reused. */
const parser = baseParser.configure(GFM);

// --- AST ---------------------------------------------------------------------

/** A run of literal text (whitespace is collapsed by the renderer, HTML-style). */
export interface MdText {
  type: "text";
  value: string;
}
/** Inline `code` span (rendered verbatim, monospace). */
export interface MdCodeSpan {
  type: "code";
  value: string;
}
/** A hard line break (two trailing spaces or a backslash at end of line). */
export interface MdBreak {
  type: "break";
}
export interface MdStrong {
  type: "strong";
  children: MdInline[];
}
export interface MdEm {
  type: "em";
  children: MdInline[];
}
export interface MdDel {
  type: "del";
  children: MdInline[];
}
export interface MdLink {
  type: "link";
  href: string;
  title: string | null;
  children: MdInline[];
}
export interface MdImage {
  type: "image";
  src: string;
  alt: string;
  title: string | null;
}
export type MdInline =
  | MdText
  | MdCodeSpan
  | MdBreak
  | MdStrong
  | MdEm
  | MdDel
  | MdLink
  | MdImage;

/** Column alignment for a table (`null` = default/left, no explicit marker). */
export type MdAlign = "left" | "center" | "right" | null;

/** One item of a list. `checked` is non-null only for a GFM task-list item. */
export interface MdListItem {
  checked: boolean | null;
  children: MdBlock[];
}

export interface MdHeading {
  type: "heading";
  level: number;
  children: MdInline[];
}
export interface MdParagraph {
  type: "paragraph";
  children: MdInline[];
}
export interface MdBlockquote {
  type: "blockquote";
  children: MdBlock[];
}
export interface MdList {
  type: "list";
  ordered: boolean;
  /** First number for an ordered list (from its marker); `1` otherwise. */
  start: number;
  items: MdListItem[];
}
export interface MdCodeBlock {
  type: "codeBlock";
  lang: string | null;
  value: string;
}
export interface MdRule {
  type: "rule";
}
export interface MdTable {
  type: "table";
  align: MdAlign[];
  header: MdInline[][];
  rows: MdInline[][][];
}
/** A raw-HTML block — carried as **escaped text**, never executed. */
export interface MdHtml {
  type: "html";
  value: string;
}
/** GitHub's alert callout (`> [!WARNING]` …) — a blockquote with a known marker. */
export type MdAlertKind = "note" | "tip" | "important" | "warning" | "caution";
export interface MdAlert {
  type: "alert";
  kind: MdAlertKind;
  children: MdBlock[];
}
/** A `<details>`/`<summary>` disclosure. The summary is plain text (GitHub allows
 *  inline markup there, but bots overwhelmingly use plain text) and the body is a
 *  fully-parsed sub-document. */
export interface MdDetails {
  type: "details";
  summary: string;
  children: MdBlock[];
}
export type MdBlock =
  | MdHeading
  | MdParagraph
  | MdBlockquote
  | MdList
  | MdCodeBlock
  | MdRule
  | MdTable
  | MdHtml
  | MdAlert
  | MdDetails;

/** Parse Markdown source into a typed block AST for the Preview renderer. */
export function renderMarkdown(src: string): MdBlock[] {
  const tree = parser.parse(src);
  return blocks(tree.topNode, src);
}

// --- block walk --------------------------------------------------------------

const slice = (src: string, n: SyntaxNode): string => src.slice(n.from, n.to);

function firstNamed(n: SyntaxNode, name: string): SyntaxNode | null {
  for (let c = n.firstChild; c; c = c.nextSibling) if (c.name === name) return c;
  return null;
}
function childrenNamed(n: SyntaxNode, name: string): SyntaxNode[] {
  const out: SyntaxNode[] = [];
  for (let c = n.firstChild; c; c = c.nextSibling) if (c.name === name) out.push(c);
  return out;
}

function blocks(parent: SyntaxNode, src: string): MdBlock[] {
  const out: MdBlock[] = [];
  for (let c = parent.firstChild; c; c = c.nextSibling) {
    const b = block(c, src);
    if (b) out.push(...b);
  }
  // Runs here rather than only at the top level, so a disclosure nested in a
  // blockquote (where bots put them) is folded too.
  return foldDetails(out);
}

/** Map one Lezer block node to AST block(s), or null for a structural token
 *  (a mark, delimiter, or anything with no rendered block of its own). */
function block(n: SyntaxNode, src: string): MdBlock[] | null {
  const name = n.name;
  if (/^ATXHeading[1-6]$/.test(name) || /^SetextHeading[12]$/.test(name)) {
    return [{ type: "heading", level: Number(name.slice(-1)), children: inline(n, src) }];
  }
  switch (name) {
    case "Paragraph":
      return [{ type: "paragraph", children: inline(n, src) }];
    case "Blockquote":
      return [blockquoteBlock(blocks(n, src))];
    case "BulletList":
      return [listBlock(n, src, false)];
    case "OrderedList":
      return [listBlock(n, src, true)];
    case "FencedCode":
    case "CodeBlock":
      return [codeBlock(n, src)];
    case "HorizontalRule":
      return [{ type: "rule" }];
    case "Table":
      return [tableBlock(n, src)];
    case "HTMLBlock":
    case "CommentBlock":
    case "ProcessingInstructionBlock":
      return htmlBlock(slice(src, n));
    default:
      return null; // ListMark / QuoteMark / other structural tokens
  }
}

/** Map a raw-HTML block to AST block(s).
 *
 *  Two things happen here that the raw slice can't express:
 *
 *  1. **HTML comments are dropped.** GitHub hides them, and bots lean on them as
 *     machine markers (`<!-- review_stack_entry_start -->`) — rendering them as
 *     visible boxes buried the actual comment in noise.
 *  2. **Blockquote continuation markers are stripped.** Lezer reports the node's
 *     source range verbatim, so an HTML block nested in a `>` quote arrives with a
 *     literal `> ` on every line after the first.
 *
 *  A complete `<details>` becomes a real disclosure; anything else stays raw text
 *  (escaped by the renderer — we never execute it). */
function htmlBlock(raw: string): MdBlock[] {
  const value = stripQuoteMarkers(raw).trim();
  if (!value || isOnlyComments(value)) return [];
  // Strip any marker comments wrapped around real content.
  const stripped = value.replace(/<!--[\s\S]*?-->/g, "").trim();
  if (!stripped) return [];
  if (/<details[^>]*>/i.test(stripped)) return splitDetails(stripped);
  return [{ type: "html", value: stripped }];
}

/** Remove the `>` blockquote prefix Lezer leaves on an HTML block's 2nd+ lines. */
function stripQuoteMarkers(raw: string): string {
  return raw
    .split("\n")
    .map((line) => line.replace(/^\s*>\s?/, ""))
    .join("\n");
}

/** Whether the block is nothing but HTML comments (and whitespace). */
function isOnlyComments(value: string): boolean {
  return value.replace(/<!--[\s\S]*?-->/g, "").trim() === "";
}

/** The plain text of a `<summary>`, or "" when there isn't one. */
function summaryText(value: string): string {
  const m = /<summary[^>]*>([\s\S]*?)<\/summary>/i.exec(value);
  return m ? m[1].replace(/<[^>]+>/g, "").trim() : "";
}

/** Split an HTML block into its `<details>` disclosures plus the raw HTML around
 *  them.
 *
 *  Depth-aware on purpose. Inside a blockquote no line is blank (they all carry
 *  `>`), so *every* disclosure in a bot's comment lands in a single HTML block —
 *  and a greedy `<details>…</details>` match would run from the first opener to
 *  the **last** closer, swallowing every sibling into the first one's body. An
 *  unclosed opener leaves the remainder raw for [`foldDetails`] to stitch. */
function splitDetails(value: string): MdBlock[] {
  const out: MdBlock[] = [];
  let pos = 0;
  for (;;) {
    const opener = /<details[^>]*>/i.exec(value.slice(pos));
    if (!opener) break;
    const openAt = pos + opener.index;
    const bodyStart = openAt + opener[0].length;
    // Walk tags forward, counting depth, to find *this* opener's closer.
    const tagRe = /<(\/?)details[^>]*>/gi;
    tagRe.lastIndex = bodyStart;
    let depth = 1;
    let closeAt = -1;
    let after = -1;
    for (let m = tagRe.exec(value); m; m = tagRe.exec(value)) {
      depth += m[1] ? -1 : 1;
      if (depth === 0) {
        closeAt = m.index;
        after = tagRe.lastIndex;
        break;
      }
    }
    if (closeAt === -1) break; // unclosed — leave the rest raw
    const before = value.slice(pos, openAt).trim();
    if (before) out.push({ type: "html", value: before });
    const body = value.slice(bodyStart, closeAt);
    const summaryTag = /^\s*<summary[^>]*>[\s\S]*?<\/summary>/i.exec(body);
    out.push({
      type: "details",
      summary: summaryText(body),
      // The body is Markdown in its own right — GitHub renders it as such.
      children: renderMarkdown((summaryTag ? body.slice(summaryTag[0].length) : body).trim()),
    });
    pos = after;
  }
  const rest = value.slice(pos).trim();
  if (rest) out.push({ type: "html", value: rest });
  return out;
}

/** Fold `<details>` disclosures out of a block list.
 *
 *  A blank line **ends** an HTML block in CommonMark, so the very common
 *  `<details>` + blank line + Markdown body + `</details>` arrives as three
 *  separate blocks — opener, content, closer — and would otherwise render as two
 *  bare tags with the body loose between them. This stitches those back together;
 *  a `<details>` that never closes is left raw rather than swallowing the rest of
 *  the document. Nested disclosures aren't folded (the first `</details>` closes
 *  the outer one) — bots don't nest them, and a wrong guess is worse than raw. */
function foldDetails(list: MdBlock[]): MdBlock[] {
  const out: MdBlock[] = [];
  for (let i = 0; i < list.length; i++) {
    const b = list[i];
    if (b.type !== "html" || !/^<details[^>]*>/i.test(b.value)) {
      out.push(b);
      continue;
    }
    // Multi-block form: collect until the block that closes it. (A disclosure
    // wholly inside one HTML block was already folded by `splitDetails`.)
    let close = -1;
    for (let j = i + 1; j < list.length; j++) {
      const c = list[j];
      if (c.type === "html" && /<\/details>/i.test(c.value)) {
        close = j;
        break;
      }
    }
    if (close === -1) {
      out.push(b); // unclosed — leave it raw
      continue;
    }
    out.push({
      type: "details",
      summary: summaryText(b.value),
      children: list.slice(i + 1, close),
    });
    i = close;
  }
  return out;
}

/** GitHub alert markers, as they appear once Lezer has parsed `[!WARNING]` into a
 *  shortcut link with an empty href. */
const ALERT_KINDS: MdAlertKind[] = ["note", "tip", "important", "warning", "caution"];

/** Turn a blockquote that opens with `[!WARNING]` (or any GitHub alert marker)
 *  into an alert, dropping the marker line. Anything else stays a blockquote. */
function blockquoteBlock(children: MdBlock[]): MdBlock {
  const first = children[0];
  if (!first || first.type !== "paragraph") return { type: "blockquote", children };
  const lead = first.children[0];
  // `[!WARNING]` parses as a link with no destination whose text is `!WARNING`.
  if (!lead || lead.type !== "link" || lead.href !== "") {
    return { type: "blockquote", children };
  }
  const label = lead.children[0];
  if (!label || label.type !== "text") return { type: "blockquote", children };
  const kind = ALERT_KINDS.find((k) => label.value.toLowerCase() === `!${k}`);
  if (!kind) return { type: "blockquote", children };
  // Drop the marker and whatever separated it from the body — a `break` node, or
  // (when the body continued the same paragraph) the newline that opens the next
  // text run, which would otherwise render as a stray blank first line.
  let restInline = first.children.slice(1);
  if (restInline[0]?.type === "break") restInline = restInline.slice(1);
  const bodyStart = restInline[0];
  if (bodyStart?.type === "text") {
    const trimmed = bodyStart.value.replace(/^\s+/, "");
    restInline = trimmed
      ? [{ ...bodyStart, value: trimmed }, ...restInline.slice(1)]
      : restInline.slice(1);
  }
  const isBlank = restInline.length === 0;
  const rest = isBlank
    ? children.slice(1)
    : [{ type: "paragraph" as const, children: restInline }, ...children.slice(1)];
  return { type: "alert", kind, children: rest };
}

function listBlock(n: SyntaxNode, src: string, ordered: boolean): MdList {
  let start = 1;
  if (ordered) {
    const firstItem = firstNamed(n, "ListItem");
    const mark = firstItem && firstNamed(firstItem, "ListMark");
    const m = mark && /^(\d+)/.exec(slice(src, mark));
    if (m) start = Number(m[1]);
  }
  const items: MdListItem[] = [];
  for (let c = n.firstChild; c; c = c.nextSibling) {
    if (c.name === "ListItem") items.push(listItem(c, src));
  }
  return { type: "list", ordered, start, items };
}

function listItem(n: SyntaxNode, src: string): MdListItem {
  let checked: boolean | null = null;
  const children: MdBlock[] = [];
  for (let c = n.firstChild; c; c = c.nextSibling) {
    if (c.name === "ListMark") continue;
    if (c.name === "Task") {
      // GFM task item: a `[ ]`/`[x]` marker followed by inline content.
      const marker = firstNamed(c, "TaskMarker");
      checked = marker ? /\[[xX]\]/.test(slice(src, marker)) : false;
      children.push({
        type: "paragraph",
        children: inlineRange(c, src, marker ? marker.to : c.from, c.to),
      });
      continue;
    }
    const b = block(c, src);
    if (b) children.push(...b);
  }
  return { checked, children };
}

function codeBlock(n: SyntaxNode, src: string): MdCodeBlock {
  const info = firstNamed(n, "CodeInfo");
  const lang = info ? slice(src, info).trim() || null : null;
  const value = childrenNamed(n, "CodeText")
    .map((t) => slice(src, t))
    .join("");
  return { type: "codeBlock", lang, value };
}

function tableBlock(n: SyntaxNode, src: string): MdTable {
  const header: MdInline[][] = [];
  const rows: MdInline[][][] = [];
  let align: MdAlign[] = [];
  const cells = (row: SyntaxNode): MdInline[][] =>
    childrenNamed(row, "TableCell").map((cell) => inline(cell, src));
  for (let c = n.firstChild; c; c = c.nextSibling) {
    if (c.name === "TableHeader") header.push(...cells(c));
    else if (c.name === "TableRow") rows.push(cells(c));
    else if (c.name === "TableDelimiter" && align.length === 0 && slice(src, c).includes("-"))
      align = parseAlign(slice(src, c)); // the `|:--|--:|` alignment row
  }
  return { type: "table", align, header, rows };
}

function parseAlign(row: string): MdAlign[] {
  return row
    .split("|")
    .map((c) => c.trim())
    .filter((c) => c.length > 0)
    .map((cell) => {
      const left = cell.startsWith(":");
      const right = cell.endsWith(":");
      return left && right ? "center" : right ? "right" : left ? "left" : null;
    });
}

// --- inline walk -------------------------------------------------------------

function inline(parent: SyntaxNode, src: string): MdInline[] {
  return inlineRange(parent, src, parent.from, parent.to);
}

/** Collect inline nodes for a node's `[from, to)` span: child nodes are processed
 *  (marks yield nothing), and the gaps between them are literal text. A range is
 *  passed explicitly so a link/image label (the text between its brackets) reuses
 *  the same walk. */
function inlineRange(parent: SyntaxNode, src: string, from: number, to: number): MdInline[] {
  const out: MdInline[] = [];
  let pos = from;
  for (let c = parent.firstChild; c; c = c.nextSibling) {
    if (c.to <= from) continue;
    if (c.from >= to) break;
    if (c.from > pos) pushText(out, src.slice(pos, c.from));
    const node = processInline(c, src);
    if (node) out.push(node);
    pos = Math.max(pos, c.to);
  }
  if (pos < to) pushText(out, src.slice(pos, to));
  return trimEdges(out);
}

function processInline(n: SyntaxNode, src: string): MdInline | null {
  switch (n.name) {
    case "StrongEmphasis":
      return { type: "strong", children: inline(n, src) };
    case "Emphasis":
      return { type: "em", children: inline(n, src) };
    case "Strikethrough":
      return { type: "del", children: inline(n, src) };
    case "InlineCode":
      return { type: "code", value: innerCode(n, src) };
    case "Link":
      return linkInline(n, src);
    case "Image":
      return imageInline(n, src);
    case "Autolink":
      return autolinkInline(n, src);
    case "HardBreak":
      return { type: "break" };
    case "Escape":
      return { type: "text", value: src.slice(n.from + 1, n.to) };
    case "Entity":
      return { type: "text", value: decodeEntity(slice(src, n)) };
    default:
      return null; // EmphasisMark / CodeMark / LinkMark / QuoteMark / … — no output
  }
}

function innerCode(n: SyntaxNode, src: string): string {
  const marks = childrenNamed(n, "CodeMark");
  if (marks.length >= 2) return src.slice(marks[0].to, marks[marks.length - 1].from);
  return slice(src, n);
}

function linkInline(n: SyntaxNode, src: string): MdLink {
  const marks = childrenNamed(n, "LinkMark");
  const open = marks.find((m) => slice(src, m) === "[");
  const close = marks.find((m) => slice(src, m) === "]");
  const url = firstNamed(n, "URL");
  const title = firstNamed(n, "LinkTitle");
  return {
    type: "link",
    href: url ? slice(src, url) : "",
    title: title ? stripQuotes(slice(src, title)) : null,
    children: inlineRange(n, src, open ? open.to : n.from, close ? close.from : n.to),
  };
}

function imageInline(n: SyntaxNode, src: string): MdImage {
  const marks = childrenNamed(n, "LinkMark");
  const open = marks.find((m) => slice(src, m) === "![") ?? marks[0];
  const close = marks.find((m) => slice(src, m) === "]");
  const url = firstNamed(n, "URL");
  const title = firstNamed(n, "LinkTitle");
  return {
    type: "image",
    src: url ? slice(src, url) : "",
    alt: src.slice(open ? open.to : n.from, close ? close.from : n.to).trim(),
    title: title ? stripQuotes(slice(src, title)) : null,
  };
}

function autolinkInline(n: SyntaxNode, src: string): MdLink {
  const url = firstNamed(n, "URL");
  const href = url ? slice(src, url) : slice(src, n).replace(/^<|>$/g, "");
  return { type: "link", href, title: null, children: [{ type: "text", value: href }] };
}

// --- small helpers -----------------------------------------------------------

function pushText(out: MdInline[], value: string): void {
  if (!value) return;
  const last = out[out.length - 1];
  if (last && last.type === "text") last.value += value;
  else out.push({ type: "text", value });
}

/** Trim leading/trailing insignificant whitespace at the edges of an inline run
 *  (e.g. the space after a heading `#`, or a trailing soft-wrap newline) and drop
 *  any now-empty text nodes. */
function trimEdges(nodes: MdInline[]): MdInline[] {
  const first = nodes[0];
  if (first && first.type === "text") first.value = first.value.replace(/^[ \t]+/, "");
  const last = nodes[nodes.length - 1];
  if (last && last.type === "text") last.value = last.value.replace(/[ \t\n]+$/, "");
  return nodes.filter((n) => n.type !== "text" || n.value.length > 0);
}

function stripQuotes(s: string): string {
  const t = s.trim();
  const paired =
    (t.startsWith('"') && t.endsWith('"')) ||
    (t.startsWith("'") && t.endsWith("'")) ||
    (t.startsWith("(") && t.endsWith(")"));
  return paired ? t.slice(1, -1) : t;
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  copy: "©",
  reg: "®",
  trade: "™",
  hellip: "…",
  mdash: "—",
  ndash: "–",
};

/** Decode a single HTML entity token (named or numeric) to its character; returns
 *  the raw token unchanged when it isn't recognized. */
function decodeEntity(token: string): string {
  const m = /^&(#x?[0-9a-fA-F]+|[a-zA-Z]+);$/.exec(token);
  if (!m) return token;
  const body = m[1];
  if (body.startsWith("#x") || body.startsWith("#X"))
    return codePoint(parseInt(body.slice(2), 16), token);
  if (body.startsWith("#")) return codePoint(parseInt(body.slice(1), 10), token);
  return NAMED_ENTITIES[body] ?? token;
}

function codePoint(code: number, fallback: string): string {
  return Number.isFinite(code) && code > 0 && code <= 0x10ffff
    ? String.fromCodePoint(code)
    : fallback;
}
