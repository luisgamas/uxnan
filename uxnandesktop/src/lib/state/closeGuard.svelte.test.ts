import { describe, expect, it } from "vitest";

import { closeGuard, closeMatters } from "./closeGuard.svelte";

describe("closeGuard", () => {
  it("only matters with an agent working or a file unsaved", () => {
    expect(closeMatters({ working: 0, unsaved: 0 })).toBe(false);
    expect(closeMatters({ working: 1, unsaved: 0 })).toBe(true);
    expect(closeMatters({ working: 0, unsaved: 2 })).toBe(true);
  });

  it("asks, and resolves with the answer", async () => {
    const answer = closeGuard.request({ working: 2, unsaved: 1 });
    expect(closeGuard.open).toBe(true);
    expect(closeGuard.work).toEqual({ working: 2, unsaved: 1 });
    closeGuard.choose(true);
    await expect(answer).resolves.toBe(true);
    expect(closeGuard.open).toBe(false);
  });

  it("answers a superseded question 'stay'", async () => {
    const first = closeGuard.request({ working: 1, unsaved: 0 });
    const second = closeGuard.request({ working: 1, unsaved: 1 });
    await expect(first).resolves.toBe(false);
    closeGuard.choose(false);
    await expect(second).resolves.toBe(false);
  });
});
