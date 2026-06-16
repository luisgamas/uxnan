<script lang="ts">
  import * as Dialog from "$lib/components/ui/dialog";
  import * as Select from "$lib/components/ui/select";
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
  const selectedAgent = $derived(launchable.find((a) => a.id === agentId));
  const agentLabel = $derived(selectedAgent?.name.trim() || i18n.t("newWorktree.agentNone"));

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
  const baseLabel = $derived(base || i18n.t("newWorktree.selectBase"));

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

<Dialog.Root bind:open>
  <Dialog.Content class="sm:max-w-[460px]">
    <Dialog.Header>
      <Dialog.Title>{i18n.t("newWorktree.title")}</Dialog.Title>
      <Dialog.Description>
        {i18n.t("newWorktree.desc", { name: repo.name })}
      </Dialog.Description>
    </Dialog.Header>

    <div class="flex flex-col gap-4 py-2">
      <div class="flex flex-col gap-1.5">
        <label for="wt-branch" class={cn("font-medium", text.body)}>{i18n.t("newWorktree.branch")}</label>
        <Input
          id="wt-branch"
          placeholder={i18n.t("newWorktree.branchPlaceholder")}
          bind:value={branch}
          autocomplete="off"
          onkeydown={(e) => e.key === "Enter" && submit()}
        />
      </div>

      <div class="flex flex-col gap-1.5">
        <span class={cn("font-medium", text.body)}>{i18n.t("newWorktree.base")}</span>
        <Select.Root type="single" bind:value={base} disabled={loading}>
          <Select.Trigger class="w-full">{baseLabel}</Select.Trigger>
          <Select.Content>
            {#each baseOptions as b (b)}
              <Select.Item value={b} label={b}>{b}</Select.Item>
            {/each}
          </Select.Content>
        </Select.Root>
        <p class={text.meta}>{i18n.t("newWorktree.baseDesc")}</p>
      </div>

      {#if launchable.length > 0}
        <div class="flex flex-col gap-1.5">
          <span class={cn("font-medium", text.body)}>{i18n.t("newWorktree.agent")}</span>
          <Select.Root type="single" bind:value={agentId}>
            <Select.Trigger class="w-full">
              <span class="flex items-center gap-2">
                {#if selectedAgent}
                  <AgentLogo
                    logo={agentLogoKey(selectedAgent.icon, selectedAgent.command)}
                    class="size-4"
                  />
                {/if}
                {agentLabel}
              </span>
            </Select.Trigger>
            <Select.Content>
              <Select.Item value={NONE} label={i18n.t("newWorktree.agentNone")}>
                {i18n.t("newWorktree.agentNone")}
              </Select.Item>
              {#each launchable as a (a.id)}
                {@const name = a.name.trim() || a.command}
                <Select.Item value={a.id} label={name}>
                  <span class="flex items-center gap-2">
                    <AgentLogo logo={agentLogoKey(a.icon, a.command)} class="size-4" />
                    {name}
                  </span>
                </Select.Item>
              {/each}
            </Select.Content>
          </Select.Root>
          <p class={text.meta}>{i18n.t("newWorktree.agentDesc")}</p>
        </div>
      {/if}

      {#if previewPath}
        <div class="flex items-start gap-2 rounded-md bg-muted/50 px-3 py-2">
          <GitBranchIcon class={cn(icon.decorative, "mt-0.5 shrink-0 text-muted-foreground")} />
          <code class="break-all text-[11px] text-muted-foreground">{previewPath}</code>
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
