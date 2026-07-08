<script lang="ts">
  // A labeled usage bar: window name on the left, used-% on the right, a thin
  // track below, and an optional reset countdown. Shared by the provider cards
  // and the status-bar popover. `compact` tightens it for the popover.
  import { cn } from "$lib/utils";
  import { text } from "$lib/design";
  import { i18n } from "$lib/i18n";
  import { formatReset, meterFill } from "$lib/usageFormat";
  import type { UsageWindow } from "$lib/types";

  let { window, compact = false }: { window: UsageWindow; compact?: boolean } = $props();

  const pct = $derived(Math.round(window.usedPercent));
  const reset = $derived(formatReset(window.resetsAt));
</script>

<div class="flex flex-col gap-1">
  <div class="flex items-baseline justify-between gap-2">
    <span class={cn("truncate text-foreground", compact ? "text-xs" : text.body)}>{window.label}</span>
    <span class={cn("flex shrink-0 items-baseline gap-1", compact ? "text-[11px]" : "text-xs")}>
      <span class="font-mono font-medium tabular-nums text-foreground">{pct}%</span>
      <span class="text-muted-foreground">{i18n.t("providers.used")}</span>
    </span>
  </div>
  <div class={cn("w-full overflow-hidden rounded-full bg-muted", compact ? "h-1.5" : "h-2")}>
    <div class={cn("h-full rounded-full transition-[width]", meterFill(window.usedPercent))} style={`width:${Math.min(100, Math.max(2, pct))}%`}></div>
  </div>
  {#if reset && !compact}
    <span class={text.meta}>{i18n.t("providers.resetsIn")} {reset}</span>
  {/if}
</div>
