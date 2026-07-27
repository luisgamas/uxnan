<script lang="ts">
  // One animated pet, rendered from its spritesheet.
  //
  // The sheet is a single image holding every frame in a row-major grid, so the
  // only thing that moves is `background-position` — the browser composites it
  // on the GPU and no canvas or per-frame decode is involved.
  //
  // Timing is scheduled on frame boundaries (`msUntilNextFrame`) rather than on
  // requestAnimationFrame: an 8 fps sprite then wakes 8 times a second instead
  // of 60, and a settled one-shot or a still frame schedules nothing at all.
  // The animation is also fully parked while the window is hidden, and reduced
  // to a single frame under `prefers-reduced-motion`.
  import { untrack } from "svelte";
  import {
    resolveAnimation,
    framePosition,
    type Pet,
    type PetAnimation,
  } from "$lib/pets/manifest";
  import { frameAt, hasSettled, msUntilNextFrame, prefixMs } from "$lib/pets/animator";
  import { planFlavour } from "$lib/pets/personality";

  interface Props {
    pet: Pet;
    /** Spritesheet URL (a static path for the bundled pet, else a data URL). */
    sheet: string;
    /** Animation name to play; falls back through the pack's own chain. */
    animation: string;
    /** Rendered height in px; the sprite keeps its aspect ratio. */
    size?: number;
    /** Master motion switch (the user's setting). */
    animate?: boolean;
    /** Let the pet occasionally break its loop with a short one-shot (look
     *  around while resting, wave when it needs you). Off for previews, where
     *  the point is to show one state exactly as chosen. */
    flavour?: boolean;
    /** Interaction one-shot (e.g. the click reaction): an animation played at
     *  full pace, winning over flavour, look and the base loop. The caller owns
     *  its lifetime — set it, then clear it to resume. */
    override?: string | null;
    /** Static pose held while the pet is being carried. Wins over everything,
     *  including `override` — a dragged pet is busy being dragged. */
    holdFrame?: number | null;
    /** Static look pose (a sheet index from the v2 look rows). Only honored
     *  while the pet is resting on its idle loop — a pet mid-state keeps
     *  playing that state. */
    lookFrame?: number | null;
    class?: string;
  }

  let {
    pet,
    sheet,
    animation,
    size = 96,
    animate = true,
    flavour = true,
    override = null,
    holdFrame = null,
    lookFrame = null,
    class: className = "",
  }: Props = $props();

  /** A short one-shot currently interrupting the base loop, if any.
   *
   *  Always a *different* animation than the base — see `personality.ts`. Both
   *  edges of a flavour hand the renderer a new animation, and the second one
   *  (back to the base) restarts the state's row from the top: that replay is
   *  how a state the pet had long since settled out of shows itself again, and
   *  it is why a flavour that resolved to the base itself made the pet perform
   *  twice over. */
  let flavourAnim = $state<string | null>(null);

  // Schedule flavour one-shots for as long as the base animation holds. The
  // cycle restarts whenever the state (and so the base animation) changes, so a
  // real state change always wins over a decorative one.
  $effect(() => {
    const base = animation;
    flavourAnim = null;
    // No decoration while an interaction plays: the user's poke owns the stage,
    // and the cycle restarts cleanly once the override clears.
    if (!flavour || !animate || reduced || !visible || override) return;

    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const cycle = () => {
      if (stopped) return;
      const plan = planFlavour(base);
      if (!plan) return;
      timer = setTimeout(() => {
        if (stopped) return;
        flavourAnim = plan.animation;
        timer = setTimeout(() => {
          if (stopped) return;
          flavourAnim = null;
          cycle();
        }, plan.holdMs);
      }, plan.delayMs);
    };
    cycle();

    return () => {
      stopped = true;
      if (timer !== undefined) clearTimeout(timer);
    };
  });

  // One pace for everything: a flavour, a state and a click reaction all play
  // the row exactly as the animation set times it (`STATE_PACE` is baked in),
  // so the same wave never looks calm in one context and frantic in another.
  const anim = $derived(resolveAnimation(pet, override ?? flavourAnim ?? animation));

  /** Frame index currently displayed (an index into the sheet, not the list). */
  let frame = $state(0);
  /** Honour the OS "reduce motion" preference — a still pet, never a jitter. */
  let reduced = $state(false);
  /** Park the animation entirely while the window is hidden (zero wakeups). */
  let visible = $state(true);

  /** The animation the pet has already played through and is now looping the
   *  tail of — i.e. it is visually breathing. Held as the animation itself, so
   *  it is self-invalidating: a new animation is not settled until it says so. */
  let settledAnim = $state<PetAnimation | null>(null);
  /** Whether what is playing right now has settled. */
  const settled = $derived(settledAnim === anim);

  /** Static pose to hold instead of animating, when an interaction asks for
   *  one. Carried (`holdFrame`) wins outright; a look pose only applies once the
   *  pet is visually at rest. Reduced motion keeps its still frame.
   *
   *  "At rest" is [`hasSettled`], not "the agent state is idle". Those used to be
   *  the same thing, because every state expired within minutes and the pet spent
   *  most of its life on the idle animation. Now a state lives for as long as its
   *  agent keeps reporting, while its *animation* settles seconds in — so keying
   *  the look pose off the state meant a pet that never once glanced at the cursor
   *  during a long task. Keying it off the animation keeps the original rule
   *  intact (a gesture is never interrupted mid-move) and restores the glance. */
  const staticFrame = $derived(
    reduced || !animate
      ? null
      : holdFrame != null
        ? holdFrame
        : override == null && flavourAnim == null && settled && lookFrame != null
          ? lookFrame
          : null,
  );

  $effect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => (reduced = mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  });

  $effect(() => {
    const sync = () => (visible = !document.hidden);
    sync();
    document.addEventListener("visibilitychange", sync);
    return () => document.removeEventListener("visibilitychange", sync);
  });

  // Re-runs whenever the animation, the motion setting or visibility changes.
  // Restarting on an animation change means a state transition plays from its
  // first frame rather than joining the new cycle part-way through.
  $effect(() => {
    const a = anim;
    // A held pose is a single frame: show it and schedule nothing.
    if (staticFrame !== null) {
      frame = staticFrame;
      return;
    }
    // Resuming an animation that had already played through — the look pose it
    // was holding just ended — picks up at the loop point instead of the top.
    // Starting over would perform the whole gesture again every time the cursor
    // wandered off, which is the pet performing twice for one event.
    // Untracked: this effect must not re-run merely because the flag was set.
    const resuming = untrack(() => settledAnim) === a;
    const offset = resuming ? prefixMs(a) : 0;
    frame = frameAt(a, offset);
    if (reduced || !animate || !visible) return;

    const startedAt = performance.now() - offset;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;

    const tick = () => {
      if (stopped) return;
      const elapsed = performance.now() - startedAt;
      frame = frameAt(a, elapsed);
      if (!resuming && hasSettled(a, elapsed)) settledAnim = a;
      const next = msUntilNextFrame(a, elapsed);
      if (next === null) return; // nothing left to schedule
      timer = setTimeout(tick, Math.max(16, next));
    };
    tick();

    return () => {
      stopped = true;
      if (timer !== undefined) clearTimeout(timer);
    };
  });

  // Scale the whole sheet so one frame is exactly `size` tall.
  const scale = $derived(size / pet.frame.height);
  const width = $derived(Math.round(pet.frame.width * scale));
  const sheetWidth = $derived(pet.frame.width * pet.frame.columns * scale);
  const sheetHeight = $derived(pet.frame.height * pet.frame.rows * scale);
  const pos = $derived(framePosition(pet.frame, frame));
</script>

<div
  class={className}
  style:width="{width}px"
  style:height="{size}px"
  style:background-image="url('{sheet}')"
  style:background-size="{sheetWidth}px {sheetHeight}px"
  style:background-position="{-pos.x * scale}px {-pos.y * scale}px"
  style:background-repeat="no-repeat"
  aria-hidden="true"
></div>
