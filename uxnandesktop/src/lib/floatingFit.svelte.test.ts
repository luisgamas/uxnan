import { afterEach, describe, expect, it } from "vitest";
import { clipSpan, fitPanel } from "./floatingFit";

describe("fitPanel", () => {
  const clip = { top: 100, bottom: 900 };

  it("opens above at its full height when there is room", () => {
    expect(fitPanel({ top: 700, bottom: 800 }, clip, 288)).toEqual({ side: "above", maxHeight: 288 });
  });

  it("shrinks above to the room there is, rather than running past the pane", () => {
    // 300 - 100 - 16 = 184 px above, still more than below.
    expect(fitPanel({ top: 300, bottom: 880 }, clip, 288)).toEqual({ side: "above", maxHeight: 184 });
  });

  it("stays above once the room there is comfortable, even with more below", () => {
    // 330 - 100 - 16 = 214 px above: comfortable, so it keeps rising out of the composer.
    expect(fitPanel({ top: 330, bottom: 430 }, clip, 288)).toEqual({ side: "above", maxHeight: 214 });
  });

  it("opens below when the room above is cramped and there is more below", () => {
    // 150 px above (cramped); 900 - 400 - 16 = 484 px below.
    expect(fitPanel({ top: 266, bottom: 400 }, clip, 288)).toEqual({ side: "below", maxHeight: 288 });
  });

  it("never reports a negative height", () => {
    expect(fitPanel({ top: 90, bottom: 950 }, clip, 288).maxHeight).toBe(0);
  });
});

describe("clipSpan", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("is the nearest ancestor that scrolls", () => {
    document.body.innerHTML = `<div id="pane" style="overflow-y: auto"><div><span id="anchor"></span></div></div>`;
    const pane = document.getElementById("pane")!;
    pane.getBoundingClientRect = () => ({ top: 40, bottom: 500 }) as DOMRect;
    expect(clipSpan(document.getElementById("anchor")!)).toEqual({ top: 40, bottom: 500 });
  });

  it("is the window when nothing clips", () => {
    document.body.innerHTML = `<span id="anchor"></span>`;
    // `body`/`html` default to visible overflow in the test DOM.
    expect(clipSpan(document.getElementById("anchor")!)).toEqual({ top: 0, bottom: window.innerHeight });
  });
});
