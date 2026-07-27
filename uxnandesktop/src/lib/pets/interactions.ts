// Pointer interactions — how the pet answers being poked or carried.
//
// The ecosystem's convention (and the desktop reference's behavior) is small
// and readable: clicking a pet makes it jump, dragging carries it, and while
// carried it looks down at the ground below. Packs without the needed rows
// degrade through the ordinary fallback chains, so an incomplete pack still
// reacts — just less specifically.
//
// Pure constants + pure helpers, shared by the in-window layer and the desktop
// overlay window (which drag through completely different machinery — pointer
// events on one side, the OS window drag on the other — and must still agree on
// what the pet does).

import type { Pet } from "./manifest";

/** Animation played when the pet is clicked (a poke). `jumping` falls back
 *  through the pack's chain, so even a minimal pack answers with something. */
export const REACTION_ANIMATION = "jumping";

/** How long the click reaction holds before the pet resumes, in ms. Sized to
 *  one deliberate pass of the jump row at the ambient pace (`STATE_PACE`):
 *  4 x 280 ms + a 560 ms landing ≈ 1.7 s — one clear jump, then back to work.
 *  It tracks the pace: leaving it at the old 2 s would tack a still frame onto
 *  the end of the hop. */
export const REACTION_MS = 1_700;

/** Animation looped while dragging, for packs without the v2 look-down pose. */
export const DRAG_ANIMATION = "jumping";

/** Which way a carried pet is currently being taken; `null` = not travelling. */
export type CarryDirection = "left" | "right" | null;

/** Horizontal travel (px) within one move before the pet turns to face that way.
 *  Small, but not zero: the hand shake in a "still" drag is a pixel or two, and
 *  reacting to it flips the pet back and forth. */
export const CARRY_TURN_PX = 3;

/** How long the pet keeps running after the horizontal travel stops, in ms.
 *  Without it, the pause between two mouse move events reads as a stutter
 *  (run → look down → run) instead of one continuous carry. */
export const CARRY_SETTLE_MS = 280;

/**
 * How long the desktop window keeps counting as *carried* after it stops moving.
 *
 * Only the overlay window needs this. Its drag belongs to the OS, which
 * swallows every pointer event for the duration — so there is no `pointerup` to
 * end the carry, and the only signal available is the window going still. A
 * short window there is wrong in the one direction that matters: pause the hand
 * mid-carry and the pet decides it was dropped, then can never learn otherwise,
 * because nothing but a *new* press can arm the carry again. Generous enough to
 * ride out a real pause; short enough that a parked pet settles a beat after you
 * let go.
 */
export const CARRY_HOLD_MS = 900;

/**
 * The direction a carry is heading, given the horizontal travel of one move.
 *
 * Movement below the threshold (or purely vertical) leaves the direction as it
 * was — the caller ages it out with [`CARRY_SETTLE_MS`] instead, so a carry that
 * pauses settles back to the look-down pose rather than twitching on every
 * sub-pixel jitter.
 */
export function carryDirection(dx: number, current: CarryDirection): CarryDirection {
  if (dx >= CARRY_TURN_PX) return "right";
  if (dx <= -CARRY_TURN_PX) return "left";
  return current;
}

/**
 * The travelling-run animation for a carry direction, or `null` when there is
 * none to play.
 *
 * These are the sheet's rows 1–2 — a run that *moves*, which is exactly what
 * being carried across the desktop is (the busy state uses the in-place row 7).
 * The lookup is deliberate rather than going through `resolveAnimation`: a pack
 * without those rows would fall back to `idle`, and a pet standing perfectly
 * still while you drag it looks broken. Returning `null` instead lets the caller
 * keep the existing behaviour — the v2 look-down pose, or `jumping`.
 */
export function carryAnimation(pet: Pet, direction: CarryDirection): string | null {
  if (!direction) return null;
  const name = direction === "right" ? "running-right" : "running-left";
  return (pet.animations[name]?.frames.length ?? 0) > 0 ? name : null;
}
