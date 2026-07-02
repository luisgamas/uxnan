<script lang="ts">
  import * as Dialog from "$lib/components/ui/dialog";
  import Combobox, { type ComboGroup } from "./Combobox.svelte";
  import { Button } from "$lib/components/ui/button";
  import { Input } from "$lib/components/ui/input";
  import { projects } from "$lib/state/projects.svelte";
  import { app } from "$lib/state/app.svelte";
  import { cn } from "$lib/utils";
  import { icon, text } from "$lib/design";
  import { i18n } from "$lib/i18n";
  import type { RepoData } from "$lib/types";
  import AgentLogo from "./AgentLogo.svelte";
  import { agentLogoKey } from "$lib/agentCatalog";
  import GitBranchIcon from "@lucide/svelte/icons/git-branch";
  import FolderIcon from "@lucide/svelte/icons/folder";

  let {
    repo,
    open = $bindable(false),
  }: { repo: RepoData; open?: boolean } = $props();

  let branch = $state("");
  let base = $state("");
  let branches = $state<string[]>([]);
  let loading = $state(false);
  let busy = $state(false);

  // Agent to launch into the new worktree. "" = none; defaults to the global
  // default agent when the dialog opens. Only shown when agents are configured.
  const NONE = "__none__";
  let agentId = $state<string>(NONE);
  const launchable = $derived(app.launchableAgents);
  // Agent options for the Combobox: a "none" row, then each launchable agent
  // (logos rendered via the `agentPrefix` snippet, matched back by value).
  const agentGroups = $derived<ComboGroup[]>([
    {
      items: [
        { value: NONE, label: i18n.t("newWorktree.agentNone") },
        ...launchable.map((a) => ({ value: a.id, label: a.name.trim() || a.command })),
      ],
    },
  ]);

  // The sibling folder the backend will create: `<repo>--<safe-branch>`
  // (mirrors `git::worktree_path_for`). Shown so the user knows where it lands.
  const sep = $derived(repo.path.includes("\\") ? "\\" : "/");
  const parent = $derived(
    repo.path.replace(/[\\/]+$/, "").split(/[\\/]/).slice(0, -1).join(sep),
  );
  const repoName = $derived(
    repo.path.replace(/[\\/]+$/, "").split(/[\\/]/).pop() ?? repo.name,
  );
  const previewPath = $derived(
    branch.trim()
      ? `${parent}${sep}${repoName}--${branch.trim().replace(/[\\/]/g, "-")}`
      : "",
  );

  // The resolved default base may be a remote ref (e.g. `origin/main`) or `HEAD`,
  // which won't be in the local-branch list — surface it as the first option.
  const baseOptions = $derived(
    base && !branches.includes(base) ? [base, ...branches] : branches,
  );
  const baseGroups = $derived<ComboGroup[]>([
    { items: baseOptions.map((b) => ({ value: b, label: b })) },
  ]);

  // Load branches + default base each time the dialog opens.
  $effect(() => {
    if (!open) return;
    loading = true;
    branch = "";
    // Preselect the global default agent (if it's launchable), else none.
    const def = app.defaultAgent();
    agentId = def ? def.id : NONE;
    projects.error = null;
    projects
      .branchInfo(repo.id)
      .then((info) => {
        branches = info.branches;
        base = info.defaultBase;
      })
      .catch((e) => {
        projects.error = e instanceof Error ? e.message : String(e);
      })
      .finally(() => (loading = false));
  });

  async function submit() {
    if (!branch.trim() || busy) return;
    busy = true;
    const ok = await projects.createWorktree(
      repo.id,
      branch.trim(),
      base || undefined,
      agentId === NONE ? null : agentId,
    );
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
      <!-- Branch name — the focal field, with a leading branch glyph. -->
      <div class="flex flex-col gap-1.5">
        <label for="wt-branch" class={cn("font-medium", text.body)}>{i18n.t("newWorktree.branch")}</label>
        <div class="relative">
          <GitBranchIcon
            class="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground/80"
          />
          <Input
            id="wt-branch"
            class="pl-8"
            placeholder={i18n.t("newWorktree.branchPlaceholder")}
            bind:value={branch}
            autocomplete="off"
            onkeydown={(e) => e.key === "Enter" && submit()}
          />
        </div>
      </div>

      <!-- Base ref — searchable Combobox (shared with the rest of the app). -->
      <div class="flex flex-col gap-1.5">
        <span class={cn("font-medium", text.body)}>{i18n.t("newWorktree.base")}</span>
        <Combobox
          value={base}
          groups={baseGroups}
          triggerClass="w-full"
          placeholder={i18n.t("newWorktree.selectBase")}
          searchPlaceholder={i18n.t("common.search")}
          disabled={loading}
          onChange={(v) => (base = v)}
        />
        <p class={text.meta}>{i18n.t("newWorktree.baseDesc")}</p>
      </div>

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

      <!-- Where it lands — a quiet preview of the sibling folder to be created. -->
      {#if previewPath}
        <div class="flex items-start gap-2 rounded-lg border border-border/50 bg-muted/40 px-3 py-2.5">
          <FolderIcon class={cn(icon.decorative, "mt-px shrink-0 text-muted-foreground")} />
          <code class="break-all text-[11px] leading-5 text-muted-foreground">{previewPath}</code>
        </div>
      {/if}

      {#if projects.error}
        <p class="text-xs text-destructive">{projects.error}</p>
      {/if}
    </div>

    <Dialog.Footer>
      <Button variant="ghost" onclick={() => (open = false)}>{i18n.t("common.cancel")}</Button>
      <Button onclick={submit} disabled={!branch.trim() || busy || loading}>
        {busy ? i18n.t("common.creating") : i18n.t("newWorktree.create")}
      </Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
