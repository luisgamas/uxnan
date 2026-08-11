<script lang="ts">
  // The project's "+" window — one place to start anything in the project,
  // without the old floating menu that repeated every option per worktree (and
  // overflowed the screen once a project had a few branches). The flow reads as
  // a sentence: pick WHERE (an existing worktree, or a brand-new one) and WHAT
  // to open there (a terminal / profile, one or several agents, the browser).
  // Everything runs against the chosen target so the workspace linkage
  // (terminals ↔ agents ↔ worktree) is preserved.
  import { onDestroy, untrack } from "svelte";
  import * as Dialog from "$lib/components/ui/dialog";
  import * as Tabs from "$lib/components/ui/tabs";
  import { Button } from "$lib/components/ui/button";
  import { Spinner } from "$lib/components/ui/spinner";
  import { Input } from "$lib/components/ui/input";
  import type { ComboGroup, ComboItem } from "./Combobox.svelte";
  import MultiSelect from "./MultiSelect.svelte";
  import AgentLogo from "./AgentLogo.svelte";
  import WorktreeCreateFields from "./WorktreeCreateFields.svelte";
  import GitHubWorkItemPicker from "./GitHubWorkItemPicker.svelte";
  import { app } from "$lib/state/app.svelte";
  import { projects } from "$lib/state/projects.svelte";
  import { agentLogoKey } from "$lib/agentCatalog";
  import { parseGitHubWorkItemInput } from "$lib/githubInput";
  import { githubWorkItemKind } from "$lib/api";
  import { errorMessage } from "$lib/toast";
  import { cn } from "$lib/utils";
  import { icon, text } from "$lib/design";
  import { i18n } from "$lib/i18n";
  import type { RepoData } from "$lib/types";
  import { Icon } from "$lib/components/ui/icon";
  import TerminalIcon from "@hugeicons/core-free-icons/TerminalIcon";
  import GlobeIcon from "@hugeicons/core-free-icons/GlobeIcon";
  import GitBranchIcon from "@hugeicons/core-free-icons/GitBranchIcon";
  import GitBranchPlusIcon from "@hugeicons/core-free-icons/GitBranchPlusIcon";
  import GitPullRequestIcon from "@hugeicons/core-free-icons/GitPullRequestIcon";
  import CircleDotIcon from "@hugeicons/core-free-icons/CircleDotIcon";
  import SettingsIcon from "@hugeicons/core-free-icons/Settings01Icon";
  import SearchIcon from "@hugeicons/core-free-icons/Search01Icon";

  let { repo, open = $bindable(false) }: { repo: RepoData; open?: boolean } = $props();

  type SourceMode = "worktree" | "new" | "pr" | "issue";

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

  let sourceMode = $state<SourceMode>("worktree");
  let previousSourceMode = $state<SourceMode>("worktree");
  let target = $state<string>("");
  let worktreeQuery = $state("");
  const isNew = $derived(sourceMode === "new");
  const githubKind = $derived(sourceMode === "pr" ? "pr" : sourceMode === "issue" ? "issue" : null);
  const isGitHubSource = $derived(githubKind !== null);
  const mainPath = $derived(projects.mainWorktree(repo.id)?.path ?? repo.path);

  function folderName(path: string): string {
    return path.replace(/[\\/]+$/, "").split(/[\\/]/).pop() ?? repo.name;
  }
  function worktreeLabel(w: { path: string; branch: string | null }): string {
    return w.branch ?? folderName(w.path);
  }

  const filteredWorktrees = $derived.by(() => {
    const query = worktreeQuery.trim().toLowerCase();
    if (!query) return worktrees;
    return worktrees.filter((worktree) =>
      [worktreeLabel(worktree), folderName(worktree.path), worktree.path]
        .some((value) => value.toLowerCase().includes(query)),
    );
  });

  // --- New-worktree fields (only when target = NEW) -------------------------
  // The whole worktree-creation form is the shared WorktreeCreateFields; these
  // are its bound outputs (modes, auto-name, existing-branch, custom location).
  let wtMode = $state<"new" | "existing">("new");
  let wtNewBranch = $state("");
  let wtExistingBranch = $state("");
  let wtBase = $state("");
  let wtLocation = $state("");
  let wtLocationTouched = $state(false);
  let wtEffectiveBranch = $state("");
  let wtValid = $state(false);
  let wtLoading = $state(false);
  let wtNewBranchTouched = $state(false);

  /** What this workspace is called, in plain words. It is the *same* value the
   *  branch name under Advanced holds — this field just lets you write it as a
   *  sentence and have the branch derived, instead of spelling out a valid ref.
   *  Optional: left empty, the dialog behaves exactly as it always has. */
  let workspaceName = $state("");
  let githubInitialQuery = $state("");
  let sourceDetectionTimer: ReturnType<typeof setTimeout> | undefined;
  let referenceRequest = 0;
  let referenceResolving = $state(false);

  async function routeWorkspaceReference(value: string, request = ++referenceRequest): Promise<boolean> {
    const parsed = parseGitHubWorkItemInput(value);
    if (!parsed) return false;
    if (!parsed.kind) {
      referenceResolving = true;
      projects.error = null;
      try {
        const kind = await githubWorkItemKind(mainPath, String(parsed.number));
        if (request !== referenceRequest || workspaceName.trim() !== value.trim()) return true;
        githubInitialQuery = value.trim();
        sourceMode = kind;
      } catch (error) {
        if (request === referenceRequest) projects.error = errorMessage(error);
      } finally {
        if (request === referenceRequest) referenceResolving = false;
      }
      return true;
    }
    githubInitialQuery = value.trim();
    sourceMode = parsed.kind;
    return true;
  }

  function detectWorkspaceReference(value: string): void {
    if (sourceDetectionTimer) clearTimeout(sourceDetectionTimer);
    const request = ++referenceRequest;
    referenceResolving = false;
    sourceDetectionTimer = setTimeout(() => {
      sourceDetectionTimer = undefined;
      void routeWorkspaceReference(value, request);
    }, 300);
  }

  onDestroy(() => {
    if (sourceDetectionTimer) clearTimeout(sourceDetectionTimer);
    referenceRequest += 1;
  });

  // --- GitHub work-item source ---------------------------------------------
  let githubNumber = $state<number | null>(null);
  let githubTitle = $state("");
  let githubBranch = $state("");

  $effect(() => {
    const next = sourceMode;
    if (next === previousSourceMode) return;
    previousSourceMode = next;
    referenceRequest += 1;
    referenceResolving = false;
    githubNumber = null;
    githubTitle = "";
    githubBranch = "";
    const expectedKind = next === "pr" || next === "issue" ? next : undefined;
    if (!expectedKind || !parseGitHubWorkItemInput(githubInitialQuery, expectedKind)) {
      githubInitialQuery = "";
    }
    projects.error = null;
  });

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
    isNew
      ? !referenceResolving && wtValid
      : isGitHubSource
        ? githubNumber !== null && githubBranch.trim().length > 0
        : target.length > 0 && selected.length > 0,
  );
  let busy = $state(false);

  const primaryLabel = $derived(
    isNew || isGitHubSource
      ? selected.length > 0
        ? i18n.t("launcher.createAndOpen")
        : i18n.t("newWorktree.create")
      : i18n.t("launcher.openAction"),
  );

  // Reset + pick a sensible default target every time the dialog opens. The
  // worktree-creation fields reset themselves (WorktreeCreateFields, keyed off
  // `active={isNew}`), so nothing branch-related is touched here.
  // `untrack` so this depends ONLY on `open`: creating a worktree refreshes the
  // repo's list and moves the active worktree, and a tracked read of either would
  // re-run this reset mid-submit — wiping the user's "what to open" picks before
  // they were launched.
  $effect(() => {
    if (!open) {
      referenceRequest += 1;
      referenceResolving = false;
      return;
    }
    untrack(() => {
      const active = projects.activeWorktreePath;
      const belongs = active && worktrees.some((w) => w.path === active);
      target = belongs ? active! : (worktrees[0]?.path ?? repo.path);
      sourceMode = isGit ? "new" : "worktree";
      previousSourceMode = sourceMode;
      worktreeQuery = "";
      selected = [];
      workspaceName = "";
      githubInitialQuery = "";
      githubNumber = null;
      githubTitle = "";
      githubBranch = "";
      referenceRequest += 1;
      referenceResolving = false;
      projects.error = null;
    });
  });

  function runActions(path: string, actions: string[]) {
    // Switch to (and link) the target first, so even a browser-only launch
    // leaves the app focused on the chosen worktree.
    projects.setActiveWorktree(path);
    for (const id of actions) {
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
      // Snapshot what the user picked BEFORE any await: creating the worktree
      // yields, and whatever runs in between must not be able to change what we
      // launch. The snapshot is what `runActions` opens.
      const actions = [...selected];
      const creating = isNew;
      let path = target;
      if (creating) {
        // `null` = don't auto-launch the default agent; the "what to open"
        // selection is the single source of truth for what starts here.
        const ok = await projects.createWorktree(repo.id, wtEffectiveBranch, {
          base: wtMode === "new" ? wtBase || undefined : undefined,
          fromExisting: wtMode === "existing",
          path: wtLocationTouched && wtLocation.trim() ? wtLocation.trim() : undefined,
          agentId: null,
        });
        if (!ok) return;
        path = projects.activeWorktreePath ?? path;
        // Keep the sentence, not just the ref derived from it. The branch only
        // carries a folded, truncated slug; three weeks from now the note is what
        // still explains why this space exists. Skipped when the name *is* the
        // branch (typed straight into Advanced) — repeating it says nothing.
        const typed = workspaceName.trim();
        if (typed && typed !== wtEffectiveBranch) projects.setNote(path, typed);
      } else if (isGitHubSource && githubKind && githubNumber !== null) {
        const createdPath = await projects.createGitHubWorktree(
          repo.id,
          githubKind,
          githubNumber,
          githubBranch.trim(),
          null,
        );
        if (!createdPath) return;
        path = createdPath;
        if (githubTitle.trim()) projects.setNote(path, githubTitle.trim());
      }
      runActions(path, actions);
      open = false;
    } finally {
      busy = false;
    }
  }
</script>

<Dialog.Root bind:open>
  <Dialog.Content size="large">
    <Dialog.Header>
      <Dialog.Title>{i18n.t("launcher.dialogTitle", { name: repo.name })}</Dialog.Title>
      <Dialog.Description>{i18n.t("launcher.dialogDesc")}</Dialog.Description>
    </Dialog.Header>

    <div class="uxnan-scroll flex max-h-[64vh] flex-col gap-5 overflow-y-auto py-1">
      <Tabs.Root bind:value={sourceMode} class="gap-3">
        <Tabs.List class="h-9 w-full">
          {#if isGit}
            <Tabs.Trigger value="new" class={cn("flex-1 rounded-md", sourceMode === "new" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}>
              <Icon icon={GitBranchPlusIcon} />{i18n.t("launcher.source.new")}
            </Tabs.Trigger>
          {/if}
          <Tabs.Trigger value="worktree" class={cn("flex-1 rounded-md", sourceMode === "worktree" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}>
            <Icon icon={GitBranchIcon} />{i18n.t("launcher.source.worktree")}
          </Tabs.Trigger>
          {#if isGit}
            <Tabs.Trigger value="pr" class={cn("flex-1 rounded-md", sourceMode === "pr" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}>
              <Icon icon={GitPullRequestIcon} />{i18n.t("launcher.source.pr")}
            </Tabs.Trigger>
            <Tabs.Trigger value="issue" class={cn("flex-1 rounded-md", sourceMode === "issue" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}>
              <Icon icon={CircleDotIcon} />{i18n.t("launcher.source.issue")}
            </Tabs.Trigger>
          {/if}
        </Tabs.List>
      </Tabs.Root>

      {#if sourceMode === "worktree"}
        <div class="flex flex-col gap-2">
          <div class="relative">
            <Icon icon={SearchIcon} class="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground/70" />
            <Input class="h-10 pl-9" bind:value={worktreeQuery} placeholder={i18n.t("launcher.searchWorktrees")} autocomplete="off" />
          </div>
          <div class="uxnan-scroll max-h-52 min-h-32 overflow-y-auto rounded-lg border border-border/60 bg-background p-1" role="listbox" aria-label={i18n.t("launcher.sectionWorktree")}>
            {#if filteredWorktrees.length === 0}
              <div class={cn("flex min-h-28 items-center justify-center", text.meta)}>{i18n.t("launcher.noResults")}</div>
            {:else}
              {#each filteredWorktrees as worktree (worktree.path)}
                <button
                  type="button"
                  role="option"
                  aria-selected={target === worktree.path}
                  class={cn("flex min-h-11 w-full items-center gap-3 rounded-md px-3 py-2 text-left transition-colors", target === worktree.path ? "bg-accent text-foreground" : "hover:bg-accent/55")}
                  onclick={() => (target = worktree.path)}
                >
                  <Icon icon={GitBranchIcon} class={cn(icon.button, "shrink-0", target === worktree.path ? "text-primary" : "text-muted-foreground")} />
                  <span class="min-w-0 flex-1">
                    <span class={cn("block truncate", text.bodyStrong)}>{worktreeLabel(worktree)}</span>
                    <span class={cn("block truncate", text.meta)}>{worktree.path}</span>
                  </span>
                  {#if worktree.path === projects.activeWorktreePath}
                    <span class="shrink-0 rounded bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">{i18n.t("launcher.activeBadge")}</span>
                  {:else if worktree.isMain}
                    <span class={cn("shrink-0", text.meta)}>{i18n.t("launcher.mainBadge")}</span>
                  {/if}
                </button>
              {/each}
            {/if}
          </div>
        </div>
      {/if}

      <!-- New-worktree extras — the shared creation form (modes / auto-name /
           existing branch / optional custom location), fronted by the name.
           ONE name, written twice over: this field takes it in plain words, the
           branch under Advanced holds the ref it derives to. They are not two
           questions — spelling out a valid ref before you can say what the space
           is for is exactly the chore the dice button exists to dodge. -->
      {#if isNew}
        <div class="flex flex-col gap-3">
          <div class="flex flex-col gap-1.5">
            <label for="launcher-name" class={cn("font-medium", text.body)}>
              {i18n.t("launcher.nameLabel")}
            </label>
            <Input
              id="launcher-name"
              placeholder={i18n.t("launcher.namePlaceholder")}
              bind:value={workspaceName}
              autocomplete="off"
              oninput={(event) => detectWorkspaceReference(event.currentTarget.value)}
              onkeydown={(event) => {
                if (event.key !== "Enter") return;
                if (sourceDetectionTimer) clearTimeout(sourceDetectionTimer);
                const parsed = parseGitHubWorkItemInput(workspaceName);
                if (parsed) {
                  event.preventDefault();
                  void routeWorkspaceReference(workspaceName);
                } else void submit();
              }}
            />
            {#if referenceResolving}
              <span class={cn("flex items-center gap-1.5", text.meta)} aria-live="polite">
                <Spinner class="size-3" />{i18n.t("launcher.github.resolving")}
              </span>
            {/if}
          </div>
          <WorktreeCreateFields
            {repo}
            active={isNew}
            advanced
            nameHint={workspaceName}
            bind:mode={wtMode}
            bind:newBranch={wtNewBranch}
            bind:newBranchTouched={wtNewBranchTouched}
            bind:existingBranch={wtExistingBranch}
            bind:base={wtBase}
            bind:location={wtLocation}
            bind:locationTouched={wtLocationTouched}
            bind:effectiveBranch={wtEffectiveBranch}
            bind:canSubmit={wtValid}
            bind:loading={wtLoading}
            onEnter={submit}
          />
        </div>
      {/if}

      {#if isGitHubSource && githubKind}
        <div class="flex flex-col gap-3">
          <GitHubWorkItemPicker
            active={isGitHubSource}
            repoPath={mainPath}
            kind={githubKind}
            initialQuery={githubInitialQuery}
            bind:number={githubNumber}
            bind:title={githubTitle}
            bind:branch={githubBranch}
          />
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
        <Icon icon={SettingsIcon} class={icon.decorative} />
        {i18n.t("agent.configure")}
      </button>
      <Button onclick={submit} disabled={!canSubmit || busy || (isNew && wtLoading)}>
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
    <Icon icon={GlobeIcon} class={cn(icon.button, "shrink-0 text-muted-foreground")} />
  {:else}
    <Icon icon={TerminalIcon} class={cn(icon.button, "shrink-0 text-muted-foreground")} />
  {/if}
{/snippet}
