/**
 * The chip editor's DOM model: the element ↔ the string it stands for, where
 * every chip is one marker (U+FFFC), and the caret's place in that string.
 */
import { describe, expect, it } from "vitest";
import {
  caretOf,
  chipNode,
  isChip,
  offsetOf,
  plainTextOf,
  pointAt,
  render,
  serialize,
  setCaret,
  spacedInsert,
} from "./chip-editor";

const M = "￼";

function chip(id: string): HTMLElement {
  const span = document.createElement("span");
  span.textContent = `[${id}]`;
  return span;
}

function editor(text: string, ids: string[] = []): HTMLElement {
  const root = document.createElement("div");
  root.contentEditable = "true";
  document.body.replaceChildren(root);
  render(root, text, ids, chip);
  return root;
}

describe("chip editor model", () => {
  it("draws text, line breaks and chips, and reads back the same string", () => {
    const root = editor(`in ${M} you see\nand ${M}`, ["a", "b"]);
    expect(root.querySelectorAll("[data-chip]")).toHaveLength(2);
    expect(root.querySelectorAll("br")).toHaveLength(1);
    expect(serialize(root)).toEqual({ text: `in ${M} you see\nand ${M}`, chips: ["a", "b"] });
  });

  it("keeps an empty last line with a placeholder that counts for nothing", () => {
    const root = editor("line\n");
    expect(root.querySelectorAll("br")).toHaveLength(2);
    expect(serialize(root).text).toBe("line\n");
    expect(serialize(editor("")).text).toBe("");
  });

  it("leaves out a marker that has no chip", () => {
    const root = editor(`${M} and ${M}`, ["only"]);
    expect(serialize(root)).toEqual({ text: `${M} and `, chips: ["only"] });
  });

  it("makes a chip atomic: not editable, not draggable, carrying its id", () => {
    const node = chipNode(chip, "x1");
    expect(isChip(node)).toBe(true);
    expect(node.getAttribute("contenteditable")).toBe("false");
    expect(node.getAttribute("draggable")).toBe("false");
    expect(node.getAttribute("data-chip")).toBe("x1");
  });

  it("reads a line a browser wrapped in a block, and drops a stray marker typed as text", () => {
    const root = editor("");
    root.innerHTML = `first<div>second</div>x${M}y`;
    expect(serialize(root).text).toBe("first\nsecondxy");
  });

  it("maps the caret to the string, a chip counting one", () => {
    const root = editor(`ab ${M} cd`, ["c1"]);
    for (let offset = 0; offset <= 7; offset += 1) {
      const point = pointAt(root, offset);
      expect(offsetOf(root, point.node, point.offset)).toBe(offset);
    }
    setCaret(root, 4);
    expect(caretOf(root)).toBe(4);
    // A point inside a chip is just after it.
    const inside = root.querySelector("[data-chip]")!.firstChild!;
    expect(offsetOf(root, inside, 1)).toBe(4);
  });

  it("says nothing of a caret outside the editor", () => {
    const root = editor("abc");
    const other = document.createElement("input");
    document.body.append(other);
    other.focus();
    window.getSelection()?.removeAllRanges();
    expect(caretOf(root)).toBeNull();
  });

  it("copies a selection with each chip as its text, never a marker", () => {
    const root = editor(`see ${M} here`, ["shot.png"]);
    const range = document.createRange();
    range.selectNodeContents(root);
    expect(plainTextOf(range.cloneContents(), (c) => `[${c.getAttribute("data-chip")}]`)).toBe(
      "see [shot.png] here",
    );
  });

  it("sets inserted chips apart from the words around them", () => {
    expect(spacedInsert("", 0)).toEqual({ before: "", after: " " });
    expect(spacedInsert("look at", 7)).toEqual({ before: " ", after: " " });
    expect(spacedInsert("look  at", 5)).toEqual({ before: "", after: "" });
    expect(spacedInsert("a\nb", 2)).toEqual({ before: "", after: " " });
  });
});
