// Splits a reply that is still streaming into the part that will never change
// again and the part still being written — the same rule the phone uses
// (`uxnanmobile/.../streaming_markdown_split.dart`), where it was measured on a
// real device: rendering one Markdown body over the whole growing reply made
// the cost of each update grow with the reply's length; rendering finished
// chunks once and re-rendering only the last one made it flat.
//
// In the desktop chat each chunk is its own `MarkdownView`, so a chunk whose
// text did not change keeps its parsed document and its DOM: only the last one
// is re-parsed and re-rendered on each streamed update.
//
// The rule is deliberately conservative. A boundary is only taken at a blank
// line OUTSIDE a fenced code block that is followed by a line which
// unambiguously starts a new block. Anything that might continue what came
// before — a list item, a blockquote, a table row, an indented code line, a
// link reference definition — is never split, because Markdown parsed in
// pieces must render exactly as it does whole (two items of a loose list split
// apart would become two lists; a fence split in two would turn code into
// prose). Every chunk is a verbatim slice: `split(s).join("") === s`.

interface Line {
  start: number;
  /** End of the line's text (before `\r\n` / `\n`). */
  contentEnd: number;
  /** End including the newline, so slices rejoin into the source exactly. */
  end: number;
}

/** A line that may continue the block above it, so nothing may be cut before it. */
const CONTINUATION = /^(?: {0,3}(?:[-*+]|\d{1,9}[.)])(?:\s|$)| {0,3}>| {0,3}\||(?: {4,}|\t)| {0,3}\[[^\]]*\]:)/;

/** Splits `source` so that appending text can only ever change the last chunk.
 *  Empty input gives no chunks; the chunks always join back into `source`. */
export function splitStreamingMarkdown(source: string): string[] {
  if (!source) return [];
  const lines = scanLines(source);
  const chunks: string[] = [];
  let chunkStart = 0;
  let fence = "";

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const text = source.slice(line.start, line.contentEnd);
    if (!fence) {
      const opened = fenceMarker(text);
      if (opened) {
        fence = opened;
        continue;
      }
    } else {
      // Inside a fence nothing is a boundary — not even a blank line.
      if (closesFence(text, fence)) fence = "";
      continue;
    }
    if (text.trim()) continue;
    if (!startsFreshBlock(source, lines, i + 1)) continue;
    chunks.push(source.slice(chunkStart, line.end));
    chunkStart = line.end;
  }

  if (chunkStart < source.length) chunks.push(source.slice(chunkStart));
  return chunks;
}

function scanLines(source: string): Line[] {
  const lines: Line[] = [];
  let start = 0;
  for (let i = 0; i < source.length; i += 1) {
    if (source.charCodeAt(i) !== 0x0a) continue;
    const contentEnd = i > start && source.charCodeAt(i - 1) === 0x0d ? i - 1 : i;
    lines.push({ start, contentEnd, end: i + 1 });
    start = i + 1;
  }
  if (start < source.length) lines.push({ start, contentEnd: source.length, end: source.length });
  return lines;
}

/** The fence a line opens (a run of ``` or ~~~), or null. */
function fenceMarker(line: string): string | null {
  const trimmed = line.trimStart();
  // Four or more leading spaces is an indented code block, not a fence.
  if (line.length - trimmed.length > 3) return null;
  for (const marker of ["```", "~~~"]) {
    if (!trimmed.startsWith(marker)) continue;
    let length = 0;
    while (length < trimmed.length && trimmed[length] === marker[0]) length += 1;
    return marker[0].repeat(length);
  }
  return null;
}

/** Whether `line` closes an open `fence`: same character, at least as long, nothing after it. */
function closesFence(line: string, fence: string): boolean {
  const trimmed = line.trim();
  if (!trimmed || trimmed[0] !== fence[0]) return false;
  let length = 0;
  while (length < trimmed.length && trimmed[length] === fence[0]) length += 1;
  return length >= fence.length && !trimmed.slice(length).trim();
}

/** Whether the first non-blank line at or after `from` starts a block that can
 *  stand on its own. Trailing blank lines alone are never a boundary: the reply
 *  has not written what follows them yet. */
function startsFreshBlock(source: string, lines: Line[], from: number): boolean {
  for (let i = from; i < lines.length; i += 1) {
    const text = source.slice(lines[i].start, lines[i].contentEnd);
    if (!text.trim()) continue;
    return !CONTINUATION.test(text);
  }
  return false;
}

/** How long streamed text may wait before the view catches up: the phone's
 *  measured window (`thread_manager.dart` → `_streamCoalesceWindow`) — one
 *  frame for a short reply, growing with the reply to at most 100 ms, since a
 *  long reply re-renders more on each update. */
export function streamCoalesceWindow(length: number): number {
  return Math.min(100, Math.max(16, Math.floor(length / 60)));
}
