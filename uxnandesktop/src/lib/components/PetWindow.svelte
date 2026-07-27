<script lang="ts">
  // The desktop pet — the content of the borderless, transparent, always-on-top
  // `pet` window (created by `pet_window_show`; branched in the root layout via
  // `index.html?window=pet`).
  //
  // Deliberately a **thin renderer with no state of its own**: the main window
  // parses the pack, measures the sheet and derives the live agent state, then
  // pushes it all here over Tauri events. Anything that must persist or
  // navigate goes back to the main window as an event — this window never
  // touches settings or stores. That split is what keeps the second window
  // from ever needing the app's boot sequence (and what keeps a bug here from
  // taking Settings down with it).
  //
  // Pointer interplay mirrors the in-window layer: the pet watches the cursor
  // while resting (polled — the cursor lives outside this tiny window, so no
  // mousemove events reach it), clicking pokes it and jumps to the agent, and
  // dragging carries it via the OS-native window drag (`startDragging`), which
  // is DPI- and multi-monitor-correct where manual `setPosition` maths are not.
  import { listen, emitTo } from "@tauri-apps/api/event";
  import { getCurrentWindow, cursorPosition } from "@tauri-apps/api/window";
  import type { Pet } from "$lib/pets/manifest";
  import { animationFor, type PetState } from "$lib/pets/status";
  import {
    hasLookPoses,
    lookAngle,
    lookFrameIndex,
    LOOK_DEADZONE_PX,
    LOOK_DOWN_DEG,
    LOOK_LINGER_MS,
  } from "$lib/pets/look";
  import {
    CARRY_HOLD_MS,
    CARRY_SETTLE_MS,
    carryAnimation,
    carryDirection,
    DRAG_ANIMATION,
    REACTION_ANIMATION,
    REACTION_MS,
    type CarryDirection,
  } from "$lib/pets/interactions";
  import PetSprite from "./PetSprite.svelte";

  /** Everything about the pet being shown, pushed by the main window whenever
   *  the selection, the sheet or the render settings change. */
  interface PetConfig {
    pet: Pet;
    sheet: string;
    size: number;
    animate: boolean;
    clickToFocus: boolean;
  }
  /** The live state, pushed whenever the most urgent agent report changes.
   *  `stateLabel` arrives pre-localized — this window never boots i18n. */
  interface PetLiveState {
    state: PetState;
    tabId?: string;
    label?: string;
    stateLabel?: string;
  }

  let config = $state<PetConfig | null>(null);
  let live = $state<PetLiveState>({ state: "idle" });

  /** Look pose held toward the cursor (a sheet index), if any. */
  let lookFrame = $state<number | null>(null);
  /** Click reaction currently playing, if any. */
  let reaction = $state<string | null>(null);
  let reactionTimer: ReturnType<typeof setTimeout> | undefined;
  /** True while the OS-native window drag is carrying the pet. */
  let dragging = $state(false);
  /** Which way the pet is being carried, read from the window's own movement
   *  (the OS owns the drag, so there are no pointer events to measure). */
  let carryDir = $state<CarryDirection>(null);
  let carrySettle: ReturnType<typeof setTimeout> | undefined;
  /** Last window x seen while carrying; `NaN` until the first move gives us a
   *  baseline to compare against. */
  let lastCarryX = Number.NaN;

  const pet = $derived(config?.pet ?? null);
  const dragPose = $derived(pet ? lookFrameIndex(pet, LOOK_DOWN_DEG) : null);
  /** The travelling run to play while carried, when the pack has those rows. */
  const carryAnim = $derived(pet && dragging ? carryAnimation(pet, carryDir) : null);
  const resting = $derived(live.state === "idle");

  /** Turn the pet the way the window is travelling, and let that decay so a
   *  carry that comes to rest settles back into the look-down pose. */
  function trackCarry(x: number) {
    if (Number.isNaN(lastCarryX)) {
      lastCarryX = x;
      return;
    }
    const next = carryDirection(x - lastCarryX, carryDir);
    lastCarryX = x;
    if (next !== carryDir) carryDir = next;
    clearTimeout(carrySettle);
    carrySettle = setTimeout(() => (carryDir = null), CARRY_SETTLE_MS);
  }

  // Wire the event channel and announce readiness — the main window answers
  // with the current config and state, so a recreated window self-hydrates.
  // Readiness is only announced once the listeners are actually registered;
  // emitting first would race the answer past them.
  $effect(() => {
    let stopped = false;
    const unsubs: (() => void)[] = [];
    void (async () => {
      const us = await Promise.all([
        listen<PetConfig>("pet:config", (e) => (config = e.payload)),
        listen<PetLiveState>("pet:state", (e) => (live = e.payload)),
      ]);
      if (stopped) {
        for (const f of us) f();
        return;
      }
      unsubs.push(...us);
      await emitTo("main", "pet:ready", {});
    })();
    return () => {
      stopped = true;
      for (const f of unsubs) f();
      clearTimeout(reactionTimer);
    };
  });

  // The window's own movement is the only thing this window knows about its
  // drag: the OS owns it and swallows every pointer event for the duration. So
  // that one stream answers all three questions — is it still being carried,
  // which way, and where did it end up.
  //
  // Movement therefore *arms* the carry rather than only feeding it. Waiting for
  // a pointer event to do that is what let a paused hand end the carry for good:
  // nothing could contradict the "it went still, so it was dropped" guess, and
  // the pet stopped running mid-drag and never started again.
  $effect(() => {
    const win = getCurrentWindow();
    let settle: ReturnType<typeof setTimeout> | undefined;
    let hold: ReturnType<typeof setTimeout> | undefined;
    const unlisten = win.onMoved((e) => {
      dragging = true;
      trackCarry(e.payload.x);
      // Still for long enough to mean "let go" — see `CARRY_HOLD_MS`.
      clearTimeout(hold);
      hold = setTimeout(() => {
        dragging = false;
        clearTimeout(carrySettle);
        carryDir = null;
        lastCarryX = Number.NaN;
      }, CARRY_HOLD_MS);
      // Persisting where it was parked is a separate, cheaper question: the spot
      // is worth recording as soon as the window settles, carried or not.
      clearTimeout(settle);
      settle = setTimeout(() => {
        void (async () => {
          const pos = await win.outerPosition();
          void emitTo("main", "pet:moved", { x: pos.x, y: pos.y });
        })();
      }, 300);
    });
    return () => {
      clearTimeout(settle);
      clearTimeout(hold);
      clearTimeout(carrySettle);
      void unlisten.then((f) => f());
    };
  });

  // Watch the cursor while resting. The cursor is outside this window nearly
  // always, so `mousemove` never fires here — the global position is polled
  // instead, at a gentle 150 ms, and only while there is something to show.
  $effect(() => {
    const p = pet;
    const cfg = config;
    if (!p || !cfg || !cfg.animate || !resting || dragging || !hasLookPoses(p)) {
      lookFrame = null;
      return;
    }
    const win = getCurrentWindow();
    let stopped = false;
    let lastX = Number.NaN;
    let lastY = Number.NaN;
    let lastMove = performance.now();
    const timer = setInterval(() => {
      if (stopped || document.hidden) return;
      void (async () => {
        try {
          const [cur, pos, size] = await Promise.all([
            cursorPosition(),
            win.outerPosition(),
            win.outerSize(),
          ]);
          if (stopped) return;
          if (Math.abs(cur.x - lastX) > 2 || Math.abs(cur.y - lastY) > 2) {
            lastMove = performance.now();
            lastX = cur.x;
            lastY = cur.y;
          }
          // A cursor that parked somewhere stops being interesting after a bit.
          if (performance.now() - lastMove > LOOK_LINGER_MS) {
            lookFrame = null;
            return;
          }
          const scale = await win.scaleFactor();
          const dx = cur.x - (pos.x + size.width / 2);
          const dy = cur.y - (pos.y + size.height / 2);
          const dead = Math.max(LOOK_DEADZONE_PX * scale, size.height * 0.6);
          lookFrame = Math.hypot(dx, dy) <= dead ? null : lookFrameIndex(p, lookAngle(dx, dy));
        } catch {
          // Cursor position unavailable (permission/platform) — stay neutral.
          lookFrame = null;
        }
      })();
    }, 150);
    return () => {
      stopped = true;
      clearInterval(timer);
      lookFrame = null;
    };
  });

  /** Pointer travel (px) before a press becomes a drag rather than a click. */
  const DRAG_SLOP = 4;
  let pressed = false;
  let origin = { x: 0, y: 0 };

  function onPointerDown(e: PointerEvent) {
    if (e.button !== 0) return;
    pressed = true;
    origin = { x: e.screenX, y: e.screenY };
    // Capture, so a fast flick that leaves the tiny window before its first
    // move event still becomes a drag instead of being dropped.
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: PointerEvent) {
    if (!pressed || dragging) return;
    if (Math.hypot(e.screenX - origin.x, e.screenY - origin.y) < DRAG_SLOP) return;
    // Hand the drag to the OS. From here pointer events stop arriving; the
    // move-settle listener above ends the drag state and persists the spot,
    // and the window's own movement is what tells us which way it is going.
    pressed = false;
    dragging = true;
    lastCarryX = Number.NaN;
    void getCurrentWindow().startDragging();
  }

  function onPointerUp() {
    if (!pressed) return;
    pressed = false;
    const cfg = config;
    if (!cfg) return;
    // A poke always gets an answer, even with no agent to jump to.
    if (cfg.animate) {
      reaction = REACTION_ANIMATION;
      clearTimeout(reactionTimer);
      reactionTimer = setTimeout(() => (reaction = null), REACTION_MS);
    }
    if (cfg.clickToFocus) {
      void emitTo("main", "pet:focus", { tabId: live.tabId });
    }
  }

  const title = $derived.by(() => {
    const s = live.stateLabel || live.state;
    return live.label ? `${s} — ${live.label}` : s;
  });
</script>

{#if config && pet}
  <div class="flex h-screen w-screen items-end justify-center overflow-hidden">
    <!-- `outline-none`: this window is a single borderless sprite floating over
         the desktop, and the webview's default focus ring draws a rectangle
         around the whole sprite cell as soon as the button holds focus — on the
         click itself, and again on any key pressed afterwards (the focus-visible
         flag is re-evaluated then, which is why Esc "brought the box back").
         There is nothing else here to move focus between, so the ring carries no
         information and only breaks the illusion of a pet on the desktop. The
         in-window layer keeps a real keyboard ring — see `PetLayer.svelte`. -->
    <button
      type="button"
      {title}
      aria-label={title}
      class="select-none outline-none {dragging ? 'cursor-grabbing' : 'cursor-grab'}"
      onpointerdown={onPointerDown}
      onpointermove={onPointerMove}
      onpointerup={onPointerUp}
      onpointercancel={() => (pressed = false)}
    >
      <PetSprite
        {pet}
        sheet={config.sheet}
        animation={animationFor(live.state)}
        size={config.size}
        animate={config.animate}
        override={dragging
          ? (carryAnim ?? (dragPose === null ? DRAG_ANIMATION : null))
          : reaction}
        holdFrame={dragging && !carryAnim ? dragPose : null}
        {lookFrame}
      />
    </button>
  </div>
{/if}
