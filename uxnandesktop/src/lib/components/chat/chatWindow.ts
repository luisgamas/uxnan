// Which of a conversation's loaded turns the timeline renders.
//
// A chat tab stays mounted while hidden (`display: none`), so every turn it
// renders is DOM the webview keeps, restyles and lays out whenever the tab is
// shown — one long conversation held 56 000 nodes, and the hidden chats were
// 99 % of a workspace's document. So the timeline renders a window: the newest
// turns, plus whatever older ones the reader has scrolled back to. It only
// grows toward the past while the reader is in history, and goes back to the
// newest turns when the tab is hidden with the reader at the end.
//
// The window is kept as the `seq` of its first turn, not as a count: a count
// would slide forward as new turns stream in and pull the history the reader is
// looking at out from under them.

import type { Turn } from "$shared/models/thread";

/** How many of the newest turns a timeline renders at first. */
export const TURN_WINDOW = 6;

/** The whole loaded history. */
export const EVERYTHING = Number.NEGATIVE_INFINITY;

function numbered(turns: readonly Turn[]): number[] {
  const seqs: number[] = [];
  for (const turn of turns) if (typeof turn.seq === "number") seqs.push(turn.seq);
  return seqs;
}

/** Where a window of the newest [size] turns starts. Turns without a `seq` yet
 *  are always rendered (they are the newest), so only numbered ones count. */
export function newestWindowStart(turns: readonly Turn[], size = TURN_WINDOW): number {
  const seqs = numbered(turns);
  return seqs.length > size ? seqs[seqs.length - size]! : EVERYTHING;
}

/** The turns a window starting at [start] renders, in order. */
export function windowed(turns: readonly Turn[], start: number): Turn[] {
  if (start === EVERYTHING) return [...turns];
  return turns.filter((turn) => typeof turn.seq !== "number" || turn.seq >= start);
}

/** How many loaded turns sit above the window, not rendered. */
export function hiddenAbove(turns: readonly Turn[], start: number): number {
  if (start === EVERYTHING) return 0;
  let count = 0;
  for (const seq of numbered(turns)) if (seq < start) count++;
  return count;
}

/** The window grown [by] more turns toward the past. */
export function grownStart(turns: readonly Turn[], start: number, by = TURN_WINDOW): number {
  if (start === EVERYTHING) return EVERYTHING;
  const above = numbered(turns).filter((seq) => seq < start);
  return above.length > by ? above[above.length - by]! : EVERYTHING;
}

/** A window that includes [turnId] (and everything after it). */
export function startIncluding(turns: readonly Turn[], start: number, turnId: string): number {
  const turn = turns.find((t) => t.id === turnId);
  if (!turn || typeof turn.seq !== "number" || start === EVERYTHING) return start;
  return Math.min(start, turn.seq);
}
