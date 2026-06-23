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
    "inline-flex h-[18px] min-w-[18px] items-center justify-center rounded border border-border bg-muted px-1 font-mono text-[10px] font-medium leading-none text-muted-foreground",
    className,
  )}
>
  {@render children?.()}
</kbd>
