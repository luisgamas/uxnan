<script lang="ts">
  // One worktree row — used for both the primary (main) worktree and each child.
  // Leading: an aggregate agent-status dot (or the branch icon when idle).
  // Title: the branch name + git status. Second line: the worktree folder name.
  // Left-click opens (and links) the worktree, spawning a default-profile
  // terminal if the workspace has none yet. Right-click opens a rich context
  // menu (terminals · agents · reveal · configure · remove) — the row no longer
  // carries a persistent overflow button.
  import * as ContextMenu from "$lib/components/ui/context-menu";
  import { projects, type WorktreeRow } from "$lib/state/projects.svelte";
  import { unread } from "$lib/state/unread.svelte";
  import { github } from "$lib/state/github.svelte";
  import { terminals } from "$lib/state/terminals.svelte";
  import { resolveAgentDisplay } from "$lib/state/agentDisplay";
  import { cn } from "$lib/utils";
  import { icon, surface, text } from "$lib/design";
  import { TooltipSimple } from "$lib/components/ui/tooltip";
  import { i18n } from "$lib/i18n";
  import AgentSpace from "./AgentSpace.svelte";
  import AgentStatusDot from "./AgentStatusDot.svelte";
  import RowActionsMenu from "./RowActionsMenu.svelte";
  import EntityIcon from "./EntityIcon.svelte";
  import IconPicker from "./IconPicker.svelte";
  import ConfirmDialog from "./ConfirmDialog.svelte";
  import RemoveWorktreeDialog from "./RemoveWorktreeDialog.svelte";
  import type { DragReorder } from "$lib/state/dragReorder.svelte";
  import GitBranchIcon from "@lucide/svelte/icons/git-branch";
  import GitPullRequestIcon from "@lucide/svelte/icons/git-pull-request";
  import MoonIcon from "@lucide/svelte/icons/moon";
  import PinIcon from "@lucide/svelte/icons/pin";
  import TerminalIcon from "@lucide/svelte/icons/terminal";

  let {
    row,
    onRemoveProject,
    drag,
    dragIndex,
    showRepo = false,
  }: {
    row: WorktreeRow;
    /** Main worktree only: "remove" removes the whole project (the card owns it). */
    onRemoveProject?: () => void;
    /** Reorder controller for child worktrees; undefined for the main worktree
     *  (which always renders first and isn't reorderable). */
    drag?: DragReorder;
    /** This child's index among the reorderable worktrees (for the drop marker). */
    dragIndex?: number;
    /** In the "group by status" view, show the owning project as the meta line
     *  (rows there are flattened out of their project, so the branch alone is
     *  ambiguous). */
    showRepo?: boolean;
  } = $props();

  const active = $derived(projects.activeWorktreePath === row.path);
  const label = $derived(row.branch ?? i18n.t("worktree.detached"));
  // The cached GitHub PR for this worktree's branch (for the sidebar-card badge),
  // colored by its CI checks. Cheap: read from the store's per-path cache.
  const prBadge = $derived(github.contextFor(row.path)?.pr ?? null);
  const status = $derived(projects.status(row.path));
  const hasUnread = $derived(unread.has(row.path));
  const dirName = $derived(
    row.path.replace(/\\/g, "/").replace(/\/+$/, "").split("/").pop() ?? row.path,
  );
  // In the status view the project name is the useful context (rows are flattened
  // out of their project tree); otherwise the worktree's folder name.
  const meta = $derived(showRepo ? row.repoName : dirName);

  // Tooltip: the full absolute path in the tree, but a short **relative** path in
  // the flattened status view (relative to the project root, else the folder
  // name) — the absolute path there was long enough to overflow the tooltip.
  const shortLocation = $derived.by(() => {
    const norm = (p: string) => p.replace(/\\/g, "/").replace(/\/+$/, "");
    const p = norm(row.path);
    const base = norm(projects.repoPath(row.repoId) ?? "");
    if (base && p.startsWith(base + "/")) return p.slice(base.length + 1);
    return p.split("/").pop() ?? p;
  });
  const tipText = $derived(showRepo ? shortLocation : row.path);

  // Live-space indicator: how many terminals this worktree's workspace holds
  // (0 hides the chip — an empty space needs no marker), and whether the whole
  // workspace is asleep (dimmed moon variant).
  const termCount = $derived(terminals.terminalCount(row.path));
  const wsAsleep = $derived(terminals.isWorkspaceAsleep(row.path));

  // Sleep with a working agent inside requires an explicit confirm; the dialog
  // opens a macrotask after the menu closes (the menu→dialog body-lock race).
  let sleepConfirmOpen = $state(false);
  let sleepAgents = $state<string[]>([]);
  function requestSleep() {
    const blockers = terminals.sleepBlockers(row.path);
    if (blockers.length === 0) {
      void terminals.sleepWorkspace(row.path);
      return;
    }
    sleepAgents = blockers;
    setTimeout(() => (sleepConfirmOpen = true), 0);
  }

  // Aggregate agent status for the leading dot: a working agent wins, else the
  // first one; null when the worktree has no agents (show the branch icon).
  const agentStatus = $derived.by(() => {
    const ds = terminals
      .agentTabs(row.path)
      .map((t) => resolveAgentDisplay(t))
      .filter((d): d is NonNullable<typeof d> => d != null);
    return ds.find((d) => d.status === "working") ?? ds[0] ?? null;
  });

  // Left-click / Enter: select + link the worktree, and open a default-profile
  // terminal only when the workspace has none (so repeated clicks don't stack
  // duplicate terminals).
  function activate() {
    // Swallow the click a just-finished drag would otherwise fire.
    if (drag?.consumeClick()) return;
    projects.setActiveWorktree(row.path);
    if (terminals.terminalCount(row.path) === 0) projects.openTerminalAt(row.path);
  }

  // The stable per-branch icon key (branch name, or path when detached) + the
  // custom icon stored for it (undefined → the default branch glyph).
  const iconKey = $derived(projects.branchIconKey(row));
  const branchIcon = $derived(projects.branchIcon(row.repoId, iconKey));

  let iconPickerOpen = $state(false);
  let removeOpen = $state(false);

  function openRemove() {
    removeOpen = true;
  }
</script>

{#snippet branchGlyph()}
  <GitBranchIcon class={cn(icon.decorative, "text-muted-foreground")} />
{/snippet}

<!-- The whole worktree block — its row AND its agents — sits inside one surface:
     when the worktree is selected the selection fill/ring wraps everything, so the
     agents read as living in that worktree's space (not floating below it). -->
<div class={cn("flex flex-col rounded-md", active && surface.active)}>
  <!-- Insertion marker for a worktree-reorder drop at this position. -->
  {#if drag && dragIndex != null && drag.isDropAt(dragIndex)}
    <div class="ml-4 mr-2 mb-0.5 h-0.5 rounded-full bg-primary/70"></div>
  {/if}
  <ContextMenu.Root>
    <ContextMenu.Trigger>
      {#snippet child({ props })}
        <TooltipSimple title={tipText}>
          {#snippet children(tp)}
            <div
              {...tp}
              {...props}
              data-drag-key={drag ? row.path : undefined}
              data-drag-index={drag ? dragIndex : undefined}
              class={cn(
                "group flex items-center gap-2 rounded-md py-1 pl-2 pr-2 transition-colors",
                !active && "hover:bg-foreground/[0.05]",
                drag?.draggingKey === row.path && "opacity-40",
              )}
              role="button"
              tabindex="0"
              onpointerdown={(e) => drag?.pointerDown(e, row.path)}
              onpointermove={drag ? drag.pointerMove : undefined}
              onpointerup={drag ? drag.pointerUp : undefined}
              onclick={activate}
              onkeydown={(e) => (e.key === "Enter" || e.key === " ") && activate()}
            >
              <span class="flex size-4 shrink-0 items-center justify-center">
                {#if agentStatus}
                  <AgentStatusDot status={agentStatus.status} stale={agentStatus.stale} />
                {:else}
                  <EntityIcon value={branchIcon} class={cn(icon.decorative, "rounded-[3px]")} fallback={branchGlyph} />
                {/if}
              </span>
              <div class="min-w-0 flex-1">
                <div class="flex items-center gap-1.5">
                  <span class={cn("truncate", text.body, active && "font-medium")}>{label}</span>
                  {#if !row.isMain && projects.isWorktreePinned(row.path)}
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
                    <TooltipSimple
                      title={wsAsleep
                        ? i18n.t("worktree.asleepTooltip", { n: termCount })
                        : i18n.t("worktree.runningTooltip", { n: termCount })}
                    >
                      {#snippet children(tp2)}
                        <span
                          {...tp2}
                          class={cn(
                            "inline-flex shrink-0 items-center gap-0.5",
                            wsAsleep ? "text-muted-foreground/50" : "text-muted-foreground",
                            text.indicator,
                          )}
                        >
                          {#if wsAsleep}<MoonIcon class="size-3" />{:else}<TerminalIcon class="size-3" />{/if}{termCount}
                        </span>
                      {/snippet}
                    </TooltipSimple>
                  {/if}
                  {#if status && status.dirty > 0}
                    <TooltipSimple title={i18n.t("worktree.dirtyTooltip", { n: status.dirty })}>
                      {#snippet children(tp2)}
                        <span
                          {...tp2}
                          class={cn("inline-flex shrink-0 items-center gap-0.5 text-amber-600 dark:text-amber-400", text.indicator)}
                        >
                          <span class="size-1.5 rounded-full bg-amber-500"></span>{status.dirty}
                        </span>
                      {/snippet}
                    </TooltipSimple>
                  {/if}
                  {#if status && status.ahead > 0}
                    <TooltipSimple title={i18n.t("worktree.aheadTooltip")}>
                      {#snippet children(tp2)}
                        <span {...tp2} class={cn("shrink-0 text-muted-foreground", text.indicator)}>↑{status.ahead}</span>
                      {/snippet}
                    </TooltipSimple>
                  {/if}
                  {#if status && status.behind > 0}
                    <TooltipSimple title={i18n.t("worktree.behindTooltip")}>
                      {#snippet children(tp2)}
                        <span {...tp2} class={cn("shrink-0 text-muted-foreground", text.indicator)}>↓{status.behind}</span>
                      {/snippet}
                    </TooltipSimple>
                  {/if}
                  {#if prBadge}
                    <TooltipSimple title={i18n.t("github.panel.openPr", { n: prBadge.number })}>
                      {#snippet children(tp2)}
                        <span
                          {...tp2}
                          class={cn(
                            "shrink-0",
                            prBadge.checks.state === "success"
                              ? "text-emerald-500"
                              : prBadge.checks.state === "failure"
                                ? "text-red-500"
                                : prBadge.checks.state === "pending"
                                  ? "text-amber-500"
                                  : prBadge.isDraft
                                    ? "text-muted-foreground"
                                    : "text-emerald-500",
                          )}
                        >
                          <GitPullRequestIcon class="size-3" />
                        </span>
                      {/snippet}
                    </TooltipSimple>
                  {/if}
            </div>
            <div class={cn("truncate", text.meta)}>{meta}</div>
          </div>
        </div>
      {/snippet}
    </TooltipSimple>
  {/snippet}
    </ContextMenu.Trigger>

    <RowActionsMenu
      path={row.path}
      removeLabel={row.isMain ? i18n.t("project.removeProject") : i18n.t("worktree.removeWorktree")}
      onRemove={row.isMain ? onRemoveProject : openRemove}
      onChangeIcon={() => (iconPickerOpen = true)}
      onTogglePin={row.isMain ? undefined : () => projects.toggleWorktreePin(row.path)}
      onSleep={requestSleep}
      pinned={projects.isWorktreePinned(row.path)}
    />
  </ContextMenu.Root>

  <div class="pl-6 pr-1 pb-1">
    <AgentSpace path={row.path} />
  </div>
</div>

<ConfirmDialog
  bind:open={sleepConfirmOpen}
  danger
  title={i18n.t("workspace.sleepBlockedTitle")}
  description={i18n.t("workspace.sleepBlockedDesc", { agents: sleepAgents.join(", ") })}
  confirmLabel={i18n.t("workspace.sleepAnyway")}
  onconfirm={async () => {
    await terminals.sleepWorkspace(row.path);
    return true;
  }}
/>

<RemoveWorktreeDialog bind:open={removeOpen} {row} />

<IconPicker
  bind:open={iconPickerOpen}
  title={i18n.t("worktree.branchIconTitle")}
  current={branchIcon}
  fallback={branchGlyph}
  onselect={(value) => void projects.setBranchIcon(row.repoId, iconKey, value)}
/>
