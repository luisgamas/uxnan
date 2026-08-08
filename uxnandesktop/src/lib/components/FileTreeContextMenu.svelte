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
  import { isTextFile } from "$lib/fileType";
  import { text } from "$lib/design";
  import { i18n } from "$lib/i18n";
  import type { FsEntry } from "$lib/types";
  import OpenWith from "./OpenWith.svelte";
  import { Icon } from "$lib/components/ui/icon";
  import FilePlusIcon from "@hugeicons/core-free-icons/FilePlusIcon";
  import FolderPlusIcon from "@hugeicons/core-free-icons/FolderAddIcon";
  import CopyIcon from "@hugeicons/core-free-icons/CopyIcon";
  import FilesIcon from "@hugeicons/core-free-icons/Files01Icon";
  import SquareTerminalIcon from "@hugeicons/core-free-icons/ComputerTerminal01Icon";
  import FileIcon from "@hugeicons/core-free-icons/File01Icon";
  import FolderOpenIcon from "@hugeicons/core-free-icons/FolderOpenIcon";
  import ListCollapseIcon from "@hugeicons/core-free-icons/ListChevronsDownUpIcon";
  import SearchIcon from "@hugeicons/core-free-icons/Search01Icon";
  import PencilIcon from "@hugeicons/core-free-icons/PencilIcon";
  import Trash2Icon from "@hugeicons/core-free-icons/Delete02Icon";

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
    <Icon icon={FilePlusIcon} />
    {i18n.t("fileTree.newFile")}
  </ContextMenu.Item>
  <ContextMenu.Item class={text.menu} onclick={onNewFolder}>
    <Icon icon={FolderPlusIcon} />
    {i18n.t("fileTree.newFolder")}
  </ContextMenu.Item>

  <ContextMenu.Separator />

  <ContextMenu.Item class={text.menu} onclick={() => void clipboardWrite(entry.path)}>
    <Icon icon={CopyIcon} />
    {i18n.t("common.copyPath")}
  </ContextMenu.Item>
  <ContextMenu.Item class={text.menu} onclick={() => void clipboardWrite(rel)}>
    <Icon icon={CopyIcon} />
    {i18n.t("fileTree.copyRelativePath")}
  </ContextMenu.Item>

  {#if !entry.isDir}
    <ContextMenu.Item class={text.menu} onclick={() => void fileTree.duplicateEntry(entry)}>
      <Icon icon={FilesIcon} />
      {i18n.t("fileTree.duplicate")}
    </ContextMenu.Item>
  {/if}
  {#if canAddAsProject}
    <ContextMenu.Item class={text.menu} onclick={() => void projects.addProjectPaths([entry.path])}>
      <Icon icon={FolderPlusIcon} />
      {i18n.t("fileTree.addAsProject")}
    </ContextMenu.Item>
  {/if}
  {#if entry.isDir}
    <ContextMenu.Item class={text.menu} onclick={openInTerminal}>
      <Icon icon={SquareTerminalIcon} />
      {i18n.t("fileTree.openInTerminal")}
    </ContextMenu.Item>
  {:else}
    <ContextMenu.Item class={text.menu} onclick={() => terminals.openFile(entry.path, root)}>
      <Icon icon={FileIcon} />
      {i18n.t("fileTree.viewFile")}
    </ContextMenu.Item>
  {/if}
  {#if entry.isDir && isExpanded}
    <ContextMenu.Item class={text.menu} onclick={() => fileTree.collapseSubtree(entry.path)}>
      <Icon icon={ListCollapseIcon} />
      {i18n.t("fileTree.collapseFolder")}
    </ContextMenu.Item>
  {/if}
  {#if entry.isDir}
    <ContextMenu.Item class={text.menu} onclick={findInFolder}>
      <Icon icon={SearchIcon} />
      {i18n.t("fileTree.findInFolder")}
    </ContextMenu.Item>
  {/if}
  <OpenWith menu={ContextMenu} path={entry.path} textFile={!entry.isDir && isTextFile(entry.name)} />
  <ContextMenu.Item class={text.menu} onclick={() => void revealPath(entry.path)}>
    <Icon icon={FolderOpenIcon} />
    {i18n.t("fileTree.reveal")}
  </ContextMenu.Item>

  <ContextMenu.Separator />

  <ContextMenu.Item class={text.menu} onclick={onRename}>
    <Icon icon={PencilIcon} />
    {i18n.t("common.rename")}
  </ContextMenu.Item>
  <ContextMenu.Item variant="destructive" class={text.menu} onclick={onDelete}>
    <Icon icon={Trash2Icon} />
    {i18n.t("fileTree.delete")}
  </ContextMenu.Item>
</ContextMenu.Content>
