<script lang="ts">
  import * as Dialog from "$lib/components/ui/dialog";
  import Combobox, { type ComboGroup } from "./Combobox.svelte";
  import { Button } from "$lib/components/ui/button";
  import { Spinner } from "$lib/components/ui/spinner";
  import { projects } from "$lib/state/projects.svelte";
  import { app } from "$lib/state/app.svelte";
  import { cn } from "$lib/utils";
  import { text } from "$lib/design";
  import { i18n } from "$lib/i18n";
  import type { RepoData } from "$lib/types";
  import AgentLogo from "./AgentLogo.svelte";
  import WorktreeCreateFields from "./WorktreeCreateFields.svelte";
  import { agentLogoKey } from "$lib/agentCatalog";

  let {
    repo,
    open = $bindable(false),
  }: { repo: RepoData; open?: boolean } = $props();

  // Worktree-creation fields (owned by WorktreeCreateFields; bound here).
  let mode = $state<"new" | "existing">("new");
  let newBranch = $state("");
  let existingBranch = $state("");
  let base = $state("");
  let location = $state("");
  let locationTouched = $state(false);
  let effectiveBranch = $state("");
  let canSubmit = $state(false);
  let loading = $state(false);
  let busy = $state(false);

  // Agent to launch into the new worktree. "" = none; defaults to the global
  // default agent when the dialog opens. Only shown when agents are configured.
  const NONE = "__none__";
  let agentId = $state<string>(NONE);
  const launchable = $derived(app.launchableAgents);
  const agentGroups = $derived<ComboGroup[]>([
    {
      items: [
        { value: NONE, label: i18n.t("newWorktree.agentNone") },
        ...launchable.map((a) => ({ value: a.id, label: a.name.trim() || a.command })),
      ],
    },
  ]);

  // Preselect the global default agent (if launchable) each time the dialog opens.
  $effect(() => {
    if (!open) return;
    const def = app.defaultAgent();
    agentId = def ? def.id : NONE;
  });

  async function submit() {
    if (!canSubmit || busy || loading) return;
    busy = true;
    const ok = await projects.createWorktree(repo.id, effectiveBranch, {
      base: mode === "new" ? base || undefined : undefined,
      fromExisting: mode === "existing",
      path: locationTouched && location.trim() ? location.trim() : undefined,
      agentId: agentId === NONE ? null : agentId,
    });
    busy = false;
    if (ok) open = false;
  }
</script>

{#snippet agentPrefix(item: { value: string })}
  {@const a = launchable.find((x) => x.id === item.value)}
  {#if a}
    <AgentLogo logo={agentLogoKey(a.icon, a.command)} class="size-4 shrink-0" />
  {/if}
{/snippet}

<Dialog.Root bind:open>
  <Dialog.Content class="sm:max-w-[460px]">
    <Dialog.Header>
      <Dialog.Title>{i18n.t("newWorktree.title")}</Dialog.Title>
      <Dialog.Description>
        {i18n.t("newWorktree.desc", { name: repo.name })}
      </Dialog.Description>
    </Dialog.Header>

    <div class="flex flex-col gap-4 py-1">
      <WorktreeCreateFields
        {repo}
        active={open}
        bind:mode
        bind:newBranch
        bind:existingBranch
        bind:base
        bind:location
        bind:locationTouched
        bind:effectiveBranch
        bind:canSubmit
        bind:loading
        onEnter={submit}
      />

      <!-- Agent to launch — same Combobox with logos via the prefix snippet. -->
      {#if launchable.length > 0}
        <div class="flex flex-col gap-1.5">
          <span class={cn("font-medium", text.body)}>{i18n.t("newWorktree.agent")}</span>
          <Combobox
            value={agentId}
            groups={agentGroups}
            triggerClass="w-full"
            searchPlaceholder={i18n.t("common.search")}
            itemPrefix={agentPrefix}
            onChange={(v) => (agentId = v)}
          />
          <p class={text.meta}>{i18n.t("newWorktree.agentDesc")}</p>
        </div>
      {/if}

      {#if projects.error}
        <p class="text-xs text-destructive">{projects.error}</p>
      {/if}
    </div>

    <Dialog.Footer>
      <Button variant="ghost" onclick={() => (open = false)}>{i18n.t("common.cancel")}</Button>
      <Button onclick={submit} disabled={!canSubmit || busy || loading}>
        {#if busy}
          <Spinner data-icon="inline-start" aria-label={i18n.t("common.loading")} />
        {/if}
        {busy ? i18n.t("common.creating") : i18n.t("newWorktree.create")}
      </Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
