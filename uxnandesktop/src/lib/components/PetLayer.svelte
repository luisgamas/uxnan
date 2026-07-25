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
  import { app } from "$lib/state/app.svelte";
  import { pets } from "$lib/state/pets.svelte";
  import { animationFor, type PetState } from "$lib/pets/status";
  import { i18n } from "$lib/i18n";
  import { cn } from "$lib/utils";
  import { PET_SIZE_MAX, PET_SIZE_MIN, nearestPetSize } from "$lib/pets/manifest";
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
   *  ordinary click doesn't swallow it. */
  let moved = false;
  let root = $state<HTMLDivElement | null>(null);

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
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    e.preventDefault();
  }

  function onPointerMove(e: PointerEvent) {
    if (!dragAt || !root) return;
    if (!moved && Math.hypot(e.clientX - origin.x, e.clientY - origin.y) < DRAG_SLOP) return;
    moved = true;
    const rect = root.getBoundingClientRect();
    // Clamp so the pet can never be dragged off-screen and stranded there.
    const x = Math.min(Math.max(0, e.clientX - grab.x), window.innerWidth - rect.width);
    const y = Math.min(Math.max(0, e.clientY - grab.y), window.innerHeight - rect.height);
    dragAt = { x, y };
  }

  function onPointerUp(e: PointerEvent) {
    if (!dragAt || !root) return;
    (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
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
  }

  function onClick(instanceTabId: string | undefined) {
    // A drag that ended over the pet must not also count as a click.
    if (moved || settings.clickToFocus === false) return;
    pets.focus(instanceTabId);
  }

  /** Human-readable state, reused for the tooltip and the accessible label. */
  function stateLabel(state: PetState): string {
    return i18n.t(`pets.state.${state}`);
  }

  function title(state: PetState, label?: string): string {
    const s = stateLabel(state);
    return label ? `${s} — ${label}` : s;
  }

</script>

<!-- Hidden while Settings is open: it overlays the whole content region, and the
     Pets section carries its own live preview. -->
{#if pets.enabled && !app.settingsOpen && pet && sheet && instance}
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
          "pointer-events-auto relative select-none rounded-lg transition-transform",
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
        />
      </button>
  </div>
{/if}
