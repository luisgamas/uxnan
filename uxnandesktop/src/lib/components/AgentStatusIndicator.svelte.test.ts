/**
 * The sidebar's state glyphs, proven to actually paint.
 *
 * These four states are what makes the sidebar scannable, and three of them are
 * rare compared to `working` — you can use the app for a long stretch and only
 * ever see the Comet Trail, which is exactly how a missing glyph would hide.
 * Type checking cannot catch it either: a glyph that resolved to `undefined`
 * still type-checks as a prop and renders an empty `<svg>`.
 *
 * So each assertion is about painted geometry, not about a class name.
 */

import { describe, expect, it } from "vitest";

import { mountWithProviders } from "../../test/render";
import AgentStatusIndicator from "./AgentStatusIndicator.svelte";
import type { DisplayStatus } from "$lib/state/agentDisplay";

const GLYPH_STATES: DisplayStatus[] = ["waiting", "blocked", "done"];

const shapesIn = (container: HTMLElement) =>
  container.querySelectorAll("svg path, svg circle, svg rect, svg ellipse");

describe("AgentStatusIndicator", () => {
  it.each(GLYPH_STATES)("paints a real glyph for %s", (status) => {
    const { screen } = mountWithProviders(AgentStatusIndicator, { props: { status } });

    const shapes = shapesIn(screen.container);
    expect(shapes.length).toBeGreaterThan(0);
    // An empty <svg> is the failure this guards: the glyph data went missing.
    for (const shape of shapes) {
      const drawn =
        shape.getAttribute("d") ||
        shape.getAttribute("r") ||
        shape.getAttribute("width");
      expect(drawn).toBeTruthy();
    }
  });

  it.each(GLYPH_STATES)("tints %s through currentColor, not a hard-coded fill", (status) => {
    const { screen } = mountWithProviders(AgentStatusIndicator, { props: { status } });

    const stroked = [...shapesIn(screen.container)].filter((s) => s.hasAttribute("stroke"));
    expect(stroked.length).toBeGreaterThan(0);
    for (const shape of stroked) {
      expect(shape.getAttribute("stroke")).toBe("currentColor");
    }
  });

  it("draws the Comet Trail for working, not an icon", () => {
    const { screen } = mountWithProviders(AgentStatusIndicator, { props: { status: "working" } });

    // The comet is CSS dots, so there is no <svg> glyph at all here.
    expect(screen.container.querySelector("svg")).toBeNull();
    expect(screen.container.querySelector("span")).not.toBeNull();
  });

  it("keeps idle a plain dot", () => {
    const { screen } = mountWithProviders(AgentStatusIndicator, { props: { status: "idle" } });

    expect(shapesIn(screen.container).length).toBe(0);
    expect(screen.container.querySelector(".rounded-full")).not.toBeNull();
  });

  it("dims a stale report without dropping its glyph", () => {
    const { screen } = mountWithProviders(AgentStatusIndicator, {
      props: { status: "waiting", stale: true },
    });

    expect(shapesIn(screen.container).length).toBeGreaterThan(0);
    expect(screen.container.querySelector(".opacity-40")).not.toBeNull();
  });
});
