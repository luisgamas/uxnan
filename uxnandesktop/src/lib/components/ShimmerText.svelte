<script lang="ts">
  // Live text — what is happening right now (the agent working, a step
  // running): a soft band of light sweeps across the words, in the text's own
  // colour brightened toward the foreground.
  //
  // Animated by the compositor alone. The band is a window that slides with
  // `transform`, holding a brighter copy of the text that slides the other way
  // by the same amount, so the copy stays exactly over the words while the
  // window crosses them. Nothing is repainted per frame: the earlier version
  // swept a `background-clip: text` gradient by animating `background-position`,
  // which repainted the text on the main thread every frame — measured as most
  // of the app's work while an agent ran. A transform is the cheapest animation
  // a webview has, which is what modest machines need. Off under reduced motion.
  import type { Snippet } from "svelte";
  import { cn } from "$lib/utils";

  let {
    active = true,
    class: className,
    children,
  }: {
    /** Whether the sweep runs; off, it is plain text. */
    active?: boolean;
    class?: string;
    children: Snippet;
  } = $props();
</script>

<span class={cn("ux-shimmer", className)}>
  {@render children()}
  {#if active}
    <span class="ux-shimmer-band" aria-hidden="true">
      <span class="ux-shimmer-glint">{@render children()}</span>
    </span>
  {/if}
</span>

<style>
  .ux-shimmer {
    position: relative;
    display: inline-block;
    max-width: 100%;
    vertical-align: bottom;
  }
  /* The window: 40 % of the text wide, from just left of it to just right. */
  .ux-shimmer-band {
    position: absolute;
    inset-block: 0;
    left: 0;
    width: 40%;
    overflow: hidden;
    pointer-events: none;
    -webkit-mask-image: linear-gradient(90deg, transparent, #000 50%, transparent);
    mask-image: linear-gradient(90deg, transparent, #000 50%, transparent);
    will-change: transform;
    animation: ux-shimmer-band 2.2s linear infinite;
  }
  /* The brighter copy, as wide as the text, moving back by exactly as much as
     the window moves forward. */
  .ux-shimmer-glint {
    position: absolute;
    inset-block: 0;
    left: 0;
    width: 250%;
    white-space: inherit;
    color: color-mix(in oklab, currentColor 35%, var(--foreground));
    will-change: transform;
    animation: ux-shimmer-glint 2.2s linear infinite;
  }
  @keyframes ux-shimmer-band {
    from {
      transform: translateX(-100%);
    }
    to {
      transform: translateX(250%);
    }
  }
  @keyframes ux-shimmer-glint {
    from {
      transform: translateX(40%);
    }
    to {
      transform: translateX(-100%);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .ux-shimmer-band {
      display: none;
    }
  }
</style>
