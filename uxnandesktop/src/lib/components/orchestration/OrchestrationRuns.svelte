<script lang="ts">
  // Runs tab (spec 02d §3) — the deterministic run engine's surface. Lists runs
  // grouped Active / Drafts / Past, opens one into `RunDetail` (build + drive),
  // and creates a new draft. The heavy lifting (scheduling, dispatch, completion,
  // persistence) lives in the `orchestrationRun` engine; this is its window.
  import { Button } from "$lib/components/ui/button";
  import { Badge } from "$lib/components/ui/badge";
  import { cn } from "$lib/utils";
  import { text } from "$lib/design";
  import { i18n } from "$lib/i18n";
  import { orchestrationRun } from "$lib/state/orchestrationRun.svelte";
  import { runStatusDot, runStatusLabelKey } from "$lib/orchestration/runDisplay";
  import type { Run } from "$lib/orchestration/run";
  import RunDetail from "./RunDetail.svelte";
  import PlusIcon from "@lucide/svelte/icons/plus";
  import WorkflowIcon from "@lucide/svelte/icons/workflow";

  let selectedRunId = $state<string | null>(null);

  // Look the selected run up live so the detail view stays reactive; reset if it
  // was deleted out from under us.
  const selected = $derived.by(() => {
    if (!selectedRunId) return null;
    return orchestrationRun.runById(selectedRunId) ?? null;
  });
  $effect(() => {
    if (selectedRunId && !orchestrationRun.runById(selectedRunId)) selectedRunId = null;
  });

  const active = $derived(orchestrationRun.activeRuns);
  const drafts = $derived(orchestrationRun.draftRuns);
  const past = $derived(orchestrationRun.pastRuns);
  const hasAny = $derived(active.length + drafts.length + past.length > 0);

  function newRun() {
    const run = orchestrationRun.createDraft(i18n.t("orchestration.newRunDefault"));
    selectedRunId = run.id;
  }

  const sections = $derived(
    [
      { key: "active", label: i18n.t("orchestration.runsActive"), runs: active },
      { key: "draft", label: i18n.t("orchestration.runsDrafts"), runs: drafts },
      { key: "past", label: i18n.t("orchestration.runsPast"), runs: past },
    ].filter((s) => s.runs.length > 0),
  );

  function stepSummary(run: Run): string {
    const done = run.steps.filter((s) => s.status === "completed").length;
    return i18n.t("orchestration.stepsProgress", { done, total: run.steps.length });
  }
</script>

{#if selected}
  <RunDetail run={selected} onback={() => (selectedRunId = null)} />
{:else}
  <div class="flex items-center justify-between gap-2 pb-1">
    <p class={text.meta}>{i18n.t("orchestration.runsDesc")}</p>
    <Button size="sm" onclick={newRun}>
      <PlusIcon data-icon="inline-start" />
      {i18n.t("orchestration.newRun")}
    </Button>
  </div>

  {#if !hasAny}
    <div class="flex flex-col items-center gap-1.5 py-8 text-center">
      <WorkflowIcon class="size-8 text-muted-foreground/50" />
      <p class={cn("font-medium", text.body)}>{i18n.t("orchestration.runsEmptyTitle")}</p>
      <p class={cn(text.meta, "max-w-sm")}>{i18n.t("orchestration.runsEmptyDesc")}</p>
    </div>
  {:else}
    <div class="flex max-h-[52vh] flex-col gap-3 overflow-auto pr-1">
      {#each sections as section (section.key)}
        <div class="flex flex-col gap-1">
          <span class={text.section}>{section.label}</span>
          {#each section.runs as run (run.id)}
            <button
              type="button"
              class="flex items-center gap-2.5 rounded-md border border-border/70 bg-card/30 px-2.5 py-2 text-left transition-colors hover:border-border hover:bg-accent/40"
              onclick={() => (selectedRunId = run.id)}
            >
              <span class={cn("size-2 shrink-0 rounded-full", runStatusDot(run.status))}></span>
              <div class="min-w-0 flex-1">
                <div class={cn("truncate", text.bodyStrong)}>{run.title}</div>
                <div class={text.meta}>{stepSummary(run)}</div>
              </div>
              <Badge variant="secondary" class={cn("font-normal", text.indicator)}>
                {i18n.t(runStatusLabelKey(run.status))}
              </Badge>
            </button>
          {/each}
        </div>
      {/each}
    </div>
  {/if}
{/if}
