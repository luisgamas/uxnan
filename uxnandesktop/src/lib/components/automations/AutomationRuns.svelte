<script lang="ts">
  // Every run, across every automation — the place to answer "what has been
  // happening while I wasn't watching". Filterable by automation and by outcome,
  // because the interesting question is usually "what failed".
  import { i18n } from "$lib/i18n";
  import { cn } from "$lib/utils";
  import { text } from "$lib/design";
  import { automations } from "$lib/state/automations.svelte";
  import { runStatusLabelKey } from "$lib/automations/display";
  import type { RunStatus } from "$lib/automations/types";
  import Combobox from "$lib/components/Combobox.svelte";
  import RunView from "./RunView.svelte";

  let automationFilter = $state("all");
  let statusFilter = $state("all");

  $effect(() => {
    for (const a of automations.items) void automations.loadRuns(a.id);
  });

  const STATUSES: RunStatus[] = [
    "running",
    "completed",
    "failed",
    "skippedPrecondition",
    "skippedOverlap",
    "skippedUnavailable",
  ];

  const automationOptions = $derived([
    {
      items: [
        { value: "all", label: i18n.t("automations.allAutomations") },
        ...automations.items.map((a) => ({ value: a.id, label: a.name })),
      ],
    },
  ]);
  const statusOptions = $derived([
    {
      items: [
        { value: "all", label: i18n.t("automations.allOutcomes") },
        ...STATUSES.map((s) => ({ value: s, label: i18n.t(runStatusLabelKey(s)) })),
      ],
    },
  ]);

  const runs = $derived(
    Object.values(automations.runs)
      .flat()
      .filter((r) => automationFilter === "all" || r.automationId === automationFilter)
      .filter((r) => statusFilter === "all" || r.status === statusFilter)
      .sort((a, b) => b.startedAt - a.startedAt),
  );
</script>

<div class="flex flex-col gap-4">
  <div class="flex flex-wrap items-center gap-2">
    <Combobox
      value={automationFilter}
      groups={automationOptions}
      triggerClass="w-64"
      searchPlaceholder={i18n.t("common.search")}
      onChange={(v) => (automationFilter = v)}
    />
    <Combobox
      value={statusFilter}
      groups={statusOptions}
      triggerClass="w-52"
      searchPlaceholder={i18n.t("common.search")}
      onChange={(v) => (statusFilter = v)}
    />
  </div>

  {#if runs.length === 0}
    <p class={text.meta}>{i18n.t("automations.noRuns")}</p>
  {:else}
    <div class={cn("flex flex-col gap-2")}>
      {#each runs as run (run.id)}
        <RunView {run} showName />
      {/each}
    </div>
  {/if}
</div>
