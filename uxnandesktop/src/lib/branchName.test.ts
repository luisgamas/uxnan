import { describe, expect, it } from "vitest";
import { branchSlug, worktreeFolderFor } from "./branchName";

describe("worktreeFolderFor", () => {
  it("puts the worktree beside its repo, named <repo>--<branch>", () => {
    expect(worktreeFolderFor("C:/code/uxnan", "pr-42")).toBe("C:/code/uxnan--pr-42");
    expect(worktreeFolderFor("/home/me/uxnan", "issue-7")).toBe("/home/me/uxnan--issue-7");
  });

  it("flattens slashes in the branch, which can't appear in a folder name", () => {
    expect(worktreeFolderFor("C:/code/uxnan", "feat/github")).toBe(
      "C:/code/uxnan--feat-github",
    );
  });

  it("canonicalizes to forward slashes, matching what git reports", () => {
    // A backslash form would never compare equal to the worktree git lists, so a
    // freshly-created worktree would look like it didn't exist.
    expect(worktreeFolderFor("C:\\code\\uxnan", "pr-42")).toBe("C:/code/uxnan--pr-42");
  });

  it("ignores a trailing separator on the repo path", () => {
    expect(worktreeFolderFor("C:/code/uxnan/", "pr-1")).toBe("C:/code/uxnan--pr-1");
  });
});

describe("branchSlug", () => {
  it("lowercases and joins words with single dashes", () => {
    expect(branchSlug("Fix the login")).toBe("fix-the-login");
  });

  it("collapses punctuation runs and trims the edges", () => {
    expect(branchSlug("  Fix: the login!!  ")).toBe("fix-the-login");
  });

  it("folds accents rather than dropping the whole word", () => {
    expect(branchSlug("Añadir sesión")).toBe("anadir-sesion");
  });

  it("caps the length without leaving a trailing dash", () => {
    expect(branchSlug("a".repeat(80))).toHaveLength(50);
    expect(branchSlug("aaaa bbbb cccc dddd", 10)).toBe("aaaa-bbbb");
  });

  it("returns empty for a title with nothing sluggable", () => {
    expect(branchSlug("!!! ???")).toBe("");
  });
});
