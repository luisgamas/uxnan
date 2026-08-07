import { describe, expect, it } from "vitest";
import {
  buildReviewGroups,
  reviewGroupOf,
  REVIEW_GROUP_ORDER,
  type ReviewPr,
} from "./sidebar-review";

function pr(over: Partial<ReviewPr> = {}): ReviewPr {
  return { state: "OPEN", isDraft: false, checks: { state: "success" }, ...over };
}

describe("reviewGroupOf", () => {
  it("puts a workspace with no pull request in progress", () => {
    expect(reviewGroupOf(null)).toBe("in-progress");
    expect(reviewGroupOf(undefined)).toBe("in-progress");
  });

  it("treats a draft like work still in your hands", () => {
    // Same lane as "no PR" on purpose: neither has been handed over.
    expect(reviewGroupOf(pr({ isDraft: true }))).toBe("in-progress");
  });

  it("puts an open, non-draft pull request in review", () => {
    expect(reviewGroupOf(pr())).toBe("in-review");
  });

  it("pulls a failing run out of the review lane", () => {
    // The one open state that is blocked on you — burying it under "in review"
    // is how a red branch sits for a day.
    expect(reviewGroupOf(pr({ checks: { state: "failure" } }))).toBe("failing");
  });

  it("keeps a pending run in review — it is not asking for anything yet", () => {
    expect(reviewGroupOf(pr({ checks: { state: "pending" } }))).toBe("in-review");
  });

  it("reads merged and closed from the provider", () => {
    expect(reviewGroupOf(pr({ state: "MERGED" }))).toBe("merged");
    expect(reviewGroupOf(pr({ state: "CLOSED" }))).toBe("closed");
  });

  it("normalizes the provider's casing and padding", () => {
    expect(reviewGroupOf(pr({ state: " merged " }))).toBe("merged");
  });

  it("does not let a failing run override a merged pull request", () => {
    // It landed; a red post-merge run is not this view's problem.
    expect(reviewGroupOf(pr({ state: "MERGED", checks: { state: "failure" } }))).toBe("merged");
  });

  it("survives a pull request with no checks roll-up", () => {
    expect(reviewGroupOf({ state: "OPEN", isDraft: false })).toBe("in-review");
    expect(reviewGroupOf(pr({ checks: null }))).toBe("in-review");
  });
});

describe("buildReviewGroups", () => {
  const rows = [
    { id: "red", pr: pr({ checks: { state: "failure" } }) },
    { id: "waiting", pr: pr() },
    { id: "mine", pr: null },
    { id: "landed", pr: pr({ state: "MERGED" }) },
    { id: "dropped", pr: pr({ state: "CLOSED" }) },
  ];

  it("orders the lanes most-actionable first", () => {
    const groups = buildReviewGroups(rows, (r) => r.pr);
    expect(groups.map((g) => g.group)).toEqual([...REVIEW_GROUP_ORDER]);
    expect(groups.map((g) => g.items[0].id)).toEqual([
      "red",
      "waiting",
      "mine",
      "landed",
      "dropped",
    ]);
  });

  it("drops empty lanes rather than showing hollow headers", () => {
    const groups = buildReviewGroups([{ id: "a", pr: null }], (r) => r.pr);
    expect(groups).toHaveLength(1);
    expect(groups[0].group).toBe("in-progress");
  });

  it("never loses a row", () => {
    const groups = buildReviewGroups(rows, (r) => r.pr);
    expect(groups.reduce((n, g) => n + g.items.length, 0)).toBe(rows.length);
  });

  it("handles an empty list", () => {
    expect(buildReviewGroups([], () => null)).toEqual([]);
  });
});
