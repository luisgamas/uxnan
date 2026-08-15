import { describe, expect, it } from "vitest";
import {
  canonicalFor,
  keyTarget,
  parseWorkspaceKey,
  pathKey,
  reconcilePlan,
  samePath,
  sameWorkspace,
  workspaceKey,
} from "./pathid";

describe("pathKey / samePath", () => {
  it("treats separator spellings as the same folder", () => {
    expect(samePath("C:/Users/dev/repo", "C:\\Users\\dev\\repo")).toBe(true);
  });

  it("ignores case (Windows path semantics)", () => {
    expect(samePath("C:/Users/Dev/Repo", "c:/users/dev/repo")).toBe(true);
  });

  it("ignores trailing slashes", () => {
    expect(samePath("C:/Users/dev/repo/", "C:/Users/dev/repo")).toBe(true);
    expect(pathKey("C:/x//")).toBe("c:/x");
  });

  it("distinguishes genuinely different folders", () => {
    expect(samePath("C:/Users/dev/repo", "C:/Users/dev/repo2")).toBe(false);
  });

  it("handles UNC/WSL spellings uniformly", () => {
    expect(samePath("\\\\wsl$\\Ubuntu\\home\\dev", "//wsl$/Ubuntu/home/dev")).toBe(true);
  });
});

describe("canonicalFor", () => {
  it("returns the first known spelling that matches", () => {
    const known = ["C:/a/wt", "C:\\a"];
    expect(canonicalFor("C:\\a\\wt", known)).toBe("C:/a/wt");
    expect(canonicalFor("C:/a/", known)).toBe("C:\\a");
  });

  it("returns undefined when nothing matches", () => {
    expect(canonicalFor("C:/gone", ["C:/a"])).toBeUndefined();
  });
});

describe("reconcilePlan", () => {
  const known = ["C:/repo/wt-a", "C:/repo/wt-b", "C:\\repo"];

  it("skips the Global workspace key", () => {
    const plan = reconcilePlan([""], known);
    expect(plan.rekeys).toEqual([]);
    expect(plan.unknown).toEqual([]);
  });

  it("leaves canonically-spelled keys alone", () => {
    const plan = reconcilePlan(["C:/repo/wt-a"], known);
    expect(plan.rekeys).toEqual([]);
    expect(plan.unknown).toEqual([]);
  });

  it("re-keys alternate spellings to the known one", () => {
    const plan = reconcilePlan(["C:\\repo\\wt-a", "c:/REPO/"], known);
    expect(plan.rekeys).toEqual([
      ["C:\\repo\\wt-a", "C:/repo/wt-a"],
      ["c:/REPO/", "C:\\repo"],
    ]);
    expect(plan.unknown).toEqual([]);
  });

  it("routes unmatched keys to the existence check", () => {
    const plan = reconcilePlan(["C:/somewhere/else"], known);
    expect(plan.rekeys).toEqual([]);
    expect(plan.unknown).toEqual(["C:/somewhere/else"]);
  });
});

describe("workspaceKey / parseWorkspaceKey", () => {
  it("keeps a local key as the bare path, so nothing persisted changes", () => {
    expect(workspaceKey("local", "C:/repo")).toBe("C:/repo");
    expect(workspaceKey(undefined, "C:/repo")).toBe("C:/repo");
    expect(workspaceKey(null, "/home/u/repo")).toBe("/home/u/repo");
  });

  it("prefixes a remote key with its target", () => {
    expect(workspaceKey("ssh:h1", "/home/u/repo")).toBe("ssh:h1::/home/u/repo");
  });

  it("round-trips both forms", () => {
    expect(parseWorkspaceKey("C:/repo")).toEqual({ target: "local", path: "C:/repo" });
    expect(parseWorkspaceKey("ssh:h1::/home/u/repo")).toEqual({
      target: "ssh:h1",
      path: "/home/u/repo",
    });
    expect(keyTarget("ssh:h1::/x")).toBe("ssh:h1");
    expect(keyTarget("C:/x")).toBe("local");
  });

  it("splits at the first separator, so a path containing '::' survives", () => {
    const key = workspaceKey("ssh:h1", "/home/u/we::ird");
    expect(parseWorkspaceKey(key).path).toBe("/home/u/we::ird");
  });

  it("treats a Windows drive letter as a path, never as a target", () => {
    // `C:` looks like a scheme; only known target prefixes may claim a key.
    expect(parseWorkspaceKey("C:/a::b")).toEqual({ target: "local", path: "C:/a::b" });
  });
});

describe("sameWorkspace (identity is the pair, not the path)", () => {
  it("still tolerates spelling differences within one machine", () => {
    expect(sameWorkspace("C:/repo/wt", "C:\\repo\\WT")).toBe(true);
    expect(
      sameWorkspace(workspaceKey("ssh:h1", "/home/u/repo/"), workspaceKey("ssh:h1", "/home/u/repo")),
    ).toBe(true);
  });

  it("never merges the same path across two machines", () => {
    const a = workspaceKey("ssh:h1", "/home/u/repo");
    const b = workspaceKey("ssh:h2", "/home/u/repo");
    expect(sameWorkspace(a, b)).toBe(false);
    expect(sameWorkspace(a, "/home/u/repo")).toBe(false); // remote vs local
  });

  it("does not fold host ids (they are ids, not user-typed paths)", () => {
    expect(sameWorkspace(workspaceKey("ssh:H1", "/x"), workspaceKey("ssh:h1", "/x"))).toBe(false);
  });
});

describe("reconcilePlan across targets", () => {
  it("re-keys only within the same machine", () => {
    const known = [workspaceKey("ssh:h1", "/home/u/repo"), "C:/repo"];
    const plan = reconcilePlan([workspaceKey("ssh:h1", "/home/u/repo/"), "C:\\repo"], known);
    expect(plan.rekeys).toEqual([
      ["ssh:h1::/home/u/repo/", "ssh:h1::/home/u/repo"],
      ["C:\\repo", "C:/repo"],
    ]);
    expect(plan.unknown).toEqual([]);
  });

  it("never re-points a workspace at another machine that shares its path", () => {
    // The data-loss case: host h2 is registered, h1 is not. The h1 workspace is
    // unknown (drop candidate) — it must not be adopted by h2.
    const known = [workspaceKey("ssh:h2", "/home/u/repo")];
    const plan = reconcilePlan([workspaceKey("ssh:h1", "/home/u/repo")], known);
    expect(plan.rekeys).toEqual([]);
    expect(plan.unknown).toEqual(["ssh:h1::/home/u/repo"]);
  });
});
