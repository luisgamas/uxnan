<script lang="ts">
  // Compact resource readout for the backend popover: what uxnan + its
  // terminals + its agents cost right now, each row carrying its attribution
  // confidence instead of pretending precision. Fed by the `resources` store,
  // whose lease the popover takes on open — this component renders whatever is
  // buffered and never drives sampling itself.
  import { i18n } from "$lib/i18n";
  import { resources } from "$lib/state/resources.svelte";
  import type { ResourceGroupSummary } from "$lib/types";
  import {
    confidenceKey,
    groupLabel,
    groupState,
    orderedGroups,
    surfaceState,
  } from "$lib/resources/display";
  import { formatAge, formatBytes, formatCpu } from "$lib/resources/format";
  import { cn } from "$lib/utils";
  import { text } from "$lib/design";
  import { TooltipSimple } from "$lib/components/ui/tooltip";
  import ActivityIcon from "@lucide/svelte/icons/activity";
  import TrendingUpIcon from "@lucide/svelte/icons/trending-up";
  import TrendingDownIcon from "@lucide/svelte/icons/trending-down";
  import TriangleAlertIcon from "@lucide/svelte/icons/triangle-alert";

  const summary = $derived(resources.summary);
  const state = $derived(surfaceState(summary, resources.loading));
  const groups = $derived(summary ? orderedGroups(summary) : []);
  const total = $derived(summary?.total ?? null);
  const orphans = $derived(summary?.orphans ?? []);

  /** Confidence marker after a row label: nothing for exact, `~` inferred,
   *  `?` unknown — each explained in its tooltip. */
  function confidenceMark(group: ResourceGroupSummary): string {
    if (group.confidence === "exact") return "";
    return group.confidence === "inferred" ? "~" : "?";
  }

  function kindLabel(group: ResourceGroupSummary): string {
    switch (group.kind) {
      case "desktop":
        return i18n.t("resources.kindDesktop");
      case "workspace":
        return groupLabel(group);
      case "agent":
        return groupLabel(group);
      case "terminal":
        return `${i18n.t("resources.kindTerminal")} ${groupLabel(group)}`;
      default:
        return groupLabel(group) || group.kind;
    }
  }
</script>

<div class="flex flex-col gap-2 border-t border-border/60 p-3" data-testid="resource-summary">
  <div class="flex items-center gap-1.5">
    <ActivityIcon class="size-3.5 text-muted-foreground" />
    <span class="text-sm font-medium text-foreground">{i18n.t("resources.title")}</span>
    {#if summary?.sampling.active && summary.sampling.intervalMs}
      <span class={cn("ml-auto tabular-nums", text.meta)}>
        {i18n.t("resources.samplingEvery", { seconds: summary.sampling.intervalMs / 1000 })}
      </span>
    {/if}
  </div>

  {#if state === "loading"}
    <p class={text.meta}>{i18n.t("resources.loading")}</p>
  {:else if state === "unsupported"}
    <p class={text.meta}>{i18n.t("resources.unsupported")}</p>
  {:else if state === "empty"}
    <p class={text.meta}>{i18n.t("resources.empty")}</p>
  {:else if summary}
    <!-- Uxnan total: instant, with average/peak context underneath. -->
    {#if total}
      <div class="flex items-baseline justify-between gap-2">
        <span class={cn("font-medium text-foreground", text.body)}>
          {i18n.t("resources.totalLabel")}
        </span>
        <span class={cn("shrink-0 font-medium tabular-nums text-foreground", text.body)}>
          {formatCpu(total.cpuPercent)} · {formatBytes(total.residentBytes)}
        </span>
      </div>
      <div class="flex items-center justify-between gap-2">
        <span class={text.meta}>
          {i18n.plural(total.processes, "resources.processesOne", "resources.processesOther")}
        </span>
        <span class={cn("flex items-center gap-1 tabular-nums", text.meta)}>
          {i18n.t("resources.peak")}
          {formatCpu(total.cpuPeakPercent)} · {formatBytes(total.residentPeakBytes)}
          {#if total.trend === "rising"}
            <TooltipSimple title={i18n.t("resources.trendRising")}>
              {#snippet children(tp)}
                <span {...tp}><TrendingUpIcon class="size-3 text-amber-500" /></span>
              {/snippet}
            </TooltipSimple>
          {:else if total.trend === "falling"}
            <TooltipSimple title={i18n.t("resources.trendFalling")}>
              {#snippet children(tp)}
                <span {...tp}><TrendingDownIcon class="size-3 text-muted-foreground" /></span>
              {/snippet}
            </TooltipSimple>
          {/if}
        </span>
      </div>
    {/if}

    {#if groups.length > 0}
      <div class="flex flex-col gap-1 border-t border-border/50 pt-2">
        {#each groups as group (group.kind + (group.id ?? ""))}
          {@const rowState = groupState(group)}
          <div
            class={cn("flex items-baseline justify-between gap-2", group.ended && "opacity-60")}
            data-testid="resource-group"
            data-state={rowState}
          >
            <span class={cn("flex min-w-0 items-baseline gap-1", text.meta)}>
              <span class="truncate" title={group.id ?? undefined}>{kindLabel(group)}</span>
              {#if confidenceMark(group)}
                <TooltipSimple title={i18n.t(confidenceKey(group.confidence))}>
                  {#snippet children(tp)}
                    <span
                      {...tp}
                      class={cn(
                        "shrink-0 cursor-help font-medium",
                        group.confidence === "unknown" ? "text-amber-500" : "",
                      )}>{confidenceMark(group)}</span
                    >
                  {/snippet}
                </TooltipSimple>
              {/if}
              {#if group.ended}
                <span class="shrink-0">· {i18n.t("resources.ended")}</span>
              {/if}
            </span>
            <span
              class={cn(
                "shrink-0 tabular-nums",
                text.meta,
                rowState === "spike" && "font-medium text-amber-600 dark:text-amber-400",
              )}
            >
              {#if rowState === "spike"}
                <TooltipSimple title={i18n.t("resources.spike")}>
                  {#snippet children(tp)}
                    <span {...tp}>{formatCpu(group.cpuPercent)}</span>
                  {/snippet}
                </TooltipSimple>
              {:else}
                {formatCpu(group.cpuPercent)}
              {/if}
              · {formatBytes(group.residentBytes)}
            </span>
          </div>
        {/each}
      </div>
    {/if}

    {#if orphans.length > 0}
      <div
        class={cn(
          "flex flex-col gap-1 rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-1.5",
          text.meta,
        )}
        data-testid="resource-orphans"
      >
        <span class="flex items-center gap-1.5 font-medium text-amber-600 dark:text-amber-400">
          <TriangleAlertIcon class="size-3" />
          {i18n.plural(orphans.length, "resources.orphansOne", "resources.orphansOther")}
        </span>
        {#each orphans as orphan (orphan.id + orphan.sinceMs)}
          <span class="truncate">
            {orphan.id} · {formatBytes(orphan.residentBytes)} ·
            {i18n.t("resources.orphanAge", { age: formatAge(Date.now() - orphan.sinceMs) })}
          </span>
        {/each}
      </div>
    {/if}

    {#if !summary.capabilities.validated}
      <p class={text.meta}>{i18n.t("resources.bestEffort")}</p>
    {/if}
  {/if}
</div>
