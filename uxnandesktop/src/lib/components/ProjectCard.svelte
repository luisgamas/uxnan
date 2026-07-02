<script lang="ts">
  // A project: a borderless group with an identity header and, when expanded,
  // a list of its worktrees (the primary one first, then the children). The
  // header's two actions — collapse/expand and the shared launcher (+) — reveal
  // on hover; right-clicking the header opens the shared actions menu
  // (`RowActionsMenu`: copy path / remove project / terminals / agents / …).
  import * as ContextMenu from "$lib/components/ui/context-menu";
  import { Button } from "$lib/components/ui/button";
  import { projects } from "$lib/state/projects.svelte";
  import { unread } from "$lib/state/unread.svelte";
  import { cn } from "$lib/utils";
  import { icon, iconButton, surface, text } from "$lib/design";
  import { i18n } from "$lib/i18n";
  import ConfirmDialog from "./ConfirmDialog.svelte";
  import WorktreeRow from "./WorktreeRow.svelte";
  import AgentSpace from "./AgentSpace.svelte";
  import LauncherDialog from "./LauncherDialog.svelte";
  import RowActionsMenu from "./RowActionsMenu.svelte";
  import type { RepoData } from "$lib/types";
  import FolderGitIcon from "@lucide/svelte/icons/folder-git-2";
  import FolderIcon from "@lucide/svelte/icons/folder";
  import ChevronRightIcon from "@lucide/svelte/icons/chevron-right";
  import PlusIcon from "@lucide/svelte/icons/plus";

  let { repo }: { repo: RepoData } = $props();

  // A non-git folder is a valid project but has no worktrees, so it skips the
  // expand/worktree machinery and is itself the selectable context.
  const isGit = $derived(repo.isGit !== false);

  let launcherOpen = $state(false);
  let confirmRemoveOpen = $state(false);
  let expanded = $state(false);

  const mainPath = $derived(projects.mainWorktree(repo.id)?.path ?? repo.path);
  const children = $derived(projects.visibleChildWorktrees(repo.id));
  // Expanded list = the primary (main) worktree first, then the child worktrees.
  const rows = $derived.by(() => {
    const main = projects.mainWorktree(repo.id);
    const childRows = children.map((w) => ({ ...w, repoId: repo.id, repoName: repo.name }));
    if (!main) return childRows;
    return [{ ...main, isMain: true, repoId: repo.id, repoName: repo.name }, ...childRows];
  });
  // Unread if the project's own context, or any worktree, has an unreviewed result.
  const hasUnread = $derived(
    unread.has(mainPath) ||
      projects.childWorktrees(repo.id).some((w) => unread.has(w.path)),
  );
  // Highlight the (collapsed) header when this project holds the active worktree,
  // so you can still see "where you are" without expanding.
  const projectActive = $derived(
    projects.activeWorktreePath != null &&
      (projects.activeWorktreePath === mainPath ||
        projects.childWorktrees(repo.id).some((w) => w.path === projects.activeWorktreePath)),
  );
  // Auto-expand while searching so matching worktrees are visible.
  const isExpanded = $derived(expanded || projects.query.trim().length > 0);

  const hoverReveal = "opacity-0 group-hover/header:opacity-100";

  function onHeaderActivate() {
    if (isGit) expanded = !isExpanded;
    else projects.setActiveWorktree(repo.path);
  }
</script>

<div class="flex flex-col">
  <!-- Project header — left-click expands (git) or selects (folder); right-click
       opens the shared actions menu (same body as a worktree row). -->
  <ContextMenu.Root>
    <ContextMenu.Trigger>
      {#snippet child({ props })}
        <div
          {...props}
          class={cn(
            "group/header flex min-h-9 items-center gap-2 rounded-md px-2 py-1.5 transition-colors",
            projectActive && !isExpanded && surface.active,
          )}
          role="button"
          tabindex="0"
          title={repo.path}
          onclick={onHeaderActivate}
          onkeydown={(e) => (e.key === "Enter" || e.key === " ") && onHeaderActivate()}
        >
          {#if isGit}
            <FolderGitIcon class={cn(icon.nav, "shrink-0 text-muted-foreground")} />
          {:else}
            <FolderIcon class={cn(icon.nav, "shrink-0 text-muted-foreground")} />
          {/if}
          <span class={cn("min-w-0 flex-1 truncate", text.title)} title={repo.name}>{repo.name}</span>
          {#if hasUnread}
            <span class="size-1.5 shrink-0 rounded-full bg-red-500" title={i18n.t("monitor.unread")}></span>
          {/if}

          <div class="flex shrink-0 items-center gap-0.5">
            {#if isGit}
              <Button
                variant="ghost"
                size="icon"
                class={cn(iconButton.xs, hoverReveal)}
                title={isExpanded ? i18n.t("project.collapse") : i18n.t("project.expand")}
                aria-label={isExpanded ? i18n.t("project.collapse") : i18n.t("project.expand")}
                onclick={(e) => {
                  e.stopPropagation();
                  expanded = !isExpanded;
                }}
              >
                <ChevronRightIcon class={cn(icon.action, "transition-transform", isExpanded && "rotate-90")} />
              </Button>
            {/if}
            <Button
              variant="ghost"
              size="icon"
              class={cn(iconButton.xs, hoverReveal)}
              title={i18n.t("launcher.open", { name: repo.name })}
              onclick={(e) => {
                e.stopPropagation();
                launcherOpen = true;
              }}
            >
              <PlusIcon class={icon.action} />
            </Button>
          </div>
        </div>
      {/snippet}
    </ContextMenu.Trigger>
    <RowActionsMenu
      path={mainPath}
      removeLabel={i18n.t("project.removeProject")}
      onRemove={() => (confirmRemoveOpen = true)}
    />
  </ContextMenu.Root>

  {#if isGit}
    {#if isExpanded}
      <div class="flex flex-col pl-2">
        {#each rows as row (row.path)}
          <WorktreeRow
            {row}
            onRemoveProject={row.isMain ? () => (confirmRemoveOpen = true) : undefined}
          />
        {/each}
      </div>
    {/if}
  {:else}
    <!-- Non-git folder: no worktrees — its agents live right under the header. -->
    <div class="pl-6">
      <AgentSpace path={repo.path} />
    </div>
  {/if}
</div>

<LauncherDialog {repo} bind:open={launcherOpen} />
<ConfirmDialog
  bind:open={confirmRemoveOpen}
  title={i18n.t("project.removeTitle")}
  description={i18n.t("project.removeDesc", { name: repo.name })}
  confirmLabel={i18n.t("common.remove")}
  danger
  onconfirm={() => projects.removeProject(repo.id)}
/>
