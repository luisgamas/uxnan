<script lang="ts">
  // The honesty valve of the whole feature (spec `02f` §5.3).
  //
  // An automation that looks active but was never registered with the OS would
  // silently never run. So this badge states the truth in every case, and when
  // registration failed it shows **the operating system's own message** rather
  // than a friendlier version that hides what to fix.
  import { i18n } from "$lib/i18n";
  import { cn } from "$lib/utils";
  import { text } from "$lib/design";
  import { schedulerLabelKey, schedulerTipKey } from "$lib/automations/display";
  import type { SchedulerStatus } from "$lib/automations/types";
  import { TooltipSimple } from "$lib/components/ui/tooltip";
  import { Icon } from "$lib/components/ui/icon";
  import CalendarCheckIcon from "@hugeicons/core-free-icons/CalendarCheckIcon";
  import CalendarOffIcon from "@hugeicons/core-free-icons/CalendarOffIcon";
  import TriangleAlertIcon from "@hugeicons/core-free-icons/Alert01Icon";

  let { status, compact = false }: { status?: SchedulerStatus; compact?: boolean } = $props();

  const kind = $derived(status?.kind ?? "absent");
  const label = $derived(i18n.t(schedulerLabelKey(status)));
  // Only a real failure carries a message, and it is the OS's own text.
  const detail = $derived(
    status?.kind === "failed" ? status.message : i18n.t(schedulerTipKey(status)),
  );
</script>

<TooltipSimple title={detail}>
  {#snippet children(tp)}
    <span
      {...tp}
      class={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5",
        text.indicator,
        kind === "registered" &&
          "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
        kind === "failed" && "border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400",
        kind === "unsupported" &&
          "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400",
        kind === "absent" && "border-border/60 bg-muted/40 text-muted-foreground",
      )}
    >
      {#if kind === "registered"}
        <Icon icon={CalendarCheckIcon} class="size-3" />
      {:else if kind === "failed" || kind === "unsupported"}
        <Icon icon={TriangleAlertIcon} class="size-3" />
      {:else}
        <Icon icon={CalendarOffIcon} class="size-3" />
      {/if}
      {#if !compact}{label}{/if}
    </span>
  {/snippet}
</TooltipSimple>
