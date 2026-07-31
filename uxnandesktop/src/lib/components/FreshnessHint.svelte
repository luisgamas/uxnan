<script lang="ts">
  // The "this data is less fresh because of the resource mode" indicator: a
  // quiet leaf that explains itself in a tooltip and, when clicked, refreshes
  // right now — without touching the selected profile. Callers render it only
  // while their surface's cadence is actually relaxed
  // (`resourceMode.freshness`), so its mere presence is the honest signal.
  import { Button } from "$lib/components/ui/button";
  import { TooltipSimple } from "$lib/components/ui/tooltip";
  import { cn } from "$lib/utils";
  import LeafIcon from "@lucide/svelte/icons/leaf";

  let {
    label,
    onrefresh,
    class: className = "",
  }: {
    /** Localized explanation + call to action (the tooltip and aria-label). */
    label: string;
    /** The one-shot manual refresh. */
    onrefresh: () => void;
    class?: string;
  } = $props();
</script>

<TooltipSimple title={label}>
  {#snippet children(tp)}
    <Button
      {...tp}
      variant="ghost"
      size="icon"
      class={cn("size-6", className)}
      aria-label={label}
      onclick={onrefresh}
    >
      <LeafIcon class="size-3.5 text-muted-foreground" />
    </Button>
  {/snippet}
</TooltipSimple>
