<script lang="ts">
  import * as Dialog from "$lib/components/ui/dialog";
  import { Button } from "$lib/components/ui/button";
  import { Input } from "$lib/components/ui/input";
  import { Badge } from "$lib/components/ui/badge";
  import { browseDirs } from "$lib/api";
  import { projects } from "$lib/state/projects.svelte";
  import { cn } from "$lib/utils";
  import { icon, text } from "$lib/design";
  import { i18n } from "$lib/i18n";
  import DialogHints from "./DialogHints.svelte";
  import type { DirListing } from "$lib/types";
  import FolderIcon from "@lucide/svelte/icons/folder";
  import FolderGitIcon from "@lucide/svelte/icons/folder-git-2";
  import CornerLeftUpIcon from "@lucide/svelte/icons/corner-left-up";

  let { open = $bindable(false) }: { open?: boolean } = $props();

  let listing = $state<DirListing | null>(null);
  let pathInput = $state("");
  let loading = $state(false);
  let error = $state<string | null>(null);
  let busy = $state(false);
  /** Highlighted sub-folder index, for keyboard navigation. */
  let activeIdx = $state(0);

  const msg = (e: unknown) =>
    e && typeof e === "object" && "message" in e
      ? String((e as { message: unknown }).message)
      : String(e);

  async function go(path?: string) {
    loading = true;
    error = null;
    try {
      listing = await browseDirs(path);
      pathInput = listing.path;
      activeIdx = 0;
    } catch (e) {
      error = msg(e);
    } finally {
      loading = false;
    }
  }

  // Keep the highlight within range as the listing changes.
  $effect(() => {
    const n = listing?.entries.length ?? 0;
    if (activeIdx >= n) activeIdx = Math.max(0, n - 1);
  });

  /** Arrow/Enter navigation from the path field: ↑/↓ move the highlight, Enter
   *  opens the highlighted folder (or goes to a typed path when it was edited). */
  function onNavKey(e: KeyboardEvent) {
    const entries = listing?.entries ?? [];
    if (e.key === "ArrowDown") {
      e.preventDefault();
      activeIdx = Math.min(entries.length - 1, activeIdx + 1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      activeIdx = Math.max(0, activeIdx - 1);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const typed = pathInput.trim();
      if (typed && typed !== listing?.path) void go(typed);
      else if (entries[activeIdx]) void go(entries[activeIdx].path);
    }
  }

  // Load the home directory the first time the dialog opens; clear transient
  // state when it closes.
  $effect(() => {
    if (open) {
      if (!listing) void go(undefined);
    } else {
      error = null;
      busy = false;
    }
  });

  async function add(path: string) {
    busy = true;
    const ok = await projects.addProjectPath(path);
    busy = false;
    if (ok) open = false;
    else error = projects.error;
  }
</script>

<Dialog.Root bind:open>
  <Dialog.Content class="sm:max-w-[560px]">
    <Dialog.Header>
      <Dialog.Title>{i18n.t("picker.title")}</Dialog.Title>
      <Dialog.Description>{i18n.t("picker.desc")}</Dialog.Description>
    </Dialog.Header>

    <!-- Current path + up -->
    <div class="flex items-center gap-2">
      <Button
        variant="outline"
        size="icon-sm"
        title={i18n.t("picker.parent")}
        disabled={!listing?.parent || loading}
        onclick={() => listing?.parent && go(listing.parent)}
      >
        <CornerLeftUpIcon class={icon.button} />
      </Button>
      <Input
        class="h-7 flex-1 font-mono text-xs"
        placeholder={i18n.t("picker.pathPlaceholder")}
        bind:value={pathInput}
        spellcheck={false}
        onkeydown={onNavKey}
      />
    </div>

    <!-- Sub-folders -->
    <div class="uxnan-scroll h-64 overflow-y-auto rounded-md border border-border">
      {#if loading}
        <div class="p-4 text-center text-xs text-muted-foreground">{i18n.t("common.loading")}</div>
      {:else if listing && listing.entries.length === 0}
        <div class="p-4 text-center text-xs text-muted-foreground">
          {i18n.t("picker.empty")}
        </div>
      {:else if listing}
        {#each listing.entries as entry, i (entry.path)}
          <div
            class={cn(
              "group flex items-center gap-2 px-2 py-1.5",
              i === activeIdx ? "bg-accent" : "hover:bg-accent/50",
            )}
            onmouseenter={() => (activeIdx = i)}
            role="presentation"
          >
            <button
              class={cn("flex min-w-0 flex-1 items-center gap-2 text-left", text.body)}
              title={i18n.t("picker.open", { name: entry.name })}
              onclick={() => go(entry.path)}
            >
              {#if entry.isRepo}
                <FolderGitIcon class={cn(icon.button, "shrink-0 text-primary")} />
              {:else}
                <FolderIcon class={cn(icon.button, "shrink-0 text-muted-foreground")} />
              {/if}
              <span class="truncate">{entry.name}</span>
              {#if entry.isRepo}
                <Badge variant="outline" class="px-1 py-0 text-[9px] uppercase">
                  {i18n.t("picker.repoBadge")}
                </Badge>
              {/if}
            </button>
            <Button
              variant="ghost"
              size="sm"
              class="h-6 text-[11px] opacity-0 group-hover:opacity-100"
              disabled={busy}
              onclick={() => add(entry.path)}
            >
              {i18n.t("common.add")}
            </Button>
          </div>
        {/each}
      {/if}
    </div>

    {#if error}
      <div
        class="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive"
      >
        {error}
      </div>
    {/if}

    <Dialog.Footer class="items-center sm:justify-between">
      <DialogHints class="hidden sm:flex" />
      <div class="flex items-center gap-2">
        <Button variant="ghost" onclick={() => (open = false)}>{i18n.t("common.cancel")}</Button>
        <Button
          disabled={!listing || busy}
          onclick={() => listing && add(listing.path)}
        >
          {busy ? i18n.t("common.adding") : i18n.t("picker.addFolder")}
        </Button>
      </div>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
