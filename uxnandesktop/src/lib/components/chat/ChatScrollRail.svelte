<script lang="ts">
  // The conversation's scroll rail — the phone's (`message_scroll_rail.dart`),
  // for a mouse: a short mark per message the user sent, faint at rest on the
  // pane's right edge. Pointing at the strip grows the nearest mark and its two
  // neighbours (a dock-style fisheye) and shows that message with the end of
  // its reply; a click jumps there. The mark of the message on screen stays a
  // little longer, as "you are here". Keyboard: ↑ ↓ move, Enter or Space jumps.
  //
  // A pure input control: it owns no scroll position and reports the chosen
  // anchor through `onselect`; the conversation does the scrolling.
  import type { RailAnchor } from "$lib/bridge/railAnchors";
  import { i18n } from "$lib/i18n";
  import { cn } from "$lib/utils";
  import { focus, overlay, text } from "$lib/design";

  let {
    anchors,
    current = null,
    onselect,
  }: {
    anchors: RailAnchor[];
    /** The anchor whose message is on screen now. */
    current?: number | null;
    onselect: (index: number) => void;
  } = $props();

  /** Tick lengths (px): at rest, the one on screen, the one pointed at. */
  const REST = 10;
  const HERE = 16;
  const ACTIVE = 24;
  /** How many neighbours on each side the fisheye reaches. */
  const RADIUS = 2;
  /** Ideal distance between marks before the strip compresses them. */
  const SPACING = 10;

  let strip = $state<HTMLDivElement | null>(null);
  /** The mark pointed at (or moved to with the keys); null at rest. */
  let active = $state<number | null>(null);

  /** The strip is as tall as its marks want, within the pane's middle. */
  const height = $derived(Math.max(0, anchors.length - 1) * SPACING);
  const position = (index: number) =>
    anchors.length < 2 ? 0 : (index / (anchors.length - 1)) * 100;

  function length(index: number): number {
    if (active === null) return index === current ? HERE : REST;
    const distance = Math.abs(index - active);
    if (distance > RADIUS) return REST;
    return REST + (ACTIVE - REST) * (1 - distance / (RADIUS + 1));
  }

  function opacity(index: number): number {
    if (index === active) return 0.95;
    if (active !== null && Math.abs(index - active) <= RADIUS) return 0.5;
    if (index === current) return 0.55;
    return active === null ? 0.18 : 0.3;
  }

  /** The mark nearest a pointer at [clientY]. */
  function indexAt(clientY: number): number | null {
    if (!strip || anchors.length === 0) return null;
    const rect = strip.getBoundingClientRect();
    if (rect.height === 0) return 0;
    const ratio = Math.min(1, Math.max(0, (clientY - rect.top) / rect.height));
    return Math.round(ratio * (anchors.length - 1));
  }

  function onkeydown(e: KeyboardEvent) {
    if (anchors.length === 0) return;
    const from = active ?? current ?? anchors.length - 1;
    if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
      const step = e.key === "ArrowUp" ? -1 : 1;
      active = Math.min(anchors.length - 1, Math.max(0, from + step));
    } else if ((e.key === "Enter" || e.key === " ") && active !== null) {
      e.preventDefault();
      onselect(active);
    } else if (e.key === "Escape") {
      active = null;
    }
  }

  const shown = $derived(active === null ? undefined : anchors[active]);
</script>

{#if anchors.length >= 2}
  <div
    class="pointer-events-none absolute inset-y-0 right-0 z-10 flex items-center"
  >
    <!-- The hit strip is wider than the marks, so they are easy to reach. -->
    <div
      bind:this={strip}
      role="slider"
      tabindex="0"
      aria-orientation="vertical"
      aria-label={i18n.t("chat.railLabel")}
      aria-valuemin={1}
      aria-valuemax={anchors.length}
      aria-valuenow={(active ?? current ?? anchors.length - 1) + 1}
      aria-valuetext={anchors[active ?? current ?? anchors.length - 1]?.preview}
      class={cn("pointer-events-auto relative mr-1 w-8 cursor-pointer rounded-md", focus.ring)}
      style:height="{height}px"
      style:max-height="60%"
      onmousemove={(e) => (active = indexAt(e.clientY))}
      onmouseleave={() => (active = null)}
      onblur={() => (active = null)}
      onclick={(e) => {
        const index = indexAt(e.clientY);
        if (index !== null) onselect(index);
      }}
      {onkeydown}
    >
      {#each anchors as anchor, index (anchor.turnId)}
        <span
          class="absolute right-2 h-0.5 -translate-y-1/2 rounded-full bg-foreground transition-[width,opacity] duration-150 ease-out"
          style:top="{position(index)}%"
          style:width="{length(index)}px"
          style:opacity={opacity(index)}
        ></span>
      {/each}

      {#if shown && active !== null}
        <!-- Pinned to its mark, kept inside the strip at the ends. -->
        <div
          class={cn(
            overlay.menuSurface,
            overlay.infoWidth,
            "pointer-events-none absolute right-full mr-2 flex flex-col gap-1 px-3 py-2",
          )}
          style:top="{position(active)}%"
          style:transform="translateY({active === 0 ? "0" : active === anchors.length - 1 ? "-100%" : "-50%"})"
        >
          <p class={cn(text.body, "truncate font-medium")}>{shown.preview}</p>
          {#if shown.reply}
            <p class={cn(text.meta, "line-clamp-3")}>{shown.reply}</p>
          {/if}
        </div>
      {/if}
    </div>
  </div>
{/if}
