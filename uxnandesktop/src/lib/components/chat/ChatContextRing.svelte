<script lang="ts">
  // How full the agent's context window is, as a small ring in the composer's
  // toolbar; the exact figures are in its tooltip. It turns amber past 75% and
  // red past 90%, when a compaction (or a fresh chat) is near.
  import { TooltipSimple } from "$lib/components/ui/tooltip";
  import { i18n } from "$lib/i18n";
  import { cn } from "$lib/utils";

  let { tokens, limit }: { tokens: number; limit: number } = $props();

  const RADIUS = 6;
  const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
  const percent = $derived(limit > 0 ? Math.min(100, Math.round((tokens / limit) * 100)) : 0);
  const tone = $derived(
    percent >= 90 ? "text-destructive" : percent >= 75 ? "text-amber-500" : "text-muted-foreground",
  );
  const compact = (n: number) =>
    new Intl.NumberFormat(i18n.locale, { notation: "compact", maximumFractionDigits: 1 }).format(n);
</script>

<TooltipSimple
  title={i18n.t("chat.contextDetail", {
    percent: String(percent),
    used: compact(tokens),
    total: compact(limit),
  })}
>
  {#snippet children(tp)}
    <span
      {...tp}
      role="img"
      aria-label={i18n.t("chat.context", { percent: String(percent) })}
      class={cn("flex size-7 shrink-0 items-center justify-center", tone)}
    >
      <svg viewBox="0 0 16 16" class="size-4 -rotate-90">
        <circle cx="8" cy="8" r={RADIUS} fill="none" stroke="currentColor" stroke-width="2" opacity="0.2" />
        <circle
          cx="8"
          cy="8"
          r={RADIUS}
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-dasharray={CIRCUMFERENCE}
          stroke-dashoffset={CIRCUMFERENCE * (1 - percent / 100)}
        />
      </svg>
    </span>
  {/snippet}
</TooltipSimple>
