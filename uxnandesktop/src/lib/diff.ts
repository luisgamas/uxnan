// Unified-diff parsing helpers — power hunk-level staging and the side-by-side
// view. Pure functions (no Svelte/DOM), so they're easy to reason about.

/** Image extensions the diff viewer renders visually (before/after) instead of
 *  as a text diff. Kept in sync with the backend `git::image_mime`. */
const IMAGE_EXTENSIONS = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "bmp",
  "ico",
  "svg",
  "avif",
  "tif",
  "tiff",
]);

/** Whether `path` is an image the viewer should diff visually (by extension). */
export function isImagePath(path: string): boolean {
  const dot = path.lastIndexOf(".");
  if (dot < 0) return false;
  return IMAGE_EXTENSIONS.has(path.slice(dot + 1).toLowerCase());
}

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

/** The editor change gutter, derived from a file's `git diff HEAD`: which new-file
 *  lines are additions, and which removed lines sit at a given new-file line (for
 *  the "peek the deleted lines" marker — we never show the full diff inline). */
export interface GutterDiff {
  /** 1-based new-file line numbers that are added (light highlight). */
  added: Set<number>;
  /** new-file line number → the consecutive removed lines that were deleted just
   *  before it (rendered on demand when the gutter marker is clicked). */
  removed: Map<number, string[]>;
}

/** Parse a `git diff HEAD -- <file>` into [`GutterDiff`]. Lines are tracked on
 *  the **new** side so they map onto the editor document; a run of deletions is
 *  attached to the new-file line that follows it (clamped to ≥ 1). */
export function parseHeadDiff(diff: string): GutterDiff {
  const added = new Set<number>();
  const removed = new Map<number, string[]>();
  const { hunks } = parseDiff(diff);

  const stash = (line: number, lines: string[]) => {
    if (lines.length === 0) return;
    const key = Math.max(1, line);
    const prev = removed.get(key);
    if (prev) prev.push(...lines);
    else removed.set(key, [...lines]);
  };

  for (const hunk of hunks) {
    const m = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(hunk.header);
    let newLine = m ? Math.max(1, parseInt(m[1], 10)) : 1;
    let pending: string[] = [];
    for (const line of hunk.lines.slice(1)) {
      if (line.startsWith("+")) {
        stash(newLine, pending);
        pending = [];
        added.add(newLine);
        newLine++;
      } else if (line.startsWith("-")) {
        pending.push(line.slice(1));
      } else if (line === "\\ No newline at end of file") {
        // git's no-newline marker — not a real line.
      } else {
        stash(newLine, pending);
        pending = [];
        newLine++; // context line
      }
    }
    stash(newLine - 1, pending); // trailing deletions sit at the hunk's last line
  }
  return { added, removed };
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
