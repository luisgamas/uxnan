// Pointer interactions — how the pet answers being poked or carried.
//
// The ecosystem's convention (and the desktop reference's behavior) is small
// and readable: clicking a pet makes it jump, dragging carries it, and while
// carried it looks down at the ground below. Packs without the needed rows
// degrade through the ordinary fallback chains, so an incomplete pack still
// reacts — just less specifically.
//
// Pure constants, shared by the in-window layer and the desktop overlay.

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
