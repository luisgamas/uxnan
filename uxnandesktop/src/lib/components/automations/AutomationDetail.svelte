<script lang="ts">
  // One automation, in full: what it is, whether the OS will actually fire it,
  // and everything it has done. The run history is polled while this view is
  // open, so a run started here advances in front of you.
  import { i18n } from "$lib/i18n";
  import { cn } from "$lib/utils";
  import { icon, panel, text } from "$lib/design";
  import { clock, relTime } from "$lib/time.svelte";
  import { app } from "$lib/state/app.svelte";
  import { automations } from "$lib/state/automations.svelte";
  import { agentsOf } from "$lib/automations/display";
  import { nextOccurrences } from "$lib/automations/schedule";
  import type { Automation } from "$lib/automations/types";
  import AgentLogo from "$lib/components/AgentLogo.svelte";
  import SchedulerBadge from "./SchedulerBadge.svelte";
  import RunView from "./RunView.svelte";
  import { Button } from "$lib/components/ui/button";
  import { Switch } from "$lib/components/ui/switch";
  import { Icon } from "$lib/components/ui/icon";
  import ArrowLeftIcon from "@hugeicons/core-free-icons/ArrowLeft01Icon";
  import PlayIcon from "@hugeicons/core-free-icons/PlayIcon";
  import PencilIcon from "@hugeicons/core-free-icons/PencilIcon";

  let {
    automation,
    onback,
    onedit,
  }: { automation: Automation; onback: () => void; onedit: () => void } = $props();

  // Keep this automation's runs fresh only while we're looking at them.
  $effect(() => automations.watch(automation.id));
  $effect(() => {
    void automations.refreshScheduler(automation.id);
  });

  const runs = $derived(automations.runs[automation.id] ?? []);
  const status = $derived(automations.scheduler[automation.id]);
  const upcoming = $derived(
    automation.enabled ? nextOccurrences(automation.schedule, new Date(), 3) : [],
  );
  const fmt = new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
</script>

<div class="flex flex-col gap-5">
  <div class="flex flex-wrap items-center gap-2">
    <Button variant="ghost" size="sm" onclick={onback}>
      <Icon icon={ArrowLeftIcon} data-icon="inline-start" />
      {i18n.t("common.back")}
    </Button>
    <span class="flex-1"></span>
    <Button variant="outline" size="sm" onclick={() => automations.runNow(automation.id)}>
      <Icon icon={PlayIcon} data-icon="inline-start" />
      {i18n.t("automations.runNow")}
    </Button>
    <Button variant="outline" size="sm" onclick={onedit}>
      <Icon icon={PencilIcon} data-icon="inline-start" />
      {i18n.t("common.edit")}
    </Button>
    <Switch
      checked={automation.enabled}
      onCheckedChange={(c) => automations.setEnabled(automation.id, c)}
    />
  </div>

  <div class="flex flex-col gap-2">
    <div class="flex flex-wrap items-center gap-2">
      <h2 class={text.pageTitle}>{automation.name}</h2>
      <SchedulerBadge {status} />
    </div>
    {#if automation.description}
      <p class={text.meta}>{automation.description}</p>
    {/if}
    <p class={cn("font-mono", text.meta)}>{automation.workingDir}</p>
    {#if automation.tags.length > 0}
      <div class="flex flex-wrap gap-1.5">
        {#each automation.tags as tag (tag)}
          <span
            class={cn(
              "rounded-full border border-border/60 bg-muted/40 px-2 py-0.5 text-muted-foreground",
              text.indicator,
            )}
          >
            {tag}
          </span>
        {/each}
      </div>
    {/if}
  </div>

  <!-- The agents that do the work, and when it will next happen. -->
  <div class={cn("flex flex-wrap items-center gap-4 px-3 py-2.5", panel.card)}>
    <div class="flex items-center gap-2">
      <span class={text.section}>{i18n.t("automations.agents")}</span>
      <span class="flex -space-x-1.5">
        {#each agentsOf(automation) as agentId (agentId)}
          <AgentLogo
            logo={app.resolveAgent(agentId).icon}
            class="size-5 rounded-full bg-background ring-1 ring-border/60"
          />
        {/each}
      </span>
    </div>
    <div class="flex flex-wrap items-center gap-2">
      <span class={text.section}>{i18n.t("automations.nextRuns")}</span>
      {#if upcoming.length === 0}
        <span class={text.meta}>{i18n.t("automations.paused")}</span>
      {:else}
        {#each upcoming as when (when.getTime())}
          <span class={cn("tabular-nums text-muted-foreground", text.indicator)}>
            {fmt.format(when)}
          </span>
        {/each}
      {/if}
    </div>
  </div>

  <div class="flex flex-col gap-2">
    <div class="flex items-center gap-2">
      <span class={text.section}>{i18n.t("automations.history")}</span>
      {#if runs.length > 0}
        <span class={text.meta}>{relTime(runs[0].startedAt, clock.now)}</span>
      {/if}
    </div>
    {#if runs.length === 0}
      <p class={text.meta}>{i18n.t("automations.noRuns")}</p>
    {:else}
      {#each runs as run (run.id)}
        <RunView {run} />
      {/each}
    {/if}
  </div>
</div>
