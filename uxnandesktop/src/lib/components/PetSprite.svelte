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
  import { resolveAnimation, framePosition, type Pet } from "$lib/pets/manifest";
  import { frameAt, msUntilNextFrame } from "$lib/pets/animator";
  import { planFlavour, FLAVOUR_SLOWDOWN } from "$lib/pets/personality";

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
    class?: string;
  }

  let {
    pet,
    sheet,
    animation,
    size = 96,
    animate = true,
    flavour = true,
    class: className = "",
  }: Props = $props();

  /** A short one-shot currently interrupting the base loop, if any. */
  let flavourAnim = $state<string | null>(null);

  // Schedule flavour one-shots for as long as the base animation holds. The
  // cycle restarts whenever the state (and so the base animation) changes, so a
  // real state change always wins over a decorative one.
  $effect(() => {
    const base = animation;
    flavourAnim = null;
    if (!flavour || !animate || reduced || !visible) return;

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

  const resolved = $derived(resolveAnimation(pet, flavourAnim ?? animation));

  // A flavour is decoration, so it plays slower than the very same animation
  // would when a real state triggers it — see `FLAVOUR_SLOWDOWN`. State-driven
  // animations are never stretched: there, the pace is the message.
  const anim = $derived(
    flavourAnim
      ? {
          ...resolved,
          frames: resolved.frames.map((f) => ({ ...f, ms: f.ms * FLAVOUR_SLOWDOWN })),
        }
      : resolved,
  );

  /** Frame index currently displayed (an index into the sheet, not the list). */
  let frame = $state(0);
  /** Honour the OS "reduce motion" preference — a still pet, never a jitter. */
  let reduced = $state(false);
  /** Park the animation entirely while the window is hidden (zero wakeups). */
  let visible = $state(true);

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
    frame = a.frames[0]?.index ?? 0;
    if (reduced || !animate || !visible) return;

    const startedAt = performance.now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;

    const tick = () => {
      if (stopped) return;
      const elapsed = performance.now() - startedAt;
      frame = frameAt(a, elapsed);
      const next = msUntilNextFrame(a, elapsed);
      if (next === null) return; // settled — nothing more to schedule
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
