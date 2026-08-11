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
  import { github } from "$lib/state/github.svelte";
  import type { GithubSection } from "$lib/state/app.svelte";
  import { terminals } from "$lib/state/terminals.svelte";
  import { samePath } from "$lib/pathid";
  import { clipboardWrite } from "$lib/clipboard";
  import { revealPath } from "$lib/api";
  import { cn } from "$lib/utils";
  import { deferModalOpen } from "$lib/utils/pointerLock";
  import { icon, iconButton, surface, text } from "$lib/design";
  import { TooltipSimple } from "$lib/components/ui/tooltip";
  import { i18n } from "$lib/i18n";
  import ConfirmDialog from "./ConfirmDialog.svelte";
  import WorktreeRow from "./WorktreeRow.svelte";
  import AgentSpace from "./AgentSpace.svelte";
  import AgentAvatar from "./AgentAvatar.svelte";
  import { resolveAgentDisplay } from "$lib/state/agentDisplay";
  import LauncherDialog from "./LauncherDialog.svelte";
  import EntityIcon from "./EntityIcon.svelte";
  import IconPicker from "./IconPicker.svelte";
  import ProjectSettingsDialog from "./ProjectSettingsDialog.svelte";
  import OpenWith from "./OpenWith.svelte";
  import { createStableOrder } from "$lib/state/sidebarOrder.svelte";
  import { createDragReorder, type DragReorder } from "$lib/state/dragReorder.svelte";
  import { isStaticSortMode } from "$lib/sidebar-sort";
  import type { RepoData } from "$lib/types";
  import type { DisplayStatus } from "$lib/state/agentDisplay";
  import { Icon } from "$lib/components/ui/icon";
  import FolderGitIcon from "@hugeicons/core-free-icons/FolderGitTwoIcon";
  import GitBranchIcon from "@hugeicons/core-free-icons/GitBranchIcon";
  import FolderIcon from "@hugeicons/core-free-icons/Folder01Icon";
  import ChevronRightIcon from "@hugeicons/core-free-icons/ChevronRightIcon";
  import PlusIcon from "@hugeicons/core-free-icons/PlusSignIcon";
  import EllipsisIcon from "@hugeicons/core-free-icons/EllipsisIcon";
  import SettingsIcon from "@hugeicons/core-free-icons/Settings01Icon";
  import ImageIcon from "@hugeicons/core-free-icons/Image01Icon";
  import FolderOpenIcon from "@hugeicons/core-free-icons/FolderOpenIcon";
  import CopyIcon from "@hugeicons/core-free-icons/CopyIcon";
  import BotIcon from "@hugeicons/core-free-icons/BotIcon";
  import TerminalIcon from "@hugeicons/core-free-icons/TerminalIcon";
  import GitPullRequestIcon from "@hugeicons/core-free-icons/GitPullRequestIcon";
  import CircleDotIcon from "@hugeicons/core-free-icons/CircleDotIcon";
  import PlayIcon from "@hugeicons/core-free-icons/PlayIcon";
  import Trash2Icon from "@hugeicons/core-free-icons/Delete02Icon";
  import PinIcon from "@hugeicons/core-free-icons/PinIcon";
  import PinOffIcon from "@hugeicons/core-free-icons/PinOffIcon";

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

  const mainPath = $derived(projects.mainWorktree(repo.id)?.path ?? repo.path);

  /** Open the inline GitHub view (center + right panels) scoped to this project —
   *  the shared entry point every menu uses (`github.openSection`), so the card's
   *  ⋯ menu and a worktree row's right-click land in exactly the same place. The
   *  left sidebar and browser panel stay put; a worktree click closes it. */
  function openGithub(section: GithubSection) {
    github.openSection(mainPath, section);
  }

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

  // Agents running anywhere in this project (main + every worktree), deduped by
  // tab id and resolved to their display state. Feeds the collapsed summary: a
  // closed card used to be just a name, with no way to tell it holds eight
  // worktrees and three working agents until you opened it.
  const projectAgents = $derived.by(() => {
    const paths = [repo.path, ...projects.worktreesOf(repo.id).map((w) => w.path)];
    const seen = new Set<string>();
    const out: {
      id: string;
      name: string;
      icon?: string | null;
      status: DisplayStatus;
      stale: boolean;
    }[] = [];
    for (const key of terminals.openWorkspaceKeys) {
      if (!paths.some((p) => samePath(p, key))) continue;
      for (const t of terminals.agentTabs(key)) {
        if (seen.has(t.id)) continue;
        seen.add(t.id);
        const d = resolveAgentDisplay(t);
        out.push({
          id: t.id,
          name: t.agentName ?? t.title,
          icon: t.agentIcon,
          status: d?.status ?? "idle",
          stale: d?.stale ?? false,
        });
      }
    }
    return out;
  });
  const worktreeCount = $derived(projects.worktreesOf(repo.id).length);
  /** Avatars shown in the collapsed strip before overflowing into a "+N". */
  const MAX_AVATARS = 3;

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
  // Expansion is persisted (`projects.setProjectExpanded`), so the panel comes
  // back exactly as you left it. A live search still force-expands every card so
  // matching worktrees are visible, without touching what's stored.
  const isExpanded = $derived(
    projects.isProjectExpanded(repo.id) || projects.query.trim().length > 0,
  );
  /** The collapsed summary only earns its line when there's real signal: a lone
   *  worktree with no agents keeps the card a single row. */
  const showCollapsedSummary = $derived(
    isGit && !isExpanded && (projectAgents.length > 0 || worktreeCount > 1),
  );

  const hoverReveal = "opacity-0 group-hover/header:opacity-100";

  function onHeaderActivate() {
    // Swallow the click that a just-finished drag would otherwise fire.
    if (drag.consumeClick()) return;
    if (isGit) projects.setProjectExpanded(repo.id, !isExpanded);
    else projects.setActiveWorktree(repo.path);
  }
</script>

{#snippet projectGlyph()}
  {#if isGit}
    <Icon icon={FolderGitIcon} class={cn(icon.nav, "shrink-0 text-muted-foreground")} />
  {:else}
    <Icon icon={FolderIcon} class={cn(icon.nav, "shrink-0 text-muted-foreground")} />
  {/if}
{/snippet}

<div class="flex flex-col">
  <!-- Insertion marker for a project-card drop at this position. -->
  {#if drag.isDropAt(index)}
    <div class="mx-2 mb-1 h-0.5 rounded-full bg-primary/70"></div>
  {/if}
  <!-- The header AND its collapsed summary sit inside ONE surface, so the
       selection fill/ring wraps both. With the fill on the header alone the
       summary hung outside the highlighted block and read as if it belonged to
       whatever came next. Same rule the worktree rows follow with their agents. -->
  <div
    class={cn(
      "flex flex-col rounded-md transition-colors",
      projectActive && !isExpanded && surface.active,
    )}
  >
  <!-- Project header — left-click expands (git) or selects (folder); press-and-drag
       reorders the card (pointer events; buttons are excluded from the gesture).
       The ⋯ menu (not a right-click menu) owns the project actions. -->
  <div
    data-drag-key={repo.id}
    data-drag-index={index}
    class={cn(
      "group/header flex min-h-9 items-center gap-2 rounded-md px-2 py-1.5 transition-colors",
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
      <Icon icon={PinIcon} class={cn(icon.decorative, "shrink-0 text-muted-foreground/70")} />
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
            <Icon icon={TerminalIcon} class="size-3" />{termCount}
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
                projects.setProjectExpanded(repo.id, !isExpanded);
              }}
            >
              <Icon icon={ChevronRightIcon} class={cn(icon.action, "transition-transform", isExpanded && "rotate-90")} />
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
            <Icon icon={PlusIcon} class={icon.action} />
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
              <Icon icon={EllipsisIcon} class={icon.action} />
            </Button>
          {/snippet}
        </DropdownMenu.Trigger>
        <DropdownMenu.Content width="standard" align="end">
          <DropdownMenu.Item class={text.menu} onclick={() => projects.toggleProjectPin(repo.id)}>
            {#if projects.isProjectPinned(repo.id)}
              <Icon icon={PinOffIcon} class={icon.button} />
              {i18n.t("common.unpin")}
            {:else}
              <Icon icon={PinIcon} class={icon.button} />
              {i18n.t("common.pin")}
            {/if}
          </DropdownMenu.Item>
          <DropdownMenu.Separator />
          <!-- Defer each dialog open until this menu has fully closed, so its
               teardown releases the body pointer-lock before the dialog captures
               it (else the dialog can orphan the lock on close). -->
          <DropdownMenu.Item class={text.menu} onclick={() => deferModalOpen(() => (settingsOpen = true))}>
            <Icon icon={SettingsIcon} class={icon.button} />
            {i18n.t("project.settings")}
          </DropdownMenu.Item>
          <DropdownMenu.Item class={text.menu} onclick={() => deferModalOpen(() => (iconPickerOpen = true))}>
            <Icon icon={ImageIcon} class={icon.button} />
            {i18n.t("project.changeIcon")}
          </DropdownMenu.Item>

          <DropdownMenu.Separator />

          <DropdownMenu.Item class={text.menu} onclick={() => void revealPath(mainPath)}>
            <Icon icon={FolderOpenIcon} class={icon.button} />
            {i18n.t("ctx.reveal")}
          </DropdownMenu.Item>
          <DropdownMenu.Item class={text.menu} onclick={() => clipboardWrite(mainPath)}>
            <Icon icon={CopyIcon} class={icon.button} />
            {i18n.t("common.copyPath")}
          </DropdownMenu.Item>
          <OpenWith menu={DropdownMenu} path={mainPath} />
          <DropdownMenu.Sub>
            <DropdownMenu.SubTrigger class={text.menu}>
              <Icon icon={SettingsIcon} class={icon.button} />
              {i18n.t("ctx.configure")}
            </DropdownMenu.SubTrigger>
            <DropdownMenu.SubContent width="standard">
              <DropdownMenu.Item class={text.menu} onclick={() => app.openSettings("agents")}>
                <Icon icon={BotIcon} class={icon.button} />
                {i18n.t("agent.configure")}
              </DropdownMenu.Item>
              <DropdownMenu.Item class={text.menu} onclick={() => app.openSettings("terminal")}>
                <Icon icon={TerminalIcon} class={icon.button} />
                {i18n.t("ctx.configureTerminals")}
              </DropdownMenu.Item>
            </DropdownMenu.SubContent>
          </DropdownMenu.Sub>

          {#if isGit}
            <!-- GitHub for this project: opens the inline view (center + right
                 panels) on the chosen pane, scoped to this repo. -->
            <DropdownMenu.Sub>
              <DropdownMenu.SubTrigger class={text.menu}>
                <Icon icon={GitPullRequestIcon} class={icon.button} />
                {i18n.t("github.title")}
              </DropdownMenu.SubTrigger>
              <DropdownMenu.SubContent width="standard">
                <DropdownMenu.Item class={text.menu} onclick={() => openGithub("pulls")}>
                  <Icon icon={GitPullRequestIcon} class={icon.button} />
                  {i18n.t("github.nav.pulls")}
                </DropdownMenu.Item>
                <DropdownMenu.Item class={text.menu} onclick={() => openGithub("issues")}>
                  <Icon icon={CircleDotIcon} class={icon.button} />
                  {i18n.t("github.nav.issues")}
                </DropdownMenu.Item>
                <DropdownMenu.Item class={text.menu} onclick={() => openGithub("actions")}>
                  <Icon icon={PlayIcon} class={icon.button} />
                  {i18n.t("github.nav.actions")}
                </DropdownMenu.Item>
              </DropdownMenu.SubContent>
            </DropdownMenu.Sub>
          {/if}

          <DropdownMenu.Separator />

          <DropdownMenu.Item
            variant="destructive"
            class={text.menu}
            onclick={() => deferModalOpen(() => (confirmRemoveOpen = true))}
          >
            <Icon icon={Trash2Icon} class={icon.button} />
            {i18n.t("project.removeProject")}
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Root>
    </div>
  </div>

  <!-- Collapsed summary — what the card holds, without opening it: how many
       worktrees, and who is working inside them. Aligned under the title (not the
       icon) and purely informational: a click falls through to the header and
       expands the card, which is what you want anyway.
       No negative margin: the avatars make this line ~19px tall (the status ring
       is drawn outside the circle), and clawing back the header's padding is how
       they end up crowding the project title. -->
  {#if showCollapsedSummary}
    <div class="flex min-h-5 items-center gap-2 pb-1.5 pl-8 pr-2">
      <TooltipSimple
        title={i18n.t(
          worktreeCount === 1 ? "project.worktreeOne" : "project.worktreeOther",
          { n: worktreeCount },
        )}
      >
        {#snippet children(tp)}
          <span
            {...tp}
            class={cn(
              "inline-flex shrink-0 items-center gap-0.5 text-muted-foreground/70",
              text.indicator,
            )}
          >
            <Icon icon={GitBranchIcon} class="size-3" />{worktreeCount}
          </span>
        {/snippet}
      </TooltipSimple>
      {#if projectAgents.length > 0}
        <!-- No `overflow-hidden`: each avatar's status ring is a box-shadow drawn
             outside the circle and would be clipped. Overflow is bounded by the
             "+N" cap instead. -->
        <div class="flex min-w-0 items-center gap-1">
          {#each projectAgents.slice(0, MAX_AVATARS) as a (a.id)}
            <TooltipSimple title={`${a.name} · ${i18n.t(`monitor.${a.status}`)}`}>
              {#snippet children(tp)}
                <span {...tp} class="inline-flex">
                  <AgentAvatar logo={a.icon} status={a.status} stale={a.stale} size="sm" />
                </span>
              {/snippet}
            </TooltipSimple>
          {/each}
          {#if projectAgents.length > MAX_AVATARS}
            <span class={cn("shrink-0 tabular-nums text-muted-foreground/70", text.indicator)}>
              +{projectAgents.length - MAX_AVATARS}
            </span>
          {/if}
        </div>
      {/if}
    </div>
  {/if}
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
