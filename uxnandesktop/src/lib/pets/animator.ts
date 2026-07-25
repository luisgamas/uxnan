// Frame timing — "given this animation and how long it has been playing, which
// sprite shows now?".
//
// Kept pure (no rAF, no clock of its own) so the renderer owns the loop and the
// maths stay unit-testable. The renderer passes elapsed milliseconds; this
// answers with a frame index into the spritesheet.

import type { PetAnimation } from "./manifest";

/**
 * The frame to display `elapsedMs` into `anim`.
 *
 * A looping animation cycles forever; a non-looping one holds its last frame,
 * which is what makes a one-shot reaction (a wave, a hop) settle instead of
 * snapping back. Returns `0` for an empty animation rather than `undefined`, so
 * a malformed pack still renders the sheet's first frame.
 */
export function frameAt(anim: PetAnimation, elapsedMs: number): number {
  const count = anim.frames.length;
  if (count === 0) return 0;
  const fps = anim.fps > 0 ? anim.fps : 1;
  const step = 1000 / fps;
  const raw = Math.floor(Math.max(0, elapsedMs) / step);
  const i = anim.loop ? ((raw % count) + count) % count : Math.min(raw, count - 1);
  return anim.frames[i];
}

/**
 * Milliseconds until the displayed frame changes, or `null` when it never will
 * (a finished one-shot, or a single-frame animation). The renderer uses this to
 * idle instead of spinning: with reduced motion, or once a one-shot has landed,
 * there is nothing left to schedule.
 */
export function msUntilNextFrame(anim: PetAnimation, elapsedMs: number): number | null {
  const count = anim.frames.length;
  if (count <= 1) return null;
  const fps = anim.fps > 0 ? anim.fps : 1;
  const step = 1000 / fps;
  const e = Math.max(0, elapsedMs);
  if (!anim.loop && Math.floor(e / step) >= count - 1) return null;
  return step - (e % step);
}

/** Total run time of one pass, in ms (useful for scheduling one-shots). */
export function durationMs(anim: PetAnimation): number {
  const fps = anim.fps > 0 ? anim.fps : 1;
  return (anim.frames.length * 1000) / fps;
}
