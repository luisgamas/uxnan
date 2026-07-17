<script lang="ts">
  // Runs tab (spec 02d §3) — the deterministic run engine's surface. Lists runs
  // grouped Active / Drafts / Past, opens one into `RunDetail` (build + drive),
  // and creates a new draft. The heavy lifting (scheduling, dispatch, completion,
  // persistence) lives in the `orchestrationRun` engine; this is its window.
  import { Button } from "$lib/components/ui/button";
  import { Badge } from "$lib/components/ui/badge";
  import * as DropdownMenu from "$lib/components/ui/dropdown-menu";
  import { cn } from "$lib/utils";
  import { text } from "$lib/design";
  import { i18n } from "$lib/i18n";
  import { projects } from "$lib/state/projects.svelte";
  import { orchestrationRun } from "$lib/state/orchestrationRun.svelte";
  import { aiCommitAgents } from "$lib/api";
  import { runStatusDot, runStatusLabelKey } from "$lib/orchestration/runDisplay";
  import type { ExampleStepSpec } from "$lib/orchestration/examples";
  import type { Run } from "$lib/orchestration/run";
  import RunDetail from "./RunDetail.svelte";
  import PlusIcon from "@lucide/svelte/icons/plus";
  import SparklesIcon from "@lucide/svelte/icons/sparkles";
  import WorkflowIcon from "@lucide/svelte/icons/workflow";

  let selectedRunId = $state<string | null>(null);

  // Installed CLIs, to preselect a sensible headless agent for the examples.
  let installedAgents = $state<string[]>([]);
  $effect(() => {
    if (installedAgents.length > 0) return;
    void aiCommitAgents()
      .then((a) => (installedAgents = a))
      .catch(() => {});
  });
  // Preferred headless default for examples: the first of these the user has, so
  // an example lands runnable whether they have a paid agent or a free one.
  const AGENT_PREFERENCE = ["claude", "codex", "opencode", "pi", "gemini"];
  const preferredAgent = $derived(
    AGENT_PREFERENCE.find((a) => installedAgents.includes(a)) ?? installedAgents[0] ?? "",
  );
  const defaultWorkspace = $derived(
    orchestrationRun.liveAgents.find((a) => a.workspace)?.workspace ??
      projects.allWorktrees()[0]?.path ??
      "",
  );

  // Ready-made example runs (localized copy; the prompts embed {{steps.sN.output}}).
  const templates = $derived(
    [
      {
        id: "read-summarize",
        title: i18n.t("orchestration.exReadTitle"),
        description: i18n.t("orchestration.exReadDesc"),
        steps: [
          { title: i18n.t("orchestration.exReadS1Title"), kind: "headless", prompt: i18n.t("orchestration.exReadS1Prompt"), dependsOn: [] },
          { title: i18n.t("orchestration.exReadS2Title"), kind: "headless", prompt: i18n.t("orchestration.exReadS2Prompt"), dependsOn: [0] },
        ],
      },
      {
        id: "parallel-review",
        title: i18n.t("orchestration.exReviewTitle"),
        description: i18n.t("orchestration.exReviewDesc"),
        steps: [
          { title: i18n.t("orchestration.exReviewS1Title"), kind: "headless", prompt: i18n.t("orchestration.exReviewS1Prompt"), dependsOn: [] },
          { title: i18n.t("orchestration.exReviewS2Title"), kind: "headless", prompt: i18n.t("orchestration.exReviewS2Prompt"), dependsOn: [] },
          { title: i18n.t("orchestration.exReviewS3Title"), kind: "headless", prompt: i18n.t("orchestration.exReviewS3Prompt"), dependsOn: [0, 1] },
        ],
      },
      {
        id: "gate-polish",
        title: i18n.t("orchestration.exGateTitle"),
        description: i18n.t("orchestration.exGateDesc"),
        steps: [
          { title: i18n.t("orchestration.exGateS1Title"), kind: "headless", prompt: i18n.t("orchestration.exGateS1Prompt"), dependsOn: [] },
          { title: i18n.t("orchestration.exGateS2Title"), kind: "gate", prompt: i18n.t("orchestration.exGateS2Prompt"), dependsOn: [0] },
          { title: i18n.t("orchestration.exGateS3Title"), kind: "headless", prompt: i18n.t("orchestration.exGateS3Prompt"), dependsOn: [0, 1] },
        ],
      },
    ] satisfies { id: string; title: string; description: string; steps: ExampleStepSpec[] }[],
  );

  function addExample(t: { title: string; steps: ExampleStepSpec[] }) {
    const run = orchestrationRun.createExampleRun(t.title, t.steps, preferredAgent, defaultWorkspace);
    selectedRunId = run.id;
  }

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
    <div class="flex items-center gap-2">
      <DropdownMenu.Root>
        <DropdownMenu.Trigger>
          {#snippet child({ props })}
            <Button {...props} variant="outline" size="sm">
              <SparklesIcon data-icon="inline-start" />
              {i18n.t("orchestration.examples")}
            </Button>
          {/snippet}
        </DropdownMenu.Trigger>
        <DropdownMenu.Content align="end" class="w-80">
          <DropdownMenu.Label class="text-[11px] font-normal text-muted-foreground">
            {i18n.t("orchestration.examplesHint")}
          </DropdownMenu.Label>
          {#each templates as t (t.id)}
            <DropdownMenu.Item class="flex flex-col items-start gap-0.5 py-1.5" onclick={() => addExample(t)}>
              <span class="text-[13px] font-medium">{t.title}</span>
              <span class="text-xs text-muted-foreground">{t.description}</span>
            </DropdownMenu.Item>
          {/each}
        </DropdownMenu.Content>
      </DropdownMenu.Root>
      <Button size="sm" onclick={newRun}>
        <PlusIcon data-icon="inline-start" />
        {i18n.t("orchestration.newRun")}
      </Button>
    </div>
  </div>

  {#if !hasAny}
    <div class="flex flex-col items-center gap-1.5 py-8 text-center">
      <WorkflowIcon class="size-8 text-muted-foreground/50" />
      <p class={cn("font-medium", text.body)}>{i18n.t("orchestration.runsEmptyTitle")}</p>
      <p class={cn(text.meta, "max-w-sm")}>{i18n.t("orchestration.runsEmptyDesc")}</p>
    </div>
  {:else}
    <div class="flex min-h-0 flex-1 flex-col gap-3 overflow-auto pr-1">
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
