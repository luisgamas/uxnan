// The DOM model of the chip editor (`input-group-chip-editor.svelte`): plain
// text with atomic inline chips, held as one string in which every chip is a
// single `ATTACHMENT_MARKER` (U+FFFC). Pure DOM functions, so the mapping
// between the editable element and that string — the text, where the caret
// is, what a selection copies — is one tested place.
//
// Inside the element there are only three kinds of node: text (whose "\n" are
// line breaks under `white-space: pre-wrap`), `<br>` (a line break the browser
// inserted) and chips (`[data-chip]`, `contenteditable="false"`). A `<br>`
// that is the very last node is the browser's placeholder for an empty last
// line and counts for nothing; a block a browser may wrap a line in (`div`,
// `p`) starts a new line.

import { ATTACHMENT_MARKER, stripAttachmentMarkers } from '$shared/models/inline-attachments';

/** The attribute a chip node carries its id in. */
export const CHIP_ATTR = 'data-chip';

/** Whether [node] is a chip. */
export function isChip(node: Node | null): node is HTMLElement {
  return node?.nodeType === Node.ELEMENT_NODE && (node as HTMLElement).hasAttribute(CHIP_ATTR);
}

function isBreak(node: Node): boolean {
  return node.nodeType === Node.ELEMENT_NODE && (node as Element).tagName === 'BR';
}

function isBlock(node: Node): boolean {
  if (node.nodeType !== Node.ELEMENT_NODE) return false;
  const tag = (node as Element).tagName;
  return tag === 'DIV' || tag === 'P';
}

/** What a chip writes into the serialized text. */
type ChipWriter = (chip: HTMLElement) => string;

/** The last node of [root] in document order (its deepest last descendant). */
function lastLeaf(root: Node): Node | null {
  let node = root.lastChild;
  while (node && !isChip(node) && node.lastChild) node = node.lastChild;
  return node;
}

function serializeInto(
  node: Node,
  out: { text: string; chips: string[] },
  chip: ChipWriter,
  placeholder: Node | null,
): void {
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.nodeType === Node.TEXT_NODE) {
      out.text += stripAttachmentMarkers(child.nodeValue ?? '');
    } else if (isChip(child)) {
      out.text += chip(child);
      out.chips.push(child.getAttribute(CHIP_ATTR) ?? '');
    } else if (isBreak(child)) {
      if (child !== placeholder) out.text += '\n';
    } else if (child.nodeType === Node.ELEMENT_NODE) {
      if (isBlock(child) && out.text.length > 0 && !out.text.endsWith('\n')) out.text += '\n';
      serializeInto(child, out, chip, placeholder);
    }
  }
}

/**
 * The text of [root] — every chip as one marker — and its chips' ids in
 * order. With [trailingPlaceholder] (the default) a `<br>` closing it counts
 * for nothing; a fragment cut before the caret keeps its last one.
 */
export function serialize(
  root: Node,
  trailingPlaceholder = true,
): { text: string; chips: string[] } {
  const out = { text: '', chips: [] as string[] };
  const last = trailingPlaceholder ? lastLeaf(root) : null;
  serializeInto(root, out, () => ATTACHMENT_MARKER, last && isBreak(last) ? last : null);
  return out;
}

/**
 * What a selection of the editor copies: its text with every chip written by
 * [chipText] (its `[name]`), never a marker.
 */
export function plainTextOf(fragment: Node, chipText: ChipWriter): string {
  const out = { text: '', chips: [] as string[] };
  serializeInto(fragment, out, chipText, null);
  return out.text;
}

/** The text offset of the boundary point ([node], [offset]) inside [root]. */
export function offsetOf(root: HTMLElement, node: Node, offset: number): number {
  if (!root.contains(node)) return serialize(root).text.length;
  // A point inside a chip is just after it: a chip is one character.
  let inner: Node | null = node;
  while (inner && inner !== root) {
    if (isChip(inner)) {
      const range = document.createRange();
      range.setStart(root, 0);
      range.setEndAfter(inner);
      return serialize(range.cloneContents(), false).text.length;
    }
    inner = inner.parentNode;
  }
  const range = document.createRange();
  range.setStart(root, 0);
  range.setEnd(node, offset);
  return serialize(range.cloneContents(), false).text.length;
}

/** Where the caret (the selection's focus) is in [root]'s text, or `null` when it is elsewhere. */
export function caretOf(root: HTMLElement): number | null {
  const selection = root.ownerDocument.getSelection();
  if (!selection || selection.rangeCount === 0 || !selection.focusNode) return null;
  if (!root.contains(selection.focusNode)) return null;
  return offsetOf(root, selection.focusNode, selection.focusOffset);
}

/** The DOM boundary point for text [offset] inside [root]. */
export function pointAt(root: HTMLElement, offset: number): { node: Node; offset: number } {
  let remaining = Math.max(0, offset);
  const walk = (parent: Node): { node: Node; offset: number } | null => {
    let index = 0;
    for (let child = parent.firstChild; child; child = child.nextSibling, index += 1) {
      if (child.nodeType === Node.TEXT_NODE) {
        const length = (child.nodeValue ?? '').length;
        if (remaining <= length) return { node: child, offset: remaining };
        remaining -= length;
      } else if (isChip(child) || isBreak(child)) {
        if (remaining === 0) return { node: parent, offset: index };
        remaining -= 1;
      } else if (child.nodeType === Node.ELEMENT_NODE) {
        const found = walk(child);
        if (found) return found;
      }
    }
    return null;
  };
  return walk(root) ?? { node: root, offset: root.childNodes.length - (endsWithPlaceholder(root) ? 1 : 0) };
}

function endsWithPlaceholder(root: HTMLElement): boolean {
  const last = root.lastChild;
  return last !== null && isBreak(last);
}

/** Put the caret at text [offset] of [root]. */
export function setCaret(root: HTMLElement, offset: number): void {
  const selection = root.ownerDocument.getSelection();
  if (!selection) return;
  const point = pointAt(root, offset);
  const range = root.ownerDocument.createRange();
  range.setStart(point.node, point.offset);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
}

/**
 * Fill [root] with [text], building each marker's chip with [makeChip] from
 * [chipIds] in order (a marker past the ids is left out). Line breaks are
 * `<br>`, plus the placeholder that lets an empty last line show.
 */
export function render(
  root: HTMLElement,
  text: string,
  chipIds: readonly string[],
  makeChip: (id: string) => HTMLElement,
): void {
  const doc = root.ownerDocument;
  const nodes: Node[] = [];
  let chip = 0;
  let run = '';
  const flush = () => {
    if (run) nodes.push(doc.createTextNode(run));
    run = '';
  };
  for (const ch of text) {
    if (ch === ATTACHMENT_MARKER) {
      flush();
      const id = chipIds[chip];
      chip += 1;
      if (id !== undefined) nodes.push(chipNode(makeChip, id));
    } else if (ch === '\n') {
      flush();
      nodes.push(doc.createElement('br'));
    } else {
      run += ch;
    }
  }
  flush();
  if (text.endsWith('\n')) nodes.push(doc.createElement('br'));
  root.replaceChildren(...nodes);
}

/** A chip for [id], marked as one: atomic, not editable, not draggable. */
export function chipNode(makeChip: (id: string) => HTMLElement, id: string): HTMLElement {
  const node = makeChip(id);
  node.setAttribute(CHIP_ATTR, id);
  node.setAttribute('contenteditable', 'false');
  node.setAttribute('draggable', 'false');
  return node;
}

/**
 * The spacing that sets chips inserted at text offset [at] of [current]
 * apart from the words around them: a space before unless they start a line
 * or follow one, and one after unless one follows already.
 */
export function spacedInsert(current: string, at: number): { before: string; after: string } {
  const prev = current.slice(0, at);
  const next = current.slice(at);
  return {
    before: prev === '' || /\s$/.test(prev) ? '' : ' ',
    after: /^\s/.test(next) ? '' : ' ',
  };
}
