<script lang="ts">
  import * as Dialog from "$lib/components/ui/dialog";
  import { Button } from "$lib/components/ui/button";
  import { Input } from "$lib/components/ui/input";
  import { Badge } from "$lib/components/ui/badge";
  import { browseDirs } from "$lib/api";
  import { projects } from "$lib/state/projects.svelte";
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
    } catch (e) {
      error = msg(e);
    } finally {
      loading = false;
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
      <Dialog.Title>Add project</Dialog.Title>
      <Dialog.Description>
        Browse to a git repository and add it. Folders tagged
        <Badge variant="outline" class="px-1 py-0 text-[9px] uppercase">repo</Badge>
        are git repositories.
      </Dialog.Description>
    </Dialog.Header>

    <!-- Current path + up -->
    <div class="flex items-center gap-2">
      <Button
        variant="outline"
        size="icon-sm"
        title="Parent folder"
        disabled={!listing?.parent || loading}
        onclick={() => listing?.parent && go(listing.parent)}
      >
        <CornerLeftUpIcon class="size-3.5" />
      </Button>
      <Input
        class="h-7 flex-1 font-mono text-xs"
        placeholder="Type or paste a path, then Enter…"
        bind:value={pathInput}
        spellcheck={false}
        onkeydown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            void go(pathInput.trim() || undefined);
          }
        }}
      />
    </div>

    <!-- Sub-folders -->
    <div class="uxnan-scroll h-64 overflow-y-auto rounded-md border border-border">
      {#if loading}
        <div class="p-4 text-center text-xs text-muted-foreground">Loading…</div>
      {:else if listing && listing.entries.length === 0}
        <div class="p-4 text-center text-xs text-muted-foreground">
          No sub-folders here.
        </div>
      {:else if listing}
        {#each listing.entries as entry (entry.path)}
          <div class="group flex items-center gap-2 px-2 py-1.5 hover:bg-accent/50">
            <button
              class="flex min-w-0 flex-1 items-center gap-2 text-left text-xs"
              title="Open {entry.name}"
              onclick={() => go(entry.path)}
            >
              {#if entry.isRepo}
                <FolderGitIcon class="size-4 shrink-0 text-primary" />
              {:else}
                <FolderIcon class="size-4 shrink-0 text-muted-foreground" />
              {/if}
              <span class="truncate">{entry.name}</span>
              {#if entry.isRepo}
                <Badge variant="outline" class="px-1 py-0 text-[9px] uppercase">
                  repo
                </Badge>
              {/if}
            </button>
            {#if entry.isRepo}
              <Button
                variant="ghost"
                size="sm"
                class="h-6 text-[11px] opacity-0 group-hover:opacity-100"
                disabled={busy}
                onclick={() => add(entry.path)}
              >
                Add
              </Button>
            {/if}
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

    <Dialog.Footer>
      <Button variant="ghost" onclick={() => (open = false)}>Cancel</Button>
      <Button
        disabled={!listing?.isRepo || busy}
        onclick={() => listing && add(listing.path)}
      >
        {busy ? "Adding…" : "Add this folder"}
      </Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
