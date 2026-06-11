<script lang="ts">
  import * as DropdownMenu from "$lib/components/ui/dropdown-menu";
  import { Button } from "$lib/components/ui/button";
  import { Badge } from "$lib/components/ui/badge";
  import { projects } from "$lib/state/projects.svelte";
  import { terminals } from "$lib/state/terminals.svelte";
  import { clipboardWrite } from "$lib/clipboard";
  import { cn } from "$lib/utils";
  import { icon, iconButton, text } from "$lib/design";
  import { i18n } from "$lib/i18n";
  import NewWorktreeDialog from "./NewWorktreeDialog.svelte";
  import ConfirmDialog from "./ConfirmDialog.svelte";
  import WorktreeRow from "./WorktreeRow.svelte";
  import type { RepoData } from "$lib/types";
  import FolderGitIcon from "@lucide/svelte/icons/folder-git-2";
  import TerminalIcon from "@lucide/svelte/icons/terminal";
  import GitBranchPlusIcon from "@lucide/svelte/icons/git-branch-plus";
  import MoreVerticalIcon from "@lucide/svelte/icons/ellipsis-vertical";
  import CopyIcon from "@lucide/svelte/icons/copy";
  import Trash2Icon from "@lucide/svelte/icons/trash-2";
  import ChevronRightIcon from "@lucide/svelte/icons/chevron-right";

  let { repo }: { repo: RepoData } = $props();

  let newWorktreeOpen = $state(false);
  let confirmRemoveOpen = $state(false);
  let expanded = $state(false);

  // The project's own context = its main worktree (path === repo path).
  const mainPath = $derived(projects.mainWorktree(repo.id)?.path ?? repo.path);
  const activeProject = $derived(projects.activeWorktreePath === mainPath);
  const mainStatus = $derived(projects.status(mainPath));
  const mainTermCount = $derived(terminals.terminalCount(mainPath));
  const children = $derived(projects.visibleChildWorktrees(repo.id));
  const childRows = $derived(
    children.map((w) => ({ ...w, repoId: repo.id, repoName: repo.name })),
  );
  // Auto-expand while searching so matching worktrees are visible.
  const isExpanded = $derived(expanded || projects.query.trim().length > 0);
</script>

<div class="overflow-hidden rounded-md border border-sidebar-border">
  <!-- Project header = the main worktree context (selectable) -->
  <div
    class={cn(
      "flex items-center gap-1 px-1.5 py-1.5 transition-colors hover:bg-accent/40",
      activeProject && "bg-accent/60",
    )}
  >
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

    <button
      class="flex min-w-0 flex-1 items-center gap-1.5 text-left"
      title={i18n.t("project.workIn", { name: repo.name })}
      onclick={() => projects.setActiveWorktree(mainPath)}
    >
      <FolderGitIcon class={cn(icon.decorative, "shrink-0 text-muted-foreground")} />
      <div class="min-w-0 flex-1">
        <div class="flex items-center gap-1.5">
          <span class={cn("truncate", text.title)} title={repo.name}>{repo.name}</span>
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
          {#if mainTermCount > 0}
            <span
              class={cn(
                "inline-flex shrink-0 items-center gap-0.5 text-emerald-600 dark:text-emerald-400",
                text.indicator,
              )}
              title={i18n.t("project.runningTooltip", { n: mainTermCount })}
            >
              <TerminalIcon class={icon.decorative} />{mainTermCount}
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
      <Button
        variant="ghost"
        size="icon"
        class={iconButton.action}
        title={i18n.t("project.newWorktree")}
        onclick={() => (newWorktreeOpen = true)}
      >
        <GitBranchPlusIcon class={icon.button} />
      </Button>
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

  <!-- Worktrees (non-main) as nested sub-rows -->
  {#if isExpanded}
    <div class="border-t border-sidebar-border bg-background/40 py-1 pl-3 pr-1">
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
  {:else if children.length > 0}
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
