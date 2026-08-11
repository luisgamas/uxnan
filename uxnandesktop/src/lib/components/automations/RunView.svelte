<script lang="ts">
  // One run, in full. This is the only account of an execution nobody watched,
  // so it shows what actually happened rather than a summary: the prompt **as
  // sent** (after substitution), the captured output, the verified exit code and
  // the reason for every refusal.
  import { i18n } from "$lib/i18n";
  import { cn } from "$lib/utils";
  import { icon, panel, row, text } from "$lib/design";
  import { clock, relTime } from "$lib/time.svelte";
  import { app } from "$lib/state/app.svelte";
  import {
    runDuration,
    runProgress,
    runStatusDot,
    runStatusLabelKey,
    stepStatusDot,
    stepStatusLabelKey,
  } from "$lib/automations/display";
  import type { AutomationRun } from "$lib/automations/types";
  import AgentLogo from "$lib/components/AgentLogo.svelte";
  import * as Collapsible from "$lib/components/ui/collapsible";
  import { Icon } from "$lib/components/ui/icon";
  import ChevronRightIcon from "@hugeicons/core-free-icons/ChevronRightIcon";

  let { run, showName = false }: { run: AutomationRun; showName?: boolean } = $props();

  const progress = $derived(runProgress(run));
  const duration = $derived(runDuration(run));

  function seconds(ms: number): string {
    return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
  }
</script>

<div class={cn("flex flex-col gap-3 p-3", panel.card)}>
  <div class="flex flex-wrap items-center gap-2">
    <span class={cn("size-2 shrink-0 rounded-full", runStatusDot(run.status))}></span>
    {#if showName}
      <span class={cn("truncate", text.bodyStrong)}>{run.automationName}</span>
    {/if}
    <span class={text.body}>{i18n.t(runStatusLabelKey(run.status))}</span>
    <span class={text.meta}>
      {i18n.t(`automations.trigger.${run.trigger}`)} · {relTime(run.startedAt, clock.now)}
      {#if duration !== null}· {seconds(duration)}{/if}
      · {i18n.t("automations.stepsProgress", { done: progress.done, total: progress.total })}
    </span>
  </div>

  {#if run.error}
    <p class={cn("text-red-600 dark:text-red-400", text.meta)}>{run.error}</p>
  {/if}

  {#if run.precondition}
    <!-- A precondition that said "no" is the most common reason a run did
         nothing; showing its exit code and output stops that reading as a bug. -->
    <div class={cn("rounded-md border border-border/50 bg-muted/30 px-2.5 py-2", text.meta)}>
      <span class="font-mono">{run.precondition.command}</span>
      <span> → {i18n.t("automations.exitCode", { code: run.precondition.exitCode ?? "—" })}</span>
      {#if run.precondition.timedOut}<span> · {i18n.t("automations.timedOut")}</span>{/if}
      {#if run.precondition.stdout.trim()}
        <pre class="mt-1 whitespace-pre-wrap font-mono text-[11px]">{run.precondition.stdout.trim()}</pre>
      {/if}
    </div>
  {/if}

  <div class="flex flex-col gap-1">
    {#each run.steps as step (step.id)}
      <Collapsible.Root>
        <Collapsible.Trigger class="w-full">
          {#snippet child({ props })}
            <button
              {...props}
              class={cn(row.list, "group")}
            >
              <Icon icon={ChevronRightIcon}
                class={cn(icon.action, "shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-90")}
              />
              <span class={cn("size-1.5 shrink-0 rounded-full", stepStatusDot(step.status))}></span>
              <AgentLogo logo={app.resolveAgent(step.agent).icon} class="size-4 shrink-0" />
              <span class={cn("min-w-0 flex-1 truncate", text.body)}>
                {step.title || step.id}
              </span>
              <span class={text.meta}>{i18n.t(stepStatusLabelKey(step.status))}</span>
              {#if step.exitCode !== null && step.exitCode !== undefined}
                <span class={cn("shrink-0 font-mono", text.indicator)}>
                  {i18n.t("automations.exitCode", { code: step.exitCode })}
                </span>
              {/if}
            </button>
          {/snippet}
        </Collapsible.Trigger>
        <Collapsible.Content>
          <div class="flex flex-col gap-2 px-7 pb-2 pt-1">
            {#if step.error}
              <p class={cn("text-red-600 dark:text-red-400", text.meta)}>{step.error}</p>
            {/if}
            {#if step.missingRefs.length > 0}
              <p class={cn("text-amber-600 dark:text-amber-400", text.meta)}>
                {i18n.t("automations.missingRefs", { ids: step.missingRefs.join(", ") })}
              </p>
            {/if}
            {#if step.prompt}
              <div class="flex flex-col gap-1">
                <span class={text.section}>{i18n.t("automations.promptSent")}</span>
                <pre
                  class="scrollbar-sleek max-h-40 overflow-auto whitespace-pre-wrap rounded-md border border-border/50 bg-muted/30 p-2 font-mono text-[11px]">{step.prompt}</pre>
              </div>
            {/if}
            {#if step.output}
              <div class="flex flex-col gap-1">
                <span class={text.section}>{i18n.t("automations.output")}</span>
                <pre
                  class="scrollbar-sleek max-h-64 overflow-auto whitespace-pre-wrap rounded-md border border-border/50 bg-muted/30 p-2 font-mono text-[11px]">{step.output}</pre>
              </div>
            {/if}
            {#if step.stderr.trim()}
              <div class="flex flex-col gap-1">
                <span class={text.section}>stderr</span>
                <pre
                  class="scrollbar-sleek max-h-40 overflow-auto whitespace-pre-wrap rounded-md border border-border/50 bg-muted/30 p-2 font-mono text-[11px]">{step.stderr.trim()}</pre>
              </div>
            {/if}
          </div>
        </Collapsible.Content>
      </Collapsible.Root>
    {/each}
  </div>
</div>
