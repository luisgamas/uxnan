import { describe, expect, it } from "vitest";
import {
  classifyCompletion,
  isClosable,
  shouldCheckIntegration,
  type CompletionInputs,
} from "./worktree-completion";

/** A workspace in play: dirty, no PR, nothing decided. */
function base(over: Partial<CompletionInputs> = {}): CompletionInputs {
  return {
    pr: null,
    status: { dirty: 2, ahead: 0, behind: 0 },
    integrated: null,
    hasLiveAgent: false,
    isMain: false,
    ...over,
  };
}

const QUIET = { dirty: 0, ahead: 0, behind: 0 };

describe("classifyCompletion", () => {
  it("keeps a worktree with uncommitted work active", () => {
    expect(classifyCompletion(base())).toBe("active");
  });

  it("never judges the primary worktree, whatever else says", () => {
    expect(
      classifyCompletion(
        base({ isMain: true, pr: { state: "MERGED" }, integrated: true, status: QUIET }),
      ),
    ).toBe("active");
  });

  it("reads a merged pull request as done", () => {
    expect(classifyCompletion(base({ pr: { state: "MERGED" } }))).toBe("done");
  });

  it("reads a closed pull request as abandoned", () => {
    expect(classifyCompletion(base({ pr: { state: "CLOSED" } }))).toBe("abandoned");
  });

  it("normalizes the provider's casing", () => {
    expect(classifyCompletion(base({ pr: { state: " merged " } }))).toBe("done");
  });

  it("keeps an open pull request active even when the checkout is quiet", () => {
    expect(classifyCompletion(base({ pr: { state: "OPEN" }, status: QUIET }))).toBe("active");
  });

  it("lets the pull request outrank local history", () => {
    // The remote branch is gone and the squash is unexplainable locally, but the
    // provider already said it merged.
    expect(classifyCompletion(base({ pr: { state: "MERGED" }, integrated: false }))).toBe("done");
  });

  it("reads a branch git confirms has landed as done", () => {
    expect(classifyCompletion(base({ integrated: true, status: QUIET }))).toBe("done");
  });

  it("calls a clean, unpushed, unattended worktree inert — not done", () => {
    expect(classifyCompletion(base({ status: QUIET, integrated: false }))).toBe("inert");
  });

  it("keeps a quiet worktree active while an agent is alive in it", () => {
    expect(classifyCompletion(base({ status: QUIET, hasLiveAgent: true }))).toBe("active");
  });

  it("keeps a worktree with unpushed commits active", () => {
    expect(classifyCompletion(base({ status: { dirty: 0, ahead: 3, behind: 0 } }))).toBe("active");
  });

  it("stays active while the status is still unknown", () => {
    expect(classifyCompletion(base({ status: null }))).toBe("active");
  });
});

describe("isClosable", () => {
  it("only proposes closing what uxnan can defend", () => {
    expect(isClosable("done")).toBe(true);
    expect(isClosable("abandoned")).toBe(true);
    // The whole point: "nothing moved lately" must never offer a delete.
    expect(isClosable("inert")).toBe(false);
    expect(isClosable("active")).toBe(false);
  });
});

describe("shouldCheckIntegration", () => {
  it("asks git only for a quiet worktree with no verdict yet", () => {
    expect(shouldCheckIntegration(base({ status: QUIET }))).toBe(true);
  });

  it("does not spend a git call when the answer is already known", () => {
    expect(shouldCheckIntegration(base({ status: QUIET, integrated: false }))).toBe(false);
    expect(shouldCheckIntegration(base({ status: QUIET, integrated: true }))).toBe(false);
  });

  it("does not spend a git call when the pull request already decided", () => {
    for (const state of ["MERGED", "CLOSED", "OPEN"]) {
      expect(shouldCheckIntegration(base({ status: QUIET, pr: { state } }))).toBe(false);
    }
  });

  it("does not spend a git call on a busy or dirty worktree", () => {
    expect(shouldCheckIntegration(base())).toBe(false);
    expect(shouldCheckIntegration(base({ status: QUIET, hasLiveAgent: true }))).toBe(false);
    expect(shouldCheckIntegration(base({ status: { dirty: 0, ahead: 1, behind: 0 } }))).toBe(false);
  });

  it("never asks about the primary worktree", () => {
    expect(shouldCheckIntegration(base({ status: QUIET, isMain: true }))).toBe(false);
  });
});
