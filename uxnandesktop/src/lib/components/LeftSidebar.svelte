<script lang="ts">
  import { app } from "$lib/state/app.svelte";
  import { projects } from "$lib/state/projects.svelte";
  import { resourceMode } from "$lib/state/resourceMode.svelte";
  import { Button } from "$lib/components/ui/button";
  import * as DropdownMenu from "$lib/components/ui/dropdown-menu";
  import ProjectCard from "./ProjectCard.svelte";
  import WorktreeRow from "./WorktreeRow.svelte";
  import KeyChord from "./KeyChord.svelte";
  import FreshnessHint from "./FreshnessHint.svelte";
  import SidebarProfile from "./SidebarProfile.svelte";
  import BatchCloseDialog from "./BatchCloseDialog.svelte";
  // Aliased: `WorktreeRow` is already the component imported above.
  import type { WorktreeRow as WorktreeRowData } from "$lib/state/projects.svelte";
  import { createStableOrder } from "$lib/state/sidebarOrder.svelte";
  import { createDragReorder } from "$lib/state/dragReorder.svelte";
  import { CLOSABLE_LANE, isStaticSortMode, type AttentionClass } from "$lib/sidebar-sort";
  import type { ReviewGroup } from "$lib/sidebar-review";
  import type { SidebarGroupBy, SortMode } from "$lib/types";
  import { Icon } from "$lib/components/ui/icon";
  import ChevronRightIcon from "@hugeicons/core-free-icons/ChevronRightIcon";
  import { control, divider, field, focus, icon, row, shell, text } from "$lib/design";
  import { cn } from "$lib/utils";
  import { TooltipSimple } from "$lib/components/ui/tooltip";
  import { i18n } from "$lib/i18n";
  import { formatChord, resolveBinding } from "$lib/keybindings";
  import SearchIcon from "@hugeicons/core-free-icons/Search01Icon";
  import FolderPlusIcon from "@hugeicons/core-free-icons/FolderAddIcon";
  import ArrowUpDownIcon from "@hugeicons/core-free-icons/ArrowUpDownIcon";
  import RefreshCwIcon from "@hugeicons/core-free-icons/RefreshIcon";
  import PlusIcon from "@hugeicons/core-free-icons/PlusSignIcon";
  import TerminalIcon from "@hugeicons/core-free-icons/TerminalIcon";

  // The five sort modes offered for each axis (projects and worktrees). "manual"
  // and the two "name" modes don't drift over time; "recent"/"attention" do (they
  // read agent state), so the rendered order is frozen between settle windows.
  const SORT_MODES: { value: SortMode; label: () => string }[] = [
    { value: "manual", label: () => i18n.t("sidebar.sortManual") },
    { value: "name-asc", label: () => i18n.t("sidebar.sortNameAsc") },
    { value: "name-desc", label: () => i18n.t("sidebar.sortNameDesc") },
    { value: "recent", label: () => i18n.t("sidebar.sortRecent") },
    { value: "attention", label: () => i18n.t("sidebar.sortAttention") },
  ];

  // Raw bindings (for the split keycaps via KeyChord) + their formatted strings
  // (for tooltips / presence guards) for the shortcut hints on the quick actions.
  const searchBinding = $derived(resolveBinding("worktreePalette"));
  const addBinding = $derived(resolveBinding("addProject"));
  const addChord = $derived(formatChord(addBinding));

  // Borderless nav button (mirrors the Settings section nav): no chrome until
  // hover, a quiet accent fill when "active".
  const navBase = cn(row.sidebar, focus.ring);
  const navIdle = row.sidebarInactive;

  /** Shell/args for a region-level new terminal (blank command → backend default). */
  function profileLabel(name: string): string {
    return name.trim() || i18n.t("terminal.unnamedProfile");
  }

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

<div class={cn("scrollbar-sleek-parent flex h-full min-h-0 flex-col", shell.sidebar)}>
  <!-- Region: Brand header — app identity; also the window's drag handle (there
       is no title bar). -->
  <div
    data-tauri-drag-region
    class={cn(shell.sidebarBrand, divider.bottom)}
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

  <!-- Region: Quick actions — just Search now; GitHub & Settings moved to the
       profile footer at the bottom. -->
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
  </div>

  <!-- Region: Projects — header (label + actions) and the project tree. -->
  <header class={shell.sidebarSectionHeader}>
    <span class={cn("flex-1 truncate", text.section)}>
      {i18n.t("sidebar.projects")}
      <span class="text-muted-foreground/60">({projects.filteredRepos.length})</span>
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
              control.dense,
              "mr-0.5 inline-flex shrink-0 items-center gap-1 rounded-full bg-orange-500/15 font-medium tabular-nums text-orange-600 transition-colors hover:bg-orange-500/25 dark:text-orange-400",
              focus.ring,
              text.indicator,
            )}
            onclick={() => projects.revealNeedsYou()}
          >
            <span class="size-1.5 rounded-full bg-orange-500"></span>
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
    <TooltipSimple title={`${i18n.t("sidebar.addProject")} (${addChord})`}>
      {#snippet children(props)}
        <Button
          {...props}
          variant="ghost"
          size="icon-xs"
          onclick={() => (projects.pickerOpen = true)}
        >
          <Icon icon={FolderPlusIcon} class={icon.action} />
        </Button>
      {/snippet}
    </TooltipSimple>
    <TooltipSimple title={i18n.t("sidebar.refresh")}>
      {#snippet children(props)}
        <Button
          {...props}
          variant="ghost"
          size="icon-xs"
          onclick={() => void projects.init()}
        >
          <Icon icon={RefreshCwIcon} class={icon.action} />
        </Button>
      {/snippet}
    </TooltipSimple>
    <DropdownMenu.Root>
      <DropdownMenu.Trigger>
        {#snippet child({ props })}
          <TooltipSimple title={i18n.t("sidebar.sort")}>
            {#snippet children(tp)}
              <Button variant="ghost" size="icon-xs" {...tp} {...props}>
                <Icon icon={ArrowUpDownIcon} class={icon.action} />
              </Button>
            {/snippet}
          </TooltipSimple>
        {/snippet}
      </DropdownMenu.Trigger>
      <DropdownMenu.Content width="standard" align="end">
        <DropdownMenu.Label class={text.menuLabel}>{i18n.t("sidebar.view")}</DropdownMenu.Label>
        <DropdownMenu.RadioGroup
          value={projects.groupBy}
          onValueChange={(v) => projects.setGroupBy(v as SidebarGroupBy)}
        >
          <DropdownMenu.RadioItem class={text.menu} value="none">{i18n.t("sidebar.viewTree")}</DropdownMenu.RadioItem>
          <DropdownMenu.RadioItem class={text.menu} value="status">{i18n.t("sidebar.viewStatus")}</DropdownMenu.RadioItem>
          <DropdownMenu.RadioItem class={text.menu} value="review">{i18n.t("sidebar.viewReview")}</DropdownMenu.RadioItem>
        </DropdownMenu.RadioGroup>
        <DropdownMenu.Separator />
        <DropdownMenu.Label class={text.menuLabel}>{i18n.t("sidebar.sortProjects")}</DropdownMenu.Label>
        <DropdownMenu.RadioGroup
          value={projects.projectSort}
          onValueChange={(v) => projects.setProjectSort(v as SortMode)}
        >
          {#each SORT_MODES as m (m.value)}
            <DropdownMenu.RadioItem class={text.menu} value={m.value}>{m.label()}</DropdownMenu.RadioItem>
          {/each}
        </DropdownMenu.RadioGroup>
        <DropdownMenu.Separator />
        <DropdownMenu.Label class={text.menuLabel}>{i18n.t("sidebar.sortWorktrees")}</DropdownMenu.Label>
        <DropdownMenu.RadioGroup
          value={projects.worktreeSort}
          onValueChange={(v) => projects.setWorktreeSort(v as SortMode)}
        >
          {#each SORT_MODES as m (m.value)}
            <DropdownMenu.RadioItem class={text.menu} value={m.value}>{m.label()}</DropdownMenu.RadioItem>
          {/each}
        </DropdownMenu.RadioGroup>
      </DropdownMenu.Content>
    </DropdownMenu.Root>
    <!-- New terminal (moved here from the center pane). Click for the default
         shell; the menu also offers each configured profile. -->
    <DropdownMenu.Root>
      <DropdownMenu.Trigger>
        {#snippet child({ props })}
          <TooltipSimple title={i18n.t("terminal.newTerminal")}>
            {#snippet children(tp)}
              <Button variant="ghost" size="icon-xs" {...tp} {...props}>
                <Icon icon={PlusIcon} class={icon.action} />
              </Button>
            {/snippet}
          </TooltipSimple>
        {/snippet}
      </DropdownMenu.Trigger>
      <DropdownMenu.Content width="standard" align="end">
        <DropdownMenu.Item class={text.menu} onclick={() => app.openTerminal()}>
          <Icon icon={TerminalIcon} class={icon.button} />
          {i18n.t("terminal.newDefault")}
        </DropdownMenu.Item>
        {#if app.terminalProfiles.length > 0}
          <DropdownMenu.Separator />
          <DropdownMenu.Label class={text.menuLabel}>{i18n.t("terminal.chooseProfile")}</DropdownMenu.Label>
          {#each app.terminalProfiles as p (p.id)}
            <DropdownMenu.Item class={text.menu} onclick={() => app.openTerminal({ profileId: p.id })}>
              <Icon icon={TerminalIcon} class={icon.button} />
              {profileLabel(p.name)}
            </DropdownMenu.Item>
          {/each}
        {/if}
      </DropdownMenu.Content>
    </DropdownMenu.Root>
  </header>

  <!-- Project rows: either the project → worktree tree, or (group by status) every
       worktree flattened into attention lanes. -->
  <div class="scrollbar-sleek worktree-sidebar-scrollbar min-h-0 flex-1 overflow-y-auto px-2.5 pb-2.5 pt-1">
    {#snippet emptyState()}
      <div class="flex flex-col items-center gap-2 px-2 py-6 text-center">
        <p class="text-xs text-muted-foreground">
          {projects.query ? i18n.t("sidebar.noMatch") : i18n.t("sidebar.empty")}
        </p>
        {#if !projects.query}
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

    {#if projects.filteredRepos.length === 0}
      {@render emptyState()}
    {:else if projects.groupBy === "status"}
      {@const lanes = projects.statusGroups()}
      {#if lanes.length === 0}
        {@render emptyState()}
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
                          "text-muted-foreground opacity-0 transition-opacity hover:bg-accent/60 hover:text-foreground focus-visible:opacity-100 group-hover/lane:opacity-100",
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
      {#if lanes.length === 0}
        {@render emptyState()}
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
  </div>

  <!-- Region: Profile footer — avatar + name + description; opens GitHub &
       Settings (moved here from the quick actions) and the profile editor. -->
  <SidebarProfile />
</div>

<BatchCloseDialog bind:open={batchOpen} rows={batchRows} />

<!-- Floating label that follows the pointer while dragging a project card. -->
{#if cardDrag.active && draggedRepo}
  <div
    class="pointer-events-none fixed z-50 max-w-48 truncate rounded-md border border-border bg-popover px-2 py-1 text-xs font-medium text-popover-foreground shadow-md"
    style="left: {cardDrag.x + 12}px; top: {cardDrag.y + 8}px;"
  >
    {draggedRepo.name}
  </div>
{/if}
