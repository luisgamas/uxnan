/** Pull "what the agent last said" out of a terminal transcript.
 *
 *  The agent card's second line used to show `hook.summary`, but measured
 *  against a real run of all seven agents only Claude ever fills it in — every
 *  other card fell back to the bare status. The transcript is the one material
 *  they all have, so the preview is read from there instead.
 *
 *  Kept apart from `instances.ts` on purpose: that module owns live xterm
 *  objects and cannot be unit-tested, while this is the part with the judgement
 *  in it.
 */

/** Braille frames every CLI spinner cycles through. */
const SPINNER = /[⠀-⣿]/;

/** Box drawing, block elements and the arrows TUIs frame their panes with. */
const DECORATION = /[─-╿▀-▟■-◿←-⇿]/g;

/** Markers a CLI puts in front of its own output (Claude's `⏺`, bullets). */
const LEADING_MARKER = /^[⏺●○•‣▶→*+\-\s]+/;

/** Footer chrome: shortcut hints, context meters, token counters. */
const FOOTER =
  /(for shortcuts|shortcuts\b|context:\s*\d+%|tokens?\s*(used|left)|esc to|ctrl\+[a-z])/i;

/** Does this line carry something a human would read as content? */
function isSubstantive(line: string): boolean {
  const bare = line.replace(DECORATION, '').trim();
  if (!bare) return false;
  // A frame of an animation, not a sentence.
  if (SPINNER.test(bare)) return false;
  // The user's own turn — the card is showing what the AGENT answered.
  if (bare.startsWith('>')) return false;
  if (FOOTER.test(bare)) return false;
  // Punctuation-only separators and rules.
  if (!/[\p{L}\p{N}]/u.test(bare)) return false;
  // A lone marker with nothing after it.
  return bare.replace(LEADING_MARKER, '').trim().length > 1;
}

/** Strip the CLI's own decoration so the card shows a sentence, not glyphs. */
function clean(line: string): string {
  return (
    line
      .replace(DECORATION, '')
      // Bold comes off BEFORE the leading marker: `*` is a marker character, so
      // stripping the marker first eats the opening `**` and strands its pair.
      .replace(/\*\*(.+?)\*\*/g, '$1')
      .replace(/`{1,3}/g, '')
      .replace(LEADING_MARKER, '')
      .replace(/\s+/g, ' ')
      .trim()
  );
}

/**
 * The opening line of the agent's most recent reply, or `null` when the
 * transcript holds nothing worth showing.
 *
 * Walks up from the bottom — the newest output is there — skips the terminal's
 * chrome, then takes the **contiguous block** of real lines it lands in and
 * returns that block's FIRST line. Returning the last line instead would show
 * the tail end of a paragraph, which reads as a fragment; the user asked for
 * the *start* of the last reply, matching the mobile row.
 */
export function lastReplyPreview(transcript: string | null, maxChars = 140): string | null {
  if (!transcript) return null;
  const lines = transcript.split('\n').map((l) => l.trimEnd());

  let end = lines.length - 1;
  while (end >= 0 && !isSubstantive(lines[end])) end--;
  if (end < 0) return null;

  let start = end;
  while (start > 0 && isSubstantive(lines[start - 1])) start--;

  const text = clean(lines[start]);
  if (!text) return null;
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars - 1).trimEnd()}…`;
}
