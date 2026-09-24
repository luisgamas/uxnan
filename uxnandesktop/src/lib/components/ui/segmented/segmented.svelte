<script lang="ts">
  // Pick one of a few options — a view, a mode. Always one is chosen: pressing
  // the chosen option again keeps it (a toggle group would clear it).
  import { ToggleGroup } from "bits-ui";
  import { cn } from "$lib/utils";
  import SegmentedItem from "./segmented-item.svelte";
  import { segmented } from "./recipe";
  import type { SegmentedOption } from "./types";

  let {
    value,
    options,
    onValueChange,
    fill = false,
    label,
    class: className,
  }: {
    value: string;
    options: SegmentedOption[];
    onValueChange: (value: string) => void;
    /** Share the whole width, one equal part per option. */
    fill?: boolean;
    /** The control's accessible name. */
    label?: string;
    class?: string;
  } = $props();

  const styles = $derived(segmented({ fill }));
</script>

<ToggleGroup.Root
  type="single"
  bind:value={() => value, (next) => { if (next && next !== value) onValueChange(next); }}
  aria-label={label}
  class={cn(styles.root(), className)}
>
  {#each options as option (option.value)}
    <SegmentedItem {option} {fill} />
  {/each}
</ToggleGroup.Root>
