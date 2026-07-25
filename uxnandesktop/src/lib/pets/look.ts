// Look-direction poses — what the v2 sheet's last two rows are for.
//
// A v2 pack (`spriteVersionNumber: 2`, 8x11 grid) reserves rows 9 and 10 for a
// single continuous 16-pose clockwise "look" loop: row 9 holds 0°–157.5°, row
// 10 holds 180°–337.5°, in 22.5° steps, where 0° means looking **up** (12
// o'clock) — not neutral. They are poses to *hold*, one at a time, facing the
// cursor; playing them in sequence is exactly the full-sheet sweep that makes a
// pet look broken.
//
// Neutral/front has no pose of its own: it is the pointer deadzone, and inside
// it the pet simply rests on its idle animation.
//
// Pure module (no DOM, no Tauri) so the maths are unit-testable and shared by
// the in-window layer and the desktop overlay window alike.

import type { Pet } from "./manifest";

/** Poses in the look loop: 22.5° apart, clockwise from 12 o'clock. */
export const LOOK_POSES = 16;

/** Row (0-indexed) where the look loop starts; it spans two full rows. */
const LOOK_ROW = 9;

/** The grid the look rows are defined for. The v2 contract is exactly 8
 *  columns by 11 rows; any other shape has no convention saying where (or
 *  whether) the poses live. */
const LOOK_COLUMNS = 8;
const LOOK_MIN_ROWS = 11;

/** Cursor distance (px at render scale) under which the pet stays neutral. */
export const LOOK_DEADZONE_PX = 40;

/** How long the pet keeps watching a cursor that stopped moving, in ms. */
export const LOOK_LINGER_MS = 4_000;

/** The pose held while the pet is carried: looking straight down. */
export const LOOK_DOWN_DEG = 180;

/**
 * Whether `pet`'s sheet carries the 16 look poses.
 *
 * True for a declared v2 pack, and for a measured (underdeclared) pack whose
 * sheet turned out to have the v2 shape — packs imported before the version
 * field was preserved lost the declaration but kept the rows. A pack that
 * explicitly declared an 11-row grid *and* its own animations without the
 * version is left alone: it told us its layout, and that layout said nothing
 * about look poses.
 */
export function hasLookPoses(pet: Pet): boolean {
  return (
    pet.frame.columns === LOOK_COLUMNS &&
    pet.frame.rows >= LOOK_MIN_ROWS &&
    (pet.spriteVersion >= 2 || !pet.frameExplicit)
  );
}

/**
 * Angle of the vector `(dx, dy)` in look degrees: 0° is up, growing clockwise,
 * with `dy` positive downward (screen coordinates).
 */
export function lookAngle(dx: number, dy: number): number {
  const deg = (Math.atan2(dx, -dy) * 180) / Math.PI;
  return (deg + 360) % 360;
}

/**
 * Sheet index of the pose looking along `angleDeg`, or `null` when the pet has
 * no look poses. Angles snap to the nearest of the 16 directions (`348.75°`
 * wraps back to pose 0).
 */
export function lookFrameIndex(pet: Pet, angleDeg: number): number | null {
  if (!hasLookPoses(pet)) return null;
  const step = 360 / LOOK_POSES;
  const pose = Math.round((((angleDeg % 360) + 360) % 360) / step) % LOOK_POSES;
  return LOOK_ROW * pet.frame.columns + pose;
}
