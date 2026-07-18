import { describe, expect, it } from "vitest";
import { canonicalFor, pathKey, reconcilePlan, samePath } from "./pathid";

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
