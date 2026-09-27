import { describe, expect, it } from "vitest";
import { mountWithProviders as mount } from "../../../test/render";
import ChatContextRing from "./ChatContextRing.svelte";

const window = (used: number) => ({
  id: "session5h",
  label: "Session (5h)",
  usedPercent: used,
  windowMinutes: 300,
  resetsAt: Date.now() + 2 * 3_600_000,
});

describe("ChatContextRing", () => {
  it("adds where the agent's plan stands, and marks a pace that runs out", () => {
    const { screen } = mount(ChatContextRing, {
      props: {
        tokens: 50_000,
        limit: 200_000,
        plan: { name: "Claude Code", window: window(72), pace: { elapsed: 0.6, runsOutInMs: 70 * 60_000 } },
      },
    });
    const ring = screen.getByRole("img");
    const label = ring.getAttribute("aria-label") ?? "";
    expect(label).toContain("25% of context used");
    expect(label).toContain("Claude Code · Session (5h) 72% used");
    expect(label).toContain("At this pace you hit the limit in");
    expect(ring.querySelector(".bg-amber-500")).not.toBeNull();
  });

  it("stays the context ring alone without a plan, or with a calm one", () => {
    const calm = mount(ChatContextRing, {
      props: { tokens: 10, limit: 100, plan: { name: "Codex", window: window(10), pace: { elapsed: 0.6 } } },
    });
    const calmRing = calm.screen.getByRole("img");
    expect(calmRing.querySelector(".bg-amber-500")).toBeNull();
    expect(calmRing.getAttribute("aria-label")).toContain("Codex");
    calm.screen.unmount();
    const bare = mount(ChatContextRing, { props: { tokens: 10, limit: 100 } });
    expect(bare.screen.getByRole("img").getAttribute("aria-label")).toBe("10% of context used");
  });
});
