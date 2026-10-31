<script lang="ts">
  import SidebarBridgeRow from "./SidebarBridgeRow.svelte";
  import BridgeDialog from "./BridgeDialog.svelte";
  import { bridgePanel } from "$lib/bridge/bridgePanel.svelte";
  import { app } from "$lib/state/app.svelte";
  import { projects } from "$lib/state/projects.svelte";
  import { resourceMode } from "$lib/state/resourceMode.svelte";
  import { Button } from "$lib/components/ui/button";
  import ProjectCard from "./ProjectCard.svelte";
  import WorktreeRow from "./WorktreeRow.svelte";
  import KeyChord from "./KeyChord.svelte";
  import FreshnessHint from "./FreshnessHint.svelte";
  import SidebarProfile from "./SidebarProfile.svelte";
  import SidebarOptionsMenu from "./SidebarOptionsMenu.svelte";
  import BatchCloseDialog from "./BatchCloseDialog.svelte";
  // Aliased: `WorktreeRow` is already the component imported above.
  import type { WorktreeRow as WorktreeRowData } from "$lib/state/projects.svelte";
  import { createStableOrder } from "$lib/state/sidebarOrder.svelte";
  import { createDragReorder } from "$lib/state/dragReorder.svelte";
  import { CLOSABLE_LANE, isStaticSortMode, type AttentionClass } from "$lib/sidebar-sort";
  import { sidebarEmptyState, type SidebarEmptyState } from "$lib/sidebar-visibility";
  import type { ReviewGroup } from "$lib/sidebar-review";
  import { Icon } from "$lib/components/ui/icon";
  import ChevronRightIcon from "@hugeicons/core-free-icons/ChevronRightIcon";
  import { field, focus, icon, row, shell, text } from "$lib/design";
  import { cn } from "$lib/utils";
  import { TooltipSimple } from "$lib/components/ui/tooltip";
  import { i18n } from "$lib/i18n";
  import { formatChord, isMac, resolveBinding } from "$lib/keyboard";
  import SearchIcon from "@hugeicons/core-free-icons/Search01Icon";
  import FolderPlusIcon from "@hugeicons/core-free-icons/FolderAddIcon";
  import ViewIcon from "@hugeicons/core-free-icons/ViewIcon";
  import ViewOffIcon from "@hugeicons/core-free-icons/ViewOffIcon";
  // A bell: this pill is the general notification for the tree, counting both
  // `waiting` and `blocked` worktrees (see `projects.needsYouCount`). Neither
  // state's own glyph would do — half the count is never a question for you.
  import BellIcon from "@hugeicons/core-free-icons/Notification01Icon";

  // Raw bindings (for the split keycaps via KeyChord) + their formatted strings
  // (for tooltips / presence guards) for the shortcut hints on the quick actions.
  const searchBinding = $derived(resolveBinding("worktreePalette"));
  const addBinding = $derived(resolveBinding("addProject"));
  const addChord = $derived(formatChord(addBinding));

  // Borderless nav button (mirrors the Settings section nav): no chrome until
  // hover, a quiet accent fill when "active".
  const navBase = cn(row.sidebar, focus.ring);
  const navIdle = row.sidebarInactive;

  // Load every repo's worktrees once the backend is ready.
  let initialized = false;
  $effect(() => {
    if (app.backend === "ready" && !initialized) {
      initialized = true;
      void projects.init();
    }
  });

  // Agents can create worktrees through Git/CLI, outside the New Worktree
  // dialog. Reconcile those changes while the sidebar is mounted so every
  // project card and both sidebar views stay current without a manual click.
  $effect(() => {
    if (app.backend !== "ready") return;
    const timer = setInterval(() => {
      void projects.refreshWorktrees();
      // …and keep every card's badges honest, not just the active worktree's:
      // both calls pace themselves from the resource-mode policy (see
      // `resourceMode.policy.capabilities`) and the sweep skips a hidden window.
      void projects.sweepStatuses();
    }, 3000);
    // Coming back to the window is the moment the indicators are most likely
    // stale — an agent has been working while we were elsewhere.
    const onFocus = () => projects.requestStatusSweep();
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  });

  // A hidden worktree an agent surfaced stays until you select another one — the
  // store compares against the previous selection, so it must run on every change
  // of an agent's state, not only when the row is drawn.
  $effect(() => projects.syncLingering());

  // The rendered project order — frozen against jumping for the drifting modes
  // (recent/attention) — plus the pointer-drag reorder that feeds "manual".
  const stableRepos = createStableOrder({
    compute: () => projects.sortedRepos(),
    keyOf: (r) => r.id,
    immediate: () => isStaticSortMode(projects.projectSort),
  });
  const cardDrag = createDragReorder({
    keys: () => stableRepos.items.map((r) => r.id),
    onCommit: (ids) => void projects.reorderProjects(ids),
  });
  const draggedRepo = $derived(
    cardDrag.draggingKey
      ? projects.filteredRepos.find((r) => r.id === cardDrag.draggingKey)
      : null,
  );

  // The batch close, driven from the finished lane's header.
  let batchOpen = $state(false);
  let batchRows = $state<WorktreeRowData[]>([]);

  // "Group by status" view: the human label for each attention lane. The collapse
  // state lives in the store (persisted across restarts).
  function reviewLabel(g: ReviewGroup): string {
    switch (g) {
      case "failing":
        return i18n.t("sidebar.review.failing");
      case "in-review":
        return i18n.t("sidebar.review.in-review");
      case "in-progress":
        return i18n.t("sidebar.review.in-progress");
      case "merged":
        return i18n.t("sidebar.review.merged");
      default:
        return i18n.t("sidebar.review.closed");
    }
  }

  /** What the body should say when it has nothing to draw — "nothing here" and
   *  "everything is hidden" are different situations with different ways out
   *  (see `sidebarEmptyState`). `rowCount` is what the flat views would draw. */
  function emptyKind(view: "tree" | "flat", rowCount: number): SidebarEmptyState {
    return sidebarEmptyState({
      view,
      projectCount: app.repos.length,
      matchedProjectCount: projects.filteredRepos.length,
      rowCount,
      query: projects.query,
      hiddenCount: projects.hiddenCount,
      showHidden: projects.showHidden,
    });
  }
  const countRows = (lanes: { items: unknown[] }[]) =>
    lanes.reduce((n, lane) => n + lane.items.length, 0);

  function laneLabel(c: AttentionClass): string {
    switch (c) {
      case 1:
        return i18n.t("sidebar.laneNeedsYou");
      case 2:
        return i18n.t("sidebar.laneDone");
      case 3:
        return i18n.t("sidebar.laneWorking");
      case CLOSABLE_LANE:
        return i18n.t("sidebar.laneReadyToClose");
      default:
        return i18n.t("sidebar.laneIdle");
    }
  }
</script>

<!-- `@container/sidebar`: the panel's own width, not the window's, decides what
     its header and rows can afford (it is resizable from 200px up). -->
<div class={cn("@container/sidebar scrollbar-sleek-parent flex h-full min-h-0 flex-col", shell.sidebar)}>
  <!-- Region: Brand header — app identity; also the window's drag handle (there
       is no title bar). -->
  <div
    data-tauri-drag-region
    class={cn(shell.appBar, shell.sidebarBrand, isMac && shell.macTrafficLightsInset)}
  >
    <img
      src="/logo_nb.svg"
      alt=""
      aria-hidden="true"
      data-tauri-drag-region
      class="block h-5 w-5 dark:hidden"
    />
    <img
      src="/logo_wnb.svg"
      alt=""
      aria-hidden="true"
      data-tauri-drag-region
      class="hidden h-5 w-5 dark:block"
    />
    <span data-tauri-drag-region class="truncate text-sm font-semibold tracking-tight">
      Uxnan Desktop
    </span>
    <TooltipSimple title={i18n.t("titlebar.alphaTooltip")}>
      {#snippet children(props)}
        <span
          {...props}
          class="rounded bg-muted px-1.5 py-px text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
        >
          Alpha
        </span>
      {/snippet}
    </TooltipSimple>
  </div>

  <!-- Region: Quick actions — Search, and the phone (connect one, or the one
       connected); GitHub & Settings live in the profile footer at the bottom. -->
  <div class="flex shrink-0 flex-col gap-px px-2 pb-1 pt-2">
    <TooltipSimple title={i18n.t("sidebar.search")}>
      {#snippet children(props)}
        <button
          {...props}
          class={cn(field.search, focus.ring, "w-full")}
          onclick={() => (projects.paletteOpen = true)}
        >
          <Icon icon={SearchIcon} class={field.searchIcon} />
          <span class={field.searchLabel}>{i18n.t("sidebar.search")}</span>
          {#if searchBinding}
            <KeyChord class={field.searchShortcut} chord={searchBinding} />
          {/if}
        </button>
      {/snippet}
    </TooltipSimple>
    <SidebarBridgeRow />
  </div>

  <!-- Region: Projects — header (label + actions) and the project tree. -->
  <header class={shell.sidebarSectionHeader}>
    <!-- The label yields before it is cut mid-word, by the panel's own width
         (`@container/sidebar`): first the count, which the attention pill beside
         it makes the most expendable thing here, then the whole label, which
         leaves the pill and the buttons — what the header is for at 200px — the
         room. The outer span stays so they keep their place at the right edge. -->
    <span class={cn("min-w-0 flex-1 truncate", text.section)}>
      <span class="@max-[13rem]/sidebar:hidden">
        {i18n.t("sidebar.projects")}
        <span
          class={cn(
            "text-muted-foreground/60",
            projects.needsYouCount > 0
              ? "@max-[15rem]/sidebar:hidden"
              : "@max-[13rem]/sidebar:hidden",
          )}>({projects.filteredRepos.length})</span
        >
      </span>
    </span>
    <!-- Attention pill — the one signal that must escape the tree: an agent
         waiting on you inside a collapsed project is otherwise invisible. Click
         jumps to the status view with the "needs you" lane open. -->
    {#if projects.needsYouCount > 0}
      <TooltipSimple title={i18n.t("sidebar.needsYouTooltip", { n: projects.needsYouCount })}>
        {#snippet children(props)}
          <button
            {...props}
            class={cn(
              shell.sidebarPill,
              "bg-orange-500/15 text-orange-600 hover:bg-orange-500/25 dark:text-orange-400",
              focus.ring,
              text.indicator,
            )}
            onclick={() => projects.revealNeedsYou()}
          >
            <Icon icon={BellIcon} class={icon.decorative} />
            {projects.needsYouCount}
          </button>
        {/snippet}
      </TooltipSimple>
    {/if}
    {#if resourceMode.freshness.git}
      <FreshnessHint
        label={i18n.t("resourceMode.freshness.git")}
        onrefresh={() => projects.refreshNow()}
      />
    {/if}
    <!-- Add a project — the panel's own primary action, so it stays in sight. -->
    <TooltipSimple title={`${i18n.t("sidebar.addProject")} (${addChord})`}>
      {#snippet children(props)}
        <Button
          {...props}
          variant="ghost"
          size="icon-xs"
          aria-label={i18n.t("sidebar.addProject")}
          onclick={() => (projects.pickerOpen = true)}
        >
          <Icon icon={FolderPlusIcon} class={icon.action} />
        </Button>
      {/snippet}
    </TooltipSimple>
    <!-- Everything else — new terminal (and its profiles), view, sorts, hidden
         worktrees, refresh — lives in this one menu; the held-back count rides
         on its button. -->
    <SidebarOptionsMenu />
  </header>

  <!-- Project rows: either the project → worktree tree, or (group by status) every
       worktree flattened into attention lanes. -->
  <div class="scrollbar-sleek worktree-sidebar-scrollbar min-h-0 flex-1 overflow-y-auto px-2.5 pb-2.5 pt-1">
    {#snippet emptyState(kind: SidebarEmptyState)}
      <div class="flex flex-col items-center gap-2 px-2 py-6 text-center">
        {#if kind === "all-hidden"}
          <!-- Not "nothing here": there is plenty, and it is all set aside. -->
          <Icon icon={ViewOffIcon} class={cn(icon.empty, "text-muted-foreground/40")} />
          <p class="text-xs text-muted-foreground">{i18n.t("sidebar.allHidden")}</p>
          <Button variant="outline" size="sm" onclick={() => projects.setShowHidden(true)}>
            <Icon icon={ViewIcon} data-icon="inline-start" />
            {i18n.plural(projects.hiddenCount, "sidebar.showHiddenCountOne", "sidebar.showHiddenCountOther")}
          </Button>
        {:else if kind === "no-match"}
          <p class="text-xs text-muted-foreground">{i18n.t("sidebar.noMatch")}</p>
        {:else if kind === "no-worktrees"}
          <p class="text-xs text-muted-foreground">{i18n.t("sidebar.noWorktrees")}</p>
        {:else}
          <p class="text-xs text-muted-foreground">{i18n.t("sidebar.empty")}</p>
          <Button variant="outline" size="sm" onclick={() => (projects.pickerOpen = true)}>
            <Icon icon={FolderPlusIcon} data-icon="inline-start" />
            {i18n.t("sidebar.addRepo")}
            {#if addBinding}
              <KeyChord class="ml-1" chord={addBinding} />
            {/if}
          </Button>
        {/if}
      </div>
    {/snippet}

    {#if projects.groupBy === "status"}
      {@const lanes = projects.statusGroups()}
      {@const empty = emptyKind("flat", countRows(lanes))}
      {#if empty !== "none"}
        {@render emptyState(empty)}
      {:else}
        <div class="flex flex-col gap-3">
          {#each lanes as lane (lane.attention)}
            <div class="group/lane flex flex-col">
              <!-- Lane header — collapsible; the attention label + a count. The
                   finished lane also carries the batch close, hover-revealed so
                   it never sits next to the lanes that are still working. -->
              <div class="flex items-center gap-1">
                <button
                  class={cn(shell.laneHeader, focus.ring, "transition-colors hover:bg-accent/40")}
                  onclick={() => projects.toggleLane(lane.attention)}
                >
                  <Icon icon={ChevronRightIcon}
                    class={cn(icon.status, "shrink-0 text-muted-foreground/70 transition-transform", !projects.isLaneCollapsed(lane.attention) && "rotate-90")}
                  />
                  <span class={cn("flex-1 truncate", text.section)}>{laneLabel(lane.attention)}</span>
                  <span class="text-xs tabular-nums text-muted-foreground/60">{lane.items.length}</span>
                </button>
                {#if lane.attention === CLOSABLE_LANE}
                  <TooltipSimple title={i18n.t("sidebar.closeLane")}>
                    {#snippet children(props)}
                      <button
                        {...props}
                        class={cn(
                          shell.laneAction,
                          focus.ring,
                          "text-muted-foreground opacity-0 transition-opacity hover:bg-accent/60 hover:text-foreground focus-visible:opacity-100 group-hover-lane:opacity-100",
                          text.indicator,
                        )}
                        onclick={() => {
                          batchRows = lane.items;
                          batchOpen = true;
                        }}
                      >
                        {i18n.t("sidebar.closeLane")}
                      </button>
                    {/snippet}
                  </TooltipSimple>
                {/if}
              </div>
              {#if !projects.isLaneCollapsed(lane.attention)}
                <div class="flex flex-col">
                  {#each lane.items as row (row.path)}
                    <WorktreeRow {row} showRepo />
                  {/each}
                </div>
              {/if}
            </div>
          {/each}
        </div>
      {/if}
    {:else if projects.groupBy === "review"}
      <!-- "How far along is this" — the third question, once there are enough
           workspaces that "who needs me" and "what belongs to what" both leave
           a branch waiting on a reviewer unaccounted for. -->
      {@const lanes = projects.reviewGroups()}
      {@const empty = emptyKind("flat", countRows(lanes))}
      {#if empty !== "none"}
        {@render emptyState(empty)}
      {:else}
        <div class="flex flex-col gap-3">
          {#each lanes as lane (lane.group)}
            <div class="flex flex-col">
              <button
                class={cn(shell.laneHeader, focus.ring, "w-full transition-colors hover:bg-accent/40")}
                onclick={() => projects.toggleReviewLane(lane.group)}
              >
                <Icon icon={ChevronRightIcon}
                  class={cn(
                    icon.status,
                    "shrink-0 text-muted-foreground/70 transition-transform",
                    !projects.isReviewLaneCollapsed(lane.group) && "rotate-90",
                  )}
                />
                <span class={cn("flex-1 truncate", text.section)}>{reviewLabel(lane.group)}</span>
                <span class="text-xs tabular-nums text-muted-foreground/60">{lane.items.length}</span>
              </button>
              {#if !projects.isReviewLaneCollapsed(lane.group)}
                <div class="flex flex-col">
                  {#each lane.items as row (row.path)}
                    <WorktreeRow {row} showRepo />
                  {/each}
                </div>
              {/if}
            </div>
          {/each}
        </div>
      {/if}
    {:else}
      {@const empty = emptyKind("tree", 0)}
      {#if empty !== "none"}
        {@render emptyState(empty)}
      {:else}
        <div class="flex flex-col gap-2">
          {#each stableRepos.items as repo, i (repo.id)}
            <ProjectCard {repo} index={i} drag={cardDrag} />
          {/each}
          <!-- Insertion marker for a drop appended at the very end. -->
          {#if cardDrag.isDropAt(stableRepos.items.length)}
            <div class="mx-2 h-0.5 rounded-full bg-primary/70"></div>
          {/if}
        </div>
      {/if}
    {/if}
  </div>

  <!-- Region: Profile footer — avatar + name + description; opens GitHub &
       Settings (moved here from the quick actions) and the profile editor. -->
  <SidebarProfile />
</div>

<BatchCloseDialog bind:open={batchOpen} rows={batchRows} />
<!-- The Bridge window: one for the whole app (see bridgePanel). -->
<BridgeDialog bind:open={bridgePanel.open} />

<!-- Floating label that follows the pointer while dragging a project card. -->
{#if cardDrag.active && draggedRepo}
  <div
    class="pointer-events-none fixed z-50 max-w-48 truncate rounded-md border border-border bg-popover px-2 py-1 text-xs font-medium text-popover-foreground shadow-md"
    style="left: {cardDrag.x + 12}px; top: {cardDrag.y + 8}px;"
  >
    {draggedRepo.name}
  </div>
{/if}
