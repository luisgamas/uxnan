import { describe, expect, it } from "vitest";
import {
  addKnown,
  baselineKnown,
  canHide,
  canHideIdle,
  hidesImmediately,
  isAuthoritativeList,
  isExternalWorktree,
  isRowShown,
  isSetAside,
  isSuppressed,
  nextLingering,
  pruneMarks,
  sidebarEmptyState,
  surfaceReason,
  type EmptyStateInputs,
  type VisibilityInputs,
} from "./sidebar-visibility";

/** A quiet, hidden, ordinary child worktree — the case the feature exists for. */
const quiet: VisibilityInputs = {
  hidden: true,
  external: false,
  quiet: true,
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

describe("pruneMarks", () => {
  it("forgets paths whose worktree is gone", () => {
    expect(pruneMarks(["/a", "/b", "/c"], new Set(["/a", "/c"]))).toEqual(["/a", "/c"]);
  });

  it("returns the very same list when nothing changed", () => {
    const list = ["/a"];
    expect(pruneMarks(list, new Set(["/a", "/z"]))).toBe(list);
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

// --- Worktrees created outside Uxnan -------------------------------------------

/** An external, untouched, not-hidden worktree — what an agent's scratch checkout
 *  looks like to the panel. */
const outside: VisibilityInputs = { ...quiet, hidden: false, external: true, quiet: true };
const outside_ = (patch: Partial<VisibilityInputs>): VisibilityInputs => ({ ...outside, ...patch });

describe("isExternalWorktree", () => {
  const base = { isMain: false, createdByUxnan: false, known: false };

  it("is a worktree nobody at Uxnan made and nobody took in", () => {
    expect(isExternalWorktree(base)).toBe(true);
  });

  it("is not one Uxnan made — whichever creator left its record", () => {
    expect(isExternalWorktree({ ...base, createdByUxnan: true })).toBe(false);
  });

  it("is not one that was taken in (it was there first, or it was shown once)", () => {
    expect(isExternalWorktree({ ...base, known: true })).toBe(false);
  });

  it("is never the primary worktree", () => {
    expect(isExternalWorktree({ ...base, isMain: true })).toBe(false);
  });
});

describe("an external worktree is set aside while it is untouched", () => {
  it("holds back an external worktree that is quiet, with nobody having hidden it", () => {
    expect(isSetAside(outside)).toBe(true);
    expect(surfaceReason(outside)).toBeNull();
    expect(isSuppressed(outside)).toBe(true);
  });

  it("keeps one with work in it: dirty, unpushed, a live agent or an open PR is not 'untouched'", () => {
    // `quiet` is the completion verdict `inert`; anything else is `active`.
    expect(isSetAside(outside_({ quiet: false }))).toBe(false);
    expect(isSuppressed(outside_({ quiet: false }))).toBe(false);
  });

  it("does not touch a worktree that is neither external nor hidden", () => {
    expect(isSuppressed(outside_({ external: false }))).toBe(false);
  });

  it("is surfaced by the very same reasons as a hidden one", () => {
    expect(isSuppressed(outside_({ active: true }))).toBe(false);
    expect(isSuppressed(outside_({ pinned: true }))).toBe(false);
    expect(isSuppressed(outside_({ attention: 1 }))).toBe(false);
    expect(isSuppressed(outside_({ attention: 3 }))).toBe(false);
    expect(isSuppressed(outside_({ closable: true }))).toBe(false);
    expect(isSuppressed(outside_({ lingering: true }))).toBe(false);
    expect(isSuppressed(outside_({ isMain: true }))).toBe(false);
    expect(isSuppressed(outside_({ attention: 4 }))).toBe(true);
  });

  it("stays held back when the user also hid it, even if it has work in it", () => {
    // Hiding is the user's decision and does not lapse when the work arrives.
    expect(isSuppressed(outside_({ hidden: true, quiet: false }))).toBe(true);
  });

  it("is lifted by 'show hidden' and by a search, like a hidden one", () => {
    expect(isRowShown(outside, { showHidden: false, searching: false })).toBe(false);
    expect(isRowShown(outside, { showHidden: true, searching: false })).toBe(true);
    expect(isRowShown(outside, { showHidden: false, searching: true })).toBe(true);
  });

  it("is not offered Hide while it is already set aside — that is Show — but is once it has work", () => {
    expect(canHide(outside)).toBe(false);
    expect(canHide(outside_({ quiet: false }))).toBe(true);
    expect(canHide(outside_({ external: false, hidden: false }))).toBe(true);
  });

  it("is not taken by a bulk 'hide idle' — it is already out of the list", () => {
    expect(canHideIdle(outside, "inert")).toBe(false);
  });
});

describe("isAuthoritativeList", () => {
  it("trusts a list with several worktrees, or one that names a branch", () => {
    expect(isAuthoritativeList([{ branch: null }, { branch: "x" }])).toBe(true);
    expect(isAuthoritativeList([{ branch: "main" }])).toBe(true);
  });

  it("does not trust the stand-in a host gets while it cannot be asked", () => {
    expect(isAuthoritativeList([{ branch: null }])).toBe(false);
    expect(isAuthoritativeList([])).toBe(false);
  });
});

describe("baselineKnown (what was already there when this arrived)", () => {
  const entry = (path: string, over: Partial<{ isMain: boolean; createdByUxnan: boolean }> = {}) => ({
    path,
    isMain: false,
    createdByUxnan: false,
    ...over,
  });

  it("takes in every worktree that is already there, so none of them vanishes", () => {
    const list = [entry("/r", { isMain: true }), entry("/r--a"), entry("/r--b")];
    expect(baselineKnown([], list)).toEqual(["/r--a", "/r--b"]);
  });

  it("needs no entry for what Uxnan made, nor for the primary worktree", () => {
    const list = [entry("/r", { isMain: true }), entry("/r--ours", { createdByUxnan: true })];
    const known: string[] = ["/other"];
    expect(baselineKnown(known, list)).toBe(known);
  });

  it("keeps what was known and never repeats a path", () => {
    expect(baselineKnown(["/r--a"], [entry("/r--a"), entry("/r--b")])).toEqual(["/r--a", "/r--b"]);
  });

  it("returns the very same list when there is nothing to add", () => {
    const known = ["/r--a"];
    expect(baselineKnown(known, [entry("/r--a")])).toBe(known);
  });

  it("leaves a worktree that appears afterwards external", () => {
    const known = baselineKnown([], [entry("/r", { isMain: true }), entry("/r--old")]);
    const knownSet = new Set(known);
    const fresh = entry("/r--fresh");
    expect(isExternalWorktree({ ...fresh, known: knownSet.has(fresh.path) })).toBe(true);
    expect(isExternalWorktree({ ...entry("/r--old"), known: knownSet.has("/r--old") })).toBe(false);
  });
});

describe("addKnown", () => {
  it("adds the new paths, once", () => {
    expect(addKnown(["/a"], ["/b", "/a", "/b"])).toEqual(["/a", "/b"]);
  });

  it("returns the very same list when nothing is new", () => {
    const known = ["/a", "/b"];
    expect(addKnown(known, ["/b"])).toBe(known);
  });
});
