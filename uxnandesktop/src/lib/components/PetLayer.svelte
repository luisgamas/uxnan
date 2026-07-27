<script lang="ts">
  // The floating pet overlay.
  //
  // Sits above the app content (below dialogs) and shows what the agents are
  // doing — one pet, reflecting the most urgent agent state. Clicking it jumps
  // to the terminal it is reflecting, which makes the companion a shortcut
  // rather than only decoration.
  //
  // The pet is parked in a corner and can be dragged anywhere; on release it
  // snaps to the nearest corner and remembers its exact offset. Dragging is
  // pointer-based because Tauri suppresses HTML5 drag-and-drop in the webview
  // (same reason the file tree drags with pointer events).
  //
  // The pet is also *interactive*, the way the desktop reference is: while
  // resting it watches the cursor (the v2 look rows), clicking it makes it
  // jump, and while carried it looks down at the ground.
  //
  // It is also the **controller of the desktop pet window** (opt-in
  // `pets.overlay`): it creates/destroys the `pet` window, pushes it the parsed
  // pet + sheet + live state over Tauri events, and applies what comes back
  // (position to persist, the click-to-focus jump). The pet window itself is a
  // thin renderer with no state — see `PetWindow.svelte`.
  import { untrack } from "svelte";
  import { emitTo, listen, type UnlistenFn } from "@tauri-apps/api/event";
  import { app } from "$lib/state/app.svelte";
  import { pets } from "$lib/state/pets.svelte";
  import { petFocusMain, petWindowHide, petWindowShow } from "$lib/api";
  import { animationFor, type PetState } from "$lib/pets/status";
  import { i18n } from "$lib/i18n";
  import { cn } from "$lib/utils";
  import { PET_SIZE_MAX, PET_SIZE_MIN, nearestPetSize } from "$lib/pets/manifest";
  import {
    hasLookPoses,
    lookAngle,
    lookFrameIndex,
    LOOK_DEADZONE_PX,
    LOOK_DOWN_DEG,
    LOOK_LINGER_MS,
  } from "$lib/pets/look";
  import {
    CARRY_SETTLE_MS,
    carryAnimation,
    carryDirection,
    DRAG_ANIMATION,
    REACTION_ANIMATION,
    REACTION_MS,
    type CarryDirection,
  } from "$lib/pets/interactions";
  import PetSprite from "./PetSprite.svelte";
  import type { PetCorner } from "$lib/types";

  const settings = $derived(app.petSettings);
  const pet = $derived(pets.active);
  // Snap to the ladder Settings offers, so what the picker shows and what is
  // drawn can never disagree (a value persisted before the ladder changed still
  // renders as its nearest option).
  const size = $derived(
    Math.min(PET_SIZE_MAX, Math.max(PET_SIZE_MIN, nearestPetSize(settings.size))),
  );
  const corner = $derived((settings.corner ?? "bottom-right") as PetCorner);
  const instance = $derived(pets.instance);
  /** Resolved lazily; until it arrives there is simply nothing to paint. The
   *  request is made from an effect (never from markup — see `pets.sheet`). */
  const sheet = $derived(pet ? pets.sheet(pet.id) : undefined);
  $effect(() => {
    if (pet) void pets.ensureSheet(pet.id);
  });

  /** Live position while dragging (viewport px); `null` when parked. */
  let dragAt = $state<{ x: number; y: number } | null>(null);
  /** Grab point inside the pet, so it doesn't jump to the cursor on grab. */
  let grab = { x: 0, y: 0 };
  /** Where the pointer went down, to measure real travel. */
  let origin = { x: 0, y: 0 };
  /** Distinguishes a click (focus the agent) from a drag (reposition). Only set
   *  once the pointer travels past [`DRAG_SLOP`], so the hand-shake in an
   *  ordinary click doesn't swallow it. Reactive: the carried pose keys off it. */
  let moved = $state(false);
  let root = $state<HTMLDivElement | null>(null);

  /** Look pose currently held toward the cursor (a sheet index), if any. */
  let lookFrame = $state<number | null>(null);
  /** Click reaction currently playing, if any. */
  let reaction = $state<string | null>(null);
  let reactionTimer: ReturnType<typeof setTimeout> | undefined;

  /** True while the pet is actually being carried (pointer down + past slop). */
  const dragging = $derived(dragAt !== null && moved);
  /** The carried pose: looking straight down at the ground, when the pack has
   *  the v2 look rows. Packs without them wiggle through [`DRAG_ANIMATION`]. */
  const dragPose = $derived(pet ? lookFrameIndex(pet, LOOK_DOWN_DEG) : null);
  /** Which way the pet is currently being carried, aged out once the hand stops
   *  (so a paused drag settles back into the look-down pose). */
  let carryDir = $state<CarryDirection>(null);
  let carrySettle: ReturnType<typeof setTimeout> | undefined;
  let lastCarryX = 0;
  /** The travelling run to play while carried, when the pack has those rows. */
  const carryAnim = $derived(pet && dragging ? carryAnimation(pet, carryDir) : null);
  /** Whether the pet is resting (memoized so the cursor-watch effect doesn't
   *  re-subscribe on every clock tick that re-derives the instance). */
  const resting = $derived(instance?.state === "idle");

  // Watch the cursor while resting: the pet turns toward it (16 poses, v2
  // packs), holds the glance for a while after the cursor stops, and goes back
  // to breathing inside the deadzone. Listener-driven — no polling.
  $effect(() => {
    const p = pet;
    // `overlayOn`: while the desktop window shows the pet, this layer renders
    // nothing — the pet window runs its own cursor watch.
    if (!p || !resting || overlayOn || settings.animate === false || !hasLookPoses(p)) {
      lookFrame = null;
      return;
    }
    let linger: ReturnType<typeof setTimeout> | undefined;
    const onMove = (e: MouseEvent) => {
      if (dragAt) return; // carried: the drag pose owns the eyes
      const rect = root?.getBoundingClientRect();
      if (!rect) return;
      const dx = e.clientX - (rect.left + rect.width / 2);
      const dy = e.clientY - (rect.top + rect.height / 2);
      // The deadzone scales with the pet so a large sprite isn't cross-eyed
      // about a cursor brushing its own feet.
      const dead = Math.max(LOOK_DEADZONE_PX, rect.height * 0.45);
      lookFrame = Math.hypot(dx, dy) <= dead ? null : lookFrameIndex(p, lookAngle(dx, dy));
      clearTimeout(linger);
      linger = setTimeout(() => (lookFrame = null), LOOK_LINGER_MS);
    };
    window.addEventListener("mousemove", onMove);
    return () => {
      window.removeEventListener("mousemove", onMove);
      clearTimeout(linger);
      lookFrame = null;
    };
  });

  /** Pointer travel (px) before a press counts as a drag rather than a click. */
  const DRAG_SLOP = 4;

  const top = $derived(corner.startsWith("top"));
  const left = $derived(corner.endsWith("left"));

  function onPointerDown(e: PointerEvent) {
    if (e.button !== 0 || !root) return;
    const rect = root.getBoundingClientRect();
    grab = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    origin = { x: e.clientX, y: e.clientY };
    moved = false;
    dragAt = { x: rect.left, y: rect.top };
    lastCarryX = e.clientX;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    e.preventDefault();
  }

  /** Turn the pet the way it is being carried, and let that decay: the gap
   *  between two pointer moves is not "the drag stopped", but a hand that has
   *  actually come to rest should go back to looking down. */
  function trackCarry(x: number) {
    const next = carryDirection(x - lastCarryX, carryDir);
    lastCarryX = x;
    if (next !== carryDir) carryDir = next;
    clearTimeout(carrySettle);
    carrySettle = setTimeout(() => (carryDir = null), CARRY_SETTLE_MS);
  }

  function onPointerMove(e: PointerEvent) {
    if (!dragAt || !root) return;
    if (!moved && Math.hypot(e.clientX - origin.x, e.clientY - origin.y) < DRAG_SLOP) return;
    moved = true;
    trackCarry(e.clientX);
    const rect = root.getBoundingClientRect();
    // Clamp so the pet can never be dragged off-screen and stranded there.
    const x = Math.min(Math.max(0, e.clientX - grab.x), window.innerWidth - rect.width);
    const y = Math.min(Math.max(0, e.clientY - grab.y), window.innerHeight - rect.height);
    dragAt = { x, y };
  }

  function onPointerUp(e: PointerEvent) {
    if (!dragAt || !root) return;
    (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    // Poking a pet is not "focusing a control": leaving it focused means the
    // next keystroke (Esc, anything) flips the focus-visible flag and rings the
    // sprite. Blurring here keeps the ring exclusive to Tab navigation, and does
    // not stop the `click` that follows this event.
    (e.currentTarget as HTMLElement).blur();
    if (moved) {
      // Snap to whichever corner the pet was released nearest, keeping its exact
      // distance from that corner so it stays where the user put it.
      const rect = root.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const vertical = cy < window.innerHeight / 2 ? "top" : "bottom";
      const horizontal = cx < window.innerWidth / 2 ? "left" : "right";
      app.updatePets({
        corner: `${vertical}-${horizontal}` as PetCorner,
        offsetX: Math.round(
          horizontal === "left" ? rect.left : window.innerWidth - rect.right,
        ),
        offsetY: Math.round(vertical === "top" ? rect.top : window.innerHeight - rect.bottom),
      });
    }
    dragAt = null;
    clearTimeout(carrySettle);
    carryDir = null;
  }

  function onClick(instanceTabId: string | undefined) {
    // A drag that ended over the pet must not also count as a click.
    if (moved) return;
    // A poke always gets an answer, even when there is no agent to jump to.
    if (settings.animate !== false) {
      reaction = REACTION_ANIMATION;
      clearTimeout(reactionTimer);
      reactionTimer = setTimeout(() => (reaction = null), REACTION_MS);
    }
    if (settings.clickToFocus === false) return;
    pets.focus(instanceTabId);
  }

  // Clear pending timers when the layer unmounts.
  $effect(() => () => {
    clearTimeout(reactionTimer);
    clearTimeout(carrySettle);
  });

  /** Human-readable state, reused for the tooltip and the accessible label. */
  function stateLabel(state: PetState): string {
    return i18n.t(`pets.state.${state}`);
  }

  function title(state: PetState, label?: string): string {
    const s = stateLabel(state);
    return label ? `${s} — ${label}` : s;
  }

  // ------------------------------------------------------- desktop pet window

  /** Only a real Tauri runtime has windows to manage (not the browser preview). */
  const tauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
  /** The desktop window is the default presentation; off = the in-window layer. */
  const overlayOn = $derived(tauri && pets.enabled && settings.overlay !== false);

  /** Push the pet window everything it renders from. Split in two so the heavy
   *  half (the pet + its sheet, possibly a multi-MB data URL) is only sent when
   *  it actually changes, while state updates stay tiny. */
  function sendConfig(): void {
    const p = pets.active;
    const s = p ? pets.sheet(p.id) : undefined;
    if (!p || !s) return;
    void emitTo("pet", "pet:config", {
      pet: $state.snapshot(p),
      sheet: s,
      size,
      animate: settings.animate !== false,
      clickToFocus: settings.clickToFocus !== false,
    });
  }

  function sendState(): void {
    const inst = pets.instance;
    if (!inst) return;
    void emitTo("pet", "pet:state", {
      state: inst.state,
      tabId: inst.tabId,
      label: inst.label,
      stateLabel: stateLabel(inst.state),
    });
  }

  // Window lifecycle: create (or resize) while the overlay is on, destroy when
  // it goes off. The saved position is only honored at creation; while the
  // window lives, resizes leave it where the user parked it.
  $effect(() => {
    if (!tauri) return;
    if (!overlayOn) {
      void petWindowHide();
      return;
    }
    const p = pet;
    if (!p || !sheet) return;
    const w = Math.ceil((p.frame.width / p.frame.height) * size) + 16;
    const h = size + 8;
    // Untracked: the saved spot matters only at creation, and tracking it would
    // re-run this effect after every drag the pet window reports back.
    const sx = untrack(() => settings.screenX ?? null);
    const sy = untrack(() => settings.screenY ?? null);
    void petWindowShow(w, h, sx, sy).catch(() => {});
  });

  /** Serialized last-sent payloads, so effects that re-run on unrelated
   *  reactivity (the shared clock re-derives the instance every tick) only
   *  cross the IPC boundary when something actually changed. */
  let sentConfig = "";
  let sentState = "";

  $effect(() => {
    if (!overlayOn || !pet || !sheet) return;
    const snapshot = JSON.stringify([pet && $state.snapshot(pet), sheet, size, settings.animate, settings.clickToFocus]);
    if (snapshot === sentConfig) return;
    sentConfig = snapshot;
    sendConfig();
  });

  $effect(() => {
    if (!overlayOn) return;
    const inst = instance;
    const snapshot = JSON.stringify(inst);
    if (snapshot === sentState) return;
    sentState = snapshot;
    sendState();
  });

  // What comes back from the pet window: readiness (answer with everything),
  // a parked position (persist it), a click (jump to the agent, raising the
  // main window first — a shortcut is no shortcut if the app stays buried).
  $effect(() => {
    if (!overlayOn) return;
    const unsubs: Promise<UnlistenFn>[] = [
      listen("pet:ready", () => {
        sendConfig();
        sendState();
      }),
      listen<{ x: number; y: number }>("pet:moved", (e) =>
        app.updatePets({ screenX: e.payload.x, screenY: e.payload.y }),
      ),
      listen<{ tabId?: string }>("pet:focus", (e) => {
        // Raising the app is its own opt-in: revealing the right terminal is
        // always useful, yanking uxnan over the user's work is not.
        if (settings.raiseOnClick === true) void petFocusMain().catch(() => {});
        pets.focus(e.payload.tabId);
      }),
    ];
    return () => {
      for (const u of unsubs) void u.then((f) => f());
    };
  });

</script>

<!-- Hidden while Settings is open (it overlays the whole content region, and the
     Pets section carries its own live preview) and while the desktop window
     shows the pet instead. -->
{#if pets.enabled && !overlayOn && !app.settingsOpen && pet && sheet && instance}
  <!-- The layer itself never intercepts pointer events; only the pets do. -->
  <div
    bind:this={root}
    class="pointer-events-none fixed z-30 flex items-end gap-1"
    style:left={dragAt ? `${dragAt.x}px` : left ? `${settings.offsetX ?? 16}px` : "auto"}
    style:top={dragAt ? `${dragAt.y}px` : top ? `${settings.offsetY ?? 16}px` : "auto"}
    style:right={!dragAt && !left ? `${settings.offsetX ?? 16}px` : "auto"}
    style:bottom={!dragAt && !top ? `${settings.offsetY ?? 16}px` : "auto"}
  >
      <button
        type="button"
        title={title(instance.state, instance.label)}
        aria-label={title(instance.state, instance.label)}
        class={cn(
          // `outline-none` + an explicit `focus-visible` ring, the same way the
          // shared Button does it: the webview's default ring boxes the whole
          // sprite cell (and reappears on any key pressed after a click), which
          // reads as a selection rectangle around the pet. Keyboard focus still
          // gets a ring — a pointer one is dropped on release, below.
          "pointer-events-auto relative select-none rounded-lg transition-transform outline-none",
          "focus-visible:ring-ring/50 focus-visible:ring-2",
          dragAt ? "cursor-grabbing" : "cursor-grab",
          settings.clickToFocus !== false && instance.tabId && "hover:scale-105",
        )}
        onpointerdown={onPointerDown}
        onpointermove={onPointerMove}
        onpointerup={onPointerUp}
        onpointercancel={onPointerUp}
        onclick={() => onClick(instance.tabId)}
      >
        <PetSprite
          {pet}
          {sheet}
          animation={animationFor(instance.state)}
          {size}
          animate={settings.animate !== false}
          override={dragging
            ? (carryAnim ?? (dragPose === null ? DRAG_ANIMATION : null))
            : reaction}
          holdFrame={dragging && !carryAnim ? dragPose : null}
          {lookFrame}
        />
      </button>
  </div>
{/if}
