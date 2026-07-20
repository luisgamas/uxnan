<script lang="ts">
  // The project's "+" window — one place to start anything in the project,
  // without the old floating menu that repeated every option per worktree (and
  // overflowed the screen once a project had a few branches). The flow reads as
  // a sentence: pick WHERE (an existing worktree, or a brand-new one) and WHAT
  // to open there (a terminal / profile, one or several agents, the browser).
  // Everything runs against the chosen target so the workspace linkage
  // (terminals ↔ agents ↔ worktree) is preserved.
  import * as Dialog from "$lib/components/ui/dialog";
  import { Button } from "$lib/components/ui/button";
  import { Spinner } from "$lib/components/ui/spinner";
  import { Input } from "$lib/components/ui/input";
  import Combobox, { type ComboGroup, type ComboItem } from "./Combobox.svelte";
  import MultiSelect from "./MultiSelect.svelte";
  import AgentLogo from "./AgentLogo.svelte";
  import { app } from "$lib/state/app.svelte";
  import { projects } from "$lib/state/projects.svelte";
  import { agentLogoKey } from "$lib/agentCatalog";
  import { cn } from "$lib/utils";
  import { icon, text } from "$lib/design";
  import { i18n } from "$lib/i18n";
  import type { RepoData } from "$lib/types";
  import TerminalIcon from "@lucide/svelte/icons/terminal";
  import GlobeIcon from "@lucide/svelte/icons/globe";
  import GitBranchIcon from "@lucide/svelte/icons/git-branch";
  import GitBranchPlusIcon from "@lucide/svelte/icons/git-branch-plus";
  import SettingsIcon from "@lucide/svelte/icons/settings";

  let { repo, open = $bindable(false) }: { repo: RepoData; open?: boolean } = $props();

  const NEW = "__new__";

  const isGit = $derived(repo.isGit !== false);
  const profiles = $derived(app.terminalProfiles);
  const launchable = $derived(app.launchableAgents);
  const browserEnabled = $derived(app.settings.browser?.enabled ?? true);

  // --- Target (where to run) ------------------------------------------------
  // The project's worktrees, primary first; a non-git folder is its own single
  // target (no worktrees to choose from).
  const worktrees = $derived.by(() => {
    const list = projects.worktreesOf(repo.id);
    if (list.length === 0)
      return [{ path: repo.path, branch: null as string | null, isMain: true }];
    return [...list].sort((a, b) => (b.isMain ? 1 : 0) - (a.isMain ? 1 : 0));
  });

  let target = $state<string>("");
  const isNew = $derived(target === NEW);

  function folderName(path: string): string {
    return path.replace(/[\\/]+$/, "").split(/[\\/]/).pop() ?? repo.name;
  }
  function worktreeLabel(w: { path: string; branch: string | null }): string {
    return w.branch ?? folderName(w.path);
  }

  const targetGroups = $derived.by<ComboGroup[]>(() => {
    const wtItems: ComboItem[] = worktrees.map((w) => ({
      value: w.path,
      label: worktreeLabel(w),
      keywords: [folderName(w.path), w.isMain ? "main" : ""],
      meta:
        w.path === projects.activeWorktreePath
          ? i18n.t("launcher.activeBadge")
          : w.isMain
            ? i18n.t("launcher.mainBadge")
            : undefined,
    }));
    const groups: ComboGroup[] = [{ heading: i18n.t("launcher.sectionWorktree"), items: wtItems }];
    if (isGit) {
      groups.push({ items: [{ value: NEW, label: i18n.t("launcher.newWorktreeOption") }] });
    }
    return groups;
  });

  // --- New-worktree fields (only when target = NEW) -------------------------
  let branch = $state("");
  let base = $state("");
  let branches = $state<string[]>([]);
  let loadingBranches = $state(false);

  const baseOptions = $derived(base && !branches.includes(base) ? [base, ...branches] : branches);
  const baseGroups = $derived<ComboGroup[]>([
    { items: baseOptions.map((b) => ({ value: b, label: b })) },
  ]);

  const sep = $derived(repo.path.includes("\\") ? "\\" : "/");
  const parent = $derived(repo.path.replace(/[\\/]+$/, "").split(/[\\/]/).slice(0, -1).join(sep));
  const repoFolder = $derived(folderName(repo.path));
  const previewPath = $derived(
    branch.trim() ? `${parent}${sep}${repoFolder}--${branch.trim().replace(/[\\/]/g, "-")}` : "",
  );

  // --- What to open (multi-select) ------------------------------------------
  // Each openable is an id: `term:default`, `term:<profileId>`, `agent:<id>`,
  // or `browser`. You can pick one or several; Launch opens them all in the
  // resolved target.
  let selected = $state<string[]>([]);
  function toggle(id: string) {
    selected = selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id];
  }

  // The openable actions as a searchable, grouped list (scales to any number of
  // profiles/agents — the field stays one line + chips regardless).
  const openGroups = $derived.by<ComboGroup[]>(() => {
    const terminals: ComboItem[] = [
      { value: "term:default", label: i18n.t("terminal.newDefault"), keywords: ["terminal", "shell"] },
      ...profiles.map((p) => ({
        value: `term:${p.id}`,
        label: p.name.trim() || i18n.t("terminal.unnamedProfile"),
        keywords: ["terminal", "profile"],
      })),
    ];
    const agents: ComboItem[] = launchable.map((a) => ({
      value: `agent:${a.id}`,
      label: a.name.trim() || a.command,
      keywords: ["agent", a.command],
    }));
    const groups: ComboGroup[] = [
      { heading: i18n.t("launcher.sectionTerminals"), items: terminals },
      { heading: i18n.t("launcher.sectionAgents"), items: agents },
    ];
    if (browserEnabled)
      groups.push({
        heading: i18n.t("launcher.sectionBrowser"),
        items: [{ value: "browser", label: i18n.t("launcher.browser"), keywords: ["browser", "web"] }],
      });
    return groups;
  });

  const canSubmit = $derived(
    isNew ? branch.trim().length > 0 : target.length > 0 && selected.length > 0,
  );
  let busy = $state(false);

  const primaryLabel = $derived(
    isNew
      ? selected.length > 0
        ? i18n.t("launcher.createAndOpen")
        : i18n.t("newWorktree.create")
      : i18n.t("launcher.openAction"),
  );

  // Reset + pick a sensible default target every time the dialog opens.
  $effect(() => {
    if (!open) return;
    const active = projects.activeWorktreePath;
    const belongs = active && worktrees.some((w) => w.path === active);
    target = belongs ? active! : (worktrees[0]?.path ?? repo.path);
    selected = [];
    branch = "";
    base = "";
    branches = [];
    projects.error = null;
  });

  // Lazily load branches the first time the "new worktree" target is chosen.
  $effect(() => {
    if (!open || !isNew || branches.length || loadingBranches) return;
    loadingBranches = true;
    projects
      .branchInfo(repo.id)
      .then((info) => {
        branches = info.branches;
        base = info.defaultBase;
      })
      .catch((e) => (projects.error = e instanceof Error ? e.message : String(e)))
      .finally(() => (loadingBranches = false));
  });

  function runActions(path: string) {
    // Switch to (and link) the target first, so even a browser-only launch
    // leaves the app focused on the chosen worktree.
    projects.setActiveWorktree(path);
    for (const id of selected) {
      if (id === "term:default") projects.openTerminalAt(path);
      else if (id.startsWith("term:")) projects.openTerminalAt(path, id.slice(5));
      else if (id.startsWith("agent:")) {
        const a = launchable.find((x) => x.id === id.slice(6));
        if (a) projects.launchAgentAt(path, a);
      } else if (id === "browser") app.openBrowser();
    }
  }

  async function submit() {
    if (!canSubmit || busy) return;
    busy = true;
    try {
      let path = target;
      if (isNew) {
        // `null` = don't auto-launch the default agent; the "what to open"
        // selection is the single source of truth for what starts here.
        const ok = await projects.createWorktree(repo.id, branch.trim(), base || undefined, null);
        if (!ok) return;
        path = projects.activeWorktreePath ?? path;
      }
      runActions(path);
      open = false;
    } finally {
      busy = false;
    }
  }
</script>

<Dialog.Root bind:open>
  <Dialog.Content class="sm:max-w-[480px]">
    <Dialog.Header>
      <Dialog.Title>{i18n.t("launcher.dialogTitle", { name: repo.name })}</Dialog.Title>
      <Dialog.Description>{i18n.t("launcher.dialogDesc")}</Dialog.Description>
    </Dialog.Header>

    <div class="uxnan-scroll flex max-h-[62vh] flex-col gap-4 overflow-y-auto py-1">
      <!-- Where -->
      <div class="flex flex-col gap-1.5">
        <span class={cn("font-medium", text.body)}>{i18n.t("launcher.targetLabel")}</span>
        <Combobox
          value={target}
          groups={targetGroups}
          placeholder={i18n.t("launcher.selectTargetPlaceholder")}
          searchPlaceholder={i18n.t("launcher.searchWorktrees")}
          onChange={(v) => (target = v)}
          contentClass="w-[22rem] max-w-[80vw]"
        >
          {#snippet itemPrefix(item)}
            {#if item.value === NEW}
              <GitBranchPlusIcon class={cn(icon.button, "text-primary")} />
            {:else}
              <GitBranchIcon class={cn(icon.button, "text-muted-foreground")} />
            {/if}
          {/snippet}
        </Combobox>
      </div>

      <!-- New-worktree extras -->
      {#if isNew}
        <div class="flex flex-col gap-4 rounded-lg border border-border/50 bg-card/40 p-3">
          <div class="flex flex-col gap-1.5">
            <label for="lx-branch" class={cn("font-medium", text.body)}>{i18n.t("newWorktree.branch")}</label>
            <Input
              id="lx-branch"
              placeholder={i18n.t("newWorktree.branchPlaceholder")}
              bind:value={branch}
              autocomplete="off"
              onkeydown={(e) => e.key === "Enter" && submit()}
            />
          </div>
          <div class="flex flex-col gap-1.5">
            <span class={cn("font-medium", text.body)}>{i18n.t("newWorktree.base")}</span>
            <Combobox
              value={base}
              groups={baseGroups}
              placeholder={i18n.t("newWorktree.selectBase")}
              searchPlaceholder={i18n.t("newWorktree.selectBase")}
              disabled={loadingBranches}
              onChange={(v) => (base = v)}
            />
            <p class={text.meta}>{i18n.t("newWorktree.baseDesc")}</p>
          </div>
          {#if previewPath}
            <div class="flex items-start gap-2 rounded-md bg-muted/50 px-3 py-2">
              <GitBranchIcon class={cn(icon.decorative, "mt-0.5 shrink-0 text-muted-foreground")} />
              <code class="break-all text-[11px] text-muted-foreground">{previewPath}</code>
            </div>
          {/if}
        </div>
      {/if}

      <!-- What to open (searchable multi-select — scales to any number of
           profiles/agents without growing the dialog). -->
      <div class="flex flex-col gap-1.5">
        <span class={cn("font-medium", text.body)}>{i18n.t("launcher.whatLabel")}</span>
        <MultiSelect
          groups={openGroups}
          {selected}
          onToggle={toggle}
          placeholder={i18n.t("launcher.whatPlaceholder")}
          addLabel={i18n.t("launcher.whatAdd")}
          searchPlaceholder={i18n.t("launcher.whatSearch")}
          emptyText={i18n.t("launcher.noResults")}
          closeOnSelect
          itemPrefix={openPrefix}
        />
        {#if !launchable.length}
          <p class={text.meta}>{i18n.t("launcher.noAgents")}</p>
        {/if}
      </div>

      {#if projects.error}
        <p class="text-xs text-destructive">{projects.error}</p>
      {/if}
    </div>

    <Dialog.Footer class="items-center sm:justify-between">
      <button
        class={cn("inline-flex items-center gap-1.5 text-left transition-colors hover:text-foreground", text.meta)}
        onclick={() => {
          open = false;
          app.openSettings("agents");
        }}
      >
        <SettingsIcon class={icon.decorative} />
        {i18n.t("agent.configure")}
      </button>
      <Button onclick={submit} disabled={!canSubmit || busy || (isNew && loadingBranches)}>
        {#if busy}
          <Spinner data-icon="inline-start" aria-label={i18n.t("common.loading")} />
        {/if}
        {busy ? i18n.t("common.creating") : primaryLabel}
      </Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>

<!-- Leading icon for each openable (row + chip): an agent logo, the browser
     globe, or the terminal glyph — resolved from the item's value prefix. -->
{#snippet openPrefix(item: ComboItem)}
  {#if item.value.startsWith("agent:")}
    {@const a = launchable.find((x) => x.id === item.value.slice(6))}
    <AgentLogo logo={a ? agentLogoKey(a.icon, a.command) : null} class="size-4 shrink-0" />
  {:else if item.value === "browser"}
    <GlobeIcon class={cn(icon.button, "shrink-0 text-muted-foreground")} />
  {:else}
    <TerminalIcon class={cn(icon.button, "shrink-0 text-muted-foreground")} />
  {/if}
{/snippet}
