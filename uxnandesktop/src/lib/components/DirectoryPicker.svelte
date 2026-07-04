<script lang="ts">
  import * as Dialog from "$lib/components/ui/dialog";
  import { Button } from "$lib/components/ui/button";
  import { Input } from "$lib/components/ui/input";
  import { browseDirs } from "$lib/api";
  import { projects } from "$lib/state/projects.svelte";
  import { cn } from "$lib/utils";
  import { icon, text } from "$lib/design";
  import { TooltipSimple } from "$lib/components/ui/tooltip";
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
  <!-- Same shell as the quick-switch palette: overflow-hidden + p-0 so the
       rounded card clips every section (the scroll list and its scrollbar
       included) and nothing bleeds past the frame; each section owns its px-4. -->
  <Dialog.Content class="gap-0 overflow-hidden p-0 sm:max-w-[560px]">
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
          onkeydown={onNavKey}
        />
      </div>
    </div>

    <!-- Sub-folders scroll region. Each row is a folder glyph + name; repos are
         flagged with a git-folder icon and a quiet primary tag, plus a hover Add. -->
    <div class="uxnan-scroll h-64 overflow-y-auto p-2">
      {#if loading}
        <div class={cn("py-10 text-center", text.meta)}>{i18n.t("common.loading")}</div>
      {:else if listing && listing.entries.length === 0}
        <div class="flex flex-col items-center gap-2.5 py-10 text-center">
          <FolderIcon class="size-6 text-muted-foreground/40" />
          <p class={text.meta}>{i18n.t("picker.empty")}</p>
        </div>
      {:else if listing}
        {#each listing.entries as entry, i (entry.path)}
          <div
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
      <div class="border-t border-border/60 bg-destructive/10 px-4 py-2 text-xs text-destructive">
        {error}
      </div>
    {/if}

    <!-- Footer: hints + cancel / add, on a quiet band with a top hairline. -->
    <div
      class="flex items-center justify-between gap-2 border-t border-border/60 bg-muted/30 px-4 py-2.5"
    >
      <DialogHints class="hidden sm:flex" />
      <div class="flex items-center gap-2">
        <Button variant="ghost" size="sm" onclick={() => (open = false)}>{i18n.t("common.cancel")}</Button>
        <Button size="sm" disabled={!listing || busy} onclick={() => listing && add(listing.path)}>
          {busy ? i18n.t("common.adding") : i18n.t("picker.addFolder")}
        </Button>
      </div>
    </div>
  </Dialog.Content>
</Dialog.Root>
