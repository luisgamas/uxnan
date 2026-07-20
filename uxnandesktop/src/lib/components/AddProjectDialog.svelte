<script lang="ts">
  // Second step of "Add project": once the user picks a folder in the directory
  // picker, this dialog lets them either add that folder itself as a single
  // project, or tick sub-folders to add each as its own project. Repos are
  // pre-checked for convenience; both actions live in the footer.
  import * as Dialog from "$lib/components/ui/dialog";
  import { Button } from "$lib/components/ui/button";
  import { Checkbox } from "$lib/components/ui/checkbox";
  import { Spinner } from "$lib/components/ui/spinner";
  import Kbd from "./Kbd.svelte";
  import { projects } from "$lib/state/projects.svelte";
  import { cn } from "$lib/utils";
  import { icon, text } from "$lib/design";
  import { i18n } from "$lib/i18n";
  import type { DirEntry } from "$lib/types";
  import FolderIcon from "@lucide/svelte/icons/folder";
  import FolderGitIcon from "@lucide/svelte/icons/folder-git-2";

  let {
    open = $bindable(false),
    folderPath,
    folderName,
    entries = [],
    onadded,
  }: {
    open?: boolean;
    folderPath: string;
    folderName: string;
    entries?: DirEntry[];
    /** Called after at least one project was added, so the caller can close the
     *  underlying picker too. */
    onadded?: () => void;
  } = $props();

  /** Paths ticked to be added as separate projects. */
  let selected = $state<Set<string>>(new Set());
  let busy = $state<"parent" | "selected" | null>(null);
  let error = $state<string | null>(null);

  // Seed the selection each time the dialog opens: pre-check the git repos (the
  // folders most likely meant as separate projects), leave plain folders to the
  // user. Clear transient state on close.
  $effect(() => {
    if (open) {
      selected = new Set(entries.filter((e) => e.isRepo).map((e) => e.path));
      error = null;
      busy = null;
    }
  });

  const selectedCount = $derived(selected.size);
  const allSelected = $derived(entries.length > 0 && selected.size === entries.length);
  const someSelected = $derived(selected.size > 0 && selected.size < entries.length);

  function toggle(path: string) {
    const next = new Set(selected);
    if (next.has(path)) next.delete(path);
    else next.add(path);
    selected = next;
  }

  function toggleAll() {
    selected = allSelected ? new Set() : new Set(entries.map((e) => e.path));
  }

  async function addParent() {
    busy = "parent";
    error = null;
    const ok = await projects.addProjectPath(folderPath);
    busy = null;
    if (ok) {
      open = false;
      onadded?.();
    } else {
      error = projects.error;
    }
  }

  async function addSelected() {
    if (selectedCount === 0) return;
    busy = "selected";
    error = null;
    // Preserve the listing order for a predictable result.
    const paths = entries.filter((e) => selected.has(e.path)).map((e) => e.path);
    const { added } = await projects.addProjectPaths(paths);
    busy = null;
    if (added > 0) {
      open = false;
      onadded?.();
    } else {
      error = projects.error;
    }
  }
</script>

<Dialog.Root bind:open>
  <Dialog.Content class="gap-0 overflow-hidden p-0 sm:max-w-[560px]">
    <!-- Header: what we're adding and where. -->
    <div class="flex flex-col gap-1 border-b border-border/60 px-4 pb-3 pt-4 pr-10">
      <Dialog.Title class="text-[15px] font-semibold leading-none">{i18n.t("addProject.title")}</Dialog.Title>
      <Dialog.Description class={cn(text.meta, "truncate")} title={folderPath}>
        {i18n.t("addProject.desc", { folder: folderName })}
      </Dialog.Description>
    </div>

    {#if entries.length > 0}
      <!-- Select-all header for the sub-folder list. -->
      <div class="flex items-center gap-2.5 border-b border-border/60 px-4 py-2.5">
        <button
          type="button"
          role="checkbox"
          aria-checked={allSelected}
          aria-label={i18n.t("addProject.selectAll")}
          class="flex min-w-0 flex-1 items-center gap-2.5 text-left"
          onclick={toggleAll}
        >
          <Checkbox
            checked={allSelected}
            indeterminate={someSelected}
            tabindex={-1}
            class="pointer-events-none"
          />
          <span class={cn(text.meta, "truncate")}>
            {i18n.t("addProject.subfolders", { count: String(entries.length) })}
          </span>
        </button>
        <span class={cn(text.meta, "shrink-0")}>
          {i18n.t("addProject.selectedCount", { count: String(selectedCount) })}
        </span>
      </div>

      <!-- Tickable sub-folders. Clicking a row toggles its checkbox; repos carry
           the same git glyph + tag as the picker so the two read coherently. -->
      <div class="uxnan-scroll max-h-64 overflow-y-auto p-2">
        {#each entries as entry (entry.path)}
          <button
            type="button"
            role="checkbox"
            aria-checked={selected.has(entry.path)}
            class="group flex h-9 w-full items-center gap-2.5 rounded-md px-2 text-left hover:bg-accent/50"
            onclick={() => toggle(entry.path)}
          >
            <!-- Display-only: the whole row is the click target, so the checkbox
                 itself must not capture clicks (that would double-toggle). -->
            <Checkbox checked={selected.has(entry.path)} tabindex={-1} class="pointer-events-none" />
            {#if entry.isRepo}
              <FolderGitIcon class={cn(icon.button, "shrink-0 text-primary")} />
            {:else}
              <FolderIcon class={cn(icon.button, "shrink-0 text-muted-foreground/80")} />
            {/if}
            <span class={cn(text.body, "min-w-0 flex-1 truncate")}>{entry.name}</span>
            {#if entry.isRepo}
              <span
                class="shrink-0 rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-primary"
              >
                {i18n.t("picker.repoBadge")}
              </span>
            {/if}
          </button>
        {/each}
      </div>
    {:else}
      <div class="flex flex-col items-center gap-2.5 px-4 py-10 text-center">
        <FolderIcon class="size-6 text-muted-foreground/40" />
        <p class={text.meta}>{i18n.t("addProject.noSubfolders")}</p>
      </div>
    {/if}

    {#if error}
      <div class="border-t border-border/60 bg-destructive/10 px-4 py-2 text-xs text-destructive">
        {error}
      </div>
    {/if}

    <!-- Footer: add just this folder, or add the ticked sub-folders (Esc / the
         top-right ✕ dismiss). The action group stays put (shrink-0); the hint
         text shrinks first. -->
    <div class="flex min-w-0 items-center justify-between gap-3 border-t border-border/60 bg-muted/30 px-4 py-2.5">
      <div class="hidden min-w-0 flex-1 items-center gap-4 overflow-hidden text-[11px] text-muted-foreground sm:flex">
        <span class="flex shrink-0 items-center gap-1.5">
          <Kbd>Esc</Kbd>{i18n.t("palette.hintExit")}
        </span>
      </div>
      <div class="flex shrink-0 items-center gap-2">
        <Button variant="outline" size="sm" disabled={busy !== null} onclick={addParent}>
          {#if busy === "parent"}
            <Spinner data-icon="inline-start" aria-label={i18n.t("common.loading")} />
          {/if}
          {i18n.t("addProject.addParent")}
        </Button>
        <Button size="sm" disabled={busy !== null || selectedCount === 0} onclick={addSelected}>
          {#if busy === "selected"}
            <Spinner data-icon="inline-start" aria-label={i18n.t("common.loading")} />
          {/if}
          {busy === "selected"
            ? i18n.t("common.adding")
            : i18n.t("addProject.addSelected", { count: String(selectedCount) })}
        </Button>
      </div>
    </div>
  </Dialog.Content>
</Dialog.Root>
