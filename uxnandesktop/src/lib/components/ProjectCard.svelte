<script lang="ts">
  import * as DropdownMenu from "$lib/components/ui/dropdown-menu";
  import { Button } from "$lib/components/ui/button";
  import { Badge } from "$lib/components/ui/badge";
  import { projects } from "$lib/state/projects.svelte";
  import { unread } from "$lib/state/unread.svelte";
  import { clipboardWrite } from "$lib/clipboard";
  import { cn } from "$lib/utils";
  import { icon, iconButton, panel, surface, text } from "$lib/design";
  import { i18n } from "$lib/i18n";
  import NewWorktreeDialog from "./NewWorktreeDialog.svelte";
  import ConfirmDialog from "./ConfirmDialog.svelte";
  import WorktreeRow from "./WorktreeRow.svelte";
  import AgentSpace from "./AgentSpace.svelte";
  import LaunchAgentMenu from "./LaunchAgentMenu.svelte";
  import type { RepoData } from "$lib/types";
  import FolderGitIcon from "@lucide/svelte/icons/folder-git-2";
  import FolderIcon from "@lucide/svelte/icons/folder";
  import TerminalIcon from "@lucide/svelte/icons/terminal";
  import GitBranchPlusIcon from "@lucide/svelte/icons/git-branch-plus";
  import MoreVerticalIcon from "@lucide/svelte/icons/ellipsis-vertical";
  import CopyIcon from "@lucide/svelte/icons/copy";
  import Trash2Icon from "@lucide/svelte/icons/trash-2";
  import ChevronRightIcon from "@lucide/svelte/icons/chevron-right";

  let { repo }: { repo: RepoData } = $props();

  // A non-git folder is a valid project but has no worktrees/branches, so its
  // worktree affordances (expand, "new worktree", the worktrees subtree) are
  // hidden. Absent flag (older persisted state) means git.
  const isGit = $derived(repo.isGit !== false);

  let newWorktreeOpen = $state(false);
  let confirmRemoveOpen = $state(false);
  let expanded = $state(false);

  // The project's own context = its main worktree (path === repo path).
  const mainPath = $derived(projects.mainWorktree(repo.id)?.path ?? repo.path);
  const activeProject = $derived(projects.activeWorktreePath === mainPath);
  const mainStatus = $derived(projects.status(mainPath));
  const children = $derived(projects.visibleChildWorktrees(repo.id));
  const childRows = $derived(
    children.map((w) => ({ ...w, repoId: repo.id, repoName: repo.name })),
  );
  // Unread if the project's own context, or any of its worktrees, has a result
  // the user hasn't reviewed (so a collapsed project still surfaces it).
  const hasUnread = $derived(
    unread.has(mainPath) ||
      projects.childWorktrees(repo.id).some((w) => unread.has(w.path)),
  );
  // Auto-expand while searching so matching worktrees are visible.
  const isExpanded = $derived(expanded || projects.query.trim().length > 0);
</script>

<div class={panel.sidebarCard}>
  <!-- Project header = the main worktree context (selectable) -->
  <div
    class={cn(
      "group flex min-h-12 items-center gap-2 px-2.5 py-2 transition-colors hover:bg-foreground/[0.045]",
      activeProject && surface.active,
    )}
  >
    {#if isGit}
      <button
        class="shrink-0 rounded p-0.5 text-muted-foreground hover:text-foreground"
        title={isExpanded ? i18n.t("project.collapse") : i18n.t("project.expand")}
        aria-label={isExpanded ? i18n.t("project.collapse") : i18n.t("project.expand")}
        onclick={() => (expanded = !isExpanded)}
      >
        <ChevronRightIcon
          class={cn(icon.button, "transition-transform", isExpanded && "rotate-90")}
        />
      </button>
    {:else}
      <span class="shrink-0 p-0.5"><span class={cn(icon.button, "block")}></span></span>
    {/if}

    <button
      class="flex min-w-0 flex-1 items-center gap-1.5 text-left"
      title={i18n.t("project.workIn", { name: repo.name })}
      onclick={() => projects.setActiveWorktree(mainPath)}
    >
      {#if isGit}
        <FolderGitIcon class={cn(icon.decorative, "shrink-0 text-muted-foreground")} />
      {:else}
        <FolderIcon class={cn(icon.decorative, "shrink-0 text-muted-foreground")} />
      {/if}
      <div class="min-w-0 flex-1">
        <div class="flex items-center gap-1.5">
          <span class={cn("truncate", text.title)} title={repo.name}>{repo.name}</span>
          {#if hasUnread}
            <span
              class="size-1.5 shrink-0 rounded-full bg-red-500"
              title={i18n.t("monitor.unread")}
            ></span>
          {/if}
          {#if mainStatus && mainStatus.dirty > 0}
            <span
              class={cn(
                "inline-flex shrink-0 items-center gap-0.5 text-amber-600 dark:text-amber-400",
                text.indicator,
              )}
              title={i18n.t("project.dirtyTooltip", { n: mainStatus.dirty })}
            >
              <span class="size-1.5 rounded-full bg-amber-500"></span>{mainStatus.dirty}
            </span>
          {/if}
        </div>
        <div class={cn("truncate", text.meta)} title={repo.path}>
          {repo.path}
        </div>
      </div>
    </button>

    <div class="flex shrink-0 items-center gap-0.5">
      <Button
        variant="ghost"
        size="icon"
        class={iconButton.action}
        title={i18n.t("project.openTerminal", { name: repo.name })}
        onclick={() => projects.openTerminalAt(mainPath)}
      >
        <TerminalIcon class={icon.button} />
      </Button>
      <LaunchAgentMenu label={repo.name} path={mainPath} />
      {#if isGit}
        <Button
          variant="ghost"
          size="icon"
          class={iconButton.action}
          title={i18n.t("project.newWorktree")}
          onclick={() => (newWorktreeOpen = true)}
        >
          <GitBranchPlusIcon class={icon.button} />
        </Button>
      {/if}
      <DropdownMenu.Root>
        <DropdownMenu.Trigger>
          {#snippet child({ props })}
            <Button variant="ghost" size="icon" class={iconButton.action} title={i18n.t("common.more")} {...props}>
              <MoreVerticalIcon class={icon.button} />
            </Button>
          {/snippet}
        </DropdownMenu.Trigger>
        <DropdownMenu.Content align="end" class="min-w-44">
          <DropdownMenu.Item class={text.menu} onclick={() => clipboardWrite(repo.path)}>
            <CopyIcon class={icon.button} />
            {i18n.t("common.copyPath")}
          </DropdownMenu.Item>
          <DropdownMenu.Separator />
          <DropdownMenu.Item
            variant="destructive"
            class={text.menu}
            onclick={() => (confirmRemoveOpen = true)}
          >
            <Trash2Icon class={icon.button} />
            {i18n.t("project.removeProject")}
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Root>
    </div>
  </div>

  <!-- The project's own (main worktree) agent terminals -->
  <div class="px-1.5 pl-6">
    <AgentSpace path={mainPath} />
  </div>

  <!-- Worktrees (non-main) as nested sub-rows — git projects only -->
  {#if isGit && isExpanded}
    <div class="border-t border-sidebar-border/60 bg-background/35 py-1.5 pl-3 pr-1">
      {#if childRows.length === 0}
        <div class="flex items-center justify-between px-1 py-0.5">
          <span class={text.meta}>{i18n.t("project.noWorktrees")}</span>
          <Button
            variant="ghost"
            size="sm"
            class={cn("h-6", text.body)}
            onclick={() => (newWorktreeOpen = true)}
          >
            <GitBranchPlusIcon class={icon.decorative} />
            {i18n.t("common.new")}
          </Button>
        </div>
      {:else}
        <div class="flex flex-col">
          {#each childRows as row (row.path)}
            <WorktreeRow {row} />
          {/each}
        </div>
      {/if}
    </div>
  {:else if isGit && children.length > 0}
    <!-- Collapsed: a compact count so the relationship is visible -->
    <div class="px-2.5 pb-1.5">
      <Badge variant="secondary" class={cn("font-normal", text.indicator)}>
        {i18n.plural(children.length, "project.worktreeOne", "project.worktreeOther")}
      </Badge>
    </div>
  {/if}
</div>

<NewWorktreeDialog {repo} bind:open={newWorktreeOpen} />
<ConfirmDialog
  bind:open={confirmRemoveOpen}
  title={i18n.t("project.removeTitle")}
  description={i18n.t("project.removeDesc", { name: repo.name })}
  confirmLabel={i18n.t("common.remove")}
  danger
  onconfirm={() => projects.removeProject(repo.id)}
/>
