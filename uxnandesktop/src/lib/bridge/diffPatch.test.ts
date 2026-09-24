import { describe, expect, it } from "vitest";
import { parseDiff } from "$lib/diff";
import { toUnifiedPatch } from "./diffPatch";

describe("toUnifiedPatch", () => {
  it("gives a synthesized edit the hunk header the diff viewer needs", () => {
    const patch = toUnifiedPatch("src/app.ts", "-old line\n+new line\n+another");
    expect(patch).toBe("--- a/src/app.ts\n+++ b/src/app.ts\n@@ -1,1 +1,2 @@\n-old line\n+new line\n+another");
    expect(parseDiff(patch!).hunks).toHaveLength(1);
  });

  it("keeps a real patch, adding the file header only when it is missing", () => {
    const withHeader = "--- a/x\n+++ b/x\n@@ -1 +1 @@\n-a\n+b";
    expect(toUnifiedPatch("x", withHeader)).toBe(withHeader);
    expect(toUnifiedPatch("x", "@@ -1 +1 @@\n-a\n+b")).toBe("--- a/x\n+++ b/x\n@@ -1 +1 @@\n-a\n+b");
  });

  it("has nothing to show for an empty change", () => {
    expect(toUnifiedPatch("x", "")).toBeNull();
    expect(toUnifiedPatch("x", "\n\n")).toBeNull();
  });
});
