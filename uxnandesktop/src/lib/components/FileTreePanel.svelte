<script lang="ts">
  // File-tree tab: the active worktree/project's working tree, lazily expanded one
  // folder at a time (state lives in the `fileTree` store so it survives tab
  // switches). Files — and the folders containing them — with a git-tracked change
  // are colored, mirroring the right-panel review; git-ignored entries are dimmed.
  // Clicking a file opens it in the center editor; dragging a row onto a terminal
  // inserts its path. The row of the file the center area is showing keeps a quiet
  // background mark (see `terminals.activeFilePath`), and the tree expands to it, so
  // closing the search leaves the tree pointing at what you opened.
  //
  // Search (the toolbar's magnifier) opens a bar that searches file *names*
  // project-wide (backend `fs_search_files`), plus two sections that stay collapsed
  // until asked for: **content** search (`fs_search_content` — literal / whole-word /
  // regex, showing the matching lines, which open the file at that line) and
  // **filters** (include/exclude globs, which narrow both searches). Toolbar:
  // search · collapse · reveal · refresh, plus a "…" menu (show/hide hidden files)
  // that also creates New File/Folder at the selected folder or the root, plus
  // Esc/empty-area to clear the selection. Each row has a context menu
  // (`FileTreeContextMenu`) with full file operations, and F2/Delete shortcuts on the
  // selection. Create + rename are inline in the tree (`FileTreeDraftRow` /
  // `FileTreeRow` via the shared `TreeInlineInput`); delete uses the shared
  // destructive `ConfirmDialog`.
  import { tick, untrack } from "svelte";
  import type { ContentFileMatch, ContentMatch, FsEntry } from "$lib/types";
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
  import * as Collapsible from "$lib/components/ui/collapsible";
  import FileTreeRow from "./FileTreeRow.svelte";
  import FileTreeDraftRow from "./FileTreeDraftRow.svelte";
  import OpenWith from "./OpenWith.svelte";
  import ConfirmDialog from "./ConfirmDialog.svelte";
  import { Icon } from "$lib/components/ui/icon";
  import FolderIcon from "@hugeicons/core-free-icons/Folder01Icon";
  import FileIcon from "@hugeicons/core-free-icons/File01Icon";
  import FilePlusIcon from "@hugeicons/core-free-icons/FilePlusIcon";
  import FolderPlusIcon from "@hugeicons/core-free-icons/FolderAddIcon";
  import SearchIcon from "@hugeicons/core-free-icons/Search01Icon";
  import FoldVerticalIcon from "@hugeicons/core-free-icons/FoldVerticalIcon";
  import FolderOpenIcon from "@hugeicons/core-free-icons/FolderOpenIcon";
  import RefreshCwIcon from "@hugeicons/core-free-icons/RefreshIcon";
  import EllipsisIcon from "@hugeicons/core-free-icons/EllipsisIcon";
  import Loader2Icon from "@hugeicons/core-free-icons/Loading03Icon";
  import XIcon from "@hugeicons/core-free-icons/Cancel01Icon";
  import ChevronRightIcon from "@hugeicons/core-free-icons/ChevronRightIcon";
  import ChevronDownIcon from "@hugeicons/core-free-icons/ChevronDownIcon";
  import TextSearchIcon from "@hugeicons/core-free-icons/FileSearchIcon";
  import ListFilterIcon from "@hugeicons/core-free-icons/FilterIcon";
  import CaseSensitiveIcon from "@hugeicons/core-free-icons/CaseSensitiveIcon";
  import WholeWordIcon from "@hugeicons/core-free-icons/TextIcon";
  import RegexIcon from "@hugeicons/core-free-icons/RegexIcon";

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
    // Closing search drops both queries but keeps the filters and match modes, so
    // reopening it resumes the setup the user built.
    if (!searching) fileTree.resetSearch();
  }
  // "Find in Folder" (from a row's context menu) sets a scope — open the search UI.
  $effect(() => {
    if (fileTree.searchScope) searching = true;
  });
  // Re-run the project-wide searches whenever an input they depend on changes
  // (reading them here registers the effect's dependencies). The two are separate
  // effects so typing in one box doesn't restart the other's walk — but both watch
  // the shared scope / filters / hidden toggle.
  $effect(() => {
    void fileTree.query;
    void fileTree.searchScope;
    void fileTree.showHidden;
    void fileTree.filterInclude;
    void fileTree.filterExclude;
    fileTree.scheduleSearch();
  });
  $effect(() => {
    void fileTree.contentQuery;
    void fileTree.contentCaseSensitive;
    void fileTree.contentWholeWord;
    void fileTree.contentRegex;
    void fileTree.searchScope;
    void fileTree.showHidden;
    void fileTree.filterInclude;
    void fileTree.filterExclude;
    fileTree.scheduleContentSearch();
  });
  const queryActive = $derived(fileTree.query.trim().length > 0);
  /** Content search is driving the list (it wins over the filename list: it is the
   *  more specific ask, and narrowing *which files* is what the glob filters do). */
  const contentActive = $derived(fileTree.contentQuery.length > 0);
  const hasFilters = $derived(
    fileTree.filterInclude.trim().length > 0 || fileTree.filterExclude.trim().length > 0,
  );
  /** The normal lazy tree is what's on screen (no search list covering it). */
  const showingTree = $derived(!contentActive && !queryActive);
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

  // --- The tree follows the file you're looking at --------------------------
  // Opening a search hit must not close the search — the user closes that when
  // they're done — so instead the tree quietly keeps up behind it: the open file's
  // ancestors are expanded and its row is marked and scrolled into view. Closing
  // the search then reveals a tree already pointing at the file. The mark follows
  // `terminals.activeFilePath`, so it moves between file tabs and disappears with
  // the last one.
  const activeFilePath = $derived(terminals.activeFilePath);
  let treeEl = $state<HTMLDivElement>();

  $effect(() => {
    const path = activeFilePath;
    // Also re-run when the tree comes back into view, so a file opened while the
    // search list covered it gets scrolled to on close.
    void showingTree;
    if (!path) return;
    // `revealFile` reads and writes the store's expansion state; untracked so this
    // effect depends on the open file alone and can't re-trigger itself.
    untrack(() => void revealActiveFile(path));
  });

  async function revealActiveFile(path: string): Promise<void> {
    await fileTree.revealFile(path);
    await tick();
    const row = treeEl?.querySelector(`[data-path="${CSS.escape(path)}"]`);
    row?.scrollIntoView({ block: "nearest" });
  }

  // --- Content-search results ----------------------------------------------
  /** Result files the user folded shut (reset whenever a new result set lands). */
  let contentCollapsed = $state(new Set<string>());
  $effect(() => {
    void fileTree.contentResults;
    contentCollapsed = new Set();
  });
  function toggleContentFile(path: string): void {
    const next = new Set(contentCollapsed);
    if (next.has(path)) next.delete(path);
    else next.add(path);
    contentCollapsed = next;
  }
  /** Open a matched line in the editor, scrolled to it. */
  function openMatch(file: ContentFileMatch, m: ContentMatch): void {
    terminals.openFileAtLine(file.path, root, m.line);
  }
  /** Folder of a result file, worktree-relative (the dimmed part of its row). */
  function dirLabel(path: string): string {
    const rel = relOf(path);
    const i = rel.lastIndexOf("/");
    return i > 0 ? rel.slice(0, i) : "";
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
  // Create + rename are inline (VSCode-style: an editable row — see `startCreate` /
  // `openRename`); delete still uses the mounted-once confirm dialog below.
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

  // Rename is inline (VSCode-style: the row shows an editable input in place of its
  // name). Delete opens the confirm dialog. Both are deferred one macrotask so the
  // context menu that triggered them fully closes first — for the dialog this also lets
  // bits-ui release the body pointer-lock before it snapshots the style (F2 has no menu
  // open, so the defer is simply harmless there).
  function openRename(entry: FsEntry): void {
    deferModalOpen(() => (fileTree.renamingPath = entry.path));
  }
  async function commitRename(entry: FsEntry, name: string): Promise<void> {
    await fileTree.renameEntry(entry, name); // throws → the inline input shows the error
    fileTree.renamingPath = null;
  }
  function cancelRename(): void {
    fileTree.renamingPath = null;
  }
  function openDelete(entry: FsEntry): void {
    deleteTarget = entry;
    deleteError = null;
    deferModalOpen(() => (deleteOpen = true));
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

  // Recipes for the two collapsible search sections — quiet rows, not cards (this
  // is a dense panel, and the tree below is the surface that matters).
  const sectionTrigger = cn(
    "flex h-7 w-full items-center gap-1.5 rounded-md px-1.5 hover:bg-accent/40",
    text.meta,
  );
  const sectionField = cn(
    "h-7 w-full min-w-0 rounded-md border border-sidebar-border/60 bg-sidebar-foreground/5 px-2 text-[12px] text-foreground outline-none transition-colors placeholder:text-muted-foreground/60 focus-visible:border-ring",
  );
  /** A match-mode toggle (Aa / whole word / regex) in the content input. */
  function modeButton(on: boolean): string {
    return cn(
      "flex size-5 shrink-0 items-center justify-center rounded transition-colors",
      on ? "bg-primary/20 text-foreground" : "text-muted-foreground/70 hover:bg-accent/60",
    );
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
          <Icon icon={FolderIcon} class={cn(icon.decorative, "shrink-0")} />
          <span class="truncate">{scopeName}</span>
          <button
            type="button"
            class="shrink-0 hover:text-foreground"
            onclick={() => (fileTree.searchScope = null)}
            aria-label={i18n.t("fileTree.clearScope")}
          >
            <Icon icon={XIcon} class="size-3" />
          </button>
        </span>
      {/if}
      {#if fileTree.searchLoading}
        <Icon icon={Loader2Icon} class={cn(icon.decorative, "shrink-0 animate-spin text-muted-foreground")} />
      {:else}
        <Icon icon={SearchIcon} class={cn(icon.decorative, "shrink-0 text-muted-foreground")} />
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
          <Button
            variant="ghost"
            size="icon"
            class={iconButton.xs}
            {...tp}
            aria-label={i18n.t("common.close")}
            onclick={toggleSearch}
          >
            <Icon icon={XIcon} class={icon.action} />
          </Button>
        {/snippet}
      </TooltipSimple>
    {:else}
      <span class={cn("flex-1 truncate", text.section)}>{worktreeName}</span>
      {#if root}
        <!-- The tooltip is a hover affordance only; each icon button also carries its
             own `aria-label`, so the toolbar is usable by name (screen reader, tests). -->
        <TooltipSimple title={i18n.t("fileTree.search")}>
          {#snippet children(tp)}
            <Button
              variant="ghost"
              size="icon"
              class={iconButton.xs}
              {...tp}
              aria-label={i18n.t("fileTree.search")}
              onclick={toggleSearch}
            >
              <Icon icon={SearchIcon} class={icon.action} />
            </Button>
          {/snippet}
        </TooltipSimple>
        <TooltipSimple title={i18n.t("fileTree.collapseAll")}>
          {#snippet children(tp)}
            <Button
              variant="ghost"
              size="icon"
              class={iconButton.xs}
              {...tp}
              aria-label={i18n.t("fileTree.collapseAll")}
              onclick={() => fileTree.collapseAll()}
            >
              <Icon icon={FoldVerticalIcon} class={icon.action} />
            </Button>
          {/snippet}
        </TooltipSimple>
        <TooltipSimple title={i18n.t("fileTree.refresh")}>
          {#snippet children(tp)}
            <Button
              variant="ghost"
              size="icon"
              class={iconButton.xs}
              {...tp}
              aria-label={i18n.t("fileTree.refresh")}
              onclick={() => fileTree.refresh()}
            >
              <Icon icon={RefreshCwIcon} class={cn(icon.action, fileTree.loadingDir.size > 0 && "animate-spin")} />
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
                <Icon icon={EllipsisIcon} class={icon.action} />
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
              <Icon icon={FilePlusIcon} />
              {i18n.t("fileTree.newFile")}
            </DropdownMenu.Item>
            <DropdownMenu.Item
              class={text.menu}
              onclick={() => startCreate("folder", toolbarTargetDir())}
            >
              <Icon icon={FolderPlusIcon} />
              {i18n.t("fileTree.newFolder")}
            </DropdownMenu.Item>
            <DropdownMenu.Separator />
            <DropdownMenu.Item class={text.menu} onclick={reveal}>
              <Icon icon={FolderOpenIcon} />
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

  <!-- Advanced search: two sections that sit between the search bar and the tree,
       collapsed until the user opens them. They stay mounted while search is open
       so their inputs (and results) survive folding a section shut. -->
  {#if root && searching}
    <div class="shrink-0 border-b border-sidebar-border/60 px-1 py-1">
      <Collapsible.Root bind:open={fileTree.contentOpen}>
        <Collapsible.Trigger class={sectionTrigger}>
          <Icon icon={ChevronRightIcon}
            class={cn(icon.decorative, "shrink-0 transition-transform", fileTree.contentOpen && "rotate-90")}
          />
          <Icon icon={TextSearchIcon} class={cn(icon.decorative, "shrink-0")} />
          <span class="min-w-0 flex-1 truncate text-left">{i18n.t("fileTree.contentSection")}</span>
          <!-- Folded away, the section still reports what it is contributing. -->
          {#if contentActive && !fileTree.contentOpen}
            <span class="shrink-0 rounded bg-accent/60 px-1 tabular-nums">{fileTree.contentTotal}</span>
          {/if}
        </Collapsible.Trigger>
        <Collapsible.Content class="flex flex-col gap-1 px-1.5 pb-1.5 pt-1">
          <div class="flex items-center gap-1">
            <input
              type="text"
              placeholder={i18n.t("fileTree.contentPlaceholder")}
              bind:value={fileTree.contentQuery}
              class={cn(sectionField, "flex-1")}
              spellcheck="false"
              autocapitalize="off"
              autocomplete="off"
              onkeydown={(e) => e.key === "Escape" && (fileTree.contentQuery = "")}
            />
            <TooltipSimple title={i18n.t("fileTree.matchCase")}>
              {#snippet children(tp)}
                <button
                  {...tp}
                  type="button"
                  aria-pressed={fileTree.contentCaseSensitive}
                  aria-label={i18n.t("fileTree.matchCase")}
                  class={modeButton(fileTree.contentCaseSensitive)}
                  onclick={() => (fileTree.contentCaseSensitive = !fileTree.contentCaseSensitive)}
                >
                  <Icon icon={CaseSensitiveIcon} class={icon.decorative} />
                </button>
              {/snippet}
            </TooltipSimple>
            <TooltipSimple title={i18n.t("fileTree.matchWholeWord")}>
              {#snippet children(tp)}
                <button
                  {...tp}
                  type="button"
                  aria-pressed={fileTree.contentWholeWord}
                  aria-label={i18n.t("fileTree.matchWholeWord")}
                  class={modeButton(fileTree.contentWholeWord)}
                  onclick={() => (fileTree.contentWholeWord = !fileTree.contentWholeWord)}
                >
                  <Icon icon={WholeWordIcon} class={icon.decorative} />
                </button>
              {/snippet}
            </TooltipSimple>
            <TooltipSimple title={i18n.t("fileTree.matchRegex")}>
              {#snippet children(tp)}
                <button
                  {...tp}
                  type="button"
                  aria-pressed={fileTree.contentRegex}
                  aria-label={i18n.t("fileTree.matchRegex")}
                  class={modeButton(fileTree.contentRegex)}
                  onclick={() => (fileTree.contentRegex = !fileTree.contentRegex)}
                >
                  <Icon icon={RegexIcon} class={icon.decorative} />
                </button>
              {/snippet}
            </TooltipSimple>
          </div>
          {#if fileTree.contentError}
            <p class={cn("text-destructive", text.meta)}>{fileTree.contentError}</p>
          {/if}
        </Collapsible.Content>
      </Collapsible.Root>

      <Collapsible.Root bind:open={fileTree.filtersOpen}>
        <Collapsible.Trigger class={sectionTrigger}>
          <Icon icon={ChevronRightIcon}
            class={cn(icon.decorative, "shrink-0 transition-transform", fileTree.filtersOpen && "rotate-90")}
          />
          <Icon icon={ListFilterIcon} class={cn(icon.decorative, "shrink-0")} />
          <span class="min-w-0 flex-1 truncate text-left">{i18n.t("fileTree.filtersSection")}</span>
          {#if hasFilters && !fileTree.filtersOpen}
            <span class="size-1.5 shrink-0 rounded-full bg-primary"></span>
          {/if}
        </Collapsible.Trigger>
        <Collapsible.Content class="flex flex-col gap-1 px-1.5 pb-1.5 pt-1">
          <input
            type="text"
            placeholder={i18n.t("fileTree.includePlaceholder")}
            bind:value={fileTree.filterInclude}
            class={sectionField}
            spellcheck="false"
            autocapitalize="off"
            autocomplete="off"
            aria-label={i18n.t("fileTree.includeLabel")}
          />
          <input
            type="text"
            placeholder={i18n.t("fileTree.excludePlaceholder")}
            bind:value={fileTree.filterExclude}
            class={sectionField}
            spellcheck="false"
            autocapitalize="off"
            autocomplete="off"
            aria-label={i18n.t("fileTree.excludeLabel")}
          />
          <p class={text.meta}>{i18n.t("fileTree.filtersHint")}</p>
        </Collapsible.Content>
      </Collapsible.Root>
    </div>
  {/if}

  {#if !root}
    <p class={cn("p-3", text.meta)}>{i18n.t("rightPanel.selectWorktree")}</p>
  {:else}
    {#if fileTree.error}
      <p class={cn("px-3 py-1.5 text-destructive", text.body)}>{fileTree.error}</p>
    {/if}

    {#if contentActive}
      <!-- Content-search results: one collapsible group per file, each matched line
           opening the file at that line. -->
      {#if fileTree.contentResults.length === 0}
        <p class={cn("p-3", text.meta)}>
          {fileTree.contentLoading
            ? i18n.t("fileTree.searching")
            : fileTree.contentError
              ? i18n.t("fileTree.contentBadPattern")
              : i18n.t("fileTree.contentNoMatch")}
        </p>
      {:else}
        <div class="uxnan-scroll min-h-0 flex-1 overflow-auto px-1 py-1">
          {#each fileTree.contentResults as f (f.path)}
            {@const collapsed = contentCollapsed.has(f.path)}
            {@const dir = dirLabel(f.path)}
            <button
              type="button"
              class="flex h-7 w-full items-center gap-1 rounded-md px-1 text-left hover:bg-accent/40"
              onclick={() => toggleContentFile(f.path)}
            >
              {#if collapsed}
                <Icon icon={ChevronRightIcon} class={cn(icon.decorative, "shrink-0 text-muted-foreground")} />
              {:else}
                <Icon icon={ChevronDownIcon} class={cn(icon.decorative, "shrink-0 text-muted-foreground")} />
              {/if}
              <Icon icon={FileIcon}
                class={cn(icon.decorative, "shrink-0", fileColor(changes.fileMap.get(relOf(f.path))) || "text-muted-foreground")}
              />
              <span class={cn("shrink-0 truncate font-medium", text.body)}>{f.name}</span>
              {#if dir}
                <span class={cn("min-w-0 flex-1 truncate", text.meta)}>{dir}</span>
              {:else}
                <span class="min-w-0 flex-1"></span>
              {/if}
              <span class={cn("shrink-0 rounded bg-accent/60 px-1 tabular-nums", text.indicator)}>
                {f.matches.length}{f.truncated ? "+" : ""}
              </span>
            </button>
            {#if !collapsed}
              {#each f.matches as m, i (`${m.line}:${i}`)}
                <button
                  type="button"
                  class="flex h-6 w-full items-center gap-2 rounded-md pl-6 pr-1 text-left hover:bg-accent/40"
                  onclick={() => openMatch(f, m)}
                  title={i18n.t("fileTree.openAtLine", { line: m.line })}
                  aria-label={i18n.t("fileTree.openAtLine", { line: m.line })}
                >
                  <span class={cn("w-8 shrink-0 text-right tabular-nums", text.meta)}>{m.line}</span>
                  <!-- The backend hands us the line plus UTF-16 offsets, so the hit is
                       sliced out and marked without any HTML injection. -->
                  <span class="min-w-0 flex-1 truncate font-mono text-[12px]">
                    {#if m.elided}<span class="text-muted-foreground/60">…</span>{/if}<span
                      class="text-muted-foreground">{m.text.slice(0, m.start)}</span
                    ><span class="rounded-[2px] bg-primary/25 text-foreground"
                      >{m.text.slice(m.start, m.end)}</span
                    ><span class="text-muted-foreground">{m.text.slice(m.end)}</span>
                  </span>
                </button>
              {/each}
            {/if}
          {/each}
          {#if fileTree.contentTruncated}
            <p class={cn("px-2 py-1.5", text.meta)}>{i18n.t("fileTree.searchTruncated")}</p>
          {/if}
        </div>
      {/if}
    {:else if queryActive}
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
              activeFile={r.entry.path === activeFilePath}
              selected={fileTree.selectedEntry?.path === r.entry.path}
              renaming={fileTree.renamingPath === r.entry.path}
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
              onRenameCommit={(name) => commitRename(r.entry, name)}
              onRenameCancel={cancelRename}
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
      <div bind:this={treeEl} class="uxnan-scroll flex min-h-0 flex-1 flex-col overflow-auto px-1 py-1">
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
              activeFile={r.entry.path === activeFilePath}
              selected={fileTree.selectedEntry?.path === r.entry.path}
              renaming={fileTree.renamingPath === r.entry.path}
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
              onRenameCommit={(name) => commitRename(r.entry, name)}
              onRenameCancel={cancelRename}
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
              <Icon icon={FilePlusIcon} />
              {i18n.t("fileTree.newFile")}
            </ContextMenu.Item>
            <ContextMenu.Item class={text.menu} onclick={() => startCreate("folder", root)}>
              <Icon icon={FolderPlusIcon} />
              {i18n.t("fileTree.newFolder")}
            </ContextMenu.Item>
            <ContextMenu.Separator />
            <ContextMenu.Item class={text.menu} onclick={reveal}>
              <Icon icon={FolderOpenIcon} />
              {i18n.t("fileTree.reveal")}
            </ContextMenu.Item>
            <ContextMenu.Item class={text.menu} onclick={() => fileTree.collapseAll()}>
              <Icon icon={FoldVerticalIcon} />
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
      <Icon icon={FolderIcon} class={cn(icon.decorative, "shrink-0 text-muted-foreground")} />
    {:else}
      <Icon icon={FileIcon} class={cn(icon.decorative, "shrink-0 text-muted-foreground")} />
    {/if}
    <span class="max-w-56 truncate">{fileDrag.entry.name}</span>
  </div>
{/if}

<!-- Delete confirm, mounted once (rename + create are inline in the tree). -->
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
