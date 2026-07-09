<script lang="ts">
  // File-tree tab: the active worktree/project's full working tree, lazily
  // expanded one folder at a time (state lives in the `fileTree` store so it
  // survives tab switches). Files — and the folders that contain them — with a
  // git-tracked change are colored, mirroring the right-panel review; git-ignored
  // entries are dimmed (muted + italic). Clicking a
  // file opens it in the center editor. Toolbar: search, collapse/expand all,
  // reveal the worktree in the OS file manager, refresh. Each row has a right-click
  // context menu (`FileTreeContextMenu`) with full file operations — new/rename/
  // duplicate/delete-to-trash, open-in-terminal, add-as-project, find-in-folder —
  // driven through the `fileTree` store; create/rename use `FileNamePromptDialog`
  // and delete the shared destructive `ConfirmDialog`.
  import type { FsEntry } from "$lib/types";
  import { projects } from "$lib/state/projects.svelte";
  import { git, type FileEntry } from "$lib/state/git.svelte";
  import { terminals } from "$lib/state/terminals.svelte";
  import { fileTree } from "$lib/state/fileTree.svelte";
  import { revealPath } from "$lib/api";
  import { cn } from "$lib/utils";
  import { icon, iconButton, text } from "$lib/design";
  import { TooltipSimple } from "$lib/components/ui/tooltip";
  import { i18n } from "$lib/i18n";
  import { Button } from "$lib/components/ui/button";
  import * as ContextMenu from "$lib/components/ui/context-menu";
  import FileTreeContextMenu from "./FileTreeContextMenu.svelte";
  import FileNamePromptDialog from "./FileNamePromptDialog.svelte";
  import ConfirmDialog from "./ConfirmDialog.svelte";
  import ChevronRightIcon from "@lucide/svelte/icons/chevron-right";
  import ChevronDownIcon from "@lucide/svelte/icons/chevron-down";
  import FolderIcon from "@lucide/svelte/icons/folder";
  import FileIcon from "@lucide/svelte/icons/file";
  import SearchIcon from "@lucide/svelte/icons/search";
  import FoldVerticalIcon from "@lucide/svelte/icons/fold-vertical";
  import FolderOpenIcon from "@lucide/svelte/icons/folder-open";
  import RefreshCwIcon from "@lucide/svelte/icons/refresh-cw";
  import XIcon from "@lucide/svelte/icons/x";

  /** Active worktree root, forward-slash normalized (matches backend paths). */
  const root = $derived(
    projects.activeWorktreePath
      ? projects.activeWorktreePath.replace(/\\/g, "/").replace(/\/+$/, "")
      : null,
  );
  const worktreeName = $derived(root ? (root.split("/").pop() ?? root) : "");

  // Keep the shared tree store pointed at the active worktree.
  $effect(() => {
    fileTree.setRoot(root);
  });

  let searching = $state(false);
  function toggleSearch(): void {
    searching = !searching;
    if (!searching) {
      fileTree.query = "";
      fileTree.searchScope = null;
    }
  }
  // "Find in Folder" (from a row's context menu) sets a scope — open the search UI.
  $effect(() => {
    if (fileTree.searchScope) searching = true;
  });
  /** Name of the scoped folder, for the search-bar chip. */
  const scopeName = $derived(
    fileTree.searchScope ? (fileTree.searchScope.split("/").pop() ?? fileTree.searchScope) : "",
  );

  function openFile(entry: FsEntry): void {
    // Open as a file tab in the active workspace (which corresponds to this
    // worktree); `root` (forward-slash) drives the git change gutter.
    terminals.openFile(entry.path, root);
  }

  function reveal(): void {
    if (root) void revealPath(root);
  }

  // --- Context-menu file operations (dialogs mounted once, below) -----------
  type PromptMode = "file" | "folder" | "rename";
  let promptOpen = $state(false);
  let promptMode = $state<PromptMode>("file");
  let promptEntry = $state<FsEntry | null>(null);
  let deleteOpen = $state(false);
  let deleteTarget = $state<FsEntry | null>(null);
  let deleteError = $state<string | null>(null);

  /** The directory a new entry is created in: the folder itself, or a file's parent. */
  function dirOf(entry: FsEntry): string {
    if (entry.isDir) return entry.path;
    const i = entry.path.lastIndexOf("/");
    return i > 0 ? entry.path.slice(0, i) : entry.path;
  }

  function openPrompt(mode: PromptMode, entry: FsEntry): void {
    promptMode = mode;
    promptEntry = entry;
    promptOpen = true;
  }
  function openDelete(entry: FsEntry): void {
    deleteTarget = entry;
    deleteError = null;
    deleteOpen = true;
  }

  async function submitPrompt(name: string): Promise<void> {
    const entry = promptEntry;
    if (!entry) return;
    if (promptMode === "rename") {
      await fileTree.renameEntry(entry, name); // throws → dialog shows the error
    } else {
      const created = await fileTree.createEntry(dirOf(entry), name, promptMode);
      // Opening a brand-new file mirrors an IDE's "New File".
      if (promptMode === "file") terminals.openFile(created, root);
    }
  }

  async function doDelete(): Promise<boolean> {
    const entry = deleteTarget;
    if (!entry) return true;
    try {
      await fileTree.deleteEntry(entry);
      return true;
    } catch (e) {
      deleteError = e instanceof Error ? e.message : String(e);
      return false; // keep the dialog open to show the error
    }
  }

  // Prompt-dialog copy, by mode.
  const promptTitle = $derived(
    promptMode === "rename"
      ? i18n.t("fileTree.renameTitle")
      : promptMode === "folder"
        ? i18n.t("fileTree.newFolderTitle")
        : i18n.t("fileTree.newFileTitle"),
  );
  const promptSubmit = $derived(
    promptMode === "rename" ? i18n.t("common.rename") : i18n.t("common.create"),
  );
  const promptInitial = $derived(promptMode === "rename" ? (promptEntry?.name ?? "") : "");

  // One flattened row per visible node (depth drives indentation). While a search
  // is active every loaded folder is walked (ignoring collapse) so matches deep
  // in the tree surface; rows are then filtered to matches + their ancestors.
  interface Row {
    entry: FsEntry;
    depth: number;
  }
  const rows = $derived.by<Row[]>(() => {
    const q = fileTree.query.trim().toLowerCase();
    const all: Row[] = [];
    const walk = (dir: string, depth: number) => {
      for (const e of fileTree.childrenByDir[dir] ?? []) {
        all.push({ entry: e, depth });
        if (e.isDir && (q ? true : fileTree.expanded.has(e.path))) walk(e.path, depth + 1);
      }
    };
    // "Find in Folder" restricts the walk (and thus the results) to one subtree.
    const walkRoot = fileTree.searchScope ?? root;
    if (walkRoot) walk(walkRoot, 0);
    if (!q) return all;
    const matched = all.filter((r) => r.entry.name.toLowerCase().includes(q));
    const matchedPaths = matched.map((r) => r.entry.path);
    return all.filter(
      (r) =>
        r.entry.name.toLowerCase().includes(q) ||
        (r.entry.isDir && matchedPaths.some((p) => p.startsWith(r.entry.path + "/"))),
    );
  });

  // Changed-file map + ancestor-dir set, derived from the right-panel git status
  // (paths are worktree-relative, forward-slash). Powers the per-row coloring.
  const changes = $derived.by(() => {
    const fileMap = new Map<string, FileEntry>();
    const dirs = new Set<string>();
    for (const f of git.files) {
      fileMap.set(f.path, f);
      let p = f.path;
      let i = p.lastIndexOf("/");
      while (i > 0) {
        p = p.slice(0, i);
        dirs.add(p);
        i = p.lastIndexOf("/");
      }
    }
    return { fileMap, dirs };
  });

  function relOf(absPath: string): string {
    if (!root) return absPath;
    return absPath.startsWith(root + "/") ? absPath.slice(root.length + 1) : absPath;
  }

  /** Tailwind color class for a changed file (untracked / deleted / modified). */
  function fileColor(f: FileEntry | undefined): string {
    if (!f) return "";
    if (f.untracked) return "text-emerald-600 dark:text-emerald-400";
    if (f.index === "D" || f.worktree === "D") return "text-red-600 dark:text-red-400";
    return "text-amber-600 dark:text-amber-400";
  }
</script>

<div class="flex h-full min-h-0 flex-col">
  <header class="flex h-9 shrink-0 items-center gap-0.5 border-b border-sidebar-border/60 px-2">
    {#if searching}
      {#if fileTree.searchScope}
        <span
          class={cn(
            "inline-flex min-w-0 max-w-[45%] shrink-0 items-center gap-1 rounded bg-accent/60 px-1.5 py-0.5 text-muted-foreground",
            text.indicator,
          )}
        >
          <FolderIcon class={cn(icon.decorative, "shrink-0")} />
          <span class="truncate">{scopeName}</span>
          <button
            type="button"
            class="shrink-0 hover:text-foreground"
            onclick={() => (fileTree.searchScope = null)}
            aria-label={i18n.t("fileTree.clearScope")}
          >
            <XIcon class="size-3" />
          </button>
        </span>
      {/if}
      <!-- svelte-ignore a11y_autofocus -->
      <input
        autofocus
        type="text"
        placeholder={fileTree.searchScope
          ? i18n.t("fileTree.searchInFolder")
          : i18n.t("fileTree.searchPlaceholder")}
        bind:value={fileTree.query}
        class={cn(
          "min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted-foreground/60",
          text.body,
        )}
        onkeydown={(e) => e.key === "Escape" && toggleSearch()}
      />
      <TooltipSimple title={i18n.t("common.close")}>
        {#snippet children(tp)}
          <Button variant="ghost" size="icon" class={iconButton.xs} {...tp} onclick={toggleSearch}>
            <XIcon class={icon.action} />
          </Button>
        {/snippet}
      </TooltipSimple>
    {:else}
      <span class={cn("flex-1 truncate", text.section)}>{worktreeName}</span>
      {#if root}
        <TooltipSimple title={i18n.t("fileTree.search")}>
          {#snippet children(tp)}
            <Button variant="ghost" size="icon" class={iconButton.xs} {...tp} onclick={toggleSearch}>
              <SearchIcon class={icon.action} />
            </Button>
          {/snippet}
        </TooltipSimple>
        <TooltipSimple title={i18n.t("fileTree.collapseAll")}>
          {#snippet children(tp)}
            <Button variant="ghost" size="icon" class={iconButton.xs} {...tp} onclick={() => fileTree.collapseAll()}>
              <FoldVerticalIcon class={icon.action} />
            </Button>
          {/snippet}
        </TooltipSimple>
        <!-- "Expand all" (UnfoldVertical → fileTree.expandAll) is implemented but
             hidden for now: recursively loading a large tree is too slow. Re-enable
             once it's lazy/bounded enough to feel instant. FOR-DEV. -->
        <TooltipSimple title={i18n.t("fileTree.reveal")}>
          {#snippet children(tp)}
            <Button variant="ghost" size="icon" class={iconButton.xs} {...tp} onclick={reveal}>
              <FolderOpenIcon class={icon.action} />
            </Button>
          {/snippet}
        </TooltipSimple>
        <TooltipSimple title={i18n.t("fileTree.refresh")}>
          {#snippet children(tp)}
            <Button variant="ghost" size="icon" class={iconButton.xs} {...tp} onclick={() => fileTree.refresh()}>
              <RefreshCwIcon class={cn(icon.action, fileTree.loadingDir.size > 0 && "animate-spin")} />
            </Button>
          {/snippet}
        </TooltipSimple>
      {/if}
    {/if}
  </header>

  {#if !root}
    <p class={cn("p-3", text.meta)}>{i18n.t("rightPanel.selectWorktree")}</p>
  {:else}
    {#if fileTree.error}
      <p class={cn("px-3 py-1.5 text-destructive", text.body)}>{fileTree.error}</p>
    {/if}
    {#if rows.length === 0}
      <p class={cn("p-3", text.meta)}>
        {fileTree.query.trim()
          ? i18n.t("fileTree.noMatch")
          : fileTree.loadingDir.has(root)
            ? i18n.t("common.loading")
            : i18n.t("fileTree.empty")}
      </p>
    {:else}
      <div class="uxnan-scroll min-h-0 flex-1 overflow-auto px-1 py-1">
        {#each rows as r (r.entry.path)}
          {@const rel = relOf(r.entry.path)}
          {@const isOpen = terminals.isFileOpen(r.entry.path)}
          {@const isExpanded = fileTree.expanded.has(r.entry.path)}
          {@const ignored = r.entry.ignored}
          {@const changed = r.entry.isDir
            ? changes.dirs.has(rel)
            : changes.fileMap.has(rel)}
          {@const color = r.entry.isDir
            ? changed
              ? "text-amber-600 dark:text-amber-400"
              : ""
            : fileColor(changes.fileMap.get(rel))}
          <ContextMenu.Root>
            <ContextMenu.Trigger>
              {#snippet child({ props })}
                <TooltipSimple title={rel}>
                  {#snippet children(tp)}
                    <button
                      {...tp}
                      {...props}
                      type="button"
                      class={cn(
                        "flex h-7 w-full items-center gap-1 rounded-md pr-1 text-left",
                        isOpen
                          ? "bg-primary/15 ring-1 ring-inset ring-primary/25"
                          : "hover:bg-accent/40",
                      )}
                      style="padding-left: {r.depth * 12 + 2}px"
                      onclick={() => (r.entry.isDir ? fileTree.toggle(r.entry) : openFile(r.entry))}
                    >
                      {#if r.entry.isDir}
                        {#if isExpanded}
                          <ChevronDownIcon class={cn(icon.decorative, "shrink-0 text-muted-foreground")} />
                        {:else}
                          <ChevronRightIcon class={cn(icon.decorative, "shrink-0 text-muted-foreground")} />
                        {/if}
                        <FolderIcon
                          class={cn(icon.decorative, "shrink-0", changed ? color : "text-muted-foreground")}
                        />
                      {:else}
                        <span class="w-3 shrink-0"></span>
                        <FileIcon class={cn(icon.decorative, "shrink-0", color || "text-muted-foreground")} />
                      {/if}
                      <!-- Ignored entries are dimmed (muted + italic), winning over any git
                           colour — an ignored entry never has a git change anyway. -->
                      <span
                        class={cn(
                          "min-w-0 flex-1 truncate",
                          text.body,
                          ignored ? "italic text-muted-foreground" : color,
                          (changed || isOpen) && "font-medium",
                        )}
                      >
                        {r.entry.name}
                      </span>
                    </button>
                  {/snippet}
                </TooltipSimple>
              {/snippet}
            </ContextMenu.Trigger>
            <FileTreeContextMenu
              entry={r.entry}
              {rel}
              {isExpanded}
              {root}
              onNewFile={() => openPrompt("file", r.entry)}
              onNewFolder={() => openPrompt("folder", r.entry)}
              onRename={() => openPrompt("rename", r.entry)}
              onDelete={() => openDelete(r.entry)}
            />
          </ContextMenu.Root>
        {/each}
      </div>
    {/if}
  {/if}
</div>

<!-- Mounted once; driven by the row context-menu actions above. -->
<FileNamePromptDialog
  bind:open={promptOpen}
  title={promptTitle}
  submitLabel={promptSubmit}
  initial={promptInitial}
  isRename={promptMode === "rename"}
  placeholder={i18n.t("fileTree.namePlaceholder")}
  onsubmit={submitPrompt}
/>

<ConfirmDialog
  bind:open={deleteOpen}
  danger
  title={i18n.t("fileTree.deleteTitle")}
  description={deleteTarget
    ? i18n.t(deleteTarget.isDir ? "fileTree.deleteFolderDesc" : "fileTree.deleteFileDesc", {
        name: deleteTarget.name,
      })
    : ""}
  confirmLabel={i18n.t("fileTree.deleteConfirm")}
  error={deleteError}
  onconfirm={doDelete}
/>
