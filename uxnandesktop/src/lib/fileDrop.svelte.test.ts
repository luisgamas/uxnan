/**
 * The drop router: dropped paths go to the target under the pointer, which is
 * told while they hover over it; a drop elsewhere is not taken from the file
 * tree (the OS drop's active-terminal fallback needs a terminal to exist).
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { dropPathsAt, fileDropTarget, hoverPathsAt } from "./fileDrop";

// jsdom lays nothing out, so it has no `elementFromPoint`; each test says
// what is under the pointer.
document.elementFromPoint ??= () => null;

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

function target() {
  const node = document.createElement("div");
  const inner = document.createElement("span");
  node.append(inner);
  document.body.append(node);
  const dropped: string[][] = [];
  const over: boolean[] = [];
  const action = fileDropTarget(node, {
    ondrop: (paths) => dropped.push(paths),
    onover: (value) => over.push(value),
  });
  return { node, inner, dropped, over, action };
}

describe("fileDrop", () => {
  it("hands dropped paths to the target under the pointer", () => {
    const t = target();
    vi.spyOn(document, "elementFromPoint").mockReturnValue(t.inner);
    expect(dropPathsAt(["/a.ts"], 1, 1, "tree")).toBe(true);
    expect(t.dropped).toEqual([["/a.ts"]]);
  });

  it("tells a target while paths hover over it, and when they leave", () => {
    const t = target();
    const at = vi.spyOn(document, "elementFromPoint").mockReturnValue(t.inner);
    hoverPathsAt({ x: 1, y: 1 });
    hoverPathsAt({ x: 2, y: 2 });
    at.mockReturnValue(document.body);
    hoverPathsAt({ x: 3, y: 3 });
    hoverPathsAt(null);
    expect(t.over).toEqual([true, false]);
  });

  it("ends the hover on drop", () => {
    const t = target();
    vi.spyOn(document, "elementFromPoint").mockReturnValue(t.inner);
    hoverPathsAt({ x: 1, y: 1 });
    dropPathsAt(["/a.ts"], 1, 1, "os");
    expect(t.over).toEqual([true, false]);
  });

  it("takes nothing from the file tree dropped outside every target", () => {
    const t = target();
    vi.spyOn(document, "elementFromPoint").mockReturnValue(document.body);
    expect(dropPathsAt(["/a.ts"], 1, 1, "tree")).toBe(false);
    expect(t.dropped).toEqual([]);
  });

  it("forgets a target once it is gone", () => {
    const t = target();
    t.action.destroy();
    vi.spyOn(document, "elementFromPoint").mockReturnValue(t.inner);
    expect(dropPathsAt(["/a.ts"], 1, 1, "tree")).toBe(false);
    expect(t.node.dataset.fileDrop).toBeUndefined();
  });
});
