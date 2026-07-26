<script lang="ts">
  // The example library. These are the same four automations uxnan seeds on a
  // first visit (`$lib/automations/examples`), so this section is really a way
  // to put one back after deleting it, or to read what each one does before
  // committing to it.
  //
  // Every one is multi-agent — a single agent on a timer is what this feature is
  // not — and re-adding keeps the example's stable id, so it restores rather
  // than piling up copies.
  import { i18n } from "$lib/i18n";
  import { cn } from "$lib/utils";
  import { panel, text } from "$lib/design";
  import { app } from "$lib/state/app.svelte";
  import { projects } from "$lib/state/projects.svelte";
  import { aiCommitAgents } from "$lib/api";
  import { EXAMPLES, buildExample, type ExampleSpec } from "$lib/automations/examples";
  import { automations } from "$lib/state/automations.svelte";
  import AgentLogo from "$lib/components/AgentLogo.svelte";
  import { Button } from "$lib/components/ui/button";
  import SparklesIcon from "@lucide/svelte/icons/sparkles";
  import CheckIcon from "@lucide/svelte/icons/check";

  let installed = $state<string[]>([]);
  $effect(() => {
    if (installed.length > 0) return;
    void aiCommitAgents()
      .then((a) => (installed = a))
      .catch(() => {});
  });

  const workingDir = $derived(projects.allWorktrees()[0]?.path ?? "");

  /** Already in the list — the button then reads as "restore", not "add". */
  function isPresent(id: string): boolean {
    return automations.items.some((a) => a.id === id);
  }

  async function use(spec: ExampleSpec) {
    const built = buildExample(spec, {
      installedAgents: installed,
      workingDir,
      t: (key) => i18n.t(key),
      now: Date.now(),
    });
    // Paused, like every example — and saving under the stable id restores the
    // original rather than adding a near-duplicate.
    if (await automations.save(built)) {
      app.automationsSelectedId = built.id;
      app.automationsSection = "list";
    }
  }

  /** The distinct agents a built example would use, for the row's logo stack. */
  function agentsFor(spec: ExampleSpec): string[] {
    const built = buildExample(spec, {
      installedAgents: installed,
      workingDir,
      t: (key) => i18n.t(key),
      now: 0,
    });
    return [...new Set(built.steps.map((s) => s.agent).filter(Boolean))];
  }
</script>

<div class="flex flex-col gap-3">
  <p class={text.meta}>{i18n.t("automations.templatesDesc")}</p>

  {#each EXAMPLES as spec (spec.id)}
    {@const present = isPresent(spec.id)}
    <div class={cn("flex items-start gap-3 p-3.5", panel.card)}>
      <SparklesIcon class="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <div class="flex min-w-0 flex-1 flex-col gap-1">
        <span class={text.bodyStrong}>{i18n.t(spec.nameKey)}</span>
        <span class={text.meta}>{i18n.t(spec.descKey)}</span>
        <div class="flex items-center gap-2 pt-0.5">
          <span class="flex -space-x-1.5">
            {#each agentsFor(spec) as agentId (agentId)}
              <AgentLogo
                logo={app.resolveAgent(agentId).icon}
                class="size-4 rounded-full bg-background ring-1 ring-border/60"
              />
            {/each}
          </span>
          <span class={text.indicator}>
            {spec.steps.length === 1
              ? i18n.t("automations.oneStep")
              : i18n.t("automations.nSteps", { n: spec.steps.length })}
          </span>
        </div>
      </div>
      <Button variant="outline" size="sm" onclick={() => use(spec)}>
        {#if present}
          <CheckIcon data-icon="inline-start" />
          {i18n.t("automations.restoreTemplate")}
        {:else}
          {i18n.t("automations.useTemplate")}
        {/if}
      </Button>
    </div>
  {/each}
</div>
