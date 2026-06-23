<script lang="ts">
  import { app } from "$lib/state/app.svelte";
  import { projects } from "$lib/state/projects.svelte";
  import { Button } from "$lib/components/ui/button";
  import * as DropdownMenu from "$lib/components/ui/dropdown-menu";
  import ProjectCard from "./ProjectCard.svelte";
  import Kbd from "./Kbd.svelte";
  import { icon, text } from "$lib/design";
  import { cn } from "$lib/utils";
  import { i18n } from "$lib/i18n";
  import { formatChord, resolveBinding } from "$lib/keybindings";
  import SearchIcon from "@lucide/svelte/icons/search";
  import SettingsIcon from "@lucide/svelte/icons/settings";
  import FolderPlusIcon from "@lucide/svelte/icons/folder-plus";
  import ArrowUpDownIcon from "@lucide/svelte/icons/arrow-up-down";
  import RefreshCwIcon from "@lucide/svelte/icons/refresh-cw";

  type Sort = "manual" | "name-asc" | "name-desc";
  let sort = $state<Sort>("manual");

  // Display chords for the shortcut hints on the big actions.
  const searchChord = $derived(formatChord(resolveBinding("worktreePalette")));
  const addChord = $derived(formatChord(resolveBinding("addProject")));
  const settingsChord = $derived(formatChord(resolveBinding("openSettings")));

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

<div class="flex h-full min-h-0 flex-col">
  <!-- Search = a full-width button that opens the palette; Settings below it. -->
  <div class="flex shrink-0 flex-col gap-2 border-b border-sidebar-border p-2">
    <Button
      variant="outline"
      class="h-8 w-full justify-start gap-2 px-2.5 font-normal text-muted-foreground"
      title={i18n.t("sidebar.search")}
      onclick={() => (projects.paletteOpen = true)}
    >
      <SearchIcon data-icon="inline-start" class="text-muted-foreground" />
      <span class={cn("flex-1 truncate text-left", text.body)}>{i18n.t("sidebar.search")}</span>
      {#if searchChord}
        <Kbd>{searchChord}</Kbd>
      {/if}
    </Button>
    <Button
      variant="outline"
      class="h-8 w-full justify-start gap-2 px-2.5 font-normal text-muted-foreground"
      title={i18n.t("settings.title")}
      onclick={() => (app.settingsOpen = true)}
    >
      <SettingsIcon data-icon="inline-start" class="text-muted-foreground" />
      <span class={cn("flex-1 truncate text-left", text.body)}>{i18n.t("settings.title")}</span>
      {#if settingsChord}
        <Kbd>{settingsChord}</Kbd>
      {/if}
    </Button>
  </div>

  <!-- Header -->
  <header class="flex h-8 shrink-0 items-center gap-1 px-2">
    <span class={cn("flex-1", text.section)}>
      {i18n.t("sidebar.projects")}
      <span class="text-muted-foreground/60">({projects.filteredRepos.length})</span>
    </span>
    <Button
      variant="ghost"
      size="icon"
      class="size-6"
      title={`${i18n.t("sidebar.addProject")} (${addChord})`}
      onclick={() => (projects.pickerOpen = true)}
    >
      <FolderPlusIcon class={icon.button} />
    </Button>
    <Button
      variant="ghost"
      size="icon"
      class="size-6"
      title={i18n.t("sidebar.refresh")}
      onclick={() => void projects.init()}
    >
      <RefreshCwIcon class={icon.button} />
    </Button>
    <DropdownMenu.Root>
      <DropdownMenu.Trigger>
        {#snippet child({ props })}
          <Button variant="ghost" size="icon" class="size-6" title={i18n.t("sidebar.sort")} {...props}>
            <ArrowUpDownIcon class={icon.button} />
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
  </header>

  <!-- Project tree: each project is selectable (= its main worktree) and
       expands to show its non-main worktrees as sub-rows. -->
  <div class="uxnan-scroll min-h-0 flex-1 overflow-y-auto px-2 pb-2 pt-1">
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
      <div class="flex flex-col gap-1.5">
        {#each sortedRepos as repo (repo.id)}
          <ProjectCard {repo} />
        {/each}
      </div>
    {/if}
  </div>
</div>
