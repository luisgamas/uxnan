<script lang="ts">
  // One worktree row — used for both the primary (main) worktree and each child.
  // Leading: an aggregate agent-status indicator (or the branch icon when idle).
  // Title: the branch name + git status. Second line: the worktree folder name.
  // Left-click opens (and links) the worktree, spawning a default-profile
  // terminal if the workspace has none yet. Right-click opens a rich context
  // menu (terminals · agents · reveal · configure · remove) — the row no longer
  // carries a persistent overflow button.
  import * as ContextMenu from "$lib/components/ui/context-menu";
  import * as HoverCard from "$lib/components/ui/hover-card";
  import { projects, type WorktreeRow } from "$lib/state/projects.svelte";
  import { unread } from "$lib/state/unread.svelte";
  import { github } from "$lib/state/github.svelte";
  import { terminals } from "$lib/state/terminals.svelte";
  import { resolveAgentDisplay, resolveAgentView } from "$lib/state/agentDisplay";
  // Aliased: this component already binds `agentStatus` to its own aggregate.
  import { agentStatus as agentReports } from "$lib/state/agentStatus.svelte";
  import { clock, relTime } from "$lib/time.svelte";
  import { cn } from "$lib/utils";
  import { focus, icon, row as rowStyle, surface, text } from "$lib/design";
  import { TooltipSimple } from "$lib/components/ui/tooltip";
  import { i18n } from "$lib/i18n";
  import AgentSpace from "./AgentSpace.svelte";
  import AgentLogo from "./AgentLogo.svelte";
  import AgentStatusIndicator from "./AgentStatusIndicator.svelte";
  import RowActionsMenu from "./RowActionsMenu.svelte";
  import EntityIcon from "./EntityIcon.svelte";
  import IconPicker from "./IconPicker.svelte";
  import ConfirmDialog from "./ConfirmDialog.svelte";
  import RemoveWorktreeDialog from "./RemoveWorktreeDialog.svelte";
  import WorktreeNoteDialog from "./WorktreeNoteDialog.svelte";
  import type { DragReorder } from "$lib/state/dragReorder.svelte";
  import { Icon } from "$lib/components/ui/icon";
  import CircleCheckIcon from "@hugeicons/core-free-icons/CircleCheckIcon";
  import CircleSlashIcon from "@hugeicons/core-free-icons/CancelCircleIcon";
  import GitBranchIcon from "@hugeicons/core-free-icons/GitBranchIcon";
  import GitPullRequestIcon from "@hugeicons/core-free-icons/GitPullRequestIcon";
  // Unread is one signal drawn one way: keep this glyph and `ProjectCard`'s in
  // step — a project row and a worktree row report the same thing.
  import MessageNotificationIcon from "@hugeicons/core-free-icons/MessageNotification01Icon";
  import MoonIcon from "@hugeicons/core-free-icons/MoonIcon";
  import PinIcon from "@hugeicons/core-free-icons/PinIcon";
  import TerminalIcon from "@hugeicons/core-free-icons/TerminalIcon";

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
  // Is this space finished? `done`/`abandoned` earn a chip and a quieter row —
  // the work is over, so it should stop competing with what is still in flight.
  // `inert` deliberately gets nothing: "quiet" is not "over".
  const completion = $derived(projects.completion(row));
  const note = $derived(projects.note(row.path));
  const doneLabel = $derived(
    prBadge?.state?.trim().toUpperCase() === "MERGED"
      ? i18n.t("worktree.doneMerged")
      : i18n.t("worktree.doneIntegrated"),
  );
  const dirName = $derived(
    row.path.replace(/\\/g, "/").replace(/\/+$/, "").split("/").pop() ?? row.path,
  );
  // Second line, in priority order:
  //   1. the status view flattens rows out of their project, so the project name
  //      is the context that's missing there;
  //   2. else the linked PR's title — the folder name is usually just the branch
  //      name with the slashes swapped ("feat/login" → "feat-login"), so it spent
  //      a whole line repeating the line above it; the PR title says what the
  //      branch is actually *for*;
  //   3. else the folder name, which does carry information when it differs.
  // The line always renders, so rows keep a uniform height in the list.
  const meta = $derived(
    showRepo ? row.repoName : (prBadge?.title?.trim() || dirName),
  );

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

  const agentTabs = $derived(terminals.agentTabs(row.path));

  // Aggregate agent status for the leading indicator: a working agent wins, else
  // the first one; null when the worktree has no agents (show the branch icon).
  const agentStatus = $derived.by(() => {
    const ds = agentTabs
      .map((t) => resolveAgentDisplay(t))
      .filter((d): d is NonNullable<typeof d> => d != null);
    return ds.find((d) => d.status === "working") ?? ds[0] ?? null;
  });

  // "When did this last move" — the freshest agent report in the workspace, shown
  // at the end of the second line. It's what turns a static list of branches into
  // something you can triage at a glance; the first line is already crowded, so it
  // lives beside the meta text rather than among the badges.
  const lastActivity = $derived.by(() => {
    let newest = 0;
    for (const t of agentTabs) {
      const at = agentReports.get(t.id)?.lastUpdate ?? 0;
      if (at > newest) newest = at;
    }
    return newest || null;
  });
  const lastActivityText = $derived(
    lastActivity ? relTime(lastActivity, clock.now) : "",
  );

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
  let noteOpen = $state(false);
  let removeOpen = $state(false);

  function openRemove() {
    removeOpen = true;
  }
</script>

{#snippet branchGlyph()}
  <Icon icon={GitBranchIcon} class={cn(icon.decorative, "text-muted-foreground")} />
{/snippet}

<!-- The row's full story, on hover. Everything here already exists in the stores;
     the row itself can only afford a handful of glyphs, so the detail lives one
     hover away instead of costing every row a third line. -->
{#snippet worktreeDetails()}
  <div class="flex flex-col gap-2.5">
    <div class="flex flex-col gap-0.5">
      <div class="flex items-center gap-1.5">
        <Icon icon={GitBranchIcon} class={cn(icon.status, "shrink-0 text-muted-foreground")} />
        <span class={cn("min-w-0 flex-1 truncate", text.bodyStrong)}>{label}</span>
        {#if row.isMain}
          <span
            class={cn(
              "shrink-0 rounded bg-foreground/[0.06] px-1.5 text-foreground/70",
              text.indicator,
            )}
          >
            {i18n.t("worktree.primary")}
          </span>
        {/if}
      </div>
      <span class={cn("break-all font-mono", text.meta)}>{tipText}</span>
    </div>

    <!-- Why this space exists, in the words it was created with. Sits right under
         the identity because it answers the first question an old branch raises. -->
    {#if note}
      <p class={cn("whitespace-pre-wrap break-words", text.body)}>{note}</p>
    {/if}

    {#if status && (status.dirty > 0 || status.ahead > 0 || status.behind > 0)}
      <div class={cn("flex flex-wrap items-center gap-x-2.5 gap-y-1", text.meta)}>
        {#if status.dirty > 0}
          <span class="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400">
            <span class="size-1.5 rounded-full bg-amber-500"></span>
            {i18n.t("worktree.dirtyTooltip", { n: status.dirty })}
          </span>
        {/if}
        {#if status.ahead > 0}<span>↑{status.ahead} {i18n.t("worktree.aheadTooltip")}</span>{/if}
        {#if status.behind > 0}<span>↓{status.behind} {i18n.t("worktree.behindTooltip")}</span>{/if}
      </div>
    {/if}

    {#if prBadge}
      <div class="flex flex-col gap-0.5 border-t border-border/50 pt-2">
        <div class="flex items-center gap-1.5">
          <Icon icon={GitPullRequestIcon}
            class={cn(
              cn(icon.status, "shrink-0"),
              prBadge.checks.state === "failure"
                ? "text-red-500"
                : prBadge.checks.state === "pending"
                  ? "text-amber-500"
                  : prBadge.isDraft
                    ? "text-muted-foreground"
                    : "text-emerald-500",
            )}
          />
          <span class={cn("shrink-0 tabular-nums", text.meta)}>#{prBadge.number}</span>
          {#if prBadge.isDraft}
            <span class={cn("shrink-0 text-muted-foreground", text.indicator)}>
              {i18n.t("github.pr.draft")}
            </span>
          {/if}
        </div>
        <span class={cn("line-clamp-2", text.body)}>{prBadge.title}</span>
      </div>
    {/if}

    {#if agentTabs.length > 0}
      <div class="flex flex-col gap-1 border-t border-border/50 pt-2">
        <span class={text.section}>
          {i18n.t("agents.spaceLabel")}
          <span class="text-muted-foreground/60">({agentTabs.length})</span>
        </span>
        {#each agentTabs as t (t.id)}
          {@const v = resolveAgentView(t, row.path)}
          {#if v}
            <div class="flex items-center gap-1.5">
              <AgentStatusIndicator status={v.status} stale={v.stale} />
              <AgentLogo logo={t.agentIcon} class={cn(icon.brand, "shrink-0")} />
              <span class={cn("min-w-0 flex-1 truncate", text.meta)}>{v.title}</span>
              {#if v.lastUpdate}
                <span class={cn("shrink-0 tabular-nums", text.meta)}>
                  {relTime(v.lastUpdate, clock.now)}
                </span>
              {/if}
            </div>
          {/if}
        {/each}
      </div>
    {/if}
  </div>
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
        <!-- A hover card, not a tooltip: the path alone was never the question a
             worktree row raises. `openDelay` is generous so scanning the list
             doesn't trip it — only resting on a row does. -->
        <HoverCard.Root openDelay={500} closeDelay={120}>
          <HoverCard.Trigger>
            {#snippet child({ props: hoverProps })}
            <div
              {...hoverProps}
              {...props}
              data-drag-key={drag ? row.path : undefined}
              data-drag-index={drag ? dragIndex : undefined}
              class={cn(
                rowStyle.sidebar,
                focus.ring,
                "group",
                !active && "hover:bg-foreground/[0.05]",
                // A finished space steps back so the work still in flight reads
                // first. Full opacity returns on hover and while it's selected —
                // it is quieter, not disabled.
                completion === "done" || completion === "abandoned"
                  ? "opacity-60 hover:opacity-100"
                  : "",
                active && "opacity-100",
                drag?.draggingKey === row.path && "opacity-40",
              )}
              role="button"
              tabindex="0"
              onpointerdown={(e) => drag?.pointerDown(e, row.path)}
              onpointermove={drag ? drag.pointerMove : undefined}
              onpointerup={drag ? drag.pointerUp : undefined}
              onclick={activate}
              onkeydown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  activate();
                }
              }}
            >
              <span class={cn("flex shrink-0 items-center justify-center", icon.decorative)}>
                {#if agentStatus}
                  <AgentStatusIndicator status={agentStatus.status} stale={agentStatus.stale} />
                {:else}
                  <EntityIcon value={branchIcon} class={cn(icon.decorative, "rounded-[3px]")} fallback={branchGlyph} />
                {/if}
              </span>
              <div class="min-w-0 flex-1">
                <div class="flex items-center gap-1.5">
                  <span class={cn("truncate", text.body, active && "font-medium")}>{label}</span>
                  <!-- The verdict, stated once and quietly. Only `done` and
                       `abandoned` earn a chip: they are the two uxnan can defend. -->
                  {#if completion === "done"}
                    <TooltipSimple title={i18n.t("worktree.doneTooltip")}>
                      {#snippet children(tp2)}
                        <span
                          {...tp2}
                          class={cn(
                            "inline-flex shrink-0 items-center gap-0.5 rounded bg-sky-500/10 px-1 text-sky-600 dark:text-sky-400",
                            text.indicator,
                          )}
                        >
                          <Icon icon={CircleCheckIcon} class="size-2.5" />{doneLabel}
                        </span>
                      {/snippet}
                    </TooltipSimple>
                  {:else if completion === "abandoned"}
                    <TooltipSimple title={i18n.t("worktree.abandonedTooltip")}>
                      {#snippet children(tp2)}
                        <span
                          {...tp2}
                          class={cn(
                            "inline-flex shrink-0 items-center gap-0.5 rounded bg-foreground/[0.06] px-1 text-muted-foreground",
                            text.indicator,
                          )}
                        >
                          <Icon icon={CircleSlashIcon} class="size-2.5" />{i18n.t("worktree.abandoned")}
                        </span>
                      {/snippet}
                    </TooltipSimple>
                  {/if}
                  {#if !row.isMain && projects.isWorktreePinned(row.path)}
                    <Icon icon={PinIcon} class={cn(icon.decorative, "shrink-0 text-muted-foreground/70")} />
                  {/if}
                  {#if hasUnread}
                    <TooltipSimple title={i18n.t("monitor.unread")}>
                      {#snippet children(tp2)}
                        <span {...tp2} class="inline-flex shrink-0 text-red-500">
                          <Icon icon={MessageNotificationIcon} class={icon.decorative} />
                        </span>
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
                          {#if wsAsleep}<Icon icon={MoonIcon} class={icon.status} />{:else}<Icon icon={TerminalIcon} class={icon.status} />{/if}{termCount}
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
                        <!-- The number rides with the icon: knowing there *is* a
                             PR was never the useful half — knowing *which* is. -->
                        <span
                          {...tp2}
                          class={cn(
                            "inline-flex shrink-0 items-center gap-0.5 tabular-nums",
                            text.indicator,
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
                          <Icon icon={GitPullRequestIcon} class={icon.status} />{prBadge.number}
                        </span>
                      {/snippet}
                    </TooltipSimple>
                  {/if}
            </div>
            <div class="flex items-baseline gap-1.5">
              <span class={cn("min-w-0 flex-1 truncate", text.meta)}>{meta}</span>
              {#if lastActivityText}
                <TooltipSimple title={i18n.t("worktree.lastActivityTooltip")}>
                  {#snippet children(tp2)}
                    <span {...tp2} class={cn("shrink-0 tabular-nums", text.meta)}>
                      {lastActivityText}
                    </span>
                  {/snippet}
                </TooltipSimple>
              {/if}
            </div>
          </div>
        </div>
            {/snippet}
          </HoverCard.Trigger>
          <HoverCard.Content side="right" align="start" width="form">
            {@render worktreeDetails()}
          </HoverCard.Content>
        </HoverCard.Root>
      {/snippet}
    </ContextMenu.Trigger>

    <RowActionsMenu
      path={row.path}
      repoId={row.repoId}
      removeLabel={row.isMain ? i18n.t("project.removeProject") : i18n.t("worktree.removeWorktree")}
      onRemove={row.isMain ? onRemoveProject : openRemove}
      onChangeIcon={() => (iconPickerOpen = true)}
      onEditNote={() => (noteOpen = true)}
      onTogglePin={row.isMain ? undefined : () => projects.toggleWorktreePin(row.path)}
      onSleep={requestSleep}
      pinned={projects.isWorktreePinned(row.path)}
    />
  </ContextMenu.Root>

  <div class="w-full min-w-0 pl-6 pr-1 pb-1">
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

<WorktreeNoteDialog bind:open={noteOpen} {row} />

<IconPicker
  bind:open={iconPickerOpen}
  title={i18n.t("worktree.branchIconTitle")}
  current={branchIcon}
  fallback={branchGlyph}
  onselect={(value) => void projects.setBranchIcon(row.repoId, iconKey, value)}
/>
