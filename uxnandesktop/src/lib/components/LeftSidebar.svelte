<script lang="ts">
  import { app } from "$lib/state/app.svelte";
  import { projects } from "$lib/state/projects.svelte";
  import { Button } from "$lib/components/ui/button";
  import * as DropdownMenu from "$lib/components/ui/dropdown-menu";
  import ProjectCard from "./ProjectCard.svelte";
  import Kbd from "./Kbd.svelte";
  import { icon, iconButton, text } from "$lib/design";
  import { cn } from "$lib/utils";
  import { i18n } from "$lib/i18n";
  import { formatChord, resolveBinding } from "$lib/keybindings";
  import SearchIcon from "@lucide/svelte/icons/search";
  import SettingsIcon from "@lucide/svelte/icons/settings";
  import FolderPlusIcon from "@lucide/svelte/icons/folder-plus";
  import ArrowUpDownIcon from "@lucide/svelte/icons/arrow-up-down";
  import RefreshCwIcon from "@lucide/svelte/icons/refresh-cw";
  import PlusIcon from "@lucide/svelte/icons/plus";
  import TerminalIcon from "@lucide/svelte/icons/terminal";

  type Sort = "manual" | "name-asc" | "name-desc";
  let sort = $state<Sort>("manual");

  // Display chords for the shortcut hints on the quick actions.
  const searchChord = $derived(formatChord(resolveBinding("worktreePalette")));
  const addChord = $derived(formatChord(resolveBinding("addProject")));
  const settingsChord = $derived(formatChord(resolveBinding("openSettings")));

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

  const sortedRepos = $derived.by(() => {
    const repos = [...projects.filteredRepos];
    if (sort === "name-asc") repos.sort((a, b) => a.name.localeCompare(b.name));
    else if (sort === "name-desc")
      repos.sort((a, b) => b.name.localeCompare(a.name));
    return repos;
  });
</script>

<div class="scrollbar-sleek-parent flex h-full min-h-0 flex-col">
  <!-- Region: Brand header — app identity; also the window's drag handle (there
       is no title bar). -->
  <div
    data-tauri-drag-region
    class="flex h-9 shrink-0 select-none items-center gap-2 border-b px-3"
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
    <span
      class="rounded bg-muted px-1.5 py-px text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
      title={i18n.t("titlebar.alphaTooltip")}
    >
      Alpha
    </span>
  </div>

  <!-- Region: Quick actions — borderless nav buttons (search + settings). -->
  <div class="flex shrink-0 flex-col gap-0.5 px-2 pb-1">
    <button
      class={cn(navBase, navIdle)}
      title={i18n.t("sidebar.search")}
      onclick={() => (projects.paletteOpen = true)}
    >
      <SearchIcon class={icon.button} />
      <span class="flex-1 truncate text-left">{i18n.t("sidebar.search")}</span>
      {#if searchChord}
        <Kbd>{searchChord}</Kbd>
      {/if}
    </button>
    <button
      class={cn(navBase, app.settingsOpen ? navActive : navIdle)}
      title={i18n.t("settings.title")}
      onclick={() => (app.settingsOpen = true)}
    >
      <SettingsIcon class={icon.button} />
      <span class="flex-1 truncate text-left">{i18n.t("settings.title")}</span>
      {#if settingsChord}
        <Kbd>{settingsChord}</Kbd>
      {/if}
    </button>
  </div>

  <!-- Region: Projects — header (label + actions) and the project tree. -->
  <header class="flex h-8 shrink-0 items-center gap-0.5 px-2.5">
    <span class={cn("flex-1 truncate", text.section)}>
      {i18n.t("sidebar.projects")}
      <span class="text-muted-foreground/60">({projects.filteredRepos.length})</span>
    </span>
    <Button
      variant="ghost"
      size="icon"
      class={iconButton.xs}
      title={`${i18n.t("sidebar.addProject")} (${addChord})`}
      onclick={() => (projects.pickerOpen = true)}
    >
      <FolderPlusIcon class={icon.action} />
    </Button>
    <Button
      variant="ghost"
      size="icon"
      class={iconButton.xs}
      title={i18n.t("sidebar.refresh")}
      onclick={() => void projects.init()}
    >
      <RefreshCwIcon class={icon.action} />
    </Button>
    <DropdownMenu.Root>
      <DropdownMenu.Trigger>
        {#snippet child({ props })}
          <Button variant="ghost" size="icon" class={iconButton.xs} title={i18n.t("sidebar.sort")} {...props}>
            <ArrowUpDownIcon class={icon.action} />
          </Button>
        {/snippet}
      </DropdownMenu.Trigger>
      <DropdownMenu.Content align="end" class="min-w-44">
        <DropdownMenu.Label class={text.menuLabel}>{i18n.t("sidebar.sortBy")}</DropdownMenu.Label>
        <DropdownMenu.RadioGroup bind:value={sort}>
          <DropdownMenu.RadioItem class={text.menu} value="manual">{i18n.t("sidebar.sortManual")}</DropdownMenu.RadioItem>
          <DropdownMenu.RadioItem class={text.menu} value="name-asc">{i18n.t("sidebar.sortNameAsc")}</DropdownMenu.RadioItem>
          <DropdownMenu.RadioItem class={text.menu} value="name-desc">{i18n.t("sidebar.sortNameDesc")}</DropdownMenu.RadioItem>
        </DropdownMenu.RadioGroup>
      </DropdownMenu.Content>
    </DropdownMenu.Root>
    <!-- New terminal (moved here from the center pane). Click for the default
         shell; the menu also offers each configured profile. -->
    <DropdownMenu.Root>
      <DropdownMenu.Trigger>
        {#snippet child({ props })}
          <Button variant="ghost" size="icon" class={iconButton.xs} title={i18n.t("terminal.newTerminal")} {...props}>
            <PlusIcon class={icon.action} />
          </Button>
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

  <!-- Project tree: each project is selectable (= its main worktree) and
       expands to show its non-main worktrees as sub-rows. -->
  <div class="scrollbar-sleek worktree-sidebar-scrollbar min-h-0 flex-1 overflow-y-auto px-2.5 pb-2.5 pt-1">
    {#if sortedRepos.length === 0}
      <div class="flex flex-col items-center gap-2 px-2 py-6 text-center">
        <p class="text-xs text-muted-foreground">
          {projects.query ? i18n.t("sidebar.noMatch") : i18n.t("sidebar.empty")}
        </p>
        {#if !projects.query}
          <Button variant="outline" size="sm" onclick={() => (projects.pickerOpen = true)}>
            <FolderPlusIcon data-icon="inline-start" />
            {i18n.t("sidebar.addRepo")}
            {#if addChord}
              <Kbd class="ml-1">{addChord}</Kbd>
            {/if}
          </Button>
        {/if}
      </div>
    {:else}
      <div class="flex flex-col gap-2">
        {#each sortedRepos as repo (repo.id)}
          <ProjectCard {repo} />
        {/each}
      </div>
    {/if}
  </div>
</div>
