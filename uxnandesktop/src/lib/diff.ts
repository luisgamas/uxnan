// Unified-diff parsing helpers — power hunk-level staging and the side-by-side
// view. Pure functions (no Svelte/DOM), so they're easy to reason about.

/** One `@@ … @@` hunk within a file's diff. */
export interface Hunk {
  /** Position in the file's hunk list (0-based). */
  index: number;
  /** The `@@ -a,b +c,d @@` header line. */
  header: string;
  /** Every line of the hunk, header included. */
  lines: string[];
  /** 0-based line offset of the header within the full diff text. */
  startLine: number;
}

/** A file's diff split into its header and hunks. */
export interface ParsedDiff {
  /** Lines before the first hunk (`diff --git`, `index`, `---`, `+++`, …). */
  fileHeader: string[];
  hunks: Hunk[];
}

/** Split a single file's unified diff into its header + hunks. */
export function parseDiff(diff: string): ParsedDiff {
  const lines = diff.split("\n");
  const fileHeader: string[] = [];
  const hunks: Hunk[] = [];
  let cur: Hunk | null = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith("@@")) {
      if (cur) hunks.push(cur);
      cur = { index: hunks.length, header: line, lines: [line], startLine: i };
    } else if (cur) {
      cur.lines.push(line);
    } else {
      fileHeader.push(line);
    }
  }
  if (cur) hunks.push(cur);
  return { fileHeader, hunks };
}

/** Build a minimal, apply-able patch for a single hunk: the file header plus
 *  that hunk, newline-terminated (what `git apply` expects on stdin). */
export function hunkPatch(parsed: ParsedDiff, hunk: Hunk): string {
  const body = [...parsed.fileHeader, ...hunk.lines].join("\n");
  return body.endsWith("\n") ? body : body + "\n";
}

/** One visual row of a side-by-side diff. A `del`/`add` shows on one side only
 *  (the other side is a blank filler to keep the two columns aligned). */
export interface SideRow {
  kind: "context" | "del" | "add" | "hunk";
  /** Left (old) text, or null for a filler / add-only row. */
  left: string | null;
  /** Right (new) text, or null for a filler / del-only row. */
  right: string | null;
}

/** Convert a unified diff into aligned side-by-side rows. Deletions land on the
 *  left, additions on the right, context on both; each hunk header is a marker
 *  row. Pairing is line-by-line (not a full LCS) — good enough and predictable. */
export function toSideRows(diff: string): SideRow[] {
  const parsed = parseDiff(diff);
  const rows: SideRow[] = [];
  for (const hunk of parsed.hunks) {
    rows.push({ kind: "hunk", left: hunk.header, right: hunk.header });
    for (const line of hunk.lines.slice(1)) {
      if (line.startsWith("+")) {
        rows.push({ kind: "add", left: null, right: line.slice(1) });
      } else if (line.startsWith("-")) {
        rows.push({ kind: "del", left: line.slice(1), right: null });
      } else if (line === "\\ No newline at end of file") {
        // Skip git's no-newline marker in the visual view.
      } else {
        const text = line.startsWith(" ") ? line.slice(1) : line;
        rows.push({ kind: "context", left: text, right: text });
      }
    }
  }
  return rows;
}
