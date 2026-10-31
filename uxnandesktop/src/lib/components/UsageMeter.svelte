<script lang="ts">
  // A usage bar for one quota window, in two shapes:
  //
  // - `card` (Settings → Providers): window name and used-% on top, the track
  //   below, then the reset line (countdown + absolute clock time).
  // - `row` (the status-bar popover): one line — name, track, used-%, and the
  //   reset countdown in its own column, its absolute time on hover — so many
  //   providers fit without the popover turning into a long scroll.
  import { cn } from "$lib/utils";
  import { text } from "$lib/design";
  import { i18n } from "$lib/i18n";
  import { formatReset, formatResetAbsolute, meterFill } from "$lib/usageFormat";
  import { windowLabel } from "$lib/usageLabels";
  import type { UsageWindow } from "$lib/types";

  let {
    window,
    variant = "card",
  }: { window: UsageWindow; variant?: "card" | "row" } = $props();

  const pct = $derived(Math.round(window.usedPercent));
  const label = $derived(windowLabel(window));
  const countdown = $derived(formatReset(window.resetsAt));
  const at = $derived(formatResetAbsolute(window.resetsAt));
  // Card: "resets in 3h 20m · 15:00".
  const resetLine = $derived.by(() => {
    const parts: string[] = [];
    if (countdown) parts.push(`${i18n.t("providers.resetsIn")} ${countdown}`);
    if (at) parts.push(at);
    return parts.length > 0 ? parts.join(" · ") : null;
  });
  const width = $derived(`width:${Math.min(100, Math.max(2, pct))}%`);
</script>

{#if variant === "row"}
  <div
    class="grid min-h-6 grid-cols-[minmax(0,9rem)_minmax(3rem,1fr)_2.75rem_4.5rem] items-center gap-x-2.5"
  >
    <span class={cn("truncate text-foreground", text.meta)} title={label}>{label}</span>
    <div
      class="h-1.5 w-full overflow-hidden rounded-full bg-muted"
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
    >
      <div class={cn("h-full rounded-full transition-[width]", meterFill(window.usedPercent))} style={width}></div>
    </div>
    <span class={cn("text-right font-mono font-medium tabular-nums text-foreground", text.meta)}>{pct}%</span>
    <span
      class={cn("truncate text-right tabular-nums", text.meta)}
      title={at ? `${i18n.t("providers.resetsIn")} ${countdown} · ${at}` : undefined}
    >
      {countdown ? i18n.t("providers.resetsInShort", { time: countdown }) : ""}
    </span>
  </div>
{:else}
  <div class="flex flex-col gap-1">
    <div class="flex items-baseline justify-between gap-2">
      <span class={cn("truncate text-foreground", text.body)}>{label}</span>
      <span class="flex shrink-0 items-baseline gap-1 text-xs">
        <span class="font-mono font-medium tabular-nums text-foreground">{pct}%</span>
        <span class="text-muted-foreground">{i18n.t("providers.used")}</span>
      </span>
    </div>
    <div class="h-2 w-full overflow-hidden rounded-full bg-muted">
      <div class={cn("h-full rounded-full transition-[width]", meterFill(window.usedPercent))} style={width}></div>
    </div>
    {#if resetLine}
      <span class={text.meta}>{resetLine}</span>
    {/if}
  </div>
{/if}
