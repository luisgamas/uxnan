// Panel widths are persisted, and on the Rust side they are `u32`
// (`left_sidebar_width`, `right_sidebar_width`, `browser_panel_width` in
// `model.rs`). Serde rejects a float for a `u32`, and it rejects the *whole*
// `AppSettings` payload — so a fractional pixel does not merely round badly, it
// fails the entire settings write with
// `invalid type: floating point '312.57421875', expected u32`, taking every
// other setting in that snapshot down with it.
//
// A drag produces exactly that. Pointer coordinates are whole numbers on
// Windows but subpixel on macOS (a trackpad reports fractional `clientX`), so
// `startWidth + (e.clientX - startX)` is fractional there and integral here —
// which is why the resize handles worked on Windows and broke the first time
// someone dragged one on a Mac. The same rule already governs the pet's
// drag-to-park offsets (`PetLayer.svelte`), which round their measured rect.

/** Clamp a dragged panel width into `[min, max]` as a whole number of pixels.
 *
 *  Rounding is not cosmetic: see the note above — the persisted field is `u32`,
 *  and a float fails the whole `update_settings` call. Every write to a
 *  persisted panel width goes through here. */
export function clampPanelWidth(width: number, min: number, max: number): number {
  return Math.round(Math.min(max, Math.max(min, width)));
}
