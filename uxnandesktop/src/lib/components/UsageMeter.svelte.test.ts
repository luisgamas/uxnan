/**
 * The narrowest kind of component test: props in, rendered output out.
 *
 * `UsageMeter` is the bar the provider cards and the status-bar popover share,
 * so a change to it moves two surfaces at once. What matters is that the number
 * a user reads matches the number the backend reported, that the bar stays
 * inside its track, and that a very small percentage is still *visible* — a 0 %
 * bar that renders as nothing looks like a broken widget rather than a fact.
 */

import { describe, expect, it } from "vitest";

import { mount } from "../../test/render";
import type { UsageWindow } from "$lib/types";
import UsageMeter from "./UsageMeter.svelte";

function usageWindow(overrides: Partial<UsageWindow> = {}): UsageWindow {
  return { id: "five-hour", label: "5-hour limit", usedPercent: 42, ...overrides };
}

/** An epoch-milliseconds reset two hours out — the shape the providers report. */
function inTwoHours(): number {
  return Date.now() + 2 * 60 * 60 * 1000;
}

/** The filled part of the bar — the only element carrying an inline width. */
function fill(container: HTMLElement): HTMLElement {
  const el = container.querySelector<HTMLElement>('[style*="width"]');
  if (!el) throw new Error("no filled bar rendered");
  return el;
}

describe("UsageMeter", () => {
  it("shows the window's label and its used percentage", () => {
    const { screen } = mount(UsageMeter, { props: { window: usageWindow() } });
    expect(screen.getByText("5-hour limit")).toBeInTheDocument();
    expect(screen.getByText("42%")).toBeInTheDocument();
  });

  it("rounds the percentage rather than showing a long decimal", () => {
    const { screen } = mount(UsageMeter, { props: { window: usageWindow({ usedPercent: 42.6 }) } });
    expect(screen.getByText("43%")).toBeInTheDocument();
  });

  it("keeps a nearly-empty bar visible instead of rendering nothing", () => {
    // A 0 % bar that is 0 px wide reads as a broken component, not as "no usage".
    const { screen } = mount(UsageMeter, { props: { window: usageWindow({ usedPercent: 0 }) } });
    expect(screen.getByText("0%")).toBeInTheDocument();
    expect(fill(screen.container).style.width).toBe("2%");
  });

  it("never lets the bar overflow its track", () => {
    const { screen } = mount(UsageMeter, { props: { window: usageWindow({ usedPercent: 130 }) } });
    expect(fill(screen.container).style.width).toBe("100%");
  });

  it("omits the reset line when there is nothing to reset", () => {
    const { screen } = mount(UsageMeter, { props: { window: usageWindow() } });
    expect(screen.queryByText(/resets in/i)).not.toBeInTheDocument();
  });

  it("shows a reset countdown when the provider reported one", () => {
    const { screen } = mount(UsageMeter, {
      props: { window: usageWindow({ resetsAt: inTwoHours() }) },
    });
    expect(screen.getByText(/resets in/i)).toBeInTheDocument();
  });

  it("drops the absolute clock time in compact mode, keeping the countdown", () => {
    // The popover is tight; "resets in 2h · 3:00 PM" wraps and reads badly.
    const { screen } = mount(UsageMeter, {
      props: { window: usageWindow({ resetsAt: inTwoHours() }), compact: true, showReset: true },
    });
    expect(screen.getByText(/resets in/i).textContent).not.toContain("·");
  });
});
