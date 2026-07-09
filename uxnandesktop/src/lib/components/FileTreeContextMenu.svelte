<script lang="ts">
  // The right-click menu body for one file-tree entry (rendered inside the row's
  // `<ContextMenu.Root>`, like `RowActionsMenu` for worktrees). Actions that need a
  // dialog (New File/Folder, Rename, Delete) are raised to the panel via callbacks
  // so the dialogs mount once; everything else calls the stores directly. Items are
  // shown/hidden by entry kind, mirroring an IDE file tree.
  import * as ContextMenu from "$lib/components/ui/context-menu";
  import { app } from "$lib/state/app.svelte";
  import { projects } from "$lib/state/projects.svelte";
  import { terminals } from "$lib/state/terminals.svelte";
  import { fileTree } from "$lib/state/fileTree.svelte";
  import { clipboardWrite } from "$lib/clipboard";
  import { revealPath } from "$lib/api";
  import { text } from "$lib/design";
  import { i18n } from "$lib/i18n";
  import type { FsEntry } from "$lib/types";
  import FilePlusIcon from "@lucide/svelte/icons/file-plus";
  import FolderPlusIcon from "@lucide/svelte/icons/folder-plus";
  import CopyIcon from "@lucide/svelte/icons/copy";
  import FilesIcon from "@lucide/svelte/icons/files";
  import SquareTerminalIcon from "@lucide/svelte/icons/square-terminal";
  import FileIcon from "@lucide/svelte/icons/file";
  import FolderOpenIcon from "@lucide/svelte/icons/folder-open";
  import ListCollapseIcon from "@lucide/svelte/icons/list-collapse";
  import SearchIcon from "@lucide/svelte/icons/search";
  import PencilIcon from "@lucide/svelte/icons/pencil";
  import Trash2Icon from "@lucide/svelte/icons/trash-2";

  let {
    entry,
    rel,
    isExpanded,
    root,
    onNewFile,
    onNewFolder,
    onRename,
    onDelete,
  }: {
    entry: FsEntry;
    /** Worktree-relative path (for "Copy Relative Path"). */
    rel: string;
    isExpanded: boolean;
    /** Active worktree root (drives the change gutter + terminal workspace). */
    root: string | null;
    onNewFile: () => void;
    onNewFolder: () => void;
    onRename: () => void;
    onDelete: () => void;
  } = $props();

  const norm = (p: string) => p.replace(/\\/g, "/").replace(/\/+$/, "");
  // A folder can be added as a project unless it's already registered as one.
  const canAddAsProject = $derived(
    entry.isDir && !app.repos.some((r) => norm(r.path) === norm(entry.path)),
  );

  function openInTerminal(): void {
    // Open in the current worktree's workspace, starting in this folder.
    app.openTerminal({ cwd: entry.path, title: entry.name, workspace: root ?? undefined });
  }
  function findInFolder(): void {
    fileTree.searchScope = entry.path;
    fileTree.query = "";
    // The folder may be collapsed/unloaded — load it so results can surface.
    void fileTree.loadDir(entry.path);
  }
</script>

<ContextMenu.Content>
  <ContextMenu.Item class={text.menu} onclick={onNewFile}>
    <FilePlusIcon />
    {i18n.t("fileTree.newFile")}
  </ContextMenu.Item>
  <ContextMenu.Item class={text.menu} onclick={onNewFolder}>
    <FolderPlusIcon />
    {i18n.t("fileTree.newFolder")}
  </ContextMenu.Item>

  <ContextMenu.Separator />

  <ContextMenu.Item class={text.menu} onclick={() => void clipboardWrite(entry.path)}>
    <CopyIcon />
    {i18n.t("common.copyPath")}
  </ContextMenu.Item>
  <ContextMenu.Item class={text.menu} onclick={() => void clipboardWrite(rel)}>
    <CopyIcon />
    {i18n.t("fileTree.copyRelativePath")}
  </ContextMenu.Item>

  {#if !entry.isDir}
    <ContextMenu.Item class={text.menu} onclick={() => void fileTree.duplicateEntry(entry)}>
      <FilesIcon />
      {i18n.t("fileTree.duplicate")}
    </ContextMenu.Item>
  {/if}
  {#if canAddAsProject}
    <ContextMenu.Item class={text.menu} onclick={() => void projects.addProjectPaths([entry.path])}>
      <FolderPlusIcon />
      {i18n.t("fileTree.addAsProject")}
    </ContextMenu.Item>
  {/if}
  {#if entry.isDir}
    <ContextMenu.Item class={text.menu} onclick={openInTerminal}>
      <SquareTerminalIcon />
      {i18n.t("fileTree.openInTerminal")}
    </ContextMenu.Item>
  {:else}
    <ContextMenu.Item class={text.menu} onclick={() => terminals.openFile(entry.path, root)}>
      <FileIcon />
      {i18n.t("fileTree.viewFile")}
    </ContextMenu.Item>
  {/if}
  {#if entry.isDir && isExpanded}
    <ContextMenu.Item class={text.menu} onclick={() => fileTree.collapseSubtree(entry.path)}>
      <ListCollapseIcon />
      {i18n.t("fileTree.collapseFolder")}
    </ContextMenu.Item>
  {/if}
  {#if entry.isDir}
    <ContextMenu.Item class={text.menu} onclick={findInFolder}>
      <SearchIcon />
      {i18n.t("fileTree.findInFolder")}
    </ContextMenu.Item>
  {/if}
  <ContextMenu.Item class={text.menu} onclick={() => void revealPath(entry.path)}>
    <FolderOpenIcon />
    {i18n.t("fileTree.reveal")}
  </ContextMenu.Item>

  <ContextMenu.Separator />

  <ContextMenu.Item class={text.menu} onclick={onRename}>
    <PencilIcon />
    {i18n.t("common.rename")}
  </ContextMenu.Item>
  <ContextMenu.Item variant="destructive" class={text.menu} onclick={onDelete}>
    <Trash2Icon />
    {i18n.t("fileTree.delete")}
  </ContextMenu.Item>
</ContextMenu.Content>
