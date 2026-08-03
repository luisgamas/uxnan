import { describe, expect, it } from "vitest";
import { CONTEXT_MISS_TOLERANCE, resolveContext } from "./githubRefresh";

describe("resolveContext", () => {
  const ctx = { repo: "uxnan" };

  it("takes a real answer immediately and resets the miss count", () => {
    expect(resolveContext({ next: ctx, previous: null, misses: 1 })).toEqual({
      context: ctx,
      misses: 0,
    });
  });

  it("keeps what is on screen through a single null — the panel must not tear down", () => {
    const out = resolveContext({ next: null, previous: ctx, misses: 0 });
    expect(out.context).toBe(ctx);
    expect(out.misses).toBe(1);
  });

  it("accepts the null once it repeats past the tolerance", () => {
    const out = resolveContext({
      next: null,
      previous: ctx,
      misses: CONTEXT_MISS_TOLERANCE - 1,
    });
    expect(out).toEqual({ context: null, misses: 0 });
  });

  it("answers 'not a GitHub repo' at once when there is nothing to protect", () => {
    expect(resolveContext({ next: null, previous: null, misses: 0 })).toEqual({
      context: null,
      misses: 0,
    });
  });

  it("honors an explicit tolerance", () => {
    expect(resolveContext({ next: null, previous: ctx, misses: 0, tolerance: 1 })).toEqual({
      context: null,
      misses: 0,
    });
  });
});
