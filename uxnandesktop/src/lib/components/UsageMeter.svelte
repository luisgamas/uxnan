<script lang="ts">
  // A labeled usage bar: window name on the left, used-% on the right, a thin
  // track below, and an optional reset line (countdown + absolute clock time).
  // Shared by the provider cards and the status-bar popover. `compact` tightens
  // it for the popover; `showReset` controls the reset line (on by default in the
  // full card, off in the popover unless the status-bar toggle opts in).
  import { cn } from "$lib/utils";
  import { text } from "$lib/design";
  import { i18n } from "$lib/i18n";
  import { formatReset, formatResetAbsolute, meterFill } from "$lib/usageFormat";
  import type { UsageWindow } from "$lib/types";

  let {
    window,
    compact = false,
    showReset = !compact,
  }: { window: UsageWindow; compact?: boolean; showReset?: boolean } = $props();

  const pct = $derived(Math.round(window.usedPercent));
  const countdown = $derived(formatReset(window.resetsAt));
  const at = $derived(formatResetAbsolute(window.resetsAt));
  // The full card shows both ("resets in 2h · 3:00 PM"); the compact popover shows
  // the absolute time only, to stay tight.
  const resetLine = $derived.by(() => {
    if (!showReset) return null;
    // Popover: just the countdown ("resets in 3h 20m"), like the card's first part
    // — the absolute date/time reads awkwardly in the tight popover.
    if (compact) return countdown ? `${i18n.t("providers.resetsIn")} ${countdown}` : null;
    // Full card: countdown + absolute ("resets in 3h 20m · 3:00 PM").
    const parts: string[] = [];
    if (countdown) parts.push(`${i18n.t("providers.resetsIn")} ${countdown}`);
    if (at) parts.push(at);
    return parts.length > 0 ? parts.join(" · ") : null;
  });
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
  {#if resetLine}
    <span class={text.meta}>{resetLine}</span>
  {/if}
</div>
