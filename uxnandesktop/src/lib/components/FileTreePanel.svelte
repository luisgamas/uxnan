<script lang="ts">
  // File-tree tab: the active worktree/project's full working tree, lazily
  // expanded one folder at a time (state lives in the `fileTree` store so it
  // survives tab switches). Files — and the folders that contain them — with a
  // git-tracked change are colored, mirroring the right-panel review. Clicking a
  // file opens it in the center editor. Toolbar: search, collapse/expand all,
  // reveal the worktree in the OS file manager, refresh.
  import type { FsEntry } from "$lib/types";
  import { projects } from "$lib/state/projects.svelte";
  import { git, type FileEntry } from "$lib/state/git.svelte";
  import { files } from "$lib/state/files.svelte";
  import { fileTree } from "$lib/state/fileTree.svelte";
  import { revealPath } from "$lib/api";
  import { cn } from "$lib/utils";
  import { icon, text } from "$lib/design";
  import { i18n } from "$lib/i18n";
  import { Button } from "$lib/components/ui/button";
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
    if (!searching) fileTree.query = "";
  }

  function openFile(entry: FsEntry): void {
    git.closeDiff(); // editor + diff share the center overlay — keep one open
    void files.open(entry.path, root);
  }

  function reveal(): void {
    if (root) void revealPath(root);
  }

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
    if (root) walk(root, 0);
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
  <header class="flex h-9 shrink-0 items-center gap-0.5 border-b border-sidebar-border px-2">
    {#if searching}
      <!-- svelte-ignore a11y_autofocus -->
      <input
        autofocus
        type="text"
        placeholder={i18n.t("fileTree.searchPlaceholder")}
        bind:value={fileTree.query}
        class={cn(
          "min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted-foreground/60",
          text.body,
        )}
        onkeydown={(e) => e.key === "Escape" && toggleSearch()}
      />
      <Button variant="ghost" size="icon" class="size-6" title={i18n.t("common.close")} onclick={toggleSearch}>
        <XIcon class={icon.button} />
      </Button>
    {:else}
      <span class={cn("flex-1 truncate", text.section)} title={root ?? ""}>{worktreeName}</span>
      {#if root}
        <Button variant="ghost" size="icon" class="size-6" title={i18n.t("fileTree.search")} onclick={toggleSearch}>
          <SearchIcon class={icon.button} />
        </Button>
        <Button variant="ghost" size="icon" class="size-6" title={i18n.t("fileTree.collapseAll")} onclick={() => fileTree.collapseAll()}>
          <FoldVerticalIcon class={icon.button} />
        </Button>
        <!-- "Expand all" (UnfoldVertical → fileTree.expandAll) is implemented but
             hidden for now: recursively loading a large tree is too slow. Re-enable
             once it's lazy/bounded enough to feel instant. FOR-DEV. -->
        <Button variant="ghost" size="icon" class="size-6" title={i18n.t("fileTree.reveal")} onclick={reveal}>
          <FolderOpenIcon class={icon.button} />
        </Button>
        <Button variant="ghost" size="icon" class="size-6" title={i18n.t("fileTree.refresh")} onclick={() => fileTree.refresh()}>
          <RefreshCwIcon class={cn(icon.button, fileTree.loadingDir.size > 0 && "animate-spin")} />
        </Button>
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
          {@const isOpen = files.path === r.entry.path}
          {@const isExpanded = fileTree.expanded.has(r.entry.path)}
          {@const changed = r.entry.isDir
            ? changes.dirs.has(rel)
            : changes.fileMap.has(rel)}
          {@const color = r.entry.isDir
            ? changed
              ? "text-amber-600 dark:text-amber-400"
              : ""
            : fileColor(changes.fileMap.get(rel))}
          <button
            type="button"
            class={cn(
              "flex h-7 w-full items-center gap-1 rounded-md pr-1 text-left",
              isOpen ? "bg-primary/15 ring-1 ring-inset ring-primary/25" : "hover:bg-accent/40",
            )}
            style="padding-left: {r.depth * 12 + 2}px"
            title={rel}
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
            <span class={cn("min-w-0 flex-1 truncate", text.body, color, (changed || isOpen) && "font-medium")}>
              {r.entry.name}
            </span>
          </button>
        {/each}
      </div>
    {/if}
  {/if}
</div>
