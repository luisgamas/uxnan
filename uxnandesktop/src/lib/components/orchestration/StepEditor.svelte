<script lang="ts">
  // Inline editor for one run step (add or edit). A step is either:
  //  · Interactive — types the prompt into a live agent's PTY; output is the
  //    coarse hook summary.
  //  · Headless — runs an installed CLI in print-mode in a chosen worktree; the
  //    ADE owns the process, so output is the full stdout and completion is
  //    verified by the exit code (robust chaining).
  // The prompt can plant a prior step's output via `{{steps.s1.output}}` chips,
  // and "runs after" toggles declare the DAG edges. Referenced steps are
  // auto-added as dependencies on save, so a step never runs before what it quotes.
  import { untrack } from "svelte";
  import { Input } from "$lib/components/ui/input";
  import { Textarea } from "$lib/components/ui/textarea";
  import { Button } from "$lib/components/ui/button";
  import * as Select from "$lib/components/ui/select";
  import { cn } from "$lib/utils";
  import { text } from "$lib/design";
  import { i18n } from "$lib/i18n";
  import { app } from "$lib/state/app.svelte";
  import { projects } from "$lib/state/projects.svelte";
  import { orchestrationRun } from "$lib/state/orchestrationRun.svelte";
  import { aiCommitAgents, aiCommitModels } from "$lib/api";
  import type { AgentModel } from "$lib/types";
  import { referencedStepIds, type Run, type RunStep, type StepKind, type StepTarget } from "$lib/orchestration/run";
  import AgentLogo from "../AgentLogo.svelte";

  let {
    run,
    step = null,
    onsave,
    oncancel,
  }: {
    run: Run;
    step?: RunStep | null;
    onsave: (patch: Partial<RunStep>) => void;
    oncancel: () => void;
  } = $props();

  const liveAgents = $derived(orchestrationRun.liveAgents);

  // Local, uncommitted edit state (seeded once from the step being edited).
  let kind = $state<string>(untrack(() => step?.kind ?? "interactive"));
  let title = $state(untrack(() => step?.title ?? ""));
  let prompt = $state(untrack(() => step?.prompt ?? (step?.gate?.question ?? "")));
  let onFailure = $state<string>(untrack(() => step?.onFailure ?? "stop"));
  // String-backed so it binds cleanly to the numeric `<Input>`; parsed on save.
  let maxAttempts = $state(untrack(() => String(step?.maxAttempts ?? 2)));
  // Interactive target.
  let tabId = $state(untrack(() => step?.target.tabId ?? ""));
  // Headless target.
  let hAgent = $state(untrack(() => step?.target.agent ?? ""));
  let hModel = $state(untrack(() => step?.target.model ?? ""));
  let hWorkspace = $state(untrack(() => step?.target.workspace ?? ""));
  // Dependencies default to the most recent existing step (a sequence by
  // default); the user can toggle to run in parallel or fan in from several.
  let dependsOn = $state<string[]>(untrack(() => step?.dependsOn ?? defaultDeps()));

  // Installed CLIs + their models for the headless picker (lazy-loaded).
  let installedAgents = $state<string[]>([]);
  let headlessModels = $state<AgentModel[]>([]);

  function defaultDeps(): string[] {
    const last = run.steps[run.steps.length - 1];
    return last ? [last.id] : [];
  }

  // Earlier steps this one may depend on / reference (every step but itself).
  const candidates = $derived(run.steps.filter((s) => s.id !== step?.id));

  // Load the installed agents once (cheap; enables the headless picker).
  $effect(() => {
    if (installedAgents.length > 0) return;
    void aiCommitAgents()
      .then((a) => (installedAgents = a))
      .catch(() => {});
  });

  // Load the chosen headless agent's models when it changes.
  $effect(() => {
    const a = hAgent;
    if (kind !== "headless" || !a) return;
    void loadModels(a);
  });
  async function loadModels(a: string): Promise<void> {
    try {
      const models = await aiCommitModels(a);
      headlessModels = models;
      // Drop a stale model the newly-picked agent doesn't offer (async read is
      // outside the effect's tracking, so this doesn't loop).
      if (hModel && !models.some((m) => m.id === hModel)) hModel = "";
    } catch {
      headlessModels = [];
    }
  }

  // Interactive: the selected live agent + its label.
  const selectedAgent = $derived(liveAgents.find((a) => a.tabId === tabId));
  const agentLabel = $derived.by(() => {
    if (!selectedAgent) return i18n.t("orchestration.stepAgentPlaceholder");
    return `${selectedAgent.name} · ${projects.contextLabel(selectedAgent.workspace).name}`;
  });

  // Headless: workspace options (registered worktrees ∪ live agents' worktrees).
  const workspaceOptions = $derived.by(() => {
    const map = new Map<string, string>();
    for (const w of projects.allWorktrees()) map.set(w.path, wsLabel(w.path));
    for (const a of liveAgents) if (a.workspace) map.set(a.workspace, wsLabel(a.workspace));
    return [...map.entries()].map(([path, label]) => ({ path, label }));
  });
  function wsLabel(path: string): string {
    const c = projects.contextLabel(path);
    return c.repo ? `${c.repo} · ${c.name}` : c.name;
  }

  const headlessAgentLabel = $derived(
    hAgent ? app.resolveAgent(hAgent).name : i18n.t("orchestration.stepAgentPlaceholder"),
  );
  const modelLabel = $derived(
    headlessModels.find((m) => m.id === hModel)?.displayName ?? i18n.t("orchestration.modelDefault"),
  );
  const workspaceLabel = $derived(
    hWorkspace ? wsLabel(hWorkspace) : i18n.t("orchestration.workspacePlaceholder"),
  );

  function toggleDep(id: string) {
    dependsOn = dependsOn.includes(id) ? dependsOn.filter((d) => d !== id) : [...dependsOn, id];
  }

  function insertRef(id: string) {
    const token = `{{steps.${id}.output}}`;
    prompt = prompt ? `${prompt}\n\n${token}` : token;
    if (!dependsOn.includes(id)) dependsOn = [...dependsOn, id];
  }

  const canSave = $derived(
    prompt.trim().length > 0 &&
      (kind === "gate" || (kind === "interactive" ? !!tabId : !!hAgent && !!hWorkspace)),
  );

  function kindLabel(k: string): string {
    if (k === "headless") return i18n.t("orchestration.kindHeadless");
    if (k === "gate") return i18n.t("orchestration.kindGate");
    return i18n.t("orchestration.kindInteractive");
  }

  function save() {
    if (!canSave) return;
    let target: StepTarget = {};
    if (kind === "interactive") {
      const agent = liveAgents.find((a) => a.tabId === tabId);
      target = { tabId, agentType: agent?.type, workspace: agent?.workspace };
    } else if (kind === "headless") {
      target = { agent: hAgent, model: hModel, workspace: hWorkspace };
    }
    const refs = referencedStepIds(prompt);
    const deps = [...new Set([...dependsOn, ...refs])].filter((d) => d !== step?.id);
    const fail = onFailure === "retry" ? "retry" : "stop";
    onsave({
      title: title.trim(),
      kind: kind as StepKind,
      target,
      prompt,
      dependsOn: deps,
      onFailure: kind === "gate" ? "stop" : fail,
      maxAttempts: fail === "retry" ? Math.max(2, Math.min(9, parseInt(maxAttempts, 10) || 2)) : 1,
      gate: kind === "gate" ? { question: prompt.trim() } : undefined,
    });
  }
</script>

<div class="flex flex-col gap-3 rounded-lg border border-border/70 bg-card/40 p-3">
  <!-- Kind + title -->
  <div class="flex items-end gap-2">
    <div class="flex flex-col gap-1">
      <span class={text.section}>{i18n.t("orchestration.stepKind")}</span>
      <Select.Root type="single" bind:value={kind}>
        <Select.Trigger class="h-8 w-40 text-[13px]">{kindLabel(kind)}</Select.Trigger>
        <Select.Content>
          <Select.Item value="interactive" label={i18n.t("orchestration.kindInteractive")}>
            {i18n.t("orchestration.kindInteractive")}
          </Select.Item>
          <Select.Item value="headless" label={i18n.t("orchestration.kindHeadless")}>
            {i18n.t("orchestration.kindHeadless")}
          </Select.Item>
          <Select.Item value="gate" label={i18n.t("orchestration.kindGate")}>
            {i18n.t("orchestration.kindGate")}
          </Select.Item>
        </Select.Content>
      </Select.Root>
    </div>
    <div class="flex flex-1 flex-col gap-1">
      <span class={text.section}>{i18n.t("orchestration.stepTitle")}</span>
      <Input
        bind:value={title}
        placeholder={i18n.t("orchestration.stepTitlePlaceholder")}
        class="h-8 text-[13px]"
      />
    </div>
  </div>

  <p class={text.meta}>
    {kind === "headless"
      ? i18n.t("orchestration.kindHeadlessHint")
      : kind === "gate"
        ? i18n.t("orchestration.kindGateHint")
        : i18n.t("orchestration.kindInteractiveHint")}
  </p>

  <!-- Target -->
  {#if kind === "gate"}
    <!-- A gate has no agent target — it pauses for a human decision. -->
  {:else if kind === "interactive"}
    <div class="flex flex-col gap-1">
      <span class={text.section}>{i18n.t("orchestration.stepAgent")}</span>
      {#if liveAgents.length === 0}
        <p class={text.meta}>{i18n.t("orchestration.noAgentsHint")}</p>
      {:else}
        <Select.Root type="single" bind:value={tabId}>
          <Select.Trigger class="h-8 text-[13px]">
            <span class="flex min-w-0 items-center gap-2">
              {#if selectedAgent}
                <AgentLogo logo={selectedAgent.icon} class="size-4 shrink-0" />
              {/if}
              <span class="truncate">{agentLabel}</span>
            </span>
          </Select.Trigger>
          <Select.Content>
            {#each liveAgents as a (a.tabId)}
              {@const label = `${a.name} · ${projects.contextLabel(a.workspace).name}`}
              <Select.Item value={a.tabId} {label}>
                <span class="flex min-w-0 items-center gap-2">
                  <AgentLogo logo={a.icon} class="size-4 shrink-0" />
                  <span class="truncate">{label}</span>
                </span>
              </Select.Item>
            {/each}
          </Select.Content>
        </Select.Root>
      {/if}
    </div>
  {:else}
    <!-- Headless target: CLI + model + worktree -->
    <div class="grid grid-cols-2 gap-2">
      <div class="flex flex-col gap-1">
        <span class={text.section}>{i18n.t("orchestration.stepAgent")}</span>
        {#if installedAgents.length === 0}
          <p class={text.meta}>{i18n.t("orchestration.noInstalledAgents")}</p>
        {:else}
          <Select.Root type="single" bind:value={hAgent}>
            <Select.Trigger class="h-8 text-[13px]">
              <span class="flex min-w-0 items-center gap-2">
                {#if hAgent}
                  <AgentLogo logo={app.resolveAgent(hAgent).icon} class="size-4 shrink-0" />
                {/if}
                <span class="truncate">{headlessAgentLabel}</span>
              </span>
            </Select.Trigger>
            <Select.Content>
              {#each installedAgents as id (id)}
                {@const label = app.resolveAgent(id).name}
                <Select.Item value={id} {label}>
                  <span class="flex min-w-0 items-center gap-2">
                    <AgentLogo logo={app.resolveAgent(id).icon} class="size-4 shrink-0" />
                    <span class="truncate">{label}</span>
                  </span>
                </Select.Item>
              {/each}
            </Select.Content>
          </Select.Root>
        {/if}
      </div>
      <div class="flex flex-col gap-1">
        <span class={text.section}>{i18n.t("orchestration.stepModel")}</span>
        <Select.Root type="single" bind:value={hModel} disabled={!hAgent}>
          <Select.Trigger class="h-8 text-[13px]"><span class="truncate">{modelLabel}</span></Select.Trigger>
          <Select.Content>
            <Select.Item value="" label={i18n.t("orchestration.modelDefault")}>
              {i18n.t("orchestration.modelDefault")}
            </Select.Item>
            {#each headlessModels as m (m.id)}
              <Select.Item value={m.id} label={m.displayName}>{m.displayName}</Select.Item>
            {/each}
          </Select.Content>
        </Select.Root>
      </div>
    </div>
    <div class="flex flex-col gap-1">
      <span class={text.section}>{i18n.t("orchestration.stepWorkspace")}</span>
      {#if workspaceOptions.length === 0}
        <p class={text.meta}>{i18n.t("orchestration.noWorkspaces")}</p>
      {:else}
        <Select.Root type="single" bind:value={hWorkspace}>
          <Select.Trigger class="h-8 text-[13px]"><span class="truncate">{workspaceLabel}</span></Select.Trigger>
          <Select.Content>
            {#each workspaceOptions as w (w.path)}
              <Select.Item value={w.path} label={w.label}>{w.label}</Select.Item>
            {/each}
          </Select.Content>
        </Select.Root>
      {/if}
    </div>
  {/if}

  <!-- Prompt / question -->
  <div class="flex flex-col gap-1">
    <span class={text.section}>
      {kind === "gate" ? i18n.t("orchestration.gateQuestion") : i18n.t("orchestration.stepPrompt")}
    </span>
    <Textarea
      bind:value={prompt}
      placeholder={kind === "gate"
        ? i18n.t("orchestration.gateQuestionPlaceholder")
        : i18n.t("orchestration.stepPromptPlaceholder")}
      class="min-h-20 text-[13px]"
    />
    {#if candidates.length > 0}
      <div class="flex flex-wrap items-center gap-1 pt-0.5">
        <span class={cn(text.meta, "mr-1")}>{i18n.t("orchestration.insertRefLabel")}</span>
        {#each candidates as c (c.id)}
          <button
            type="button"
            class="rounded border border-border/70 bg-background px-1.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:border-primary/60 hover:text-foreground"
            onclick={() => insertRef(c.id)}
          >
            {c.title || c.id}
          </button>
        {/each}
      </div>
    {/if}
  </div>

  <!-- Dependencies (runs after) -->
  {#if candidates.length > 0}
    <div class="flex flex-col gap-1">
      <span class={text.section}>{i18n.t("orchestration.stepDependsOn")}</span>
      <div class="flex flex-wrap gap-1">
        {#each candidates as c (c.id)}
          {@const on = dependsOn.includes(c.id)}
          <button
            type="button"
            aria-pressed={on}
            class={cn(
              "rounded-full border px-2 py-0.5 text-[11px] transition-colors",
              on
                ? "border-primary/60 bg-primary/10 text-foreground"
                : "border-border/70 text-muted-foreground hover:text-foreground",
            )}
            onclick={() => toggleDep(c.id)}
          >
            {c.title || c.id}
          </button>
        {/each}
      </div>
      <p class={text.meta}>{i18n.t("orchestration.stepDependsHint")}</p>
    </div>
  {/if}

  <!-- On failure (agent steps only; a gate "fails" only when rejected) -->
  {#if kind !== "gate"}
    <div class="flex items-center justify-between gap-2">
      <span class={text.section}>{i18n.t("orchestration.stepOnFailure")}</span>
      <div class="flex items-center gap-2">
        {#if onFailure === "retry"}
          <Input
            type="number"
            min="2"
            max="9"
            bind:value={maxAttempts}
            class="h-8 w-16 text-[13px]"
            aria-label={i18n.t("orchestration.maxAttempts")}
          />
        {/if}
        <Select.Root type="single" bind:value={onFailure}>
          <Select.Trigger class="h-8 w-44 text-[13px]">
            {onFailure === "retry"
              ? i18n.t("orchestration.onFailureRetry")
              : i18n.t("orchestration.onFailureStop")}
          </Select.Trigger>
          <Select.Content>
            <Select.Item value="stop" label={i18n.t("orchestration.onFailureStop")}>
              {i18n.t("orchestration.onFailureStop")}
            </Select.Item>
            <Select.Item value="retry" label={i18n.t("orchestration.onFailureRetry")}>
              {i18n.t("orchestration.onFailureRetry")}
            </Select.Item>
          </Select.Content>
        </Select.Root>
      </div>
    </div>
  {/if}

  <!-- Actions -->
  <div class="flex items-center justify-end gap-2 pt-1">
    <Button variant="ghost" size="sm" onclick={oncancel}>{i18n.t("orchestration.cancelEdit")}</Button>
    <Button size="sm" disabled={!canSave} onclick={save}>{i18n.t("orchestration.save")}</Button>
  </div>
</div>
