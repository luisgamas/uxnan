<script lang="ts" generics="T">
  // Thin virtualized list on @tanstack/svelte-virtual: renders only the visible
  // rows of a (potentially long) flat list, in its own scroll container. Row
  // heights are known up-front — pass `estimateSize` as a fixed number, or a
  // `(index) => number` for exact per-row heights (e.g. a list mixing tall and
  // short rows) without runtime measurement. Pass an `activeIndex` to keep a
  // keyboard-highlighted row scrolled into view.
  import { createVirtualizer } from "@tanstack/svelte-virtual";
  import { get } from "svelte/store";
  import type { Snippet } from "svelte";
  import { cn } from "$lib/utils";

  let {
    items,
    estimateSize = 28,
    overscan = 12,
    activeIndex,
    class: className,
    row,
  }: {
    items: T[];
    /** Fixed row height, or an exact per-index height function. */
    estimateSize?: number | ((index: number) => number);
    overscan?: number;
    activeIndex?: number;
    class?: string;
    row: Snippet<[T, number]>;
  } = $props();

  const sizeAt = (index: number): number =>
    typeof estimateSize === "function" ? estimateSize(index) : estimateSize;

  let scrollEl = $state<HTMLDivElement>();

  // Seeded neutral; the $effect below sets the real count/overscan immediately
  // (and on every change), so this initial value isn't a reactive read.
  const virtualizer = createVirtualizer<HTMLDivElement, HTMLDivElement>({
    count: 0,
    getScrollElement: () => scrollEl ?? null,
    estimateSize: (i) => sizeAt(i),
    overscan: 12,
  });

  // Keep the virtualizer's options in sync with reactive inputs. This MUST run
  // *before* the render reads `rows`/`totalSize` (hence `$effect.pre`, not a
  // post-effect): otherwise, when `items` changes (e.g. a commit's file list
  // collapses), the render that reads the derived `rows` still sees the previous
  // options, painting a stale frame of absolutely-positioned rows that overlap the
  // new ones. Pushing options here means the same-tick render reads fresh virtual
  // items. IMPORTANT: read the store with `get()` (not `$virtualizer`) so this
  // effect does NOT subscribe to it — `setOptions`/`measure` emit, and subscribing
  // would re-run the effect on its own emission, an infinite loop. Deps are the
  // explicit reactive reads below.
  $effect.pre(() => {
    const count = items.length;
    const size = estimateSize;
    const over = overscan;
    const el = scrollEl ?? null;
    const v = get(virtualizer);
    v.setOptions({
      count,
      getScrollElement: () => el,
      estimateSize: (i) => (typeof size === "function" ? size(i) : size),
      overscan: over,
    });
    v.measure();
  });

  // Scroll a keyboard-selected row into view (also non-subscribing).
  $effect(() => {
    const idx = activeIndex;
    if (idx !== undefined && idx >= 0) get(virtualizer).scrollToIndex(idx);
  });

  const rows = $derived($virtualizer.getVirtualItems());
  const totalSize = $derived($virtualizer.getTotalSize());
</script>

<div bind:this={scrollEl} class={cn("uxnan-scroll overflow-y-auto", className)}>
  <div style="position:relative; width:100%; height:{totalSize}px;">
    {#each rows as vrow (vrow.key)}
      <div
        style="position:absolute; top:0; left:0; width:100%; height:{vrow.size}px; transform:translateY({vrow.start}px);"
      >
        {@render row(items[vrow.index], vrow.index)}
      </div>
    {/each}
  </div>
</div>
