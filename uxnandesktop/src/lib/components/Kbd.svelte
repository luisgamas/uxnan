<script lang="ts">
  // A small keycap for surfacing keyboard shortcuts inline (next to a big action
  // or in a dialog's hint bar). Visual-only; pass the key text as children.
  import type { Snippet } from "svelte";
  import { cn } from "$lib/utils";

  let {
    class: className,
    children,
  }: { class?: string; children?: Snippet } = $props();
</script>

<kbd
  class={cn(
    "inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-[5px] border border-border/60 bg-foreground/[0.04] px-1.5 font-sans text-[10px] font-medium leading-none text-muted-foreground/90 dark:bg-foreground/[0.06]",
    className,
  )}
>
  {@render children?.()}
</kbd>
