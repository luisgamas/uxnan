<script lang="ts">
  // A project: a borderless group with an identity header and, when expanded,
  // a list of its worktrees (the primary one first, then the children). The
  // header shows the project icon (custom or default), its name, and three
  // hover-revealed actions: collapse/expand, the shared launcher (+), and a
  // three-dots (⋯) menu. The ⋯ menu carries the project-level actions — project
  // settings, change icon, reveal, copy path, configure, remove — and replaces
  // the old header right-click menu (launching terminals/agents stays on "+").
  import * as DropdownMenu from "$lib/components/ui/dropdown-menu";
  import { Button } from "$lib/components/ui/button";
  import { projects } from "$lib/state/projects.svelte";
  import { unread } from "$lib/state/unread.svelte";
  import { app } from "$lib/state/app.svelte";
  import { terminals } from "$lib/state/terminals.svelte";
  import { samePath } from "$lib/pathid";
  import { clipboardWrite } from "$lib/clipboard";
  import { revealPath } from "$lib/api";
  import { cn } from "$lib/utils";
  import { icon, iconButton, surface, text } from "$lib/design";
  import { TooltipSimple } from "$lib/components/ui/tooltip";
  import { i18n } from "$lib/i18n";
  import ConfirmDialog from "./ConfirmDialog.svelte";
  import WorktreeRow from "./WorktreeRow.svelte";
  import AgentSpace from "./AgentSpace.svelte";
  import LauncherDialog from "./LauncherDialog.svelte";
  import EntityIcon from "./EntityIcon.svelte";
  import IconPicker from "./IconPicker.svelte";
  import ProjectSettingsDialog from "./ProjectSettingsDialog.svelte";
  import OpenWith from "./OpenWith.svelte";
  import { createStableOrder } from "$lib/state/sidebarOrder.svelte";
  import { createDragReorder, type DragReorder } from "$lib/state/dragReorder.svelte";
  import { isStaticSortMode } from "$lib/sidebar-sort";
  import type { RepoData } from "$lib/types";
  import FolderGitIcon from "@lucide/svelte/icons/folder-git-2";
  import FolderIcon from "@lucide/svelte/icons/folder";
  import ChevronRightIcon from "@lucide/svelte/icons/chevron-right";
  import PlusIcon from "@lucide/svelte/icons/plus";
  import EllipsisIcon from "@lucide/svelte/icons/ellipsis";
  import SettingsIcon from "@lucide/svelte/icons/settings";
  import ImageIcon from "@lucide/svelte/icons/image";
  import FolderOpenIcon from "@lucide/svelte/icons/folder-open";
  import CopyIcon from "@lucide/svelte/icons/copy";
  import BotIcon from "@lucide/svelte/icons/bot";
  import TerminalIcon from "@lucide/svelte/icons/terminal";
  import Trash2Icon from "@lucide/svelte/icons/trash-2";
  import PinIcon from "@lucide/svelte/icons/pin";
  import PinOffIcon from "@lucide/svelte/icons/pin-off";

  let {
    repo,
    index,
    drag,
  }: {
    repo: RepoData;
    /** This card's position in the sidebar (for the pointer-drag reorder). */
    index: number;
    /** Shared project-card reorder controller (owned by the sidebar). */
    drag: DragReorder;
  } = $props();

  // A non-git folder is a valid project but has no worktrees, so it skips the
  // expand/worktree machinery and is itself the selectable context.
  const isGit = $derived(repo.isGit !== false);

  let launcherOpen = $state(false);
  let confirmRemoveOpen = $state(false);
  let settingsOpen = $state(false);
  let iconPickerOpen = $state(false);
  let expanded = $state(false);

  const mainPath = $derived(projects.mainWorktree(repo.id)?.path ?? repo.path);

  // Live-space aggregate for the collapsed card: terminals open across this
  // project's workspaces (main + every worktree). Keys are matched by path
  // identity, and each workspace key counts once.
  const termCount = $derived.by(() => {
    const paths = [repo.path, ...projects.worktreesOf(repo.id).map((w) => w.path)];
    let n = 0;
    for (const key of terminals.openWorkspaceKeys) {
      if (paths.some((p) => samePath(p, key))) n += terminals.terminalCount(key);
    }
    return n;
  });

  // Child worktrees in their effective order — frozen against jumping for the
  // drifting modes — plus the pointer-drag reorder that feeds this project's
  // manual worktree order.
  const stableChildren = createStableOrder({
    compute: () => projects.orderedChildWorktrees(repo.id),
    keyOf: (w) => w.path,
    immediate: () => isStaticSortMode(projects.worktreeSort),
  });
  const wtDrag = createDragReorder({
    keys: () => stableChildren.items.map((w) => w.path),
    onCommit: (paths) => void projects.reorderWorktrees(repo.id, paths),
  });

  // Expanded list = the primary (main) worktree first, then the child worktrees.
  const rows = $derived.by(() => {
    const main = projects.mainWorktree(repo.id);
    const childRows = stableChildren.items.map((w) => ({
      ...w,
      repoId: repo.id,
      repoName: repo.name,
    }));
    if (!main) return childRows;
    return [{ ...main, isMain: true, repoId: repo.id, repoName: repo.name }, ...childRows];
  });
  // The dragged worktree's display name, for the floating label.
  const draggedWorktree = $derived(
    wtDrag.draggingKey
      ? stableChildren.items.find((w) => w.path === wtDrag.draggingKey)
      : null,
  );
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
    // Swallow the click that a just-finished drag would otherwise fire.
    if (drag.consumeClick()) return;
    if (isGit) expanded = !isExpanded;
    else projects.setActiveWorktree(repo.path);
  }
</script>

{#snippet projectGlyph()}
  {#if isGit}
    <FolderGitIcon class={cn(icon.nav, "shrink-0 text-muted-foreground")} />
  {:else}
    <FolderIcon class={cn(icon.nav, "shrink-0 text-muted-foreground")} />
  {/if}
{/snippet}

<div class="flex flex-col">
  <!-- Insertion marker for a project-card drop at this position. -->
  {#if drag.isDropAt(index)}
    <div class="mx-2 mb-1 h-0.5 rounded-full bg-primary/70"></div>
  {/if}
  <!-- Project header — left-click expands (git) or selects (folder); press-and-drag
       reorders the card (pointer events; buttons are excluded from the gesture).
       The ⋯ menu (not a right-click menu) owns the project actions. -->
  <div
    data-drag-key={repo.id}
    data-drag-index={index}
    class={cn(
      "group/header flex min-h-9 items-center gap-2 rounded-md px-2 py-1.5 transition-colors",
      projectActive && !isExpanded && surface.active,
      drag.draggingKey === repo.id && "opacity-40",
    )}
    role="button"
    tabindex="0"
    onpointerdown={(e) => drag.pointerDown(e, repo.id)}
    onpointermove={drag.pointerMove}
    onpointerup={drag.pointerUp}
    onclick={onHeaderActivate}
    onkeydown={(e) => (e.key === "Enter" || e.key === " ") && onHeaderActivate()}
  >
    <TooltipSimple title={repo.path}>
      {#snippet children(tp)}
        <EntityIcon {...tp} value={repo.icon} class={cn(icon.nav, "rounded-[4px]")} fallback={projectGlyph} />
      {/snippet}
    </TooltipSimple>
    <TooltipSimple title={repo.name}>
      {#snippet children(tp2)}
        <span {...tp2} class={cn("min-w-0 flex-1 truncate", text.title)}>{repo.name}</span>
      {/snippet}
    </TooltipSimple>
    {#if projects.isProjectPinned(repo.id)}
      <PinIcon class={cn(icon.decorative, "shrink-0 text-muted-foreground/70")} />
    {/if}
    {#if hasUnread}
      <TooltipSimple title={i18n.t("monitor.unread")}>
        {#snippet children(tp2)}
          <span
            {...tp2}
            class="size-2 shrink-0 rounded-full bg-red-500 ring-2 ring-red-500/15"
          ></span>
        {/snippet}
      </TooltipSimple>
    {/if}
    {#if termCount > 0}
      <TooltipSimple title={i18n.t("project.runningTooltip", { n: termCount })}>
        {#snippet children(tp2)}
          <span
            {...tp2}
            class={cn("inline-flex shrink-0 items-center gap-0.5 text-muted-foreground", text.indicator)}
          >
            <TerminalIcon class="size-3" />{termCount}
          </span>
        {/snippet}
      </TooltipSimple>
    {/if}

    <div class="flex shrink-0 items-center gap-0.5">
      {#if isGit}
        <TooltipSimple title={isExpanded ? i18n.t("project.collapse") : i18n.t("project.expand")}>
          {#snippet children(tp)}
            <Button
              {...tp}
              variant="ghost"
              size="icon"
              class={cn(iconButton.xs, hoverReveal)}
              aria-label={isExpanded ? i18n.t("project.collapse") : i18n.t("project.expand")}
              onclick={(e) => {
                e.stopPropagation();
                expanded = !isExpanded;
              }}
            >
              <ChevronRightIcon class={cn(icon.action, "transition-transform", isExpanded && "rotate-90")} />
            </Button>
          {/snippet}
        </TooltipSimple>
      {/if}
      <TooltipSimple title={i18n.t("launcher.open", { name: repo.name })}>
        {#snippet children(tp)}
          <Button
            {...tp}
            variant="ghost"
            size="icon"
            class={cn(iconButton.xs, hoverReveal)}
            onclick={(e) => {
              e.stopPropagation();
              launcherOpen = true;
            }}
          >
            <PlusIcon class={icon.action} />
          </Button>
        {/snippet}
      </TooltipSimple>

      <!-- Project actions (⋯) — replaces the header right-click menu. No terminal
           or agent launch here (that lives on "+"). -->
      <DropdownMenu.Root>
        <DropdownMenu.Trigger>
          {#snippet child({ props })}
            <Button
              variant="ghost"
              size="icon"
              class={cn(iconButton.xs, hoverReveal, "data-[state=open]:opacity-100")}
              aria-label={i18n.t("project.menu")}
              onclick={(e: MouseEvent) => e.stopPropagation()}
              {...props}
            >
              <EllipsisIcon class={icon.action} />
            </Button>
          {/snippet}
        </DropdownMenu.Trigger>
        <DropdownMenu.Content align="end" class="min-w-52">
          <DropdownMenu.Item class={text.menu} onclick={() => projects.toggleProjectPin(repo.id)}>
            {#if projects.isProjectPinned(repo.id)}
              <PinOffIcon class={icon.button} />
              {i18n.t("common.unpin")}
            {:else}
              <PinIcon class={icon.button} />
              {i18n.t("common.pin")}
            {/if}
          </DropdownMenu.Item>
          <DropdownMenu.Separator />
          <DropdownMenu.Item class={text.menu} onclick={() => (settingsOpen = true)}>
            <SettingsIcon class={icon.button} />
            {i18n.t("project.settings")}
          </DropdownMenu.Item>
          <DropdownMenu.Item class={text.menu} onclick={() => (iconPickerOpen = true)}>
            <ImageIcon class={icon.button} />
            {i18n.t("project.changeIcon")}
          </DropdownMenu.Item>

          <DropdownMenu.Separator />

          <DropdownMenu.Item class={text.menu} onclick={() => void revealPath(mainPath)}>
            <FolderOpenIcon class={icon.button} />
            {i18n.t("ctx.reveal")}
          </DropdownMenu.Item>
          <DropdownMenu.Item class={text.menu} onclick={() => clipboardWrite(mainPath)}>
            <CopyIcon class={icon.button} />
            {i18n.t("common.copyPath")}
          </DropdownMenu.Item>
          <OpenWith menu={DropdownMenu} path={mainPath} />
          <DropdownMenu.Sub>
            <DropdownMenu.SubTrigger class={text.menu}>
              <SettingsIcon class={icon.button} />
              {i18n.t("ctx.configure")}
            </DropdownMenu.SubTrigger>
            <DropdownMenu.SubContent>
              <DropdownMenu.Item class={text.menu} onclick={() => app.openSettings("agents")}>
                <BotIcon class={icon.button} />
                {i18n.t("agent.configure")}
              </DropdownMenu.Item>
              <DropdownMenu.Item class={text.menu} onclick={() => app.openSettings("terminal")}>
                <TerminalIcon class={icon.button} />
                {i18n.t("ctx.configureTerminals")}
              </DropdownMenu.Item>
            </DropdownMenu.SubContent>
          </DropdownMenu.Sub>

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

  {#if isGit}
    {#if isExpanded}
      {@const hasMain = !!projects.mainWorktree(repo.id)}
      <div class="flex flex-col pl-2">
        {#each rows as row, i (row.path)}
          <WorktreeRow
            {row}
            drag={row.isMain ? undefined : wtDrag}
            dragIndex={row.isMain ? undefined : i - (hasMain ? 1 : 0)}
            onRemoveProject={row.isMain ? () => (confirmRemoveOpen = true) : undefined}
          />
        {/each}
        <!-- Insertion marker for a worktree drop appended after the last one. -->
        {#if wtDrag.isDropAt(stableChildren.items.length)}
          <div class="ml-6 mr-2 h-0.5 rounded-full bg-primary/70"></div>
        {/if}
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
<ProjectSettingsDialog {repo} bind:open={settingsOpen} />
<IconPicker
  bind:open={iconPickerOpen}
  title={i18n.t("projectSettings.iconTitle")}
  current={repo.icon}
  repoId={isGit ? repo.id : undefined}
  fallback={projectGlyph}
  onselect={(value) => void projects.updateProject(repo.id, { icon: value })}
/>
<ConfirmDialog
  bind:open={confirmRemoveOpen}
  title={i18n.t("project.removeTitle")}
  description={i18n.t("project.removeDesc", { name: repo.name })}
  confirmLabel={i18n.t("common.remove")}
  danger
  onconfirm={() => projects.removeProject(repo.id)}
/>

<!-- Floating label that follows the pointer while dragging a worktree row. -->
{#if wtDrag.active && draggedWorktree}
  <div
    class="pointer-events-none fixed z-50 max-w-48 truncate rounded-md border border-border bg-popover px-2 py-1 text-xs font-medium text-popover-foreground shadow-md"
    style="left: {wtDrag.x + 12}px; top: {wtDrag.y + 8}px;"
  >
    {draggedWorktree.branch ?? draggedWorktree.path}
  </div>
{/if}
