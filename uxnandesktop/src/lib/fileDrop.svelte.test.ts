/**
 * The drop router: dropped paths go to the target under the pointer, which is
 * told while they hover over it; a drop elsewhere is not taken from the file
 * tree (the OS drop's active-terminal fallback needs a terminal to exist).
 * The OS drop's position is hit-tested in CSS px on every platform: it arrives
 * in CSS px on macOS and Linux and in physical px only on Windows.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  dropPathsAt,
  dropPointToCss,
  fileDropTarget,
  hoverPathsAt,
  listenForOsDrops,
} from "./fileDrop";

// The window's native drag-drop: the test holds the handler the router
// registers and plays the events the webview would send.
type DragDropHandler = (event: { payload: unknown }) => void;
const webview = vi.hoisted(() => ({ handler: null as DragDropHandler | null }));
vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({
    onDragDropEvent: async (handler: DragDropHandler) => {
      webview.handler = handler;
      return () => {
        webview.handler = null;
      };
    },
  }),
}));

// jsdom lays nothing out, so it has no `elementFromPoint`; each test says
// what is under the pointer.
document.elementFromPoint ??= () => null;

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

const MAC_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)";
const WINDOWS_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Edg/130.0";

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

describe("dropPointToCss", () => {
  it("keeps macOS positions, already in CSS px", () => {
    expect(dropPointToCss({ x: 400, y: 600 }, "macos", 2)).toEqual({ x: 400, y: 600 });
  });

  it("keeps Linux positions, already in CSS px", () => {
    expect(dropPointToCss({ x: 400, y: 600 }, "linux", 2)).toEqual({ x: 400, y: 600 });
  });

  it("scales Windows positions down from physical px", () => {
    expect(dropPointToCss({ x: 600, y: 900 }, "windows", 1.5)).toEqual({ x: 400, y: 600 });
  });

  it("leaves Windows positions alone at scale 1", () => {
    expect(dropPointToCss({ x: 400, y: 600 }, "windows", 1)).toEqual({ x: 400, y: 600 });
  });
});

describe("listenForOsDrops", () => {
  /** A target the window's hit test finds only at CSS point (400, 600). */
  function targetAt400x600(ua: string, dpr: number) {
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue(ua);
    vi.stubGlobal("devicePixelRatio", dpr);
    const t = target();
    vi.spyOn(document, "elementFromPoint").mockImplementation((x, y) =>
      x === 400 && y === 600 ? t.inner : document.body,
    );
    return t;
  }

  it("drops files from the OS file manager on the target under the pointer on a scaled Mac", async () => {
    const t = targetAt400x600(MAC_UA, 2);
    const unlisten = await listenForOsDrops();
    webview.handler!({ payload: { type: "over", position: { x: 400, y: 600 } } });
    expect(t.over).toEqual([true]);
    webview.handler!({ payload: { type: "drop", paths: ["/a.ts"], position: { x: 400, y: 600 } } });
    expect(t.dropped).toEqual([["/a.ts"]]);
    expect(t.over).toEqual([true, false]);
    unlisten();
  });

  it("scales a Windows drop from physical px before hit-testing it", async () => {
    const t = targetAt400x600(WINDOWS_UA, 2);
    const unlisten = await listenForOsDrops();
    webview.handler!({ payload: { type: "over", position: { x: 800, y: 1200 } } });
    expect(t.over).toEqual([true]);
    webview.handler!({ payload: { type: "drop", paths: ["/a.ts"], position: { x: 800, y: 1200 } } });
    expect(t.dropped).toEqual([["/a.ts"]]);
    unlisten();
  });
});
