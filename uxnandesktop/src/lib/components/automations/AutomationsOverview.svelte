<script lang="ts">
  // The dashboard: what is about to happen, what just happened, and anything
  // that needs attention. Deliberately answers "is everything fine?" first —
  // an automation that silently stopped being scheduled is the failure mode
  // worth surfacing above all else.
  import { i18n } from "$lib/i18n";
  import { cn } from "$lib/utils";
  import { icon, panel, row, text } from "$lib/design";
  import { app } from "$lib/state/app.svelte";
  import { automations } from "$lib/state/automations.svelte";
  import { agentsOf, isScheduled } from "$lib/automations/display";
  import { nextOccurrence } from "$lib/automations/schedule";
  import AgentLogo from "$lib/components/AgentLogo.svelte";
  import SchedulerBadge from "./SchedulerBadge.svelte";
  import RunView from "./RunView.svelte";
  import { Button } from "$lib/components/ui/button";
  import { Icon } from "$lib/components/ui/icon";
  import CalendarClockIcon from "@hugeicons/core-free-icons/CalendarClockIcon";

  // Every automation's runs, so "recent activity" is real rather than whatever
  // happens to be cached.
  $effect(() => {
    for (const a of automations.items) void automations.loadRuns(a.id);
  });

  const enabled = $derived(automations.items.filter((a) => a.enabled));

  /** Enabled but not actually registered — the honest-degradation surface. */
  const unscheduled = $derived(
    enabled.filter((a) => !isScheduled(automations.scheduler[a.id])),
  );

  const upcoming = $derived(
    enabled
      .map((a) => ({ automation: a, when: nextOccurrence(a.schedule, new Date()) }))
      .filter((x): x is { automation: (typeof enabled)[number]; when: Date } => x.when !== null)
      .sort((a, b) => a.when.getTime() - b.when.getTime())
      .slice(0, 6),
  );

  const recent = $derived(
    Object.values(automations.runs)
      .flat()
      .sort((a, b) => b.startedAt - a.startedAt)
      .slice(0, 5),
  );

  const fmt = new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

  function open(id: string) {
    app.automationsSelectedId = id;
    app.automationsSection = "list";
  }
</script>

<div class="flex flex-col gap-6">
  {#if automations.items.length === 0}
    <div class="flex flex-col items-center gap-1.5 py-10 text-center">
      <Icon icon={CalendarClockIcon} class={cn(icon.empty, "text-muted-foreground/50")} />
      <p class={cn("font-medium", text.body)}>{i18n.t("automations.emptyTitle")}</p>
      <p class={cn(text.meta, "max-w-md")}>{i18n.t("automations.emptyDesc")}</p>
      <Button size="sm" class="mt-2" onclick={() => (app.automationsSection = "list")}>
        {i18n.t("automations.new")}
      </Button>
    </div>
  {:else}
    {#if unscheduled.length > 0}
      <div class="flex flex-col gap-1.5">
        <span class={text.section}>{i18n.t("automations.needsAttention")}</span>
        {#each unscheduled as a (a.id)}
          <button
            type="button"
            class={cn(row.list, panel.card, "gap-2.5")}
            onclick={() => open(a.id)}
          >
            <span class={cn("min-w-0 flex-1 truncate", text.body)}>{a.name}</span>
            <SchedulerBadge status={automations.scheduler[a.id]} />
          </button>
        {/each}
      </div>
    {/if}

    <div class="flex flex-col gap-1.5">
      <span class={text.section}>{i18n.t("automations.upcoming")}</span>
      {#if upcoming.length === 0}
        <p class={text.meta}>{i18n.t("automations.nothingScheduled")}</p>
      {:else}
        {#each upcoming as item (item.automation.id)}
          <button
            type="button"
            class={cn(row.list, panel.card, "gap-2.5")}
            onclick={() => open(item.automation.id)}
          >
            <span class="flex shrink-0 -space-x-1.5">
              {#each agentsOf(item.automation).slice(0, 3) as agentId (agentId)}
                <AgentLogo
                  logo={app.resolveAgent(agentId).icon}
                  class="size-5 rounded-full bg-background ring-1 ring-border/60"
                />
              {/each}
            </span>
            <span class={cn("min-w-0 flex-1 truncate", text.body)}>{item.automation.name}</span>
            <span class={cn("shrink-0 tabular-nums", text.meta)}>{fmt.format(item.when)}</span>
          </button>
        {/each}
      {/if}
    </div>

    <div class="flex flex-col gap-2">
      <span class={text.section}>{i18n.t("automations.recent")}</span>
      {#if recent.length === 0}
        <p class={text.meta}>{i18n.t("automations.noRuns")}</p>
      {:else}
        {#each recent as run (run.id)}
          <RunView {run} showName />
        {/each}
      {/if}
    </div>
  {/if}
</div>
