<script lang="ts">
  // Reusable in-app folder browser — the shared core behind the "Add project"
  // picker (DirectoryPicker) and the "new-worktree location" picker
  // (FolderSelectDialog). It owns the file-manager surface (a parent-up button, an
  // editable path field, a manual refresh, and the sub-folder list with keyboard
  // navigation) plus a **live filesystem watch**: as the user navigates, the
  // backend watches that one directory (`browse_set_watch` → `browse:changed`), so
  // a folder created or removed inside it — even from outside the app — appears
  // without a manual reload. Each consumer wraps this in its own Dialog and
  // provides the per-row action + primary footer via snippets.
  import { onDestroy, untrack } from "svelte";
  import { listen, type UnlistenFn } from "@tauri-apps/api/event";
  import { Button } from "$lib/components/ui/button";
  import { Input } from "$lib/components/ui/input";
  import { Spinner } from "$lib/components/ui/spinner";
  import { browseDirs, browseSetWatch } from "$lib/api";
  import { cn } from "$lib/utils";
  import { icon, text } from "$lib/design";
  import { TooltipSimple } from "$lib/components/ui/tooltip";
  import { i18n } from "$lib/i18n";
  import type { BrowseChangedEvent, DirEntry, DirListing } from "$lib/types";
  import type { Snippet } from "svelte";
  import FolderIcon from "@lucide/svelte/icons/folder";
  import FolderGitIcon from "@lucide/svelte/icons/folder-git-2";
  import CornerLeftUpIcon from "@lucide/svelte/icons/corner-left-up";
  import RefreshCwIcon from "@lucide/svelte/icons/refresh-cw";

  let {
    /** Whether the containing dialog is open — drives the initial load and the
     *  watch lifecycle (cleared when the dialog closes). */
    active = false,
    /** The current directory (two-way): consumers act on it in their footer. */
    path = $bindable(""),
    /** The current listing (two-way): consumers read `entries`/`parent`. */
    listing = $bindable<DirListing | null>(null),
    /** Disable interaction while the consumer performs its own action. */
    busy = false,
    /** Tailwind height for the scroll region. */
    listClass = "h-64",
    /** Primary action (Mod+Enter) — the consumer's footer button. */
    onPrimary,
    /** Bindable out: the dialog-level keydown handler, so the consumer can wire it
     *  onto its `Dialog.Content` and arrows/Enter work no matter what holds focus. */
    keydownHandler = $bindable<((e: KeyboardEvent) => void) | undefined>(undefined),
    /** Trailing per-row control (e.g. an "Add" button). */
    rowAction,
    /** Optional informational area rendered under the location bar. */
    note,
  }: {
    active?: boolean;
    path?: string;
    listing?: DirListing | null;
    busy?: boolean;
    listClass?: string;
    onPrimary?: () => void;
    keydownHandler?: ((e: KeyboardEvent) => void) | undefined;
    rowAction?: Snippet<[DirEntry]>;
    note?: Snippet;
  } = $props();

  let pathInput = $state("");
  let loading = $state(false);
  let error = $state<string | null>(null);
  /** Highlighted sub-folder index, for keyboard navigation. */
  let activeIdx = $state(0);
  /** The scroll region, so the active row can be kept in view. */
  let listEl = $state<HTMLDivElement | null>(null);
  /** The directory the backend is currently watching (normalized), so a
   *  `browse:changed` event for a stale directory is ignored. */
  let watched = $state<string | null>(null);
  let unlisten: UnlistenFn | null = null;

  const msg = (e: unknown) =>
    e && typeof e === "object" && "message" in e
      ? String((e as { message: unknown }).message)
      : String(e);

  /** Normalize a path for comparison only (forward slashes, no trailing slash,
   *  case-folded — the watch match must not miss over a separator/case spelling). */
  const norm = (p: string) => p.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();

  /** Point the backend watch at `dir` (or clear it), tracking the normalized form
   *  so incoming events can be matched to the directory we're actually showing. */
  async function watch(dir: string | null): Promise<void> {
    watched = dir ? norm(dir) : null;
    try {
      await browseSetWatch(dir);
    } catch {
      // No Tauri bridge (plain web preview) — the manual refresh still works.
    }
  }

  /** Navigate to `target` (or the home directory when omitted). `preserve` keeps
   *  the highlighted row + typed path across a refresh of the same directory. */
  async function go(target?: string, preserve = false): Promise<void> {
    loading = true;
    error = null;
    try {
      const result = await browseDirs(target);
      listing = result;
      path = result.path;
      if (!preserve) {
        pathInput = result.path;
        activeIdx = 0;
      }
      await watch(result.path);
    } catch (e) {
      error = msg(e);
    } finally {
      loading = false;
    }
  }

  /** Manual refresh of the current directory (the toolbar button), preserving the
   *  highlight — for a folder the user just created that hasn't shown up yet. */
  function refresh(): void {
    if (listing) void go(listing.path, true);
  }

  // Keep the highlight within range as the listing changes.
  $effect(() => {
    const n = listing?.entries.length ?? 0;
    if (activeIdx >= n) activeIdx = Math.max(0, n - 1);
  });

  // Keep the highlighted row scrolled into view as the selection moves by keyboard.
  $effect(() => {
    void activeIdx;
    listEl?.querySelector('[data-active="true"]')?.scrollIntoView({ block: "nearest" });
  });

  // Load the home directory the first time the dialog opens (and re-establish the
  // watch on a reopen when a listing is already loaded); clear the watch and
  // transient state when it closes. `untrack` so this depends only on `active` —
  // navigation's own `watch()` call (inside `go`) shouldn't re-trigger it.
  $effect(() => {
    if (active) {
      untrack(() => {
        if (listing) void watch(listing.path);
        else void go(undefined);
      });
    } else {
      error = null;
      void watch(null);
    }
  });

  // Live refresh: re-list when the directory we're showing reports a change.
  $effect(() => {
    if (unlisten) return;
    let cancelled = false;
    void listen<BrowseChangedEvent>("browse:changed", (e) => {
      if (watched && norm(e.payload.path) === watched && listing) {
        void go(listing.path, true);
      }
    })
      .then((fn) => {
        if (cancelled) fn();
        else unlisten = fn;
      })
      .catch(() => {
        // No Tauri event bus — manual refresh only.
      });
    return () => {
      cancelled = true;
    };
  });

  onDestroy(() => {
    unlisten?.();
    void watch(null);
  });

  /** Keyboard handling, exported so the consumer can attach it to `Dialog.Content`
   *  (arrows/Enter then work regardless of which control holds focus): ↑/↓ move the
   *  highlight, Enter opens the highlighted folder (or a typed path), Mod+Enter
   *  runs the consumer's primary action. */
  function onDialogKey(e: KeyboardEvent) {
    if (busy || loading) return;
    const entries = listing?.entries ?? [];
    const mod = e.metaKey || e.ctrlKey;

    if (mod && e.key === "Enter") {
      e.preventDefault();
      onPrimary?.();
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      activeIdx = Math.min(entries.length - 1, activeIdx + 1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      activeIdx = Math.max(0, activeIdx - 1);
    } else if (e.key === "Enter") {
      const el = e.target as HTMLElement | null;
      if (el?.tagName === "BUTTON") return; // a button click stays a plain click
      e.preventDefault();
      const typed = pathInput.trim();
      if (typed && typed !== listing?.path) void go(typed);
      else if (entries[activeIdx]) void go(entries[activeIdx].path);
    }
  }
  keydownHandler = onDialogKey;
</script>

<!-- Location bar: parent-up + the current path as an editable field with a leading
     folder glyph (reads like a file-manager address) + a manual refresh. -->
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
  <TooltipSimple title={i18n.t("picker.refresh")}>
    {#snippet children(tp)}
      <Button
        {...tp}
        variant="outline"
        size="icon-sm"
        class="size-8 shrink-0"
        disabled={!listing || loading}
        onclick={refresh}
      >
        <RefreshCwIcon class={cn(icon.button, loading && "animate-spin")} />
      </Button>
    {/snippet}
  </TooltipSimple>
</div>

{@render note?.()}

<!-- Sub-folders scroll region. Each row is a folder glyph + name; repos are
     flagged with a git-folder icon and a quiet primary tag, plus the consumer's
     trailing action snippet. -->
<div bind:this={listEl} class={cn("uxnan-scroll overflow-y-auto p-2", listClass)}>
  {#if loading && !listing}
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
        {@render rowAction?.(entry)}
      </div>
    {/each}
  {/if}
</div>

{#if error}
  <div class="border-t border-border/60 bg-destructive/10 px-4 py-2 text-xs text-destructive">
    {error}
  </div>
{/if}
