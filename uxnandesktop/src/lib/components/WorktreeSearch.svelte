<script lang="ts">
  // Quick worktree switcher (a command-palette). Opens with Ctrl/Cmd+P or the
  // sidebar's quick-switch button; type to filter every worktree across projects,
  // ↑/↓ to move, Enter to jump. Selecting activates that worktree (same as
  // clicking it in the tree).
  import * as Dialog from "$lib/components/ui/dialog";
  import { projects } from "$lib/state/projects.svelte";
  import { cn } from "$lib/utils";
  import { focus, icon, overlay, row as rowStyle, text } from "$lib/design";
  import { i18n } from "$lib/i18n";
  import VirtualList from "./VirtualList.svelte";
  import DialogHints from "./DialogHints.svelte";
  import { Icon } from "$lib/components/ui/icon";
  import SearchIcon from "@hugeicons/core-free-icons/Search01Icon";
  import GitBranchIcon from "@hugeicons/core-free-icons/GitBranchIcon";

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
    activeIdx = items.length === 0 ? -1 : Math.min(activeIdx, items.length - 1);
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
      if (items.length > 0) activeIdx = Math.min(items.length - 1, Math.max(0, activeIdx + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (items.length > 0) activeIdx = Math.max(0, activeIdx - 1);
    } else if (e.key === "Enter") {
      e.preventDefault();
      choose(activeIdx);
    }
  }
</script>

<Dialog.Root bind:open={projects.paletteOpen}>
  <Dialog.Content size="palette" composition="sectioned" class="overflow-hidden">
    <Dialog.Title class="sr-only">{i18n.t("palette.title")}</Dialog.Title>
    <Dialog.Description class="sr-only">{i18n.t("palette.placeholder")}</Dialog.Description>

    <!-- Search: the field is the focal point — a roomy input row over a hairline. -->
    <div class="flex items-center gap-3 border-b border-border/60 px-4 py-3.5">
      <Icon icon={SearchIcon} class={cn(icon.button, "shrink-0 text-muted-foreground")} />
      <input
        bind:this={inputEl}
        bind:value={query}
        {onkeydown}
        placeholder={i18n.t("palette.placeholder")}
        class="min-w-0 flex-1 bg-transparent text-[15px] leading-6 outline-none placeholder:text-muted-foreground/60 {focus.ring}"
        autocomplete="off"
        spellcheck="false"
        role="combobox"
        aria-controls="worktree-search-results"
        aria-expanded={projects.paletteOpen}
        aria-activedescendant={activeIdx >= 0 ? `worktree-search-result-${activeIdx}` : undefined}
      />
      {#if items.length > 0}
        <span class={cn("shrink-0 tabular-nums text-muted-foreground/60", text.indicator)}>
          {i18n.plural(items.length, "palette.countOne", "palette.countOther")}
        </span>
      {/if}
    </div>

    <!-- Listing: two-line rows (branch over its path) with a soft leading glyph
         chip and the repo as a trailing tag, so each result reads at a glance. -->
    <div id="worktree-search-results" role="listbox" aria-label={i18n.t("palette.title")}>
    {#if items.length === 0}
      <div class="flex flex-col items-center gap-2.5 px-4 py-12 text-center">
        <Icon icon={SearchIcon} class="size-6 text-muted-foreground/40" />
        <p class={text.meta}>{i18n.t("palette.empty")}</p>
      </div>
    {:else}
        <VirtualList {items} estimateSize={52} activeIndex={activeIdx} class={cn(overlay.paletteViewport, "p-2")}>
          {#snippet row(w, i)}
          <button
            class={cn(
              rowStyle.searchResult,
              focus.ring,
              i === activeIdx ? "bg-accent" : "hover:bg-accent/50",
            )}
            id={`worktree-search-result-${i}`}
            role="option"
            aria-selected={i === activeIdx}
            onmouseenter={() => (activeIdx = i)}
            onclick={() => choose(i)}
          >
            <span
              class="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted/60 text-muted-foreground"
            >
              <Icon icon={GitBranchIcon} class={icon.button} />
            </span>
            <span class="flex min-w-0 flex-1 flex-col gap-0.5">
              <span class={cn("truncate font-medium", text.body)}>
                {w.branch || i18n.t("worktree.detached")}
              </span>
              <span class={cn("truncate", text.meta)}>{w.path}</span>
            </span>
            <span
              class={cn(
                "shrink-0 rounded-md bg-muted px-2 py-0.5 font-medium text-muted-foreground",
                text.indicator,
              )}
            >
              {w.repoName}
            </span>
          </button>
          {/snippet}
        </VirtualList>
    {/if}
    </div>

    <DialogHints class="border-t border-border/60 bg-muted/30 px-4 py-2.5" />
  </Dialog.Content>
</Dialog.Root>
