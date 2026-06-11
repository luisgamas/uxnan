<script lang="ts">
  import { app } from "$lib/state/app.svelte";
  import { projects } from "$lib/state/projects.svelte";
  import { Input } from "$lib/components/ui/input";
  import { Button } from "$lib/components/ui/button";
  import * as DropdownMenu from "$lib/components/ui/dropdown-menu";
  import ProjectCard from "./ProjectCard.svelte";
  import DirectoryPicker from "./DirectoryPicker.svelte";
  import { icon, text } from "$lib/design";
  import { cn } from "$lib/utils";
  import SearchIcon from "@lucide/svelte/icons/search";
  import FolderPlusIcon from "@lucide/svelte/icons/folder-plus";
  import ArrowUpDownIcon from "@lucide/svelte/icons/arrow-up-down";
  import RefreshCwIcon from "@lucide/svelte/icons/refresh-cw";

  type Sort = "manual" | "name-asc" | "name-desc";
  let sort = $state<Sort>("manual");

  /** In-app directory picker (replaces the OS-native folder dialog). */
  let pickerOpen = $state(false);

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
  <!-- Search (filters projects and their worktrees) -->
  <div class="shrink-0 border-b border-sidebar-border p-2">
    <div class="relative">
      <SearchIcon
        class={cn(
          icon.button,
          "pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground",
        )}
      />
      <Input
        class="h-8 pl-8 text-xs"
        placeholder="Search projects & worktrees…"
        bind:value={projects.query}
      />
    </div>
  </div>

  {#if projects.error}
    <p class="shrink-0 border-b border-sidebar-border px-3 py-1.5 text-xs text-destructive">
      {projects.error}
    </p>
  {/if}

  <!-- Header -->
  <header class="flex h-8 shrink-0 items-center gap-1 px-2">
    <span class={cn("flex-1", text.section)}>
      Projects
      <span class="text-muted-foreground/60">({projects.filteredRepos.length})</span>
    </span>
    <Button
      variant="ghost"
      size="icon"
      class="size-6"
      title="Add project…"
      onclick={() => (pickerOpen = true)}
    >
      <FolderPlusIcon class={icon.button} />
    </Button>
    <Button
      variant="ghost"
      size="icon"
      class="size-6"
      title="Refresh worktrees & status"
      onclick={() => void projects.init()}
    >
      <RefreshCwIcon class={icon.button} />
    </Button>
    <DropdownMenu.Root>
      <DropdownMenu.Trigger>
        {#snippet child({ props })}
          <Button variant="ghost" size="icon" class="size-6" title="Sort" {...props}>
            <ArrowUpDownIcon class={icon.button} />
          </Button>
        {/snippet}
      </DropdownMenu.Trigger>
      <DropdownMenu.Content align="end">
        <DropdownMenu.Label class={text.menuLabel}>Sort by</DropdownMenu.Label>
        <DropdownMenu.RadioGroup bind:value={sort}>
          <DropdownMenu.RadioItem class={text.menu} value="manual">Added order</DropdownMenu.RadioItem>
          <DropdownMenu.RadioItem class={text.menu} value="name-asc">Name (A–Z)</DropdownMenu.RadioItem>
          <DropdownMenu.RadioItem class={text.menu} value="name-desc">Name (Z–A)</DropdownMenu.RadioItem>
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
          {projects.query ? "No projects match your search." : "No projects yet."}
        </p>
        {#if !projects.query}
          <Button variant="outline" size="sm" onclick={() => (pickerOpen = true)}>
            <FolderPlusIcon data-icon="inline-start" />
            Add a git repository
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

  <DirectoryPicker bind:open={pickerOpen} />
</div>
