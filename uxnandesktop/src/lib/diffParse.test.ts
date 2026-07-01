import { describe, it, expect } from "vitest";
import { splitCommitDiff, commitFileDiff } from "./diffParse";

const MODIFIED = `diff --git a/src/app.ts b/src/app.ts
index 1111111..2222222 100644
--- a/src/app.ts
+++ b/src/app.ts
@@ -1,3 +1,3 @@
-const x = 1;
+const x = 2;
 const y = 3;`;

const ADDED = `diff --git a/new.txt b/new.txt
new file mode 100644
index 0000000..3333333
--- /dev/null
+++ b/new.txt
@@ -0,0 +1 @@
+hello`;

const DELETED = `diff --git a/gone.txt b/gone.txt
deleted file mode 100644
index 4444444..0000000
--- a/gone.txt
+++ /dev/null
@@ -1 +0,0 @@
-bye`;

const RENAMED = `diff --git a/old/name.ts b/new/name.ts
similarity index 90%
rename from old/name.ts
rename to new/name.ts
index 5555555..6666666 100644
--- a/old/name.ts
+++ b/new/name.ts
@@ -1 +1 @@
-old
+new`;

const BINARY = `diff --git a/logo.png b/logo.png
index 7777777..8888888 100644
Binary files a/logo.png and b/logo.png differ`;

describe("splitCommitDiff", () => {
  it("returns [] for an empty diff", () => {
    expect(splitCommitDiff("")).toEqual([]);
  });

  it("parses a modified file", () => {
    const [f] = splitCommitDiff(MODIFIED);
    expect(f.path).toBe("src/app.ts");
    expect(f.status).toBe("modified");
    expect(f.diff).toContain("@@ -1,3 +1,3 @@");
  });

  it("parses added / deleted / renamed statuses", () => {
    expect(splitCommitDiff(ADDED)[0]).toMatchObject({ path: "new.txt", status: "added" });
    expect(splitCommitDiff(DELETED)[0]).toMatchObject({ path: "gone.txt", status: "deleted" });
    const r = splitCommitDiff(RENAMED)[0];
    expect(r).toMatchObject({ path: "new/name.ts", oldPath: "old/name.ts", status: "renamed" });
  });

  it("parses a binary file from the header line", () => {
    const [f] = splitCommitDiff(BINARY);
    expect(f.path).toBe("logo.png");
    expect(f.status).toBe("modified");
  });

  it("splits a multi-file commit into one chunk per file", () => {
    const files = splitCommitDiff(`${MODIFIED}\n${ADDED}\n${DELETED}`);
    expect(files.map((f) => f.path)).toEqual(["src/app.ts", "new.txt", "gone.txt"]);
    // Each chunk keeps its own header and nothing from the next file.
    expect(files[0].diff.startsWith("diff --git a/src/app.ts")).toBe(true);
    expect(files[0].diff).not.toContain("new.txt");
  });

  it("does not treat a removed `--- ` content line as a header marker", () => {
    const tricky = `diff --git a/doc.md b/doc.md
index 1..2 100644
--- a/doc.md
+++ b/doc.md
@@ -1,2 +1,1 @@
---- not a header
 keep`;
    const [f] = splitCommitDiff(tricky);
    expect(f.path).toBe("doc.md");
    expect(f.status).toBe("modified");
  });
});

describe("commitFileDiff", () => {
  it("extracts one file's chunk by path", () => {
    const full = `${MODIFIED}\n${ADDED}`;
    expect(commitFileDiff(full, "new.txt")).toBe(ADDED);
    expect(commitFileDiff(full, "src/app.ts")).toContain("const x = 2;");
  });

  it("returns '' for an unknown path", () => {
    expect(commitFileDiff(MODIFIED, "nope.ts")).toBe("");
  });
});
