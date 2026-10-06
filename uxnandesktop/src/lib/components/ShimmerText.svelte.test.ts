/**
 * Live text sweeps a band of light across itself on the compositor alone: a
 * window and a brighter copy moving by transforms, never a repainted gradient.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createRawSnippet } from "svelte";
import { mount } from "../../test/render";
import ShimmerText from "./ShimmerText.svelte";

const text = createRawSnippet(() => ({ render: () => "<span>Working for 12s</span>" }));

describe("ShimmerText", () => {
  it("shows the words once to readers, with a hidden brighter copy for the sweep", () => {
    const { container } = mount(ShimmerText, { props: { children: text } }).screen;
    const band = container.querySelector(".ux-shimmer-band");
    expect(band?.getAttribute("aria-hidden")).toBe("true");
    expect(band?.querySelector(".ux-shimmer-glint")?.textContent).toBe("Working for 12s");
  });

  it("is plain text when inactive", () => {
    const { container } = mount(ShimmerText, { props: { children: text, active: false } }).screen;
    expect(container.querySelector(".ux-shimmer-band")).toBeNull();
    expect(container.textContent?.trim()).toBe("Working for 12s");
  });

  it("animates transforms only, so nothing is repainted per frame", () => {
    const source = readFileSync("src/lib/components/ShimmerText.svelte", "utf8");
    const keyframes = source.slice(source.indexOf("@keyframes"));
    expect(keyframes).not.toMatch(/background-position|left:|width:|color:/);
    expect(keyframes).toMatch(/transform: translateX/);
  });
});
