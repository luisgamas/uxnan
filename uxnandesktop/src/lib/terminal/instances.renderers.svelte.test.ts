/**
 * Which hidden terminals keep their GPU renderer.
 *
 * Showing a terminal that kept its renderer is a repaint; showing one that gave
 * it back rebuilds the renderer from nothing, which is what made switching to a
 * terminal tab stall. The resource mode sets how many hidden terminals keep
 * one; the longest hidden give theirs back first.
 */
import { afterEach, describe, expect, it } from "vitest";
// The store first, as the app loads it: it and the instance registry import
// each other, and entering the cycle from this side leaves its handler unset.
import "$lib/state/terminals.svelte";
import {
  hiddenRendererIds,
  releaseRenderer,
  rendererHidden,
  rendererShown,
  type TerminalInstance,
} from "./instances";

type FakeRenderer = { disposed: boolean; dispose(): void };

function renderer(): FakeRenderer {
  return {
    disposed: false,
    dispose() {
      this.disposed = true;
    },
  };
}

function instance(id: string): TerminalInstance & { renderer: FakeRenderer | undefined } {
  return {
    id,
    wrapper: document.createElement("div"),
    renderer: renderer(),
  } as unknown as TerminalInstance & { renderer: FakeRenderer | undefined };
}

const made: TerminalInstance[] = [];
function terminal(id: string) {
  const inst = instance(id);
  made.push(inst);
  return inst;
}

afterEach(() => {
  for (const inst of made.splice(0)) releaseRenderer(inst);
});

describe("hidden terminal renderers", () => {
  it("keeps hidden renderers up to the budget, giving back the longest hidden first", () => {
    const a = terminal("a");
    const b = terminal("b");
    const c = terminal("c");
    const aRenderer = a.renderer!;

    rendererHidden(a, 2);
    rendererHidden(b, 2);
    expect(hiddenRendererIds()).toEqual(["a", "b"]);
    expect(aRenderer.disposed).toBe(false);

    rendererHidden(c, 2);
    expect(hiddenRendererIds()).toEqual(["b", "c"]);
    expect(aRenderer.disposed).toBe(true);
    expect(a.renderer).toBeUndefined();
    expect(b.renderer?.disposed).toBe(false);
  });

  it("gives every renderer back when the budget is zero (Efficient)", () => {
    const a = terminal("a");
    const kept = a.renderer!;
    rendererHidden(a, 0);
    expect(hiddenRendererIds()).toEqual([]);
    expect(kept.disposed).toBe(true);
    expect(a.renderer).toBeUndefined();
  });

  it("a shown terminal stops counting, and hiding it again makes it the newest", () => {
    const a = terminal("a");
    const b = terminal("b");
    rendererHidden(a, 2);
    rendererHidden(b, 2);
    rendererShown(a);
    expect(hiddenRendererIds()).toEqual(["b"]);
    rendererHidden(a, 2);
    expect(hiddenRendererIds()).toEqual(["b", "a"]);
  });

  it("a renderer lost while hidden no longer takes a place", () => {
    const a = terminal("a");
    const b = terminal("b");
    const c = terminal("c");
    rendererHidden(a, 2);
    rendererHidden(b, 2);
    // A context loss disposes the renderer and clears the handle.
    a.renderer = undefined;
    rendererHidden(c, 2);
    expect(hiddenRendererIds()).toEqual(["b", "c"]);
    expect(b.renderer?.disposed).toBe(false);
    expect(c.renderer?.disposed).toBe(false);
  });

  it("a terminal with no renderer is not kept", () => {
    const a = terminal("a");
    a.renderer = undefined;
    rendererHidden(a, 4);
    expect(hiddenRendererIds()).toEqual([]);
  });

  it("releasing a hidden terminal's renderer takes it off the list", () => {
    const a = terminal("a");
    rendererHidden(a, 4);
    releaseRenderer(a);
    expect(hiddenRendererIds()).toEqual([]);
    expect(a.renderer).toBeUndefined();
  });
});
