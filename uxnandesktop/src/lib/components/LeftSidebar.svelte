<script lang="ts">
  import { app } from "$lib/state/app.svelte";
  import { projects } from "$lib/state/projects.svelte";
  import { Button } from "$lib/components/ui/button";
  import * as DropdownMenu from "$lib/components/ui/dropdown-menu";
  import ProjectCard from "./ProjectCard.svelte";
  import WorktreeRow from "./WorktreeRow.svelte";
  import KeyChord from "./KeyChord.svelte";
  import { createStableOrder } from "$lib/state/sidebarOrder.svelte";
  import { createDragReorder } from "$lib/state/dragReorder.svelte";
  import { isStaticSortMode, type AttentionClass } from "$lib/sidebar-sort";
  import type { SidebarGroupBy, SortMode } from "$lib/types";
  import ChevronRightIcon from "@lucide/svelte/icons/chevron-right";
  import { divider, icon, iconButton, text } from "$lib/design";
  import { cn } from "$lib/utils";
  import { TooltipSimple } from "$lib/components/ui/tooltip";
  import { i18n } from "$lib/i18n";
  import { formatChord, resolveBinding } from "$lib/keybindings";
  import SearchIcon from "@lucide/svelte/icons/search";
  import SettingsIcon from "@lucide/svelte/icons/settings";
  import FolderPlusIcon from "@lucide/svelte/icons/folder-plus";
  import ArrowUpDownIcon from "@lucide/svelte/icons/arrow-up-down";
  import RefreshCwIcon from "@lucide/svelte/icons/refresh-cw";
  import PlusIcon from "@lucide/svelte/icons/plus";
  import TerminalIcon from "@lucide/svelte/icons/terminal";

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
  const settingsBinding = $derived(resolveBinding("openSettings"));
  const addChord = $derived(formatChord(addBinding));

  // Borderless nav button (mirrors the Settings section nav): no chrome until
  // hover, a quiet accent fill when "active".
  const navBase =
    "group flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[13px] font-medium tracking-tight transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50";
  const navIdle = "text-muted-foreground hover:bg-accent/60 hover:text-foreground";
  const navActive = "bg-accent text-accent-foreground";

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

  // "Group by status" view: per-lane collapse state (local to the session) and
  // the human label for each attention lane.
  let collapsedLanes = $state<Record<number, boolean>>({});
  function toggleLane(c: AttentionClass) {
    collapsedLanes = { ...collapsedLanes, [c]: !collapsedLanes[c] };
  }
  function laneLabel(c: AttentionClass): string {
    switch (c) {
      case 1:
        return i18n.t("sidebar.laneNeedsYou");
      case 2:
        return i18n.t("sidebar.laneDone");
      case 3:
        return i18n.t("sidebar.laneWorking");
      default:
        return i18n.t("sidebar.laneIdle");
    }
  }
</script>

<div class="scrollbar-sleek-parent flex h-full min-h-0 flex-col">
  <!-- Region: Brand header — app identity; also the window's drag handle (there
       is no title bar). -->
  <div
    data-tauri-drag-region
    class={cn("flex h-9 shrink-0 select-none items-center gap-2 px-3", divider.bottom)}
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

  <!-- Region: Quick actions — borderless nav buttons (search + settings). -->
  <div class="flex shrink-0 flex-col gap-px px-2 pb-1 pt-2">
    <TooltipSimple title={i18n.t("sidebar.search")}>
      {#snippet children(props)}
        <button
          {...props}
          class={cn(navBase, navIdle)}
          onclick={() => (projects.paletteOpen = true)}
        >
          <SearchIcon class={icon.button} />
          <span class="flex-1 truncate text-left">{i18n.t("sidebar.search")}</span>
          {#if searchBinding}
            <KeyChord chord={searchBinding} />
          {/if}
        </button>
      {/snippet}
    </TooltipSimple>
    <TooltipSimple title={i18n.t("settings.title")}>
      {#snippet children(props)}
        <button
          {...props}
          class={cn(navBase, app.settingsOpen ? navActive : navIdle)}
          onclick={() => (app.settingsOpen = true)}
        >
          <SettingsIcon class={icon.button} />
          <span class="flex-1 truncate text-left">{i18n.t("settings.title")}</span>
          {#if settingsBinding}
            <KeyChord chord={settingsBinding} />
          {/if}
        </button>
      {/snippet}
    </TooltipSimple>
  </div>

  <!-- Region: Projects — header (label + actions) and the project tree. -->
  <header class="flex h-8 shrink-0 items-center gap-0.5 px-2.5">
    <span class={cn("flex-1 truncate", text.section)}>
      {i18n.t("sidebar.projects")}
      <span class="text-muted-foreground/60">({projects.filteredRepos.length})</span>
    </span>
    <TooltipSimple title={`${i18n.t("sidebar.addProject")} (${addChord})`}>
      {#snippet children(props)}
        <Button
          {...props}
          variant="ghost"
          size="icon"
          class={iconButton.xs}
          onclick={() => (projects.pickerOpen = true)}
        >
          <FolderPlusIcon class={icon.action} />
        </Button>
      {/snippet}
    </TooltipSimple>
    <TooltipSimple title={i18n.t("sidebar.refresh")}>
      {#snippet children(props)}
        <Button
          {...props}
          variant="ghost"
          size="icon"
          class={iconButton.xs}
          onclick={() => void projects.init()}
        >
          <RefreshCwIcon class={icon.action} />
        </Button>
      {/snippet}
    </TooltipSimple>
    <DropdownMenu.Root>
      <DropdownMenu.Trigger>
        {#snippet child({ props })}
          <TooltipSimple title={i18n.t("sidebar.sort")}>
            {#snippet children(tp)}
              <Button variant="ghost" size="icon" class={iconButton.xs} {...tp} {...props}>
                <ArrowUpDownIcon class={icon.action} />
              </Button>
            {/snippet}
          </TooltipSimple>
        {/snippet}
      </DropdownMenu.Trigger>
      <DropdownMenu.Content align="end" class="min-w-52">
        <DropdownMenu.Label class={text.menuLabel}>{i18n.t("sidebar.view")}</DropdownMenu.Label>
        <DropdownMenu.RadioGroup
          value={projects.groupBy}
          onValueChange={(v) => projects.setGroupBy(v as SidebarGroupBy)}
        >
          <DropdownMenu.RadioItem class={text.menu} value="none">{i18n.t("sidebar.viewTree")}</DropdownMenu.RadioItem>
          <DropdownMenu.RadioItem class={text.menu} value="status">{i18n.t("sidebar.viewStatus")}</DropdownMenu.RadioItem>
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
              <Button variant="ghost" size="icon" class={iconButton.xs} {...tp} {...props}>
                <PlusIcon class={icon.action} />
              </Button>
            {/snippet}
          </TooltipSimple>
        {/snippet}
      </DropdownMenu.Trigger>
      <DropdownMenu.Content align="end" class="min-w-48">
        <DropdownMenu.Item class={text.menu} onclick={() => app.openTerminal()}>
          <TerminalIcon class={icon.button} />
          {i18n.t("terminal.newDefault")}
        </DropdownMenu.Item>
        {#if app.terminalProfiles.length > 0}
          <DropdownMenu.Separator />
          <DropdownMenu.Label class={text.menuLabel}>{i18n.t("terminal.chooseProfile")}</DropdownMenu.Label>
          {#each app.terminalProfiles as p (p.id)}
            <DropdownMenu.Item class={text.menu} onclick={() => app.openTerminal({ profileId: p.id })}>
              <TerminalIcon class={icon.button} />
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
            <FolderPlusIcon data-icon="inline-start" />
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
            <div class="flex flex-col">
              <!-- Lane header — collapsible; the attention label + a count. -->
              <button
                class="flex w-full items-center gap-1 rounded px-1 py-1 text-left transition-colors hover:bg-accent/40"
                onclick={() => toggleLane(lane.attention)}
              >
                <ChevronRightIcon
                  class={cn("size-3 shrink-0 text-muted-foreground/70 transition-transform", !collapsedLanes[lane.attention] && "rotate-90")}
                />
                <span class={cn("flex-1 truncate", text.section)}>{laneLabel(lane.attention)}</span>
                <span class="text-xs tabular-nums text-muted-foreground/60">{lane.items.length}</span>
              </button>
              {#if !collapsedLanes[lane.attention]}
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
</div>

<!-- Floating label that follows the pointer while dragging a project card. -->
{#if cardDrag.active && draggedRepo}
  <div
    class="pointer-events-none fixed z-50 max-w-48 truncate rounded-md border border-border bg-popover px-2 py-1 text-xs font-medium text-popover-foreground shadow-md"
    style="left: {cardDrag.x + 12}px; top: {cardDrag.y + 8}px;"
  >
    {draggedRepo.name}
  </div>
{/if}
