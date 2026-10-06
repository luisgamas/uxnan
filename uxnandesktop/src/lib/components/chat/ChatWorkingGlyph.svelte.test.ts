import { describe, expect, it } from "vitest";
import { mount } from "../../../test/render";
import { stateHue } from "$lib/design";
import ChatWorkingGlyph from "./ChatWorkingGlyph.svelte";

describe("ChatWorkingGlyph", () => {
  it("is the app's working mark: the spinner in the working hue, announced as working", () => {
    const { screen } = mount(ChatWorkingGlyph, {});
    const mark = screen.getByRole("status", { name: "Working…" });
    expect(mark.className).toContain(stateHue.working);
    // One turning glyph — a transform the compositor animates — not a matrix
    // of separately animated dots.
    const glyph = mark.querySelector("svg");
    expect(glyph?.getAttribute("class")).toContain("animate-spin");
    expect(mark.querySelectorAll("svg").length).toBe(1);
  });
});
