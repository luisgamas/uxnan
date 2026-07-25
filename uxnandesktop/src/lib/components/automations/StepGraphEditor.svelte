<script lang="ts">
  // The graph editor — where an automation stops being "one agent, one prompt"
  // and becomes several providers working together.
  //
  // Dependencies are the whole model: steps with no dependencies run at the same
  // time, and a step that lists several waits for all of them. Referencing
  // `{{steps.sN.output}}` in a prompt therefore also declares intent, so the
  // editor offers to add the dependency it implies rather than letting a chain
  // silently run out of order.
  import { i18n } from "$lib/i18n";
  import { cn } from "$lib/utils";
  import { icon, iconButton, panel, text } from "$lib/design";
  import { nextStepId, newStep, type Step } from "$lib/automations/types";
  import Combobox, { type ComboGroup } from "$lib/components/Combobox.svelte";
  import AgentLogo from "$lib/components/AgentLogo.svelte";
  import { app } from "$lib/state/app.svelte";
  import { Button } from "$lib/components/ui/button";
  import { Input } from "$lib/components/ui/input";
  import { Textarea } from "$lib/components/ui/textarea";
  import { Switch } from "$lib/components/ui/switch";
  import { TooltipSimple } from "$lib/components/ui/tooltip";
  import PlusIcon from "@lucide/svelte/icons/plus";
  import Trash2Icon from "@lucide/svelte/icons/trash-2";
  import ArrowDownToLineIcon from "@lucide/svelte/icons/arrow-down-to-line";

  let {
    steps = $bindable(),
    installedAgents,
  }: { steps: Step[]; installedAgents: string[] } = $props();

  // Show each agent under its display name, not its bare command.
  const agentGroups = $derived<ComboGroup[]>([
    {
      items: installedAgents.map((a) => ({
        value: a,
        label: app.resolveAgent(a).name,
        keywords: [a],
      })),
    },
  ]);

  function addStep() {
    steps = [...steps, newStep(nextStepId(steps), installedAgents[0] ?? "")];
  }

  function removeStep(id: string) {
    // Drop the step and every dangling edge pointing at it, or the graph would
    // wait forever on something that no longer exists.
    steps = steps
      .filter((s) => s.id !== id)
      .map((s) => ({ ...s, dependsOn: s.dependsOn.filter((d) => d !== id) }));
  }

  function toggleDep(step: Step, depId: string) {
    const has = step.dependsOn.includes(depId);
    const dependsOn = has
      ? step.dependsOn.filter((d) => d !== depId)
      : [...step.dependsOn, depId];
    steps = steps.map((s) => (s.id === step.id ? { ...s, dependsOn } : s));
  }

  /** Insert a reference to another step's output at the end of a prompt. */
  function insertRef(step: Step, depId: string) {
    const token = `{{steps.${depId}.output}}`;
    const prompt = step.prompt ? `${step.prompt}\n\n${token}` : token;
    const dependsOn = step.dependsOn.includes(depId)
      ? step.dependsOn
      : [...step.dependsOn, depId];
    steps = steps.map((s) => (s.id === step.id ? { ...s, prompt, dependsOn } : s));
  }

  /** Steps a given step may depend on: everything declared before it, so the
   *  picker itself cannot be used to build a cycle. */
  function candidates(index: number): Step[] {
    return steps.slice(0, index);
  }

  /** Steps referenced in a prompt but not declared as dependencies — the exact
   *  mistake that makes a hand-off arrive empty. */
  function unlinkedRefs(step: Step): string[] {
    const out: string[] = [];
    for (const m of step.prompt.matchAll(/\{\{\s*steps\.([A-Za-z0-9_-]+)\.\w+\s*\}\}/g)) {
      const id = m[1];
      if (!step.dependsOn.includes(id) && steps.some((s) => s.id === id) && !out.includes(id)) {
        out.push(id);
      }
    }
    return out;
  }
</script>

<div class="flex flex-col gap-3">
  {#each steps as step, i (step.id)}
    {@const deps = candidates(i)}
    {@const unlinked = unlinkedRefs(step)}
    <div class={cn("flex flex-col gap-2.5 p-3", panel.card)}>
      <div class="flex items-center gap-2">
        <span
          class={cn(
            "shrink-0 rounded bg-muted px-1.5 py-0.5 font-mono text-muted-foreground",
            text.indicator,
          )}
        >
          {step.id}
        </span>
        <Input
          class="h-8 flex-1"
          placeholder={i18n.t("automations.stepTitlePlaceholder")}
          value={step.title}
          oninput={(e) =>
            (steps = steps.map((s) =>
              s.id === step.id
                ? { ...s, title: (e.currentTarget as HTMLInputElement).value }
                : s,
            ))}
        />
        <Combobox
          value={step.agent}
          groups={agentGroups}
          triggerClass="w-40"
          placeholder={i18n.t("automations.pickAgent")}
          searchPlaceholder={i18n.t("common.search")}
          onChange={(v) =>
            (steps = steps.map((s) => (s.id === step.id ? { ...s, agent: v } : s)))}
          itemPrefix={agentPrefix}
        />
        <TooltipSimple title={i18n.t("automations.removeStep")}>
          {#snippet children(tp)}
            <Button
              {...tp}
              variant="ghost"
              size="icon-sm"
              class={iconButton.action}
              aria-label={i18n.t("automations.removeStep")}
              onclick={() => removeStep(step.id)}
            >
              <Trash2Icon class={icon.action} />
            </Button>
          {/snippet}
        </TooltipSimple>
      </div>

      <Textarea
        rows={3}
        placeholder={i18n.t("automations.promptPlaceholder")}
        value={step.prompt}
        oninput={(e) =>
          (steps = steps.map((s) =>
            s.id === step.id
              ? { ...s, prompt: (e.currentTarget as HTMLTextAreaElement).value }
              : s,
          ))}
      />

      {#if deps.length > 0}
        <div class="flex flex-wrap items-center gap-1.5">
          <span class={text.section}>{i18n.t("automations.runsAfter")}</span>
          {#each deps as dep (dep.id)}
            <button
              type="button"
              class={cn(
                "rounded-full border px-2 py-0.5 transition-colors",
                text.indicator,
                step.dependsOn.includes(dep.id)
                  ? "border-primary/40 bg-primary/10 text-foreground"
                  : "border-border/60 bg-muted/40 text-muted-foreground hover:text-foreground",
              )}
              onclick={() => toggleDep(step, dep.id)}
            >
              {dep.id}
            </button>
          {/each}
          <span class="flex-1"></span>
          {#each deps as dep (dep.id)}
            <TooltipSimple title={i18n.t("automations.insertOutput", { id: dep.id })}>
              {#snippet children(tp)}
                <Button
                  {...tp}
                  variant="ghost"
                  size="icon-sm"
                  class={iconButton.xs}
                  aria-label={i18n.t("automations.insertOutput", { id: dep.id })}
                  onclick={() => insertRef(step, dep.id)}
                >
                  <ArrowDownToLineIcon class="size-3" />
                </Button>
              {/snippet}
            </TooltipSimple>
          {/each}
        </div>
      {/if}

      <!-- Autonomy is per step and off by default. A headless agent cannot ask
           a human, so without this several CLIs auto-deny their tools and the
           step comes back empty; with it, the agent edits files and runs
           commands unattended. Both facts belong next to the switch. -->
      <div class="flex items-start gap-2.5">
        <Switch
          checked={step.autonomous}
          onCheckedChange={(c) =>
            (steps = steps.map((s) => (s.id === step.id ? { ...s, autonomous: c } : s)))}
        />
        <div class="flex min-w-0 flex-col">
          <span class={text.body}>{i18n.t("automations.autonomous")}</span>
          <span class={text.meta}>
            {step.autonomous
              ? i18n.t("automations.autonomousOnDesc")
              : i18n.t("automations.autonomousOffDesc")}
          </span>
        </div>
      </div>

      {#if unlinked.length > 0}
        <!-- A reference without the matching dependency is the classic way to
             get an empty hand-off: the step runs before the one it quotes. -->
        <div class={cn("flex flex-wrap items-center gap-2", text.meta)}>
          <span class="text-amber-600 dark:text-amber-400">
            {i18n.t("automations.unlinkedRefs", { ids: unlinked.join(", ") })}
          </span>
          <Button
            variant="outline"
            size="sm"
            class="h-6"
            onclick={() =>
              (steps = steps.map((s) =>
                s.id === step.id
                  ? { ...s, dependsOn: [...new Set([...s.dependsOn, ...unlinked])] }
                  : s,
              ))}
          >
            {i18n.t("automations.linkThem")}
          </Button>
        </div>
      {/if}
    </div>
  {/each}

  <div>
    <Button variant="outline" size="sm" onclick={addStep}>
      <PlusIcon data-icon="inline-start" />
      {i18n.t("automations.addStep")}
    </Button>
  </div>
</div>

{#snippet agentPrefix(item: { value: string })}
  <AgentLogo logo={app.resolveAgent(item.value).icon} class="size-4 shrink-0" />
{/snippet}
