<script lang="ts">
  // How full the agent's context window is, as a small ring in the composer's
  // toolbar; the exact figures are in its tooltip. It turns amber past 75% and
  // red past 90%, when a compaction (or a fresh chat) is near.
  //
  // With [plan], the tooltip adds where the agent's plan stands — its most
  // pressing window, when it resets, and whether the pace so far hits the
  // limit first — and a dot on the ring says so at a glance.
  import { TooltipSimple } from "$lib/components/ui/tooltip";
  import { i18n } from "$lib/i18n";
  import { cn } from "$lib/utils";
  import { icon } from "$lib/design";
  import { formatReset } from "$lib/usageFormat";
  import type { UsageWindow } from "$lib/types";
  import type { WindowPace } from "$lib/usagePace";

  let {
    tokens,
    limit,
    plan,
  }: {
    tokens: number;
    limit: number;
    /** The agent's plan: its name and most pressing window, with its pace. */
    plan?: { name: string; window: UsageWindow; pace?: WindowPace } | null;
  } = $props();

  const hot = $derived(plan?.pace?.runsOutInMs !== undefined);
  const planLines = $derived.by(() => {
    if (!plan) return [];
    const reset = formatReset(plan.window.resetsAt);
    const lines = [
      i18n.t("chat.planLine", {
        plan: plan.name,
        window: plan.window.label,
        percent: String(Math.round(plan.window.usedPercent)),
      }) + (reset ? ` · ${i18n.t("chat.planResets", { time: reset })}` : ""),
    ];
    if (plan.pace?.runsOutInMs !== undefined) {
      const at = formatReset(Date.now() + Math.max(60_000, plan.pace.runsOutInMs)) ?? "";
      lines.push(i18n.t("chat.planRunsOut", { time: at }));
    }
    return lines;
  });

  const RADIUS = 6;
  const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
  const percent = $derived(limit > 0 ? Math.min(100, Math.round((tokens / limit) * 100)) : 0);
  const tone = $derived(
    percent >= 90 ? "text-destructive" : percent >= 75 ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground",
  );
  const compact = (n: number) =>
    new Intl.NumberFormat(i18n.locale, { notation: "compact", maximumFractionDigits: 1 }).format(n);
</script>

<TooltipSimple
  title={[
    i18n.t("chat.contextDetail", {
      percent: String(percent),
      used: compact(tokens),
      total: compact(limit),
    }),
    ...planLines,
  ].join("\n")}
>
  {#snippet children(tp)}
    <span
      {...tp}
      role="img"
      aria-label={[i18n.t("chat.context", { percent: String(percent) }), ...planLines].join(". ")}
      class={cn("relative flex size-7 shrink-0 items-center justify-center", tone)}
    >
      {#if hot}
        <span
          class="absolute right-1 top-1 size-1.5 rounded-full bg-amber-500 ring-2 ring-background"
          aria-hidden="true"
        ></span>
      {/if}
      <svg viewBox="0 0 16 16" class={cn(icon.button, "-rotate-90")}>
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
