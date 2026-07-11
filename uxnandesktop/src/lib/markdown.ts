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
export type MdBlock =
  | MdHeading
  | MdParagraph
  | MdBlockquote
  | MdList
  | MdCodeBlock
  | MdRule
  | MdTable
  | MdHtml;

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
  return out;
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
      return [{ type: "blockquote", children: blocks(n, src) }];
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
      return [{ type: "html", value: slice(src, n) }];
    default:
      return null; // ListMark / QuoteMark / other structural tokens
  }
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
