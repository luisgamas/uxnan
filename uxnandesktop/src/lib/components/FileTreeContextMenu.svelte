<script lang="ts">
  // The right-click menu body for one file-tree entry (rendered inside the row's
  // `<ContextMenu.Root>`, like `RowActionsMenu` for worktrees). Actions that need a
  // dialog (New File/Folder, Rename, Delete) are raised to the panel via callbacks
  // so the dialogs mount once; everything else calls the stores directly. Items are
  // shown/hidden by entry kind, mirroring an IDE file tree.
  //
  // A second axis since the tree can be of another machine: an action that only
  // this machine can carry out is **not offered** for a host's entry rather than
  // offered and failing — revealing a path in this Explorer, opening it in a
  // local editor, searching (which walks this filesystem) and registering a
  // folder as a local project. What is offered there is what genuinely runs
  // there: create, rename, duplicate, delete, copy path, open a terminal.
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
  /** This entry lives on another machine. */
  const remote = $derived(!fileTree.deletesToTrash);
  /** Something can be sent to that machine — a host that dropped can be read but
   *  not changed, so the actions that change it stand down rather than fail. */
  const canMutate = $derived(fileTree.mutable);

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

<ContextMenu.Content width="wide">
  <ContextMenu.Item class={text.menu} disabled={!canMutate} onclick={onNewFile}>
    <Icon icon={FilePlusIcon} />
    {i18n.t("fileTree.newFile")}
  </ContextMenu.Item>
  <ContextMenu.Item class={text.menu} disabled={!canMutate} onclick={onNewFolder}>
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
    <ContextMenu.Item
      class={text.menu}
      disabled={!canMutate}
      onclick={() => void fileTree.duplicateEntry(entry)}
    >
      <Icon icon={FilesIcon} />
      {i18n.t("fileTree.duplicate")}
    </ContextMenu.Item>
  {/if}
  {#if canAddAsProject && !remote}
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
  {#if entry.isDir && fileTree.searchable}
    <ContextMenu.Item class={text.menu} onclick={findInFolder}>
      <Icon icon={SearchIcon} />
      {i18n.t("fileTree.findInFolder")}
    </ContextMenu.Item>
  {/if}
  {#if !remote}
    <!-- Both act on *this* machine: an external editor and this Explorer cannot
         open a folder that is on another one. -->
    <OpenWith
      menu={ContextMenu}
      path={entry.path}
      textFile={!entry.isDir && isTextFile(entry.name)}
    />
    <ContextMenu.Item class={text.menu} onclick={() => void revealPath(entry.path)}>
      <Icon icon={FolderOpenIcon} />
      {i18n.t("fileTree.reveal")}
    </ContextMenu.Item>
  {/if}

  <ContextMenu.Separator />

  <ContextMenu.Item class={text.menu} disabled={!canMutate} onclick={onRename}>
    <Icon icon={PencilIcon} />
    {i18n.t("common.rename")}
  </ContextMenu.Item>
  <ContextMenu.Item
    variant="destructive"
    class={text.menu}
    disabled={!canMutate}
    onclick={onDelete}
  >
    <Icon icon={Trash2Icon} />
    {i18n.t("fileTree.delete")}
  </ContextMenu.Item>
</ContextMenu.Content>
