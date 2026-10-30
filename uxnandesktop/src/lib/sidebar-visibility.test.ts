import { describe, expect, it } from "vitest";
import {
  canHide,
  canHideIdle,
  hidesImmediately,
  isRowShown,
  isSuppressed,
  nextLingering,
  pruneHidden,
  sidebarEmptyState,
  surfaceReason,
  type EmptyStateInputs,
  type VisibilityInputs,
} from "./sidebar-visibility";

/** A quiet, hidden, ordinary child worktree — the case the feature exists for. */
const quiet: VisibilityInputs = {
  hidden: true,
  isMain: false,
  pinned: false,
  active: false,
  attention: 4,
  closable: false,
  lingering: false,
};
const with_ = (patch: Partial<VisibilityInputs>): VisibilityInputs => ({ ...quiet, ...patch });

describe("surfaceReason / isSuppressed", () => {
  it("holds back a hidden worktree that is quiet", () => {
    expect(surfaceReason(quiet)).toBeNull();
    expect(isSuppressed(quiet)).toBe(true);
  });

  it("never suppresses a worktree that was not hidden", () => {
    expect(isSuppressed(with_({ hidden: false }))).toBe(false);
  });

  it.each([
    [1, "needs you"],
    [2, "an unread result"],
    [3, "working"],
  ] as const)("brings a hidden worktree back at attention class %s (%s)", (attention, _why) => {
    expect(surfaceReason(with_({ attention }))).toBe("attention");
    expect(isSuppressed(with_({ attention }))).toBe(false);
  });

  it("lets it go again once the agent is idle", () => {
    expect(isSuppressed(with_({ attention: 3 }))).toBe(false);
    expect(isSuppressed(with_({ attention: 4 }))).toBe(true);
  });

  it("keeps a worktree shown after its agent goes quiet, until the user moves on", () => {
    // The result was read (attention fell back to 4) but nothing selected another
    // worktree yet: the row must not leave under the pointer.
    expect(surfaceReason(with_({ attention: 4, lingering: true }))).toBe("lingering");
    expect(isSuppressed(with_({ attention: 4, lingering: true }))).toBe(false);
    expect(isSuppressed(with_({ attention: 4, lingering: false }))).toBe(true);
  });

  it("never hides what is ready to close", () => {
    expect(surfaceReason(with_({ closable: true }))).toBe("closable");
    expect(isSuppressed(with_({ closable: true }))).toBe(false);
  });

  it("never hides the selected worktree, nor a pinned one, nor the primary one", () => {
    expect(surfaceReason(with_({ active: true }))).toBe("active");
    expect(surfaceReason(with_({ pinned: true }))).toBe("pinned");
    expect(surfaceReason(with_({ isMain: true }))).toBe("main");
  });

  it("names the strongest reason when several apply", () => {
    expect(surfaceReason(with_({ isMain: true, active: true, closable: true, attention: 1 }))).toBe(
      "main",
    );
    expect(surfaceReason(with_({ active: true, closable: true, attention: 1 }))).toBe("active");
    expect(surfaceReason(with_({ closable: true, attention: 1 }))).toBe("closable");
  });
});

describe("canHide / hidesImmediately / canHideIdle", () => {
  const visible = with_({ hidden: false });

  it("offers Hide for an ordinary worktree", () => {
    expect(canHide(visible)).toBe(true);
    expect(hidesImmediately(visible)).toBe(true);
  });

  it("does not offer Hide for the primary, pinned or ready-to-close worktree", () => {
    expect(canHide({ ...visible, isMain: true })).toBe(false);
    expect(canHide({ ...visible, pinned: true })).toBe(false);
    expect(canHide({ ...visible, closable: true })).toBe(false);
  });

  it("does not offer Hide for one that is already hidden", () => {
    expect(canHide(quiet)).toBe(false);
  });

  it("does not bulk-hide, or call immediate, a worktree that is still lingering", () => {
    const l = { ...visible, lingering: true };
    expect(hidesImmediately(l)).toBe(false);
    expect(canHideIdle(l, "inert")).toBe(false);
  });

  it("lets a selected or working worktree be hidden, but only once it goes quiet", () => {
    const selected = { ...visible, active: true };
    const working = { ...visible, attention: 3 as const };
    expect(canHide(selected)).toBe(true);
    expect(hidesImmediately(selected)).toBe(false);
    expect(canHide(working)).toBe(true);
    expect(hidesImmediately(working)).toBe(false);
  });

  it("bulk-hides only what the panel already calls inert", () => {
    expect(canHideIdle(visible, "inert")).toBe(true);
    expect(canHideIdle(visible, "active")).toBe(false);
    expect(canHideIdle(visible, "done")).toBe(false);
    expect(canHideIdle(visible, "abandoned")).toBe(false);
  });

  it("bulk-hides nothing that would not leave the list at once", () => {
    expect(canHideIdle({ ...visible, active: true }, "inert")).toBe(false);
    expect(canHideIdle({ ...visible, attention: 2 }, "inert")).toBe(false);
    expect(canHideIdle({ ...visible, pinned: true }, "inert")).toBe(false);
    expect(canHideIdle({ ...visible, isMain: true }, "inert")).toBe(false);
    expect(canHideIdle(quiet, "inert")).toBe(false);
  });
});

describe("isRowShown", () => {
  it("drops a suppressed row by default", () => {
    expect(isRowShown(quiet, { showHidden: false, searching: false })).toBe(false);
  });

  it("draws it when 'show hidden' is on", () => {
    expect(isRowShown(quiet, { showHidden: true, searching: false })).toBe(true);
  });

  it("finds it when searching — a typed name must not vanish into 'hidden'", () => {
    expect(isRowShown(quiet, { showHidden: false, searching: true })).toBe(true);
  });

  it("draws every worktree that was never hidden", () => {
    expect(isRowShown(with_({ hidden: false }), { showHidden: false, searching: false })).toBe(true);
  });
});

describe("nextLingering", () => {
  const ctx = {
    activePath: "/a",
    previousActivePath: "/a",
    hidden: ["/x", "/y"],
    attentive: [] as string[],
  };

  it("starts a linger for a hidden worktree an agent is surfacing now", () => {
    expect(nextLingering([], { ...ctx, attentive: ["/x"] })).toEqual(["/x"]);
  });

  it("keeps it after the agent goes quiet — the result was read", () => {
    const after = nextLingering(["/x"], { ...ctx, attentive: [] });
    expect(after).toEqual(["/x"]);
  });

  it("ends every linger when the user selects another worktree", () => {
    expect(nextLingering(["/x", "/y"], { ...ctx, activePath: "/b", attentive: [] })).toEqual([]);
  });

  it("restarts one the agent is still surfacing when the user moves on", () => {
    expect(nextLingering(["/x"], { ...ctx, activePath: "/b", attentive: ["/x"] })).toEqual(["/x"]);
  });

  it("forgets a worktree that is no longer hidden, and never repeats one", () => {
    expect(nextLingering(["/x", "/gone"], { ...ctx, attentive: ["/x"] })).toEqual(["/x"]);
  });
});

describe("pruneHidden", () => {
  it("forgets paths whose worktree is gone", () => {
    expect(pruneHidden(["/a", "/b", "/c"], new Set(["/a", "/c"]))).toEqual(["/a", "/c"]);
  });

  it("returns the very same list when nothing changed", () => {
    const list = ["/a"];
    expect(pruneHidden(list, new Set(["/a", "/z"]))).toBe(list);
  });
});

describe("sidebarEmptyState", () => {
  const base: EmptyStateInputs = {
    view: "flat",
    projectCount: 3,
    matchedProjectCount: 3,
    rowCount: 0,
    query: "",
    hiddenCount: 0,
    showHidden: false,
  };
  const state = (patch: Partial<EmptyStateInputs>) => sidebarEmptyState({ ...base, ...patch });

  it("asks for a project when there is none, in any view", () => {
    expect(state({ projectCount: 0, matchedProjectCount: 0 })).toBe("no-projects");
    expect(state({ view: "tree", projectCount: 0, matchedProjectCount: 0 })).toBe("no-projects");
  });

  it("says a search matched nothing", () => {
    expect(state({ query: "zzz", matchedProjectCount: 0 })).toBe("no-match");
    expect(state({ view: "tree", query: "zzz", matchedProjectCount: 0 })).toBe("no-match");
    expect(state({ query: "zzz", rowCount: 0 })).toBe("no-match");
  });

  it("offers the hidden ones when they are why a flat view is empty", () => {
    expect(state({ hiddenCount: 4 })).toBe("all-hidden");
  });

  it("is not 'all hidden' once they are shown, or when nothing is hidden", () => {
    expect(state({ hiddenCount: 4, showHidden: true })).toBe("no-worktrees");
    expect(state({ hiddenCount: 0 })).toBe("no-worktrees");
  });

  it("has nothing to say while there are rows, or while the tree has cards", () => {
    expect(state({ rowCount: 2, hiddenCount: 4 })).toBe("none");
    expect(state({ view: "tree", rowCount: 0, hiddenCount: 4 })).toBe("none");
  });

  it("does not mistake a hidden-only project for an empty tree", () => {
    // Every child hidden, but the card and its primary worktree still draw.
    expect(state({ view: "tree", projectCount: 1, matchedProjectCount: 1, hiddenCount: 5 })).toBe("none");
  });
});
