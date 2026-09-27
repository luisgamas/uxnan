<script lang="ts">
  // How hard a level makes the model think, drawn as rising bars: one lit per
  // step up the model's own scale, so "High" on a five-level model and "High"
  // on a three-level one each read as where they sit on that model. `level`
  // below 0 draws the bars unlit (the model's own default, level unknown).
  import { cn } from "$lib/utils";

  let {
    level,
    of,
    class: className,
  }: {
    /** The level's position, from 0 (lowest). */
    level: number;
    /** How many levels the model offers. */
    of: number;
    class?: string;
  } = $props();

  /** Never more than five bars: past that the steps are too fine to see. */
  const BARS = 5;
  const lit = $derived(
    level < 0 || of <= 0 ? 0 : Math.max(1, Math.round(((level + 1) / of) * BARS)),
  );
</script>

<span class={cn("inline-flex h-3 shrink-0 items-end gap-[2px]", className)} aria-hidden="true">
  {#each Array.from({ length: BARS }, (_, i) => i) as i (i)}
    <span
      class={cn(
        "w-[3px] rounded-[1px] transition-colors",
        i < lit ? "bg-current" : "bg-current opacity-20",
      )}
      style:height={`${40 + i * 15}%`}
    ></span>
  {/each}
</span>
