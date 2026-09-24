<script lang="ts">
  // Switch several options on and off, drawn as one segmented control — the
  // find panel's match case / whole word / regex.
  import { ToggleGroup } from "bits-ui";
  import { cn } from "$lib/utils";
  import SegmentedItem from "./segmented-item.svelte";
  import { segmented } from "./recipe";
  import type { SegmentedOption } from "./types";

  let {
    value,
    options,
    onValueChange,
    label,
    class: className,
  }: {
    value: string[];
    options: SegmentedOption[];
    onValueChange: (value: string[]) => void;
    label?: string;
    class?: string;
  } = $props();
</script>

<ToggleGroup.Root
  type="multiple"
  bind:value={() => value, (next) => onValueChange(next)}
  aria-label={label}
  class={cn(segmented().root(), className)}
>
  {#each options as option (option.value)}
    <SegmentedItem {option} />
  {/each}
</ToggleGroup.Root>
