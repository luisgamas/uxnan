// Which pets ship inside the app, in library order.
//
// Each id is a folder under `static/pets/<id>/` holding a `pet.json` and its
// spritesheet — ordinary packs in the same Codex-compatible format an imported
// one uses, never special-cased by the renderer. Adding a pet to the app is
// therefore two steps and no code: drop the folder in `static/pets/`, then add
// its id here. Art that is on disk but missing from this list ships in the
// bundle and is never shown, which is exactly what
// `tests/bundled-pets.test.mjs` exists to catch — it holds this list and the
// folders on disk to each other.
//
// Kept in its own module (rather than in the store) so it stays pure: the node
// test project can read it without pulling in the Tauri API or a rune-bearing
// `.svelte.ts`.
export const BUILTIN_PET_IDS = ["uxni", "nox"] as const;

/** The pet shown until the user picks one — the first bundled pet, uxnan's
 *  own mascot. A stored `activePetId` always wins over this. */
export const DEFAULT_PET_ID: string = BUILTIN_PET_IDS[0];
