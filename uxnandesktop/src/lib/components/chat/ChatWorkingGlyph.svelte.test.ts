import { describe, expect, it } from "vitest";
import { mount } from "../../../test/render";
import { stateHue } from "$lib/design";
import ChatWorkingGlyph from "./ChatWorkingGlyph.svelte";

describe("ChatWorkingGlyph", () => {
  it("is the app's working mark: the Comet Trail in the working hue, announced as working", () => {
    const { screen } = mount(ChatWorkingGlyph, {});
    const mark = screen.getByRole("status", { name: "Working…" });
    expect(mark.className).toContain(stateHue.working);
    // The Comet Trail's 3×3 matrix.
    expect(mark.querySelectorAll("span span").length).toBeGreaterThanOrEqual(9);
  });
});
