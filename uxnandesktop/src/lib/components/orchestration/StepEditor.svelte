<script lang="ts">
  // Inline editor for one run step (add or edit). A step is one of:
  //  · Headless — runs an installed CLI in print-mode in a chosen worktree; the ADE
  //    owns the process, so output is the full stdout and completion is verified by
  //    the exit code (the default: robust chaining).
  //  · Interactive — types the prompt into a live agent's PTY; output is the agent's
  //    hook summary or its MCP report.
  //  · Human gate — pauses the run for an Approve/Reject decision.
  // The prompt can plant a prior step's captured output; the contextual picker
  // (StepContextPicker) shows which steps exist, what each field holds, and inserts
  // the `{{steps.s1.output}}` token at the cursor (auto-adding the dependency).
  // Advanced knobs (failure policy) live behind a collapsible so the common path
  // stays uncluttered.
  import { untrack, tick } from "svelte";
  import { Input } from "$lib/components/ui/input";
  import { Textarea } from "$lib/components/ui/textarea";
  import { Button } from "$lib/components/ui/button";
  import * as Select from "$lib/components/ui/select";
  import * as Collapsible from "$lib/components/ui/collapsible";
  import { cn } from "$lib/utils";
  import { icon, text } from "$lib/design";
  import { i18n } from "$lib/i18n";
  import { app } from "$lib/state/app.svelte";
  import { projects } from "$lib/state/projects.svelte";
  import { orchestrationRun } from "$lib/state/orchestrationRun.svelte";
  import { aiCommitAgents, aiCommitModels } from "$lib/api";
  import { TooltipSimple } from "$lib/components/ui/tooltip";
  import type { AgentModel } from "$lib/types";
  import { referencedStepIds, type Run, type RunStep, type StepKind, type StepTarget } from "$lib/orchestration/run";
  import AgentLogo from "../AgentLogo.svelte";
  import Combobox from "../Combobox.svelte";
  import AiModelPicker from "../AiModelPicker.svelte";
  import StepContextPicker from "./StepContextPicker.svelte";
  import TerminalIcon from "@lucide/svelte/icons/square-terminal";
  import MessageIcon from "@lucide/svelte/icons/message-square";
  import HandIcon from "@lucide/svelte/icons/hand";
  import ChevronDownIcon from "@lucide/svelte/icons/chevron-down";

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

  // Local, uncommitted edit state (seeded once from the step being edited). A new
  // step defaults to **headless** — the robust way to chain (full stdout + verified
  // completion).
  let kind = $state<string>(untrack(() => step?.kind ?? "headless"));
  let title = $state(untrack(() => step?.title ?? ""));
  let prompt = $state(untrack(() => step?.prompt ?? (step?.gate?.question ?? "")));
  let promptEl = $state<HTMLTextAreaElement | null>(null);
  let onFailure = $state<string>(untrack(() => step?.onFailure ?? "stop"));
  // String-backed so it binds cleanly to the numeric `<Input>`; parsed on save.
  let maxAttempts = $state(untrack(() => String(step?.maxAttempts ?? 2)));
  // Interactive target.
  let tabId = $state(untrack(() => step?.target.tabId ?? ""));
  // Headless target.
  let hAgent = $state(untrack(() => step?.target.agent ?? ""));
  let hModel = $state(untrack(() => step?.target.model ?? ""));
  let hWorkspace = $state(untrack(() => step?.target.workspace ?? ""));
  // Dependencies default to the most recent existing step (a sequence by default);
  // the user can toggle to run in parallel or fan in from several.
  let dependsOn = $state<string[]>(untrack(() => step?.dependsOn ?? defaultDeps()));
  // Advanced options open when the step already customizes them.
  let advancedOpen = $state(untrack(() => step?.onFailure === "retry"));

  // Installed CLIs + their models for the headless picker (lazy-loaded).
  let installedAgents = $state<string[]>([]);
  let headlessModels = $state<AgentModel[]>([]);
  // True while an agent's models are being fetched (OpenCode/Pi/Codex query the CLI
  // live, which takes a moment) — surfaced in the model picker.
  let modelsLoading = $state(false);

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
    modelsLoading = true;
    headlessModels = []; // clear the previous agent's list while we fetch
    try {
      const models = await aiCommitModels(a);
      headlessModels = models;
      // Drop a stale model the newly-picked agent doesn't offer (async read is
      // outside the effect's tracking, so this doesn't loop).
      if (hModel && !models.some((m) => m.id === hModel)) hModel = "";
    } catch {
      headlessModels = [];
    } finally {
      modelsLoading = false;
    }
  }

  function wsLabel(path: string): string {
    const c = projects.contextLabel(path);
    return c.repo ? `${c.repo} · ${c.name}` : c.name;
  }

  // Combobox option groups for the target pickers (searchable, tokenized, reusing
  // the shared Combobox / AiModelPicker instead of a bare Select).
  const interactiveAgentGroups = $derived([
    {
      items: liveAgents.map((a) => ({
        value: a.tabId,
        label: a.name,
        meta: projects.contextLabel(a.workspace).name,
        keywords: [a.type],
      })),
    },
  ]);
  // tabId → logo, for the interactive picker's row/trigger prefix.
  const interactiveIcons = $derived(new Map(liveAgents.map((a) => [a.tabId, a.icon ?? null])));

  const headlessAgentGroups = $derived([
    { items: installedAgents.map((id) => ({ value: id, label: app.resolveAgent(id).name })) },
  ]);

  // Headless: workspace options (registered worktrees ∪ live agents' worktrees).
  const workspaceOptions = $derived.by(() => {
    const map = new Map<string, string>();
    for (const w of projects.allWorktrees()) map.set(w.path, wsLabel(w.path));
    for (const a of liveAgents) if (a.workspace) map.set(a.workspace, wsLabel(a.workspace));
    return [...map.entries()].map(([path, label]) => ({ path, label }));
  });
  const workspaceGroups = $derived([
    { items: workspaceOptions.map((w) => ({ value: w.path, label: w.label, keywords: [w.path] })) },
  ]);

  // Step-type cards (the primary choice, headless first).
  const KINDS = [
    { value: "headless", icon: TerminalIcon, label: "orchestration.kindHeadless", hint: "orchestration.kindHeadlessHint" },
    { value: "interactive", icon: MessageIcon, label: "orchestration.kindInteractive", hint: "orchestration.kindInteractiveHint" },
    { value: "gate", icon: HandIcon, label: "orchestration.kindGate", hint: "orchestration.kindGateHint" },
  ] as const;

  function toggleDep(id: string) {
    dependsOn = dependsOn.includes(id) ? dependsOn.filter((d) => d !== id) : [...dependsOn, id];
  }

  /** Insert a `{{steps.<id>.<field>}}` token at the prompt cursor and add the
   *  dependency (so the step never runs before what it quotes). */
  async function insertToken(stepId: string, field: "output" | "summary" | "title") {
    const token = `{{steps.${stepId}.${field}}}`;
    const el = promptEl;
    const start = el?.selectionStart ?? prompt.length;
    const end = el?.selectionEnd ?? prompt.length;
    prompt = prompt.slice(0, start) + token + prompt.slice(end);
    if (!dependsOn.includes(stepId)) dependsOn = [...dependsOn, stepId];
    await tick();
    if (el) {
      el.focus();
      const pos = start + token.length;
      el.setSelectionRange(pos, pos);
    }
  }

  const canSave = $derived(
    prompt.trim().length > 0 &&
      (kind === "gate" || (kind === "interactive" ? !!tabId : !!hAgent && !!hWorkspace)),
  );

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
  <!-- Step type — the primary choice, as cards -->
  <div class="flex flex-col gap-1">
    <span class={text.section}>{i18n.t("orchestration.stepKind")}</span>
    <div class="grid grid-cols-3 gap-1.5">
      {#each KINDS as k (k.value)}
        {@const Icon = k.icon}
        {@const on = kind === k.value}
        <TooltipSimple title={i18n.t(k.hint)}>
          {#snippet children(tp)}
            <button
              {...tp}
              type="button"
              aria-pressed={on}
              class={cn(
                "flex items-center gap-1.5 rounded-md border px-2 py-1.5 text-left transition-colors",
                on
                  ? "border-primary/60 bg-primary/5"
                  : "border-border/60 hover:border-border hover:bg-accent/40",
              )}
              onclick={() => (kind = k.value)}
            >
              <Icon class={cn("size-3.5 shrink-0", on ? "text-primary" : "text-muted-foreground")} />
              <span class={cn("truncate", text.body, on && "font-medium")}>{i18n.t(k.label)}</span>
            </button>
          {/snippet}
        </TooltipSimple>
      {/each}
    </div>
    <p class={text.meta}>
      {kind === "headless"
        ? i18n.t("orchestration.kindHeadlessHint")
        : kind === "gate"
          ? i18n.t("orchestration.kindGateHint")
          : i18n.t("orchestration.kindInteractiveHint")}
    </p>
  </div>

  <!-- Title -->
  <div class="flex flex-col gap-1">
    <span class={text.section}>{i18n.t("orchestration.stepTitle")}</span>
    <Input
      bind:value={title}
      placeholder={i18n.t("orchestration.stepTitlePlaceholder")}
      class="h-8 text-[13px]"
    />
  </div>

  <!-- Target -->
  {#if kind === "gate"}
    <!-- A gate has no agent target — it pauses for a human decision. -->
  {:else if kind === "interactive"}
    <div class="flex flex-col gap-1">
      <span class={text.section}>{i18n.t("orchestration.stepAgent")}</span>
      {#if liveAgents.length === 0}
        <p class={text.meta}>{i18n.t("orchestration.noAgentsHint")}</p>
      {:else}
        <Combobox
          value={tabId}
          groups={interactiveAgentGroups}
          placeholder={i18n.t("orchestration.stepAgentPlaceholder")}
          searchPlaceholder={i18n.t("orchestration.stepAgentPlaceholder")}
          onChange={(v) => (tabId = v)}
          triggerClass="h-8 text-[13px]"
        >
          {#snippet itemPrefix(item)}
            <AgentLogo logo={interactiveIcons.get(item.value) ?? null} class="size-4 shrink-0" />
          {/snippet}
        </Combobox>
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
          <Combobox
            value={hAgent}
            groups={headlessAgentGroups}
            placeholder={i18n.t("orchestration.stepAgentPlaceholder")}
            searchPlaceholder={i18n.t("orchestration.stepAgentPlaceholder")}
            onChange={(v) => (hAgent = v)}
            triggerClass="h-8 text-[13px]"
          >
            {#snippet itemPrefix(item)}
              <AgentLogo logo={app.resolveAgent(item.value).icon} class="size-4 shrink-0" />
            {/snippet}
          </Combobox>
        {/if}
      </div>
      <div class="flex flex-col gap-1">
        <span class={text.section}>{i18n.t("orchestration.stepModel")}</span>
        <AiModelPicker
          models={headlessModels}
          value={hModel}
          loading={modelsLoading}
          onSelect={(id) => (hModel = id)}
          triggerClass="h-8 w-full text-[13px]"
        />
      </div>
      <div class="col-span-2 flex flex-col gap-1">
        <span class={text.section}>{i18n.t("orchestration.stepWorkspace")}</span>
        {#if workspaceOptions.length === 0}
          <p class={text.meta}>{i18n.t("orchestration.noWorkspaces")}</p>
        {:else}
          <Combobox
            value={hWorkspace}
            groups={workspaceGroups}
            placeholder={i18n.t("orchestration.workspacePlaceholder")}
            searchPlaceholder={i18n.t("orchestration.workspacePlaceholder")}
            onChange={(v) => (hWorkspace = v)}
            triggerClass="h-8 text-[13px]"
          />
        {/if}
      </div>
    </div>
  {/if}

  <!-- Prompt / question -->
  <div class="flex flex-col gap-1">
    <span class={text.section}>
      {kind === "gate" ? i18n.t("orchestration.gateQuestion") : i18n.t("orchestration.stepPrompt")}
    </span>
    <Textarea
      bind:value={prompt}
      bind:ref={promptEl}
      placeholder={kind === "gate"
        ? i18n.t("orchestration.gateQuestionPlaceholder")
        : i18n.t("orchestration.stepPromptPlaceholder")}
      class="min-h-20 text-[13px]"
    />
  </div>

  <!-- Contextual variable picker (only when prior steps exist and this can chain) -->
  {#if candidates.length > 0 && kind !== "gate"}
    <StepContextPicker {candidates} oninsert={insertToken} />
  {/if}

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

  <!-- Advanced options (agent steps only; a gate "fails" only when rejected) -->
  {#if kind !== "gate"}
    <Collapsible.Root bind:open={advancedOpen}>
      <Collapsible.Trigger
        class={cn("flex items-center gap-1 text-left", text.meta, "hover:text-foreground")}
      >
        <ChevronDownIcon class={cn("size-3 transition-transform", !advancedOpen && "-rotate-90")} />
        {i18n.t("orchestration.advancedOptions")}
      </Collapsible.Trigger>
      <Collapsible.Content>
        <div class="flex items-center justify-between gap-2 pt-2">
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
              <Select.Content class="max-h-72">
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
      </Collapsible.Content>
    </Collapsible.Root>
  {/if}

  <!-- Actions -->
  <div class="flex items-center justify-end gap-2 pt-1">
    <Button variant="ghost" size="sm" onclick={oncancel}>{i18n.t("orchestration.cancelEdit")}</Button>
    <Button size="sm" disabled={!canSave} onclick={save}>{i18n.t("orchestration.save")}</Button>
  </div>
</div>
