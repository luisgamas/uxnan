# Pets — animated companions that mirror agent state

An optional, purely cosmetic companion that floats over the ADE and animates
according to what your agents are doing. It never changes how an agent works.

> The pet lives **inside the uxnan window**. Giving it its own always-on-top
> desktop window (visible over other apps and while uxnan is minimized) is
> planned but not shipped — see `FOR-DEV.md`.

Pets are **off by default**. Turn them on from the sidebar **profile menu →
Show pet**, or in **Settings → Pets**.

---

## What the pet reacts to

The ADE already knows precise, per-agent state from the
[hook layer](./agent-hooks.md), and those states drive the animation directly:

| Agent state | Pet shows | Animation played |
|---|---|---|
| `working` | Working | `running` |
| `waiting` | Needs you | `waiting` |
| `done` | Ready | `review` |
| `blocked` | Blocked | `failed` |
| *(nothing reporting)* | Resting | `idle` |

A report that hasn't been updated for 30 minutes is treated as stale and
ignored, so the pet returns to resting instead of miming work that ended long
ago (same staleness rule the sidebar uses to dim a report).

**Clicking the pet jumps to the terminal of the agent it is showing** — so it
doubles as a shortcut to whatever needs you. Turn that off with
*Settings → Pets → Click to jump to the agent*.

### One pet, or a colony

- **One pet** (default) — a single companion for the whole app. When several
  agents report at once, the most urgent one wins:
  **needs you → blocked → ready → working**.
- **One per agent** — every reporting agent gets its own pet, each following its
  own work. This is possible because the ADE tracks agents individually.

Set it in *Settings → Pets → How many*.

---

## Where pets live

A pet is a folder with a manifest and one spritesheet:

```
<app-data>/pets/<pet-id>/
  pet.json          # the manifest
  spritesheet.png   # every frame in one image (.webp/.gif also accepted)
  ORIGIN            # written on import: where this pet came from
```

`<app-data>` is the ADE's per-user data directory (the same folder as
`state.json`). The pet bundled with uxnan is not stored there — it ships inside
the app under `static/pets/`.

---

## The format

uxnan reads **the same `pet.json` format the Codex CLI uses**, so packs built for
that ecosystem — including community galleries — load here unmodified.

```json
{
  "id": "uxni",
  "displayName": "Uxni",
  "description": "The built-in uxnan companion",
  "spritesheetPath": "spritesheet.png",
  "frame": { "width": 192, "height": 208, "columns": 8, "rows": 9 },
  "animations": {
    "idle":    { "frames": [0, 1, 2, 3], "fps": 8,  "loop": true, "fallback": "idle" },
    "running": { "frames": [8, 9, 10],   "fps": 14, "loop": true, "fallback": "idle" }
  }
}
```

- **Every field is optional.** A pack that is only a spritesheet still works.
- **`frame` is measured when the pack omits it.** Sheets are not all the same
  height — `hatch-pet` v2 packs are **8 × 11** (1536 × 2288), older ones 8 × 9
  (1536 × 1872) — so assuming a grid would slice every frame at the wrong
  offset. When the manifest declares no `columns`/`rows`, the real grid is
  derived from the decoded spritesheet using the conventional 192 × 208 cell.
  A pack that declares its grid is trusted as-is.
- **`frames`** are indices into the sheet, counted **row-major** from 0.
- **`fps`** defaults to 8 and is capped at 60. **`loop`** defaults to true; a
  non-looping animation holds its last frame.
- **`fallback`** names the animation to use when this one is missing — chains are
  followed to `idle`, and a circular chain resolves rather than hanging.
- Animation names in common use: `idle`, `running`, `waiting`, `review`,
  `failed`, `waving`, `jumping`, `sad`, `bounce`.
- `avatar.json` is accepted as an alternative manifest file name.

Anything uxnan adds to the format is optional and ignored by other readers.

---

## Adding pets

**Settings → Pets → Your pets** holds the library. Two import routes:

- **Import from Codex** — appears when `~/.codex/pets` exists on this machine.
- **Import from folder** — point the picker at a folder of pets, or at a single
  pet folder containing `pet.json`.

Either way you get a list of what was found and import them individually or all
at once. A pet whose id already exists is offered as **Replace**.

**Importing a pack with the bundled pet's id replaces it.** The library holds one
entry per id and an imported pet wins over the bundled one, so installing a pack
called `uxni` is how you swap the mascot for your own — no duplicate entry, and
no need to delete anything first.

### Why "Import from Codex" often finds nothing

Codex's eight own pets (`codex`, `dewey`, `fireball`, `rocky`, `seedy`,
`stacky`, `bsod`, `null-signal`) are **compiled into the Codex binary**, not
written to disk. So on a fresh install `~/.codex/pets` is empty and there really
is nothing to import — the folder only fills up with pets you **install or
create**:

```bash
npx codex-pet-cli add <name>   # a community pet from the gallery
```

…or `/hatch` inside Codex, which generates one for you. Either way the pet lands
in `~/.codex/pets/<name>/`, and *then* "Import from Codex" finds it. Community
galleries: [codex-pet.com](https://codex-pet.com) (which also publishes a public
JSON index at `/api/manifest`) and [petdex.crafter.run](https://petdex.crafter.run).

None of this is Codex-specific on our side: **any** folder holding a
`pet.json`/`avatar.json` plus its spritesheet imports, wherever it came from —
downloaded, hand-made, or copied off another machine. The importer accepts the
`.webp` sheets the ecosystem actually ships, as well as `.png` and `.gif`.

### What import actually copies

Import is a **validating copy, not a directory clone**. Only the manifest and the
single spritesheet it references are copied, so importing an untrusted pack can
never drop scripts or stray files into your app data. On top of that:

- pet ids are validated against path traversal (no separators, no `..`, no
  leading dot, ≤ 64 chars);
- `spritesheetPath` must be a **bare file name beside the manifest** — a path
  with separators or `..` is refused, never resolved;
- the sheet must be ≤ 24 MiB and must actually sniff as an image;
- the declared grid is bounded (≤ 2048 px per frame, ≤ 256 columns/rows), and
  frame indices pointing outside the sheet are dropped rather than failing the
  whole pack.

The manifest written to disk is the **sanitized** one that was parsed, not the
raw JSON that came in.

### Attribution

**uxnan bundles exactly one pet — its own.** Every other pet is imported by you
from a folder you already have, and that artwork remains the property of whoever
made it; uxnan neither ships nor redistributes it. The import UI states this, and
each imported pet records where it came from (the `ORIGIN` file), shown under its
name in the library.

---

## Settings reference

| Setting | Default | Notes |
|---|---|---|
| Show a pet | off | Master switch; also in the profile menu |
| How many | One pet | One pet, or one per reporting agent |
| Corner | Bottom right | The pet can also be dragged anywhere |
| Size | Medium (96 px) | Small / Medium / Large / Extra large |
| Animate | on | Off shows a single still frame |
| Click to jump to the agent | on | Clicking opens that agent's terminal |

All of it persists in `AppSettings.pets` (`state.json`).

**Dragging:** press and drag the pet anywhere; on release it snaps to the nearest
corner and remembers its exact offset from it. Dragging is pointer-based because
Tauri suppresses HTML5 drag-and-drop in the webview.

---

## Performance and accessibility

- **Frame-boundary scheduling.** The renderer wakes only when the displayed frame
  actually changes (`msUntilNextFrame`), so an 8 fps sprite costs 8 wakeups a
  second rather than 60. A still frame or a settled one-shot schedules nothing.
- **Parked while hidden.** Animation stops entirely when the window is hidden.
- **Reduced motion.** With the OS "reduce motion" preference on, the pet renders
  a single frame and never animates — the same result as turning *Animate* off.
- **Nothing loads until enabled.** The library (and its spritesheet) is only
  fetched once pets are switched on, so a disabled companion costs nothing at
  boot.
- The pet hides itself while Settings is open (the Pets section has its own live
  preview instead).

---

## Where the code lives

| Concern | File |
|---|---|
| Storage, import, validation | `src-tauri/src/pets.rs` |
| Tauri commands | `src-tauri/src/commands.rs` (`pets_*`) |
| Persisted settings | `src-tauri/src/model.rs` (`PetSettings`) |
| Manifest parsing | `src/lib/pets/manifest.ts` |
| Frame timing | `src/lib/pets/animator.ts` |
| Agent state → animation | `src/lib/pets/status.ts` |
| Library + live state | `src/lib/state/pets.svelte.ts` |
| Rendering | `src/lib/components/PetSprite.svelte` |
| The floating layer | `src/lib/components/PetLayer.svelte` |
| Settings section | `src/lib/components/PetsSettings.svelte` |
| Bundled pet | `static/pets/uxni/` |

