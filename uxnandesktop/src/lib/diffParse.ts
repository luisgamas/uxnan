// Split a full commit diff (the output of `git show --format= -p <hash>`) into
// per-file chunks, so the History tab can list a commit's changed files and show
// each file's diff on its own (far more readable than one giant blob). Pure
// string work — no backend round-trip beyond the single `git_show` we already do.

export type CommitFileStatus = "added" | "modified" | "deleted" | "renamed";

export interface CommitFile {
  /** Display path (the new path; for a deletion, the removed path). */
  path: string;
  /** The previous path, for renames only. */
  oldPath?: string;
  status: CommitFileStatus;
  /** The unified-diff chunk for just this file (incl. its `diff --git` header). */
  diff: string;
}

const HEADER = /^diff --git /;

/** Break a full commit diff into one `CommitFile` per changed file. */
export function splitCommitDiff(full: string): CommitFile[] {
  if (!full) return [];
  const chunks: string[] = [];
  let cur: string[] | null = null;
  for (const line of full.split("\n")) {
    if (HEADER.test(line)) {
      if (cur) chunks.push(cur.join("\n"));
      cur = [line];
    } else if (cur) {
      cur.push(line);
    }
    // Any preamble before the first `diff --git` (none with `--format=`) is dropped.
  }
  if (cur) chunks.push(cur.join("\n"));
  return chunks.map(parseChunk);
}

/** The diff chunk for a single file within a full commit diff (empty if absent). */
export function commitFileDiff(full: string, path: string): string {
  return splitCommitDiff(full).find((f) => f.path === path)?.diff ?? "";
}

const strip = (p: string) => (p.startsWith("a/") || p.startsWith("b/") ? p.slice(2) : p);

function parseChunk(chunk: string): CommitFile {
  const lines = chunk.split("\n");
  let status: CommitFileStatus = "modified";
  let plusPath = "";
  let minusPath = "";
  let renameFrom = "";
  let renameTo = "";

  // Paths from the `diff --git a/<old> b/<new>` header (fallback for binary files
  // that carry no ---/+++ markers). Greedy split is fine for the common case.
  let gitOld = "";
  let gitNew = "";
  const g = /^diff --git a\/(.+) b\/(.+)$/.exec(lines[0] ?? "");
  if (g) {
    gitOld = g[1];
    gitNew = g[2];
  }

  // Scan only the file header (everything before the first `@@` hunk), so a
  // removed line like `--- text` inside a hunk can't be mistaken for a marker.
  for (const l of lines) {
    if (l.startsWith("@@ ")) break;
    if (l.startsWith("new file mode")) status = "added";
    else if (l.startsWith("deleted file mode")) status = "deleted";
    else if (l.startsWith("rename from ")) {
      status = "renamed";
      renameFrom = l.slice("rename from ".length);
    } else if (l.startsWith("rename to ")) renameTo = l.slice("rename to ".length);
    else if (l.startsWith("--- ")) minusPath = l.slice(4);
    else if (l.startsWith("+++ ")) plusPath = l.slice(4);
  }

  let path: string;
  let oldPath: string | undefined;
  if (status === "renamed") {
    oldPath = renameFrom || strip(gitOld);
    path = renameTo || strip(gitNew);
  } else if (status === "deleted") {
    path = minusPath && minusPath !== "/dev/null" ? strip(minusPath) : strip(gitOld || gitNew);
  } else {
    // added / modified: prefer the `+++ b/<path>` marker, else the header.
    path = plusPath && plusPath !== "/dev/null" ? strip(plusPath) : strip(gitNew || gitOld);
  }

  return { path, oldPath, status, diff: chunk };
}
