// Frame timing — "given this animation and how long it has been playing, which
// sprite shows now?".
//
// Kept pure (no rAF, no clock of its own) so the renderer owns the loop and the
// maths stay unit-testable. The renderer passes elapsed milliseconds; this
// answers with a sprite index.
//
// Two properties of the format shape everything here:
//
//   • every frame carries its **own** duration — a resting pose is held for
//     nearly two seconds while an in-between passes in half of one;
//   • an animation has a **loop point**: frames before it play once, the rest
//     repeat forever. A state animation puts its own row before that point and
//     the idle frames after it, so the pet reacts a few times and then settles.

import type { PetAnimation } from "./manifest";

/** Total run time of one full pass (prefix + one turn of the loop), in ms. */
export function durationMs(anim: PetAnimation): number {
  let total = 0;
  for (const frame of anim.frames) total += frame.ms;
  return total;
}

/** Run time of the play-once prefix, in ms. */
function prefixMs(anim: PetAnimation): number {
  let total = 0;
  for (let i = 0; i < Math.min(anim.loopStart, anim.frames.length); i++) {
    total += anim.frames[i].ms;
  }
  return total;
}

/** The frame slot showing at `t` ms, where `t` is already inside the timeline. */
function slotAt(anim: PetAnimation, t: number): number {
  let acc = 0;
  for (let i = 0; i < anim.frames.length; i++) {
    acc += anim.frames[i].ms;
    if (t < acc) return i;
  }
  return anim.frames.length - 1;
}

/**
 * Map elapsed time onto a position in the timeline, folding the looping tail
 * back on itself. Returns `null` once an animation with nothing to loop has
 * finished — it then holds its last frame forever.
 */
function positionAt(anim: PetAnimation, elapsedMs: number): number | null {
  const total = durationMs(anim);
  const t = Math.max(0, elapsedMs);
  if (t < total) return t;

  const prefix = prefixMs(anim);
  const loopMs = total - prefix;
  if (loopMs <= 0) return null;
  return prefix + ((t - prefix) % loopMs);
}

/**
 * The sprite to display `elapsedMs` into `anim`.
 *
 * Returns `0` for an empty animation rather than `undefined`, so a malformed
 * pack still renders the sheet's first frame.
 */
export function frameAt(anim: PetAnimation, elapsedMs: number): number {
  if (anim.frames.length === 0) return 0;
  const t = positionAt(anim, elapsedMs);
  if (t === null) return anim.frames[anim.frames.length - 1].index;
  return anim.frames[slotAt(anim, t)].index;
}

/**
 * Milliseconds until the displayed sprite changes, or `null` when it never will
 * (a settled play-once animation, or a single frame). The renderer uses this to
 * sleep exactly until the next change instead of polling.
 */
export function msUntilNextFrame(anim: PetAnimation, elapsedMs: number): number | null {
  if (anim.frames.length <= 1) return null;
  const t = positionAt(anim, elapsedMs);
  if (t === null) return null;

  let acc = 0;
  for (const frame of anim.frames) {
    acc += frame.ms;
    if (t < acc) return acc - t;
  }
  return null;
}
