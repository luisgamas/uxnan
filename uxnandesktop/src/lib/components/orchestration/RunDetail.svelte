<script lang="ts">
  // One run's detail view: header (name + status + lifecycle controls), the step
  // list (status dot, target agent, dependencies, prompt, captured output/error),
  // and the inline step editor for drafts. The engine (orchestrationRun) advances
  // the run; this view is a live window onto it plus the authoring surface.
  import { untrack } from "svelte";
  import { Button } from "$lib/components/ui/button";
  import { Input } from "$lib/components/ui/input";
  import { Badge } from "$lib/components/ui/badge";
  import { cn } from "$lib/utils";
  import { icon, iconButton, text } from "$lib/design";
  import { i18n } from "$lib/i18n";
  import { app } from "$lib/state/app.svelte";
  import { projects } from "$lib/state/projects.svelte";
  import { orchestrationRun } from "$lib/state/orchestrationRun.svelte";
  import { stepStatusDot, stepStatusLabelKey } from "$lib/orchestration/runDisplay";
  import type { Run, RunStep } from "$lib/orchestration/run";
  import { TooltipSimple } from "$lib/components/ui/tooltip";
  import ConfirmDialog from "../ConfirmDialog.svelte";
  import StepEditor from "./StepEditor.svelte";
  import ArrowLeftIcon from "@lucide/svelte/icons/arrow-left";
  import PlayIcon from "@lucide/svelte/icons/play";
  import PauseIcon from "@lucide/svelte/icons/pause";
  import SquareIcon from "@lucide/svelte/icons/square";
  import RotateIcon from "@lucide/svelte/icons/rotate-ccw";
  import Trash2Icon from "@lucide/svelte/icons/trash-2";
  import PlusIcon from "@lucide/svelte/icons/plus";
  import PencilIcon from "@lucide/svelte/icons/pencil";
  import ChevronRightIcon from "@lucide/svelte/icons/chevron-right";
  import AlertIcon from "@lucide/svelte/icons/triangle-alert";

  let { run, onback }: { run: Run; onback: () => void } = $props();

  const isDraft = $derived(run.status === "draft");
  const isRunning = $derived(run.status === "running");
  const isPaused = $derived(run.status === "paused");
  const isTerminal = $derived(
    run.status === "completed" || run.status === "failed" || run.status === "cancelled",
  );

  // Authoring state: which step is being edited, or whether a new one is added.
  let editingId = $state<string | null>(null);
  let adding = $state(false);
  // Expanded outputs (step ids).
  let expanded = $state<Set<string>>(new Set());
  // Validation errors surfaced when a Start is refused.
  let errors = $state<string[]>([]);
  // Delete-confirmation dialog.
  let deleteOpen = $state(false);
  // Editable title (seeded once; committed on blur/Enter).
  let title = $state(untrack(() => run.title));

  function commitTitle() {
    const t = title.trim();
    if (t && t !== run.title) orchestrationRun.renameRun(run.id, t);
    else title = run.title;
  }

  function start() {
    errors = orchestrationRun.startRun(run.id);
  }

  function toggleOutput(id: string) {
    const next = new Set(expanded);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    expanded = next;
  }

  // Note text for each waiting gate, keyed by step id.
  let gateNotes = $state<Record<string, string>>({});

  function resolveGate(stepId: string, decision: "approve" | "reject") {
    orchestrationRun.resolveGate(run.id, stepId, decision, gateNotes[stepId] ?? "");
    gateNotes = { ...gateNotes, [stepId]: "" };
  }

  function agentLabel(step: RunStep): string {
    if (step.kind === "gate") return i18n.t("orchestration.kindGate");
    const t = step.target;
    // Interactive targets carry `agentType` (the live agent's command); headless
    // targets carry `agent` (the CLI id). Both resolve through the same catalog.
    const id = step.kind === "headless" ? t.agent : t.agentType;
    const name = id ? app.resolveAgent(id).name : i18n.t("orchestration.stepNoAgent");
    const ctx = t.workspace ? projects.contextLabel(t.workspace).name : "";
    const suffix = step.kind === "headless" ? ` · ${i18n.t("orchestration.kindHeadless")}` : "";
    return (ctx ? `${name} · ${ctx}` : name) + suffix;
  }

  function depTitles(step: RunStep): string {
    const byId = new Map(run.steps.map((s) => [s.id, s]));
    return step.dependsOn.map((d) => byId.get(d)?.title || d).join(", ");
  }

  function saveStep(patch: Partial<RunStep>) {
    if (editingId) orchestrationRun.updateStep(run.id, editingId, patch);
    else orchestrationRun.addStepTo(run.id, patch);
    editingId = null;
    adding = false;
  }

  function removeStep(id: string) {
    orchestrationRun.removeStep(run.id, id);
    if (editingId === id) editingId = null;
  }

  function confirmDelete() {
    orchestrationRun.deleteRun(run.id);
    onback();
  }
</script>

<div class="flex min-h-0 flex-col gap-3">
  <!-- Header -->
  <div class="flex items-center gap-2">
    <Button variant="ghost" size="icon" class={iconButton.action} onclick={onback}>
      <ArrowLeftIcon class={icon.button} />
    </Button>
    {#if isDraft}
      <Input
        bind:value={title}
        onblur={commitTitle}
        onkeydown={(e) => e.key === "Enter" && (e.currentTarget as HTMLInputElement).blur()}
        class="h-8 flex-1 text-[13px] font-medium"
        placeholder={i18n.t("orchestration.runTitlePlaceholder")}
      />
    {:else}
      <div class={cn("flex-1 truncate", text.title)}>{run.title}</div>
    {/if}

    <!-- Lifecycle controls -->
    {#if isDraft}
      <Button size="sm" onclick={start}>
        <PlayIcon data-icon="inline-start" />
        {i18n.t("orchestration.start")}
      </Button>
    {:else if isRunning}
      <Button variant="outline" size="sm" onclick={() => orchestrationRun.pauseRun(run.id)}>
        <PauseIcon data-icon="inline-start" />
        {i18n.t("orchestration.pause")}
      </Button>
      <Button variant="outline" size="sm" onclick={() => orchestrationRun.cancelRun(run.id)}>
        <SquareIcon data-icon="inline-start" />
        {i18n.t("orchestration.cancel")}
      </Button>
    {:else if isPaused}
      <Button size="sm" onclick={() => orchestrationRun.resumeRun(run.id)}>
        <PlayIcon data-icon="inline-start" />
        {i18n.t("orchestration.resume")}
      </Button>
      <Button variant="outline" size="sm" onclick={() => orchestrationRun.cancelRun(run.id)}>
        <SquareIcon data-icon="inline-start" />
        {i18n.t("orchestration.cancel")}
      </Button>
    {:else if isTerminal}
      <Button variant="outline" size="sm" onclick={start}>
        <RotateIcon data-icon="inline-start" />
        {i18n.t("orchestration.rerun")}
      </Button>
    {/if}
    <TooltipSimple title={i18n.t("orchestration.deleteRun")}>
      {#snippet children(tp)}
        <Button {...tp} variant="ghost" size="icon" class={iconButton.action} onclick={() => (deleteOpen = true)}>
          <Trash2Icon class={icon.button} />
        </Button>
      {/snippet}
    </TooltipSimple>
  </div>

  <!-- Validation errors -->
  {#if errors.length > 0}
    <div class="flex flex-col gap-1 rounded-md border border-destructive/40 bg-destructive/5 p-2">
      <div class={cn("flex items-center gap-1.5 text-destructive", text.body)}>
        <AlertIcon class="size-3.5" />
        {i18n.t("orchestration.validationTitle")}
      </div>
      {#each errors as e (e)}
        <p class={cn(text.meta, "text-destructive/90")}>{e}</p>
      {/each}
    </div>
  {/if}

  <!-- Steps -->
  <div class="flex max-h-[46vh] flex-col gap-2 overflow-auto pr-1">
    {#if run.steps.length === 0 && !adding}
      <p class={cn(text.meta, "py-4 text-center")}>{i18n.t("orchestration.noSteps")}</p>
    {/if}

    {#each run.steps as step, i (step.id)}
      {#if editingId === step.id}
        <StepEditor {run} {step} onsave={saveStep} oncancel={() => (editingId = null)} />
      {:else}
        <div class="flex flex-col gap-1.5 rounded-lg border border-border/60 bg-card/30 p-2.5">
          <div class="flex items-center gap-2">
            <span class="text-[11px] tabular-nums text-muted-foreground/60">{i + 1}</span>
            <span class={cn("size-2 shrink-0 rounded-full", stepStatusDot(step.status))}></span>
            <span class={cn("min-w-0 flex-1 truncate", text.bodyStrong)}>
              {step.title || step.id}
            </span>
            <Badge variant="secondary" class={cn("font-normal", text.indicator)}>
              {i18n.t(stepStatusLabelKey(step.status))}
            </Badge>
            {#if isDraft}
              <Button
                variant="ghost"
                size="icon"
                class={iconButton.xs}
                onclick={() => (editingId = step.id)}
              >
                <PencilIcon class={icon.action} />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                class={iconButton.xs}
                onclick={() => removeStep(step.id)}
              >
                <Trash2Icon class={icon.action} />
              </Button>
            {/if}
          </div>

          <div class={cn("flex flex-wrap items-center gap-x-2 gap-y-0.5 pl-6", text.meta)}>
            <span>{agentLabel(step)}</span>
            {#if step.dependsOn.length > 0}
              <span class="text-muted-foreground/50">·</span>
              <span>{i18n.t("orchestration.runsAfter", { steps: depTitles(step) })}</span>
            {/if}
          </div>

          {#if step.prompt.trim() && step.kind !== "gate"}
            <p class={cn("line-clamp-2 pl-6", text.meta)}>{step.prompt}</p>
          {/if}

          <!-- HITL gate awaiting a decision -->
          {#if step.kind === "gate" && step.status === "running"}
            <div class="ml-6 flex flex-col gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-2">
              <p class={text.body}>{step.gate?.question || step.title}</p>
              <Input
                value={gateNotes[step.id] ?? ""}
                oninput={(e) =>
                  (gateNotes = { ...gateNotes, [step.id]: (e.currentTarget as HTMLInputElement).value })}
                placeholder={i18n.t("orchestration.gateNotePlaceholder")}
                class="h-8 text-[13px]"
              />
              <div class="flex justify-end gap-2">
                <Button variant="outline" size="sm" onclick={() => resolveGate(step.id, "reject")}>
                  {i18n.t("orchestration.gateReject")}
                </Button>
                <Button size="sm" onclick={() => resolveGate(step.id, "approve")}>
                  {i18n.t("orchestration.gateApprove")}
                </Button>
              </div>
            </div>
          {/if}

          {#if step.error}
            <p class={cn("pl-6 text-destructive/90", text.meta)}>{step.error}</p>
          {/if}

          {#if step.output && step.output.trim()}
            <button
              type="button"
              class={cn("flex items-center gap-1 pl-4 text-left", text.meta)}
              onclick={() => toggleOutput(step.id)}
            >
              <ChevronRightIcon
                class={cn("size-3 transition-transform", expanded.has(step.id) && "rotate-90")}
              />
              {i18n.t("orchestration.stepOutput")}
            </button>
            {#if expanded.has(step.id)}
              <pre
                class="ml-6 max-h-40 overflow-auto whitespace-pre-wrap rounded border border-border/50 bg-muted/40 p-2 text-[11px] leading-relaxed">{step.output}</pre>
            {/if}
          {/if}
        </div>
      {/if}
    {/each}

    <!-- Add step (drafts only) -->
    {#if adding}
      <StepEditor {run} onsave={saveStep} oncancel={() => (adding = false)} />
    {:else if isDraft}
      <Button variant="outline" size="sm" class="self-start" onclick={() => (adding = true)}>
        <PlusIcon data-icon="inline-start" />
        {i18n.t("orchestration.addStep")}
      </Button>
    {/if}
  </div>
</div>

<ConfirmDialog
  bind:open={deleteOpen}
  danger
  title={i18n.t("orchestration.deleteRunTitle")}
  description={i18n.t("orchestration.deleteRunDesc", { name: run.title })}
  confirmLabel={i18n.t("orchestration.deleteRun")}
  onconfirm={confirmDelete}
/>
