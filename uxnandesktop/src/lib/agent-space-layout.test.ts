import { describe, expect, it } from "vitest";
import { visibleAgentCount } from "$lib/agent-space-layout";

describe("visibleAgentCount", () => {
  it("handles empty, narrow, and exact overflow boundaries", () => {
    expect(visibleAgentCount(0, 0)).toBe(0);
    expect(visibleAgentCount(5, 27)).toBe(0);
    expect(visibleAgentCount(5, 28)).toBe(0);
    expect(visibleAgentCount(5, 56)).toBe(1);
    expect(visibleAgentCount(5, 139)).toBe(3);
    expect(visibleAgentCount(5, 140)).toBe(4);
    expect(visibleAgentCount(3, 83)).toBe(1);
  });

  it("caps at four and responds to shrink/growth", () => {
    expect(visibleAgentCount(9, 140)).toBe(4);
    expect(visibleAgentCount(9, 112)).toBe(3);
    expect(visibleAgentCount(9, 224)).toBe(4);
    expect(visibleAgentCount(3, 84)).toBe(3);
  });
});
