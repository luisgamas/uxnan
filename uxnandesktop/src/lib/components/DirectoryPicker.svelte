<script lang="ts">
  // "Add project" folder picker. The browsing surface (path bar + refresh + live
  // watch + sub-folder list + keyboard nav) lives in the shared DirectoryBrowser;
  // this dialog adds the header, the per-row "Add" action, the bulk-repos hint,
  // the footer, and the two-step add-project selection.
  import * as Dialog from "$lib/components/ui/dialog";
  import { Button } from "$lib/components/ui/button";
  import { Spinner } from "$lib/components/ui/spinner";
  import { projects } from "$lib/state/projects.svelte";
  import { cn } from "$lib/utils";
  import { icon, text } from "$lib/design";
  import { i18n } from "$lib/i18n";
  import { isMac } from "$lib/keybindings";
  import Kbd from "./Kbd.svelte";
  import DirectoryBrowser from "./DirectoryBrowser.svelte";
  import AddProjectDialog from "./AddProjectDialog.svelte";
  import type { DirEntry, DirListing } from "$lib/types";
  import LayersIcon from "@lucide/svelte/icons/layers";

  let { open = $bindable(false) }: { open?: boolean } = $props();

  let listing = $state<DirListing | null>(null);
  let path = $state("");
  let error = $state<string | null>(null);
  let busyPath = $state<string | null>(null);
  /** The browser's keydown handler, wired onto Dialog.Content so keyboard nav
   *  works no matter which control holds focus. */
  let browserKey = $state<((e: KeyboardEvent) => void) | undefined>(undefined);
  /** Whether the add-project selection dialog (parent vs. sub-folders) is open. */
  let selectOpen = $state(false);

  /** Child folders that are git repos — when any exist, we surface a note that
   *  this folder likely holds several projects (they can be added separately). */
  const repoChildCount = $derived(listing?.entries.filter((e) => e.isRepo).length ?? 0);
  const hasRepoChildren = $derived(repoChildCount > 0);

  const baseName = (p: string) => p.replace(/[\\/]+$/, "").split(/[\\/]/).pop() ?? p;

  // Clear transient state when the dialog closes (the browser owns the listing).
  $effect(() => {
    if (!open) {
      error = null;
      busyPath = null;
    }
  });

  /** Add a single folder as a project (the per-row "Add" action). */
  async function add(target: string) {
    busyPath = target;
    const ok = await projects.addProjectPath(target);
    busyPath = null;
    if (ok) open = false;
    else error = projects.error;
  }

  /** Primary action ("Add this folder"): with sub-folders present, open the
   *  selection dialog so the user can add this folder OR pick sub-folders to add
   *  separately; with none, just add the folder directly. */
  function addFolder() {
    if (!listing) return;
    if (listing.entries.length === 0) void add(listing.path);
    else selectOpen = true;
  }
</script>

<Dialog.Root bind:open>
  <!-- Same shell as the quick-switch palette: overflow-hidden + p-0 so the
       rounded card clips every section (the scroll list and its scrollbar
       included) and nothing bleeds past the frame; each section owns its px-4. -->
  <Dialog.Content class="gap-0 overflow-hidden p-0 sm:max-w-[560px]" onkeydown={browserKey}>
    <!-- Header -->
    <div class="flex flex-col gap-1 border-b border-border/60 px-4 pb-3 pt-4 pr-10">
      <Dialog.Title class="text-[15px] font-semibold leading-none">{i18n.t("picker.title")}</Dialog.Title>
      <Dialog.Description class={text.meta}>{i18n.t("picker.desc")}</Dialog.Description>
    </div>

    <DirectoryBrowser
      active={open}
      bind:listing
      bind:path
      bind:keydownHandler={browserKey}
      busy={busyPath !== null}
      onPrimary={addFolder}
    >
      {#snippet note()}
        <!-- Informational only: when child git repos are detected here, hint that
             "Add this folder" lets you add them separately. -->
        {#if hasRepoChildren}
          <div class="flex items-center gap-3 border-b border-border/60 bg-primary/5 px-4 py-2.5">
            <LayersIcon class={cn(icon.button, "shrink-0 text-primary")} />
            <p class="min-w-0 flex-1 text-xs text-muted-foreground">
              {i18n.t("picker.bulkHint", { repos: String(repoChildCount) })}
            </p>
          </div>
        {/if}
      {/snippet}

      {#snippet rowAction(entry: DirEntry)}
        <Button
          variant={entry.isRepo ? "secondary" : "ghost"}
          size="sm"
          class="h-7 shrink-0 px-2.5 text-[11px] opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100"
          disabled={busyPath !== null}
          onclick={() => add(entry.path)}
        >
          {#if busyPath === entry.path}
            <Spinner data-icon="inline-start" aria-label={i18n.t("common.loading")} />
            {i18n.t("common.adding")}
          {:else}
            {i18n.t("common.add")}
          {/if}
        </Button>
      {/snippet}
    </DirectoryBrowser>

    {#if error}
      <div class="border-t border-border/60 bg-destructive/10 px-4 py-2 text-xs text-destructive">
        {error}
      </div>
    {/if}

    <!-- Footer: hints + add, on a quiet band with a top hairline. -->
    <div
      class="flex min-w-0 items-center justify-between gap-3 border-t border-border/60 bg-muted/30 px-4 py-2.5"
    >
      <div
        class="hidden min-w-0 flex-1 items-center gap-4 overflow-hidden text-[11px] text-muted-foreground sm:flex"
      >
        <span class="flex shrink-0 items-center gap-1.5">
          <span class="flex items-center gap-1"><Kbd>↑</Kbd><Kbd>↓</Kbd></span>
          {i18n.t("palette.hintNavigate")}
        </span>
        <span class="flex shrink-0 items-center gap-1.5">
          <span class="flex items-center gap-1"><Kbd>{isMac ? "⌘" : "Ctrl"}</Kbd><Kbd>↵</Kbd></span>
          {i18n.t("picker.hintAdd")}
        </span>
        <span class="flex shrink-0 items-center gap-1.5">
          <Kbd>Esc</Kbd>{i18n.t("palette.hintExit")}
        </span>
      </div>
      <div class="flex shrink-0 items-center gap-2">
        <Button size="sm" disabled={!listing || busyPath !== null} onclick={addFolder}>
          {#if listing && busyPath === listing.path}
            <Spinner data-icon="inline-start" aria-label={i18n.t("common.loading")} />
          {/if}
          {listing && busyPath === listing.path
            ? i18n.t("common.adding")
            : i18n.t("picker.addFolder")}
        </Button>
      </div>
    </div>
  </Dialog.Content>
</Dialog.Root>

<!-- Step 2: choose to add this folder as one project, or tick sub-folders to add
     each separately. On success it closes the picker too. -->
{#if listing}
  <AddProjectDialog
    bind:open={selectOpen}
    folderPath={listing.path}
    folderName={baseName(listing.path)}
    entries={listing.entries}
    onadded={() => (open = false)}
  />
{/if}
