import { describe, expect, it } from "vitest";
import {
  BADGE_TICK_CAP,
  CONTEXT_MISS_TOLERANCE,
  pickBadgeTargets,
  resolveContext,
  type BadgeTickInput,
} from "./githubRefresh";

const base: BadgeTickInput = {
  known: ["/a", "/b", "/c", "/d"],
  active: "/a",
  changed: [],
  primed: [],
  cursor: 0,
  cap: BADGE_TICK_CAP,
};

describe("pickBadgeTargets", () => {
  it("never picks the active worktree (it has its own load)", () => {
    const { picks } = pickBadgeTargets({ ...base, primed: ["/b", "/c", "/d"] });
    expect(picks).not.toContain("/a");
  });

  it("fills the never-read worktrees first — a missing badge beats a stale one", () => {
    // /b and /c already show a badge; /d has never been read.
    const { picks } = pickBadgeTargets({ ...base, primed: ["/b", "/c"], changed: ["/b"] });
    expect(picks[0]).toBe("/d");
  });

  it("walks every unprimed worktree across consecutive ticks", () => {
    const known = ["/a", "/b", "/c", "/d", "/e"];
    const primed: string[] = [];
    let cursor = 0;
    for (let tick = 0; tick < 2; tick++) {
      const out = pickBadgeTargets({ ...base, known, primed: [...primed], cursor });
      cursor = out.cursor;
      primed.push(...out.picks);
    }
    // 4 non-active paths, 2 per tick → all primed after two ticks.
    expect([...primed].sort()).toEqual(["/b", "/c", "/d", "/e"]);
  });

  it("prefers a just-changed worktree once everything has been read once", () => {
    const { picks } = pickBadgeTargets({
      ...base,
      primed: ["/b", "/c", "/d"],
      changed: ["/d"],
    });
    expect(picks[0]).toBe("/d");
  });

  it("carries signalled paths that did not fit into the next tick", () => {
    const { picks, pending } = pickBadgeTargets({
      ...base,
      primed: ["/b", "/c", "/d"],
      changed: ["/b", "/c", "/d"],
    });
    expect(picks).toHaveLength(BADGE_TICK_CAP);
    // The drained-but-unread path is handed back, not dropped.
    expect(pending).toEqual(["/d"]);
  });

  it("drops a signalled path that is no longer a known worktree", () => {
    const { picks, pending } = pickBadgeTargets({
      ...base,
      primed: ["/b", "/c", "/d"],
      changed: ["/gone"],
    });
    expect(picks).not.toContain("/gone");
    expect(pending).toEqual([]);
  });

  it("rotates through the rest so an untouched repo is still re-read", () => {
    const primed = ["/b", "/c", "/d"];
    const first = pickBadgeTargets({ ...base, primed });
    const second = pickBadgeTargets({ ...base, primed, cursor: first.cursor });
    expect(first.picks).toEqual(["/b", "/c"]);
    expect(second.picks).toEqual(["/d", "/b"]);
  });

  it("never returns more than the cap, or duplicates", () => {
    const { picks } = pickBadgeTargets({ ...base, changed: ["/b", "/b"], cap: 3 });
    expect(picks).toHaveLength(3);
    expect(new Set(picks).size).toBe(3);
  });

  it("is a no-op with no other worktrees, or with no budget", () => {
    expect(pickBadgeTargets({ ...base, known: ["/a"] }).picks).toEqual([]);
    expect(pickBadgeTargets({ ...base, cap: 0 }).picks).toEqual([]);
  });
});

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
