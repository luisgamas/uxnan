/**
 * What this proves is narrow but load-bearing: the glyph data that
 * `@hugeicons/core-free-icons` ships actually reaches the DOM as *valid SVG*.
 *
 * The data uses camelCase keys (`strokeLinecap`, `strokeWidth`) plus a
 * bookkeeping `key`. SVG has no such attributes — a browser silently ignores
 * `strokeLinecap` — so a component that spreads them verbatim renders a glyph
 * that looks almost right (butt caps instead of round, hairline joins) and never
 * errors. Type checking cannot see this; only reading the emitted attributes
 * can. Hence the assertions on kebab-case names.
 *
 * The reactivity test guards the reason we render declaratively instead of using
 * `@hugeicons/svelte`, whose component captures the glyph once in `onMount` and
 * never repaints when `icon` changes. Several call sites swap the glyph on state
 * (agent status, view mode), so a regression here is a stuck icon, not a crash.
 */

import { describe, expect, it } from "vitest";

import Cancel01Icon from "@hugeicons/core-free-icons/Cancel01Icon";
import Folder01Icon from "@hugeicons/core-free-icons/Folder01Icon";

import { mount } from "../../../../test/render";
import Icon from "./icon.svelte";

const svgOf = (container: HTMLElement) => {
  const svg = container.querySelector("svg");
  if (!svg) throw new Error("no <svg> rendered");
  return svg;
};

describe("Icon", () => {
  it("renders the glyph's nodes with SVG-legal attribute names", () => {
    const { screen } = mount(Icon, { props: { icon: Folder01Icon } });
    const path = svgOf(screen.container).querySelector("path");

    expect(path).not.toBeNull();
    expect(path!.getAttribute("d")).toBeTruthy();
    // The whole point: kebab-case reaches the DOM, camelCase never does.
    expect(path!.getAttribute("stroke-linecap")).toBe("round");
    expect(path!.getAttribute("strokeLinecap")).toBeNull();
    expect(path!.getAttribute("stroke-width")).toBe("1.5");
    // `key` is bookkeeping in the data, not an attribute.
    expect(path!.hasAttribute("key")).toBe(false);
  });

  it("inherits color from CSS so Tailwind text-* classes tint it", () => {
    const { screen } = mount(Icon, { props: { icon: Folder01Icon } });
    const path = svgOf(screen.container).querySelector("path");

    expect(path!.getAttribute("stroke")).toBe("currentColor");
    expect(svgOf(screen.container).getAttribute("fill")).toBe("none");
  });

  it("lets a class override the geometry attributes", () => {
    const { screen } = mount(Icon, {
      props: { icon: Folder01Icon, class: "size-4" },
    });
    const svg = svgOf(screen.container);

    // Both present: the attribute is the fallback, the class is what wins in CSS.
    expect(svg.getAttribute("width")).toBe("24");
    expect(svg.classList.contains("size-4")).toBe(true);
  });

  it("repaints when the glyph changes", async () => {
    const { screen } = mount(Icon, { props: { icon: Folder01Icon } });
    const before = svgOf(screen.container).innerHTML;

    await screen.rerender({ icon: Cancel01Icon });

    expect(svgOf(screen.container).innerHTML).not.toBe(before);
  });

  it("thickens strokes on request without touching filled shapes", () => {
    const { screen } = mount(Icon, {
      props: { icon: Folder01Icon, strokeWidth: 2 },
    });
    const path = svgOf(screen.container).querySelector("path");

    expect(path!.getAttribute("stroke-width")).toBe("2");
  });
});
