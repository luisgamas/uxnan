<script lang="ts">
  // One option of a segmented control: a glyph and/or a label, an optional
  // count, and a tooltip when it has one. Shared by `Segmented` (pick one) and
  // `SegmentedToggles` (switch several on and off).
  import { ToggleGroup } from "bits-ui";
  import { Icon } from "$lib/components/ui/icon";
  import { TooltipSimple } from "$lib/components/ui/tooltip";
  import { cn } from "$lib/utils";
  import { segmented } from "./recipe";
  import type { SegmentedOption } from "./types";

  let { option, fill = false }: { option: SegmentedOption; fill?: boolean } = $props();

  // Without a label, an option is a square glyph button.
  const glyphOnly = $derived(!option.label);
  const styles = $derived(segmented({ fill, glyph: glyphOnly }));
</script>

{#snippet body()}
  {#if option.icon}<Icon icon={option.icon} />{/if}
  {#if option.glyph}<span aria-hidden="true">{option.glyph}</span>{/if}
  {#if option.label}<span class={styles.label()}>{option.label}</span>{/if}
  {#if option.count}<span class={styles.count()}>{option.count}</span>{/if}
{/snippet}

{#if option.tooltip}
  <TooltipSimple title={option.tooltip}>
    {#snippet children(tp)}
      <ToggleGroup.Item
        {...tp}
        value={option.value}
        disabled={option.disabled}
        aria-label={option.label ? undefined : option.tooltip}
        class={cn(styles.item(), option.class)}
      >
        {@render body()}
      </ToggleGroup.Item>
    {/snippet}
  </TooltipSimple>
{:else}
  <ToggleGroup.Item value={option.value} disabled={option.disabled} class={cn(styles.item(), option.class)}>
    {@render body()}
  </ToggleGroup.Item>
{/if}
