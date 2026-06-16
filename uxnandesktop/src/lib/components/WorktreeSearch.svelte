<script lang="ts">
  // Quick worktree switcher (a command-palette). Opens with Ctrl/Cmd+P or the
  // sidebar's quick-switch button; type to filter every worktree across projects,
  // ↑/↓ to move, Enter to jump. Selecting activates that worktree (same as
  // clicking it in the tree).
  import * as Dialog from "$lib/components/ui/dialog";
  import { projects } from "$lib/state/projects.svelte";
  import { cn } from "$lib/utils";
  import { icon, text } from "$lib/design";
  import { i18n } from "$lib/i18n";
  import VirtualList from "./VirtualList.svelte";
  import SearchIcon from "@lucide/svelte/icons/search";
  import GitBranchIcon from "@lucide/svelte/icons/git-branch";

  let query = $state("");
  let activeIdx = $state(0);
  let inputEl = $state<HTMLInputElement>();

  const items = $derived.by(() => {
    const all = projects.allWorktrees();
    const q = query.trim().toLowerCase();
    if (!q) return all;
    return all.filter(
      (w) =>
        w.repoName.toLowerCase().includes(q) ||
        w.branch.toLowerCase().includes(q) ||
        w.path.toLowerCase().includes(q),
    );
  });

  // Reset + focus when the palette opens.
  $effect(() => {
    if (projects.paletteOpen) {
      query = "";
      activeIdx = 0;
      queueMicrotask(() => inputEl?.focus());
    }
  });

  // Keep the highlight within range as the filtered list changes.
  $effect(() => {
    if (activeIdx >= items.length) activeIdx = Math.max(0, items.length - 1);
  });

  function choose(i: number) {
    const w = items[i];
    if (!w) return;
    projects.setActiveWorktree(w.path);
    projects.paletteOpen = false;
  }

  function onkeydown(e: KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      activeIdx = Math.min(items.length - 1, activeIdx + 1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      activeIdx = Math.max(0, activeIdx - 1);
    } else if (e.key === "Enter") {
      e.preventDefault();
      choose(activeIdx);
    }
  }
</script>

<Dialog.Root bind:open={projects.paletteOpen}>
  <Dialog.Content class="gap-0 overflow-hidden p-0 sm:max-w-lg">
    <div class="flex items-center gap-2 border-b border-border px-3 py-2">
      <SearchIcon class={cn(icon.button, "shrink-0 text-muted-foreground")} />
      <input
        bind:this={inputEl}
        bind:value={query}
        {onkeydown}
        placeholder={i18n.t("palette.placeholder")}
        class="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
        autocomplete="off"
        spellcheck="false"
      />
    </div>
    {#if items.length === 0}
      <p class={cn("px-2 py-3 text-center", text.meta)}>{i18n.t("palette.empty")}</p>
    {:else}
      <VirtualList {items} estimateSize={34} activeIndex={activeIdx} class="max-h-80 p-1">
        {#snippet row(w, i)}
          <button
            class={cn(
              "flex h-[34px] w-full items-center gap-2 rounded-md px-2 text-left",
              i === activeIdx ? "bg-accent" : "hover:bg-accent/50",
            )}
            onmouseenter={() => (activeIdx = i)}
            onclick={() => choose(i)}
          >
            <GitBranchIcon class={cn(icon.decorative, "shrink-0 text-muted-foreground")} />
            <span class={cn("shrink-0 font-medium", text.body)}>
              {w.branch || i18n.t("worktree.detached")}
            </span>
            <span class={cn("min-w-0 flex-1 truncate", text.meta)}>{w.path}</span>
            <span class={cn("shrink-0 text-muted-foreground/70", text.indicator)}>{w.repoName}</span>
          </button>
        {/snippet}
      </VirtualList>
    {/if}
  </Dialog.Content>
</Dialog.Root>
