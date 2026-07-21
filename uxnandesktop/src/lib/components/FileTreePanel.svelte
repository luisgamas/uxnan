<script lang="ts">
  // File-tree tab: the active worktree/project's working tree, lazily expanded one
  // folder at a time (state lives in the `fileTree` store so it survives tab
  // switches). Files — and the folders containing them — with a git-tracked change
  // are colored, mirroring the right-panel review; git-ignored entries are dimmed.
  // Clicking a file opens it in the center editor; dragging a row onto a terminal
  // inserts its path. Search runs project-wide (backend `fs_search_files`) and shows
  // a flat match list. Toolbar: search · collapse · reveal · refresh, plus a "…"
  // menu (show/hide hidden files). Each row has a context menu (`FileTreeContextMenu`)
  // with full file operations; create/rename use `FileNamePromptDialog`, delete the
  // shared destructive `ConfirmDialog`.
  import type { FsEntry } from "$lib/types";
  import { projects } from "$lib/state/projects.svelte";
  import { git, type FileEntry } from "$lib/state/git.svelte";
  import { terminals } from "$lib/state/terminals.svelte";
  import { fileTree } from "$lib/state/fileTree.svelte";
  import { revealPath } from "$lib/api";
  import { dropPathsIntoTerminal } from "$lib/terminal/terminalDrop";
  import { cn } from "$lib/utils";
  import { deferModalOpen } from "$lib/utils/pointerLock";
  import { icon, iconButton, text } from "$lib/design";
  import { TooltipSimple } from "$lib/components/ui/tooltip";
  import { i18n } from "$lib/i18n";
  import { Button } from "$lib/components/ui/button";
  import * as DropdownMenu from "$lib/components/ui/dropdown-menu";
  import * as ContextMenu from "$lib/components/ui/context-menu";
  import FileTreeRow from "./FileTreeRow.svelte";
  import FileTreeDraftRow from "./FileTreeDraftRow.svelte";
  import OpenWith from "./OpenWith.svelte";
  import FileNamePromptDialog from "./FileNamePromptDialog.svelte";
  import ConfirmDialog from "./ConfirmDialog.svelte";
  import FolderIcon from "@lucide/svelte/icons/folder";
  import FileIcon from "@lucide/svelte/icons/file";
  import FilePlusIcon from "@lucide/svelte/icons/file-plus";
  import FolderPlusIcon from "@lucide/svelte/icons/folder-plus";
  import SearchIcon from "@lucide/svelte/icons/search";
  import FoldVerticalIcon from "@lucide/svelte/icons/fold-vertical";
  import FolderOpenIcon from "@lucide/svelte/icons/folder-open";
  import RefreshCwIcon from "@lucide/svelte/icons/refresh-cw";
  import EllipsisIcon from "@lucide/svelte/icons/ellipsis";
  import Loader2Icon from "@lucide/svelte/icons/loader-2";
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
  // Re-run the project-wide search whenever the query, scope, or hidden toggle
  // changes (reading them here registers the effect's dependencies).
  $effect(() => {
    void fileTree.query;
    void fileTree.searchScope;
    void fileTree.showHidden;
    fileTree.scheduleSearch();
  });
  const queryActive = $derived(fileTree.query.trim().length > 0);
  /** Name of the scoped folder, for the search-bar chip. */
  const scopeName = $derived(
    fileTree.searchScope ? (fileTree.searchScope.split("/").pop() ?? fileTree.searchScope) : "",
  );

  // Search results are shown as a tree (same folder/file design as the browser),
  // synthesized from the matched files + their ancestor folders. Folders start
  // expanded; `searchCollapsed` tracks ones the user folded (reset each new search).
  let searchCollapsed = $state(new Set<string>());
  $effect(() => {
    void fileTree.searchResults;
    searchCollapsed = new Set();
  });
  function toggleSearchFolder(path: string): void {
    const next = new Set(searchCollapsed);
    if (next.has(path)) next.delete(path);
    else next.add(path);
    searchCollapsed = next;
  }

  function openFile(entry: FsEntry): void {
    // Open as a file tab in the active workspace (which corresponds to this
    // worktree); `root` (forward-slash) drives the git change gutter.
    terminals.openFile(entry.path, root);
  }

  function reveal(): void {
    if (root) void revealPath(root);
  }

  // --- Drag a row onto a terminal (pointer-based; Tauri suppresses HTML5 dnd) ---
  // Mirrors the tab-drag gesture in TerminalArea: a press promotes to a drag only
  // past a small threshold (so taps still open/expand); on release we hit-test the
  // element under the pointer for a terminal pane and write the path to its PTY.
  const DRAG_THRESHOLD_PX = 5;
  let fileDrag = $state<{
    entry: FsEntry;
    pointerId: number;
    startX: number;
    startY: number;
    x: number;
    y: number;
    dragging: boolean;
  } | null>(null);

  function beginDrag(e: PointerEvent, entry: FsEntry): void {
    if (e.button !== 0) return; // left button only (right opens the context menu)
    fileDrag = {
      entry,
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      x: e.clientX,
      y: e.clientY,
      dragging: false,
    };
  }
  function moveDrag(e: PointerEvent): void {
    if (!fileDrag || e.pointerId !== fileDrag.pointerId) return;
    fileDrag.x = e.clientX;
    fileDrag.y = e.clientY;
    if (!fileDrag.dragging) {
      if (Math.hypot(e.clientX - fileDrag.startX, e.clientY - fileDrag.startY) < DRAG_THRESHOLD_PX)
        return;
      fileDrag.dragging = true;
      (e.currentTarget as HTMLElement).setPointerCapture(fileDrag.pointerId);
    }
  }
  function endDrag(e: PointerEvent): boolean {
    if (!fileDrag || e.pointerId !== fileDrag.pointerId) return false;
    (e.currentTarget as HTMLElement).releasePointerCapture?.(fileDrag.pointerId);
    const wasDragging = fileDrag.dragging;
    const path = fileDrag.entry.path;
    const { x, y } = fileDrag;
    fileDrag = null;
    if (wasDragging) {
      dropPathsIntoTerminal([path], x, y); // no-op unless dropped on a terminal
      return true; // suppress the click that follows a drag
    }
    return false;
  }

  // --- Selection + create / rename / delete operations ---------------------
  // Create is inline (VSCode-style: an editable draft row — see `startCreate`);
  // rename + delete still use the mounted-once dialogs below.
  let renameOpen = $state(false);
  let renameEntry = $state<FsEntry | null>(null);
  let deleteOpen = $state(false);
  let deleteTarget = $state<FsEntry | null>(null);
  let deleteError = $state<string | null>(null);

  /** The directory a new entry is created in: the folder itself, or a file's parent. */
  function dirOf(entry: FsEntry): string {
    if (entry.isDir) return entry.path;
    const i = entry.path.lastIndexOf("/");
    return i > 0 ? entry.path.slice(0, i) : entry.path;
  }

  /** Record the last-clicked row — drives the selection highlight and the target
   *  folder for a toolbar-triggered create. */
  function select(entry: FsEntry): void {
    fileTree.selectedEntry = entry;
  }
  /** Clear the selection (VSCode-style): via Esc, or by clicking the empty area
   *  below the tree — after which a toolbar/background create targets the root. */
  function clearSelection(): void {
    fileTree.selectedEntry = null;
  }
  /** Whether a keydown originated in a text field (the search box or an inline draft
   *  input), where the rename/delete shortcuts must not fire. */
  function isEditableTarget(e: Event): boolean {
    const el = e.target as HTMLElement | null;
    return (
      !!el &&
      (el.tagName === "INPUT" ||
        el.tagName === "TEXTAREA" ||
        el.tagName === "SELECT" ||
        el.isContentEditable)
    );
  }

  /** File-tree keyboard shortcuts on the selected row (VSCode-style): Esc clears the
   *  selection; F2 renames; Delete (or Cmd+Backspace on macOS) moves it to the OS
   *  trash — reusing the same dialogs as the row context menu. Enter / Space are
   *  handled natively by the focused row `<button>` (open file / toggle folder). The
   *  rename/delete keys never fire while typing in the search box or an inline draft;
   *  the draft's own Esc stops propagation so it only cancels the draft, not here. */
  function onPanelKeydown(e: KeyboardEvent): void {
    if (e.key === "Escape") {
      clearSelection();
      return;
    }
    if (isEditableTarget(e)) return;
    const sel = fileTree.selectedEntry;
    if (!sel) return;
    if (e.key === "F2") {
      e.preventDefault();
      openRename(sel);
    } else if (e.key === "Delete" || (e.key === "Backspace" && e.metaKey)) {
      e.preventDefault();
      openDelete(sel);
    }
  }

  /** Where a toolbar "New File/Folder" lands: the selected folder (or the selected
   *  file's parent), else the worktree root — mirroring VSCode. */
  function toolbarTargetDir(): string | null {
    const sel = fileTree.selectedEntry;
    return sel ? dirOf(sel) : root;
  }

  /** Open an inline draft input inside `dir`. Deferred one macrotask so the menu
   *  that triggered it closes first; being inline it never touches the bits-ui body
   *  pointer-lock the modal create dialog had to dance around. Leaves search first so
   *  the normal tree (where the draft renders) is showing. */
  function startCreate(kind: "file" | "folder", dir: string | null): void {
    if (!dir) return;
    if (queryActive) {
      fileTree.query = "";
      fileTree.searchScope = null;
    }
    deferModalOpen(() => fileTree.beginDraft(dir, kind));
  }
  async function commitDraft(name: string): Promise<void> {
    const d = fileTree.draft;
    if (!d) return;
    const created = await fileTree.createEntry(d.dir, name, d.kind); // throws → inline error
    fileTree.draft = null;
    // Opening a brand-new file mirrors an IDE's "New File".
    if (d.kind === "file") terminals.openFile(created, root);
  }
  function cancelDraft(): void {
    fileTree.draft = null;
  }

  // Defer the dialog open until the context menu has fully closed, so the menu's
  // teardown releases the body pointer-lock before the dialog captures it (else
  // the dialog can restore `pointer-events: none` on close and freeze the mouse).
  function openRename(entry: FsEntry): void {
    renameEntry = entry;
    deferModalOpen(() => (renameOpen = true));
  }
  function openDelete(entry: FsEntry): void {
    deleteTarget = entry;
    deleteError = null;
    deferModalOpen(() => (deleteOpen = true));
  }

  async function submitRename(name: string): Promise<void> {
    if (renameEntry) await fileTree.renameEntry(renameEntry, name); // throws → dialog shows the error
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

  const renameInitial = $derived(renameEntry?.name ?? "");

  // One flattened row per visible tree node (depth drives indentation). Only
  // already-loaded folders that are expanded are walked; dotfiles are hidden when
  // the "show hidden files" toggle is off. Search is a separate, project-wide path.
  interface Row {
    entry: FsEntry;
    depth: number;
  }
  // A tree row is either a real entry or the inline "New File/Folder" draft, injected
  // as the first child of its target dir (VSCode-style). `Row` backs the search tree.
  type TreeRow =
    | { draft: false; entry: FsEntry; depth: number }
    | { draft: true; kind: "file" | "folder"; depth: number };
  const treeRows = $derived.by<TreeRow[]>(() => {
    const all: TreeRow[] = [];
    const d = fileTree.draft;
    const walk = (dir: string, depth: number) => {
      if (d && d.dir === dir) all.push({ draft: true, kind: d.kind, depth });
      for (const e of fileTree.childrenByDir[dir] ?? []) {
        if (!fileTree.showHidden && e.name.startsWith(".")) continue;
        all.push({ draft: false, entry: e, depth });
        if (e.isDir && fileTree.expanded.has(e.path)) walk(e.path, depth + 1);
      }
    };
    if (root) walk(root, 0);
    return all;
  });

  // Build the search-results *tree*: fold the flat matched-file list back into a
  // folder hierarchy (relative to the search root) so it reads exactly like the
  // normal browser. Folders are collapsible via `searchCollapsed`.
  interface SearchNode {
    entry: FsEntry;
    children: Map<string, SearchNode>;
  }
  const searchRows = $derived.by<Row[]>(() => {
    const base = fileTree.searchScope ?? root;
    if (!base) return [];
    const rootNode: SearchNode = {
      entry: { name: "", path: base, isDir: true, ignored: false },
      children: new Map(),
    };
    for (const file of fileTree.searchResults) {
      const rel = file.path.startsWith(base + "/") ? file.path.slice(base.length + 1) : file.name;
      const segs = rel.split("/");
      let cur = rootNode;
      let curPath = base;
      segs.forEach((seg, i) => {
        curPath += "/" + seg;
        const isFile = i === segs.length - 1;
        let child = cur.children.get(seg);
        if (!child) {
          child = {
            entry: isFile ? file : { name: seg, path: curPath, isDir: true, ignored: false },
            children: new Map(),
          };
          cur.children.set(seg, child);
        }
        cur = child;
      });
    }
    const out: Row[] = [];
    const walk = (node: SearchNode, depth: number) => {
      const kids = [...node.children.values()].sort((a, b) =>
        a.entry.isDir !== b.entry.isDir
          ? a.entry.isDir
            ? -1
            : 1
          : a.entry.name.toLowerCase().localeCompare(b.entry.name.toLowerCase()),
      );
      for (const k of kids) {
        out.push({ entry: k.entry, depth });
        if (k.entry.isDir && !searchCollapsed.has(k.entry.path)) walk(k, depth + 1);
      }
    };
    walk(rootNode, 0);
    return out;
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

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="flex h-full min-h-0 flex-col" onkeydown={onPanelKeydown}>
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
      {#if fileTree.searchLoading}
        <Loader2Icon class={cn(icon.decorative, "shrink-0 animate-spin text-muted-foreground")} />
      {:else}
        <SearchIcon class={cn(icon.decorative, "shrink-0 text-muted-foreground")} />
      {/if}
      <!-- svelte-ignore a11y_autofocus -->
      <input
        autofocus
        type="text"
        placeholder={fileTree.searchScope
          ? i18n.t("fileTree.searchInFolder")
          : i18n.t("fileTree.searchProjectPlaceholder")}
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
        <TooltipSimple title={i18n.t("fileTree.refresh")}>
          {#snippet children(tp)}
            <Button variant="ghost" size="icon" class={iconButton.xs} {...tp} onclick={() => fileTree.refresh()}>
              <RefreshCwIcon class={cn(icon.action, fileTree.loadingDir.size > 0 && "animate-spin")} />
            </Button>
          {/snippet}
        </TooltipSimple>
        <!-- Secondary actions: reveal-in-file-manager + show-hidden-files. ("Expand
             all" stays out for now: recursively loading a large tree is too slow.) -->
        <DropdownMenu.Root>
          <DropdownMenu.Trigger>
            {#snippet child({ props })}
              <Button
                variant="ghost"
                size="icon"
                class={iconButton.xs}
                title={i18n.t("fileTree.moreActions")}
                {...props}
              >
                <EllipsisIcon class={icon.action} />
              </Button>
            {/snippet}
          </DropdownMenu.Trigger>
          <DropdownMenu.Content align="end" class="min-w-48">
            <!-- New file/folder land in the selected folder (or a selected file's
                 parent), else the worktree root — see `toolbarTargetDir`. -->
            <DropdownMenu.Item
              class={text.menu}
              onclick={() => startCreate("file", toolbarTargetDir())}
            >
              <FilePlusIcon />
              {i18n.t("fileTree.newFile")}
            </DropdownMenu.Item>
            <DropdownMenu.Item
              class={text.menu}
              onclick={() => startCreate("folder", toolbarTargetDir())}
            >
              <FolderPlusIcon />
              {i18n.t("fileTree.newFolder")}
            </DropdownMenu.Item>
            <DropdownMenu.Separator />
            <DropdownMenu.Item class={text.menu} onclick={reveal}>
              <FolderOpenIcon />
              {i18n.t("fileTree.reveal")}
            </DropdownMenu.Item>
            <OpenWith menu={DropdownMenu} path={root} />
            <DropdownMenu.Separator />
            <DropdownMenu.CheckboxItem class={text.menu} bind:checked={fileTree.showHidden}>
              {i18n.t("fileTree.showHidden")}
            </DropdownMenu.CheckboxItem>
          </DropdownMenu.Content>
        </DropdownMenu.Root>
      {/if}
    {/if}
  </header>

  {#if !root}
    <p class={cn("p-3", text.meta)}>{i18n.t("rightPanel.selectWorktree")}</p>
  {:else}
    {#if fileTree.error}
      <p class={cn("px-3 py-1.5 text-destructive", text.body)}>{fileTree.error}</p>
    {/if}

    {#if queryActive}
      <!-- Project-wide search results, rendered as a tree (folders + files) so it
           reads like the normal browser. -->
      {#if searchRows.length === 0}
        <p class={cn("p-3", text.meta)}>
          {fileTree.searchLoading ? i18n.t("fileTree.searching") : i18n.t("fileTree.searchNoMatch")}
        </p>
      {:else}
        <div class="uxnan-scroll min-h-0 flex-1 overflow-auto px-1 py-1">
          {#each searchRows as r (r.entry.path)}
            {@const rel = relOf(r.entry.path)}
            {@const changed = r.entry.isDir ? changes.dirs.has(rel) : changes.fileMap.has(rel)}
            {@const color = r.entry.isDir
              ? changed
                ? "text-amber-600 dark:text-amber-400"
                : ""
              : fileColor(changes.fileMap.get(rel))}
            <FileTreeRow
              entry={r.entry}
              depth={r.depth}
              {rel}
              {root}
              isExpanded={r.entry.isDir && !searchCollapsed.has(r.entry.path)}
              isOpen={terminals.isFileOpen(r.entry.path)}
              selected={fileTree.selectedEntry?.path === r.entry.path}
              {changed}
              {color}
              onActivate={() => {
                select(r.entry);
                r.entry.isDir ? toggleSearchFolder(r.entry.path) : openFile(r.entry);
              }}
              onNewFile={() => startCreate("file", dirOf(r.entry))}
              onNewFolder={() => startCreate("folder", dirOf(r.entry))}
              onRename={() => openRename(r.entry)}
              onDelete={() => openDelete(r.entry)}
              {beginDrag}
              {moveDrag}
              {endDrag}
            />
          {/each}
          {#if fileTree.searchTruncated}
            <p class={cn("px-2 py-1.5", text.meta)}>{i18n.t("fileTree.searchTruncated")}</p>
          {/if}
        </div>
      {/if}
    {:else if treeRows.length === 0}
      <p class={cn("p-3", text.meta)}>
        {fileTree.loadingDir.has(root) ? i18n.t("common.loading") : i18n.t("fileTree.empty")}
      </p>
    {:else}
      <div class="uxnan-scroll flex min-h-0 flex-1 flex-col overflow-auto px-1 py-1">
        <div class="shrink-0">
        {#each treeRows as r (r.draft ? "__draft__" : r.entry.path)}
          {#if r.draft}
            <FileTreeDraftRow
              kind={r.kind}
              depth={r.depth}
              oncommit={commitDraft}
              oncancel={cancelDraft}
            />
          {:else}
            {@const rel = relOf(r.entry.path)}
            {@const changed = r.entry.isDir ? changes.dirs.has(rel) : changes.fileMap.has(rel)}
            {@const color = r.entry.isDir
              ? changed
                ? "text-amber-600 dark:text-amber-400"
                : ""
              : fileColor(changes.fileMap.get(rel))}
            <FileTreeRow
              entry={r.entry}
              depth={r.depth}
              {rel}
              {root}
              isExpanded={fileTree.expanded.has(r.entry.path)}
              isOpen={terminals.isFileOpen(r.entry.path)}
              selected={fileTree.selectedEntry?.path === r.entry.path}
              {changed}
              {color}
              ignored={r.entry.ignored}
              onActivate={() => {
                select(r.entry);
                r.entry.isDir ? fileTree.toggle(r.entry) : openFile(r.entry);
              }}
              onNewFile={() => startCreate("file", dirOf(r.entry))}
              onNewFolder={() => startCreate("folder", dirOf(r.entry))}
              onRename={() => openRename(r.entry)}
              onDelete={() => openDelete(r.entry)}
              {beginDrag}
              {moveDrag}
              {endDrag}
            />
          {/if}
        {/each}
        </div>
        <!-- Empty area (VSCode-style): a click clears the selection; a right-click
             opens the project-root actions (create at the worktree root, reveal,
             collapse all). `flex-1` gives a large hit target when few rows show; the
             floor keeps it reachable at the bottom of a long, scrolled tree. -->
        <ContextMenu.Root>
          <ContextMenu.Trigger>
            {#snippet child({ props })}
              <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
              <div
                {...props}
                role="presentation"
                class="min-h-12 flex-1"
                onclick={clearSelection}
              ></div>
            {/snippet}
          </ContextMenu.Trigger>
          <ContextMenu.Content>
            <ContextMenu.Item class={text.menu} onclick={() => startCreate("file", root)}>
              <FilePlusIcon />
              {i18n.t("fileTree.newFile")}
            </ContextMenu.Item>
            <ContextMenu.Item class={text.menu} onclick={() => startCreate("folder", root)}>
              <FolderPlusIcon />
              {i18n.t("fileTree.newFolder")}
            </ContextMenu.Item>
            <ContextMenu.Separator />
            <ContextMenu.Item class={text.menu} onclick={reveal}>
              <FolderOpenIcon />
              {i18n.t("fileTree.reveal")}
            </ContextMenu.Item>
            <ContextMenu.Item class={text.menu} onclick={() => fileTree.collapseAll()}>
              <FoldVerticalIcon />
              {i18n.t("fileTree.collapseAll")}
            </ContextMenu.Item>
          </ContextMenu.Content>
        </ContextMenu.Root>
      </div>
    {/if}
  {/if}
</div>

<!-- Floating label that follows the pointer while dragging a row onto a terminal. -->
{#if fileDrag?.dragging}
  <div
    class={cn(
      "pointer-events-none fixed z-50 flex items-center gap-1.5 rounded-md border border-border bg-popover px-2 py-1 shadow-md",
      text.body,
    )}
    style="left: {fileDrag.x + 12}px; top: {fileDrag.y + 8}px"
  >
    {#if fileDrag.entry.isDir}
      <FolderIcon class={cn(icon.decorative, "shrink-0 text-muted-foreground")} />
    {:else}
      <FileIcon class={cn(icon.decorative, "shrink-0 text-muted-foreground")} />
    {/if}
    <span class="max-w-56 truncate">{fileDrag.entry.name}</span>
  </div>
{/if}

<!-- Mounted once; rename is driven by the row context-menu action above (create is
     now inline, and delete uses the confirm dialog below). -->
<FileNamePromptDialog
  bind:open={renameOpen}
  title={i18n.t("fileTree.renameTitle")}
  submitLabel={i18n.t("common.rename")}
  initial={renameInitial}
  isRename
  placeholder={i18n.t("fileTree.namePlaceholder")}
  onsubmit={submitRename}
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
