# Pets — animated companions that mirror agent state

An optional, purely cosmetic companion that floats over the ADE and animates
according to what your agents are doing. It never changes how an agent works.

By default the pet **floats over the desktop** in its **own borderless,
transparent, always-on-top window** — visible over other apps and while uxnan
is minimized, draggable anywhere on any monitor, exactly like the Codex desktop
pet. Turn **Settings → Pets → Float over the desktop** off and it lives as a
layer inside the uxnan window instead.

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
| `done` **+ interrupted** | Blocked | `failed` |
| *(nothing reporting)* | Resting | `idle` |

**An interrupted turn is not a result.** Esc / Ctrl-C reports `done` carrying an
interrupt flag — the turn did end, which is what every other consumer (sidebar,
notifications, badges) needs to know. The pet is the one place where that reads
differently: answering a cancelled turn with the pleased "ready" gesture says the
opposite of what happened, so an interrupted `done` shows as **Blocked**
(`petStateOf` in `src/lib/pets/status.ts`). It is also what makes Blocked
reachable at all — of the five agents that report, only OpenCode can raise a
genuine error state (its `session.error`), so the sheet's failed row would
otherwise be all but unused.

**States expire, they are not mirrored.** A pet that mirrors `working` literally
runs without pause for as long as a task takes, which reads as a spinner and
drowns out the states that actually need you. So each state has a lifetime,
measured from when the agent *entered* it — a hook firing on every tool call
cannot renew it:

| State | Shown for | Why |
|---|---|---|
| Working | 3 min | Busy is not actionable; it stops being news |
| Needs you / Blocked / Ready | 30 min | Waiting on a human — it should persist |

A report older than 30 minutes is ignored outright either way, matching the
staleness rule the sidebar uses to dim a report.

**…but a lifetime is not an amnesia.** A state that runs out its lifetime while
its agent is **still reporting** (a hook within the last 90 s) starts the clock
over instead of vanishing. Keeping a spinner off the screen is the *animation's*
job — a state plays its row three times and settles into idle — so expiring the
state as well only meant the pet rested on top of live work, and pointed nowhere
while it did: the click target decays with the state, so poking the pet in the
middle of a long task went nowhere at all. An agent that goes quiet — finished,
crashed, terminal closed — still decays exactly as before.

**Clicking the pet jumps to the terminal of the agent it is showing** — so it
doubles as a shortcut to whatever needs you. Turn that off with
*Settings → Pets → Click to jump to the agent*.

### Idle personality

The state map is only five animations, and a pet that holds one loop forever
reads as a spinner rather than a companion — so on top of the state's base
animation the pet occasionally plays a short one-shot and returns:

| While it is… | It occasionally… | Roughly every |
|---|---|---|
| Resting | waves or hops | 14–34 s |
| Needs you | **waves for attention** | 6–13 s |
| Working | takes a brief breather | 25–50 s |
| Ready | hops, pleased | 25–50 s |
| Blocked | sags | 20–40 s |

**A one-shot costs two bursts of movement, not one — and that is how a state
re-shows itself.** Ending a one-shot hands the renderer a different animation
again (the base), which restarts it from the top, so the state replays its whole
row three times as well. That is the useful half: a state that had long since
settled into its idle tail comes back into view every so often, with no "pulse"
machinery anywhere. It is also why a one-shot is always a **different** row than
the state's own — using the state's own row was tried and reverted, because it
stacks the one-shot on top of the replay it already causes and the pet performs
twice over every cycle: a `done` pet, a state that lasts half an hour, spent that
half hour celebrating.

Cadence therefore reads against how long a state lasts. Needs-you nags every few
seconds because that is its entire job. Resting stirs every half-minute. The
long-lived states — busy for as long as the agent keeps reporting, ready and
blocked for up to 30 minutes — are the calmest of all, since at a livelier
cadence they read as a pet that never settles.

**One pace for every gesture.** The reference's raw row timings (120–150 ms a
frame) are tuned for a glance at a terminal; beside an idle that breathes every
6.6 s they read as a twitch — the wave is over before the eye lands on it. So
the derived rows all play at those times × 1.3 (`STATE_PACE` in `manifest.ts`):
a wave looks the same whether it decorates the idle, answers a click, or fires
because the agent needs you. The stretch is bounded on the other side, and that
bound is the binding one: past roughly a fifth of a second a held frame stops
reading as a pose and starts reading as a pause, and the gesture goes stepped and
mechanical. Both earlier values (2.4 → 288–360 ms a frame, 2.0 → 240–300 ms) were
reported as robotic; 1.3 puts a gesture at **182–195 ms**, the same register as
the carry run, which is where it reads right — a gesture keeps a slightly longer
beat than a run, as it should. A pack that declares its own `fps` knows better
and keeps it.

The state always wins: a real change cancels whatever flavour is playing, so the
texture never hides a signal. A pack missing one of these animations falls back
through its own `fallback` chain, so an incomplete pack degrades rather than
breaking. Flavour is off in the Settings preview, where the point is to see one
state exactly as chosen, and off entirely under reduced motion or with *Animate*
off. Scheduling lives in `src/lib/pets/personality.ts` (pure, unit-tested).

### Interactions

The pet answers the mouse the way the desktop reference does:

- **It watches the cursor.** While at rest, a v2 pack turns toward the pointer
  using the 16 look poses on rows 9–10 (see *The format*), snapping to the
  nearest 22.5° step. Inside the deadzone around the pet (or once the cursor has
  been still for a few seconds) it goes back to breathing. Listener-driven — no
  polling.

  **"At rest" means the animation has played through, not that the agent state is
  idle.** A gesture is still never interrupted mid-move: the pose is only held
  once the current row has run its three passes and the pet is breathing again
  (`hasSettled`). The two used to amount to the same thing, back when every state
  expired within minutes and the pet spent most of its life on the idle
  animation — so gating the glance on the *state* was invisible until states
  started living as long as their agent keeps reporting, at which point the pet
  quietly stopped glancing at all during a long task. Resuming after a glance
  picks up at the loop point, too: replaying the whole gesture every time the
  cursor wandered off would be the pet performing twice for one event.
- **Clicking pokes it.** A click plays the jump reaction (falling back through
  the pack's chain for packs without one), *and* still jumps to the agent's
  terminal when *Click to jump to the agent* is on. A poke leaves **no focus
  rectangle** around the sprite: the webview's default ring boxes the whole
  frame cell — on the click, and again on the next keystroke, since that
  re-evaluates the focus-visible flag — which reads as a selection box drawn
  around the pet. The desktop window drops the ring outright (there is nothing
  else in it to move focus between); the in-window layer keeps a proper ring for
  Tab navigation and blurs after a pointer poke.
- **Dragging carries it, and it runs.** Carried across the desktop, the pet plays
  the **travelling run** that matches the direction of travel (`running-right` /
  `running-left`, sheet rows 1–2 — the one thing those rows are for, and the only
  place they are used). Stop moving and it settles back into the v2 looking-down
  pose, watching the ground go by; a pack with neither travelling runs nor look
  rows wiggles through `jumping` as before. Unlike a state animation, a
  travelling run **loops its own row** rather than settling into idle after three
  passes — a pet standing still halfway through a drag looks broken — and it runs
  at its own quicker, perfectly even pace (`CARRY_PACE`, see *The format*).

All of it obeys *Animate* and the OS reduced-motion preference: with either off,
the pet stays a still frame. Pure maths in `src/lib/pets/look.ts` and constants +
carry helpers in `src/lib/pets/interactions.ts`, both unit-tested.

The two presentations measure the drag differently and share the decision. The
in-window layer reads pointer moves. The desktop window can't: the OS owns that
drag and swallows every pointer event for its duration, so the window's own
movement is the only signal — and it therefore **arms** the carry, rather than
merely feeding one a pointer event started. That distinction is the whole
behaviour: with movement as the only evidence, "it went still" is a *guess* that
the pet was dropped, and if only a press can arm the carry again, a hand pausing
mid-drag ends it permanently — the pet stops running and never resumes, however
long you keep dragging. So any movement re-arms it, and the carry outlives a
still moment by `CARRY_HOLD_MS` (parking the pet then settles it a beat after you
let go, which is what letting go looks like anyway).

### One pet

There is exactly one pet. When several agents report at once it shows the most
urgent state: **needs you → blocked → ready → working**.

**And it is about one of them.** The tooltip names that agent's task and a click
reveals its terminal, so when several agents share the winning state one has to be
chosen: it is **the one that reported most recently**. Picking the first match
instead — the order reports happened to land in a map, roughly the order each
agent first reported since launch — meant the pet pointed at an arbitrary
candidate: neither the agent you are driving nor the one that just moved. It is
deliberately *not* filtered to the selected worktree: the pet would then go quiet
exactly when something elsewhere needs you, which is when it is most useful.

> One pet *per agent* was built and removed. Pets were never assigned to agents —
> that mode simply showed a pet for every agent reporting within the staleness
> window, so a second pet only ever appeared during the brief moments two agents
> worked simultaneously. It also duplicated what the sidebar already reports per
> agent, precisely and with names, while the pet's job is ambient awareness —
> something you catch out of the corner of your eye, which one pet does better
> than five.

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

- **Every field is optional.** A generated pack ships only an id, a description
  and a sheet path — the layout is the format's convention, not per-pack data —
  so both the grid and the animations are recovered from the image itself:
  - **`frame`** is measured when omitted. Sheets are not all the same height
    (`hatch-pet` v2 packs are **8 × 11** = 1536 × 2288, older ones 8 × 9), so
    assuming a grid would slice every frame at the wrong offset.
  - **`animations`** are filled in from the conventional row order below, with
    its declared per-row frame counts — a row is often partly used (a generated
    wave is 4 frames in an 8-wide grid) and playing the blank remainder would
    make the pet flicker out of existence.

  A pack that declares either itself is trusted as-is.

  | Row | Animation | Per frame | Closing frame |
  |---|---|---|---|
  | 0 | `idle` | see below | — |
  | 1 | `running-right` · `move_right` | 120 ms | 220 ms |
  | 2 | `running-left` · `move_left` | 120 ms | 220 ms |
  | 3 | `waving` · `wave` | 140 ms | 280 ms |
  | 4 | `jumping` · `bounce` | 140 ms | 280 ms |
  | 5 | `failed` · `sad` | 140 ms | 240 ms |
  | 6 | `waiting` | 150 ms | 260 ms |
  | 7 | **`running`** (the busy state) | 120 ms | 220 ms |
  | 8 | `review` | 150 ms | 280 ms |
  | 9–10 | **look poses** (v2 only, not an animation) | held | — |

  The table shows the reference's **raw** times; the derived rows play them
  × 1.3 (`STATE_PACE` — see *One pace for every gesture* above). Rows 1–2 are the
  exception at both ends: they play × 1.25 (`CARRY_PACE`) with **every frame the
  same length**, closing frame included. A run is a loop, not a gesture — stretch
  it like one and the carry is slow motion, keep the longer closing frame and the
  run limps once per lap.

  Three details are easy to get wrong and all three are visible immediately:

  - **`running` is row 7, not row 1.** Rows 1–2 are a run that *travels* — which
    is what a pet being **carried** does, and the only thing they are used for
    (see *Interactions*). The busy state is row 7, animated in place; wiring the
    working state to row 1 makes the pet sprint for as long as a task lasts.
    Being a carry loop rather than a reaction, rows 1–2 are also the exception to
    the rule below: they repeat their own row instead of settling into idle.
  - **A state plays three times and then settles into idle.** Each state
    animation is its row repeated three times *followed by the idle frames*, and
    the loop returns to where idle begins. So the pet reacts, then calms down —
    it never performs a state for as long as the state lasts.
  - **Frames have individual durations, not a frame rate.** Idle holds its
    resting poses for 1.68 s and 1.92 s while passing through the in-betweens in
    0.66 s — `[1680, 660, 660, 840, 840, 1920]`, one breath every **6.6 s**. The
    same frames at a flat 8 fps take 0.75 s and look frantic. Every state row
    likewise closes on a longer frame than it runs.
- **The v2 look rows are poses, never an animation.** A pack declaring
  `spriteVersionNumber: 2` (the 8 × 11 layout) reserves its last two rows for a
  single continuous 16-pose clockwise "look" loop: row 9 holds 0°–157.5°, row 10
  holds 180°–337.5°, in 22.5° steps, where **0° means looking up** (12 o'clock).
  One pose is *held* at a time, facing the cursor (see *Interactions* below);
  playing them in sequence is exactly the full-sheet sweep that makes a pet look
  broken. Neutral/front has no pose — it is the pointer deadzone, where the pet
  simply rests on `idle`.
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
| Float over the desktop | on | Off keeps the pet as a layer inside the uxnan window |
| Bring uxnan to the front on click | off | Desktop window only; a poke never covers your work unless you ask |
| Corner | Bottom right | In-window layer only; the desktop window parks by dragging |
| Size | Medium (144 px) | 96 / 144 / 200 / 260 px — the height of the sprite, which a generated pack nearly fills |
| Animate | on | Off shows a single still frame |
| Click to jump to the agent | on | Clicking opens that agent's terminal |

All of it persists in `AppSettings.pets` (`state.json`).

**Dragging (in-window):** press and drag the pet anywhere; on release it snaps to
the nearest corner and remembers its exact offset from it. Dragging is
pointer-based because Tauri suppresses HTML5 drag-and-drop in the webview.

### The desktop window

With *Float over the desktop* on (the default), the pet gets a window of its own
(label `pet`): borderless, transparent, always on top, skipped from the taskbar,
sized to the sprite. What that means in practice:

- **Drag it anywhere** — dragging hands off to the OS-native window drag, which
  stays correct across monitors and DPI scales. The parked position persists,
  and a spot on a monitor that is no longer attached falls back to resting near
  the primary monitor's bottom-right corner.
- **Clicking still jumps to the agent.** By default the agent's terminal is
  revealed without raising uxnan over what you are doing; flip *Bring uxnan to
  the front on click* to also raise the window.
- **Closing uxnan closes the pet.** The window cannot be closed on its own
  (the Settings switch is the way to dismiss it), and it is destroyed with the
  main window so the app never keeps running as nothing but a pet.
- The window is a **thin renderer**: the main window parses packs, measures
  sheets and derives agent state, then pushes everything over Tauri events
  (`pet:config` / `pet:state`), and applies what comes back (`pet:moved`,
  `pet:focus`). It never boots the app shell.

Two implementation constraints worth knowing (each cost a broken round once):
Tauri **capabilities are per window** — the `pet` label has its own
`capabilities/pet.json`, without which `listen`/`emitTo` fail silently and the
window renders empty — and the window loads **by query, per mode**: the static
build has no per-route files (a SvelteKit route URL would 404 packaged) while
the dev server serves routes only at `/` (`/index.html` 404s there), so it is
`index.html?window=pet` packaged and `/?window=pet` in dev, branched in the
root layout.

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
| Idle personality | `src/lib/pets/personality.ts` |
| Look poses (v2 rows 9–10) | `src/lib/pets/look.ts` |
| Pointer-interaction constants | `src/lib/pets/interactions.ts` |
| Library + live state | `src/lib/state/pets.svelte.ts` |
| Rendering | `src/lib/components/PetSprite.svelte` |
| The floating layer + desktop-window controller | `src/lib/components/PetLayer.svelte` |
| The desktop window's renderer | `src/lib/components/PetWindow.svelte` |
| Desktop window commands | `src-tauri/src/commands.rs` (`pet_window_*`, `pet_focus_main`) |
| Desktop window capability | `src-tauri/capabilities/pet.json` |
| Settings section | `src/lib/components/PetsSettings.svelte` |
| Bundled pet | `static/pets/uxni/` |

