import { describe, expect, it } from "vitest";
import {
  folderName,
  formatWorktreeHint,
  shortSha,
  SHORT_SHA_LENGTH,
  worktreeIdentity,
} from "./worktree-label";

describe("folderName", () => {
  it.each([
    ["/home/me/code/uxnan", "uxnan"],
    ["/home/me/code/uxnan/", "uxnan"],
    ["C:\\Users\\me\\code\\uxnan--hotfix", "uxnan--hotfix"],
    ["C:/work/wt/", "wt"],
    ["solo", "solo"],
  ])("takes the last segment of %s", (path, expected) => {
    expect(folderName(path)).toBe(expected);
  });

  it("falls back to the path when there is no segment", () => {
    expect(folderName("/")).toBe("/");
  });
});

describe("shortSha", () => {
  it("abbreviates a full commit id", () => {
    expect(shortSha("0123456789abcdef0123456789abcdef01234567")).toBe("0123456");
    expect(shortSha("0123456789")?.length).toBe(SHORT_SHA_LENGTH);
  });

  it("keeps an already short id and rejects a missing one", () => {
    expect(shortSha("abc12")).toBe("abc12");
    expect(shortSha("  ")).toBeNull();
    expect(shortSha(null)).toBeNull();
    expect(shortSha(undefined)).toBeNull();
  });
});

describe("worktreeIdentity", () => {
  it("names a worktree on a branch by its branch, with no hint", () => {
    expect(
      worktreeIdentity({ branch: "feat/login", path: "/w/uxnan--feat-login", head: "abc1234" }),
    ).toEqual({ title: "feat/login", hint: null });
  });

  it("names a detached worktree by its folder and says where HEAD stands", () => {
    expect(
      worktreeIdentity({
        branch: null,
        path: "/w/uxnan/review-pr-42",
        head: "9fceb02d0ae598e95dc970b74767f19372d61af8",
      }),
    ).toEqual({ title: "review-pr-42", hint: { kind: "detached", sha: "9fceb02" } });
  });

  it("tells two detached worktrees of one project apart", () => {
    const a = worktreeIdentity({ branch: null, path: "/w/uxnan/a", head: "1111111aaa" });
    const b = worktreeIdentity({ branch: null, path: "/w/uxnan/b", head: "2222222bbb" });
    expect(a.title).not.toBe(b.title);
  });

  it("treats a blank branch as no branch", () => {
    expect(worktreeIdentity({ branch: "  ", path: "/w/x", head: null }).title).toBe("x");
  });

  it("still detached, just without a commit, when git gave none", () => {
    expect(worktreeIdentity({ branch: null, path: "/w/x", head: null })).toEqual({
      title: "x",
      hint: { kind: "detached", sha: null },
    });
  });

  it("does not claim a remote repository is detached when nothing was read", () => {
    expect(worktreeIdentity({ branch: null, path: "/srv/app", head: null, remote: true })).toEqual({
      title: "app",
      hint: { kind: "not-read" },
    });
  });

  it("does report a remote detached HEAD once the host answered with a commit", () => {
    expect(
      worktreeIdentity({ branch: null, path: "/srv/app", head: "abcdef0123", remote: true }).hint,
    ).toEqual({ kind: "detached", sha: "abcdef0" });
  });

  it("falls back to the commit, then the raw path, for a path with no folder", () => {
    expect(worktreeIdentity({ branch: null, path: "/", head: "abcdef0123" }).title).toBe("/");
  });
});

describe("formatWorktreeHint", () => {
  const t = (key: string, params?: Record<string, string | number>) =>
    params ? `${key}:${JSON.stringify(params)}` : key;

  it("words each hint through the translator", () => {
    expect(formatWorktreeHint({ kind: "detached", sha: "abc1234" }, t as never)).toBe(
      'worktree.detachedAt:{"sha":"abc1234"}',
    );
    expect(formatWorktreeHint({ kind: "detached", sha: null }, t as never)).toBe("worktree.detached");
    expect(formatWorktreeHint({ kind: "not-read" }, t as never)).toBe("remote.branchNotRead");
  });
});
