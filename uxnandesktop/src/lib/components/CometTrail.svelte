<script lang="ts">
  // "Comet Trail" — the working indicator: a 3×3 dot matrix whose eight perimeter
  // dots carry a bright head with a two-dot fading tail sweeping clockwise, while
  // the centre dot breathes.
  //
  // Pure CSS on purpose: one shared keyframe plus a per-dot negative
  // `animation-delay`, animating **opacity only** (the compositor's job, never the
  // input thread) with zero JS timers. One of these renders per *working* agent,
  // and uxnan targets modest hardware — a per-agent `setInterval` driving nine
  // nodes is exactly the cost this design refuses to pay.
  //
  // The colour comes from `currentColor`, so the caller owns the state hue.
  import { cn } from "$lib/utils";

  let {
    size = 12,
    lap = 1150,
    class: className,
  }: {
    /** Matrix side in px; the dots and gaps scale with it. */
    size?: number;
    /** Milliseconds for one full lap of the perimeter. */
    lap?: number;
    class?: string;
  } = $props();

  /** Row-major 3×3 grid: the eight perimeter cells, clockwise from top-left. */
  const RING = [0, 1, 2, 5, 8, 7, 6, 3];
  const CENTRE = 4;
  const CELLS = Array.from({ length: 9 }, (_, i) => i);

  // A quarter of the side per dot (so a 12px matrix is 3px dots on 1.5px gaps).
  // A fifth left the dots too small and the gaps too wide: at sidebar sizes the
  // ring stopped reading as a ring and became a smudge.
  const dotSize = $derived(Math.max(2, Math.round(size / 4)));
  const gap = $derived((size - dotSize * 3) / 2);
  const step = $derived(lap / RING.length);

  /** Negative start offset per cell. Advancing the head *clockwise* needs
   *  `(i - 8) · step`; the intuitive `-i · step` runs the comet backwards. */
  function delay(cell: number): number {
    const i = RING.indexOf(cell);
    return i < 0 ? 0 : (i - RING.length) * step;
  }
</script>

<span
  aria-hidden="true"
  class={cn("inline-grid shrink-0", className)}
  style="width:{size}px;height:{size}px;grid-template-columns:repeat(3,{dotSize}px);grid-template-rows:repeat(3,{dotSize}px);gap:{gap}px"
>
  {#each CELLS as cell (cell)}
    {#if cell === CENTRE}
      <span class="ux-comet-core" style="animation-duration:{lap * 2}ms"></span>
    {:else}
      <span
        class="ux-comet-dot"
        style="animation-duration:{lap}ms;animation-delay:{delay(cell)}ms"
      ></span>
    {/if}
  {/each}
</span>

<style>
  .ux-comet-dot,
  .ux-comet-core {
    border-radius: 9999px;
    background-color: currentColor;
    opacity: 0.1;
    animation-timing-function: linear;
    animation-iteration-count: infinite;
  }
  .ux-comet-dot {
    animation-name: ux-comet-sweep;
  }
  .ux-comet-core {
    animation-name: ux-comet-breathe;
  }

  /* One lap = eight steps: the head, two fading tail dots, then the resting ring.
     Linear interpolation between the stops is what makes the comet glide rather
     than blink from cell to cell. */
  @keyframes ux-comet-sweep {
    0% {
      opacity: 1;
    }
    12.5% {
      opacity: 0.58;
    }
    25% {
      opacity: 0.28;
    }
    37.5%,
    100% {
      opacity: 0.14;
    }
  }

  @keyframes ux-comet-breathe {
    0%,
    100% {
      opacity: 0.12;
    }
    50% {
      opacity: 0.24;
    }
  }

  /* Reduced motion: a *complete* static ring. Freezing mid-sweep would leave a
     gap that reads as a broken widget; a full ring reads as a deliberate marker. */
  @media (prefers-reduced-motion: reduce) {
    .ux-comet-dot,
    .ux-comet-core {
      animation: none;
    }
    .ux-comet-dot {
      opacity: 0.38;
    }
    .ux-comet-core {
      opacity: 0.16;
    }
  }
</style>
