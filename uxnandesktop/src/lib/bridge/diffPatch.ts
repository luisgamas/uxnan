// The bridge's `diff` blocks come in two shapes: a real unified patch (a CLI
// that reports one), or a synthesized list of `-old` / `+new` lines for an edit
// the agent described (`content-blocks.ts` → `editDiffBlock`). The app's diff
// viewer reads hunks, so a synthesized list is given the one hunk header it
// lacks — the same view as every other diff in the app, whichever the agent sent.

/** A unified patch `DiffView` can render, or `null` when there are no lines. */
export function toUnifiedPatch(filename: string, diff: string): string | null {
  const body = diff.replace(/\r\n/g, "\n").replace(/\n+$/, "");
  if (body.trim().length === 0) return null;
  const lines = body.split("\n");
  if (lines.some((l) => l.startsWith("@@"))) {
    // Already a patch; make sure it names its file so the header reads right.
    return lines.some((l) => l.startsWith("--- ")) ? body : `--- a/${filename}\n+++ b/${filename}\n${body}`;
  }
  const removed = lines.filter((l) => l.startsWith("-")).length;
  const added = lines.filter((l) => l.startsWith("+")).length;
  const context = lines.length - removed - added;
  const hunk = `@@ -1,${removed + context} +1,${added + context} @@`;
  return `--- a/${filename}\n+++ b/${filename}\n${hunk}\n${body}`;
}
