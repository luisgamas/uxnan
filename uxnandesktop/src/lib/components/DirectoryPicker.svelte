<script lang="ts">
  import * as Dialog from "$lib/components/ui/dialog";
  import { Button } from "$lib/components/ui/button";
  import { Input } from "$lib/components/ui/input";
  import { Spinner } from "$lib/components/ui/spinner";
  import { browseDirs } from "$lib/api";
  import { projects } from "$lib/state/projects.svelte";
  import { cn } from "$lib/utils";
  import { icon, text } from "$lib/design";
  import { TooltipSimple } from "$lib/components/ui/tooltip";
  import { i18n } from "$lib/i18n";
  import { isMac } from "$lib/keybindings";
  import Kbd from "./Kbd.svelte";
  import AddProjectDialog from "./AddProjectDialog.svelte";
  import type { DirListing } from "$lib/types";
  import FolderIcon from "@lucide/svelte/icons/folder";
  import FolderGitIcon from "@lucide/svelte/icons/folder-git-2";
  import CornerLeftUpIcon from "@lucide/svelte/icons/corner-left-up";
  import LayersIcon from "@lucide/svelte/icons/layers";

  let { open = $bindable(false) }: { open?: boolean } = $props();

  let listing = $state<DirListing | null>(null);
  let pathInput = $state("");
  let loading = $state(false);
  let error = $state<string | null>(null);
  let busyPath = $state<string | null>(null);
  /** Highlighted sub-folder index, for keyboard navigation. */
  let activeIdx = $state(0);
  /** The scroll region, so the active row can be kept in view. */
  let listEl = $state<HTMLDivElement | null>(null);
  /** Whether the add-project selection dialog (parent vs. sub-folders) is open. */
  let selectOpen = $state(false);

  /** Child folders that are git repos — when any exist, we surface a note that
   *  this folder likely holds several projects (they can be added separately). */
  const repoChildCount = $derived(
    listing?.entries.filter((e) => e.isRepo).length ?? 0,
  );
  const hasRepoChildren = $derived(repoChildCount > 0);

  const baseName = (p: string) =>
    p.replace(/[\\/]+$/, "").split(/[\\/]/).pop() ?? p;

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

  // Keep the highlighted row scrolled into view as the selection moves by
  // keyboard, so navigation never runs "off screen" and appears to stall.
  $effect(() => {
    void activeIdx;
    listEl
      ?.querySelector('[data-active="true"]')
      ?.scrollIntoView({ block: "nearest" });
  });

  /** Keyboard handling for the whole dialog (attached to the content, so arrows
   *  keep working no matter which control holds focus — not just the path field):
   *  ↑/↓ move the highlight, Enter opens the highlighted folder (or a typed path),
   *  Mod+Enter runs the primary "add this folder" action. */
  function onDialogKey(e: KeyboardEvent) {
    if (busyPath || loading) return;
    const entries = listing?.entries ?? [];
    const mod = e.metaKey || e.ctrlKey;

    if (mod && e.key === "Enter") {
      e.preventDefault();
      addFolder();
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      activeIdx = Math.min(entries.length - 1, activeIdx + 1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      activeIdx = Math.max(0, activeIdx - 1);
    } else if (e.key === "Enter") {
      // Enter submits from the path field (typed path or highlighted folder);
      // from a button it stays a plain click, so don't hijack it there.
      const el = e.target as HTMLElement | null;
      if (el?.tagName === "BUTTON") return;
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
      busyPath = null;
    }
  });

  /** Add a single folder as a project (the per-row "Add" action). */
  async function add(path: string) {
    busyPath = path;
    const ok = await projects.addProjectPath(path);
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
  <Dialog.Content class="gap-0 overflow-hidden p-0 sm:max-w-[560px]" onkeydown={onDialogKey}>
    <!-- Header -->
    <div class="flex flex-col gap-1 border-b border-border/60 px-4 pb-3 pt-4 pr-10">
      <Dialog.Title class="text-[15px] font-semibold leading-none">{i18n.t("picker.title")}</Dialog.Title>
      <Dialog.Description class={text.meta}>{i18n.t("picker.desc")}</Dialog.Description>
    </div>

    <!-- Location bar: a parent-up button + the current path as an editable field
         with a leading folder glyph, so it reads like a file-manager address. -->
    <div class="flex items-center gap-2 border-b border-border/60 px-4 py-3">
      <TooltipSimple title={i18n.t("picker.parent")}>
        {#snippet children(tp)}
          <Button
            {...tp}
            variant="outline"
            size="icon-sm"
            class="size-8 shrink-0"
            disabled={!listing?.parent || loading}
            onclick={() => listing?.parent && go(listing.parent)}
          >
            <CornerLeftUpIcon class={icon.button} />
          </Button>
        {/snippet}
      </TooltipSimple>
      <div class="relative min-w-0 flex-1">
        <FolderIcon
          class="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground/80"
        />
        <Input
          class="h-8 w-full pl-8 font-mono text-xs"
          placeholder={i18n.t("picker.pathPlaceholder")}
          bind:value={pathInput}
          spellcheck={false}
          autocomplete="off"
        />
      </div>
    </div>

    <!-- Note (informational only): when child git repos are detected here, hint
         that "Add this folder" lets you add them separately. No action of its
         own — the choice happens in the add-project dialog. -->
    {#if hasRepoChildren}
      <div class="flex items-center gap-3 border-b border-border/60 bg-primary/5 px-4 py-2.5">
        <LayersIcon class={cn(icon.button, "shrink-0 text-primary")} />
        <p class="min-w-0 flex-1 text-xs text-muted-foreground">
          {i18n.t("picker.bulkHint", { repos: String(repoChildCount) })}
        </p>
      </div>
    {/if}

    <!-- Sub-folders scroll region. Each row is a folder glyph + name; repos are
         flagged with a git-folder icon and a quiet primary tag, plus a hover Add. -->
    <div bind:this={listEl} class="uxnan-scroll h-64 overflow-y-auto p-2">
      {#if loading}
        <div class={cn("flex items-center justify-center gap-2 py-10", text.meta)}>
          <Spinner aria-label={i18n.t("common.loading")} />
          {i18n.t("common.loading")}
        </div>
      {:else if listing && listing.entries.length === 0}
        <div class="flex flex-col items-center gap-2.5 py-10 text-center">
          <FolderIcon class="size-6 text-muted-foreground/40" />
          <p class={text.meta}>{i18n.t("picker.empty")}</p>
        </div>
      {:else if listing}
        {#each listing.entries as entry, i (entry.path)}
          <div
            data-active={i === activeIdx}
            class={cn(
              "group flex h-9 items-center gap-2.5 rounded-md px-2",
              i === activeIdx ? "bg-accent" : "hover:bg-accent/50",
            )}
            onmouseenter={() => (activeIdx = i)}
            role="presentation"
          >
            <TooltipSimple title={i18n.t("picker.open", { name: entry.name })}>
              {#snippet children(tp)}
                <button
                  {...tp}
                  class={cn("flex min-w-0 flex-1 items-center gap-2.5 text-left", text.body)}
                  onclick={() => go(entry.path)}
                >
              {#if entry.isRepo}
                <FolderGitIcon class={cn(icon.button, "shrink-0 text-primary")} />
              {:else}
                <FolderIcon class={cn(icon.button, "shrink-0 text-muted-foreground/80")} />
              {/if}
              <span class="truncate">{entry.name}</span>
              {#if entry.isRepo}
                <span
                  class="shrink-0 rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-primary"
                >
                  {i18n.t("picker.repoBadge")}
                </span>
              {/if}
            </button>
            {/snippet}
          </TooltipSimple>
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
          </div>
        {/each}
      {/if}
    </div>

    {#if error}
      <div class="border-t border-border/60 bg-destructive/10 px-4 py-2 text-xs text-destructive">
        {error}
      </div>
    {/if}

    <!-- Footer: hints + cancel / add, on a quiet band with a top hairline. The
         hint group shrinks and clips first (min-w-0 + overflow-hidden) so it can
         never force the dialog wider than its max width; the actions stay put. -->
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
