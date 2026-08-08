<script lang="ts">
  // One file-tree row (chevron + indentation + git-change color), shared by the
  // lazy tree and the search-results tree (both render the same folder/file design).
  // Wrapped in the row context menu and carrying the pointer-drag gesture that drops
  // a path into a terminal — Tauri suppresses HTML5 dnd in the webview, so the drag
  // is pointer-based and the panel owns the gesture state, passing begin/move/end here.
  import type { FsEntry } from "$lib/types";
  import { cn } from "$lib/utils";
  import { icon, text } from "$lib/design";
  import { i18n } from "$lib/i18n";
  import { TooltipSimple } from "$lib/components/ui/tooltip";
  import * as ContextMenu from "$lib/components/ui/context-menu";
  import FileTreeContextMenu from "./FileTreeContextMenu.svelte";
  import TreeInlineInput from "./TreeInlineInput.svelte";
  import { Icon } from "$lib/components/ui/icon";
  import ChevronRightIcon from "@hugeicons/core-free-icons/ChevronRightIcon";
  import ChevronDownIcon from "@hugeicons/core-free-icons/ChevronDownIcon";
  import FolderIcon from "@hugeicons/core-free-icons/Folder01Icon";
  import FileIcon from "@hugeicons/core-free-icons/File01Icon";

  let {
    entry,
    depth = 0,
    isExpanded = false,
    isOpen = false,
    activeFile = false,
    selected = false,
    renaming = false,
    changed = false,
    color = "",
    ignored = false,
    rel,
    root,
    onActivate,
    onNewFile,
    onNewFolder,
    onRename,
    onDelete,
    onRenameCommit,
    onRenameCancel,
    beginDrag,
    moveDrag,
    endDrag,
  }: {
    entry: FsEntry;
    depth?: number;
    isExpanded?: boolean;
    isOpen?: boolean;
    /** This is the file the center area is showing — a quiet background mark that
     *  follows the viewer, independent of the click selection. */
    activeFile?: boolean;
    /** The last-clicked row — drives the selection highlight + toolbar create target. */
    selected?: boolean;
    /** When true, the row shows an inline rename input in place of the name. */
    renaming?: boolean;
    changed?: boolean;
    /** Git-change color class (empty for an unchanged entry). */
    color?: string;
    ignored?: boolean;
    /** Worktree-relative path (tooltip + Copy Relative Path). */
    rel: string;
    root: string | null;
    onActivate: () => void;
    onNewFile: () => void;
    onNewFolder: () => void;
    onRename: () => void;
    onDelete: () => void;
    /** Persist the inline rename (new bare name). Throw to show the error inline. */
    onRenameCommit: (name: string) => Promise<void>;
    onRenameCancel: () => void;
    beginDrag: (e: PointerEvent, entry: FsEntry) => void;
    moveDrag: (e: PointerEvent) => void;
    /** Ends the gesture; returns true when it was a drag (suppress the click). */
    endDrag: (e: PointerEvent) => boolean;
  } = $props();

  // Suppress the click that a completed pointer-drag would otherwise fire.
  let dragged = false;
</script>

{#if renaming}
  {#snippet renameIcon()}
    {#if entry.isDir}
      {#if isExpanded}
        <Icon icon={ChevronDownIcon} class={cn(icon.decorative, "shrink-0 text-muted-foreground")} />
      {:else}
        <Icon icon={ChevronRightIcon} class={cn(icon.decorative, "shrink-0 text-muted-foreground")} />
      {/if}
      <Icon icon={FolderIcon} class={cn(icon.decorative, "shrink-0", changed ? color : "text-muted-foreground")} />
    {:else}
      <span class="w-3 shrink-0"></span>
      <Icon icon={FileIcon} class={cn(icon.decorative, "shrink-0", color || "text-muted-foreground")} />
    {/if}
  {/snippet}
  <TreeInlineInput
    indent={depth * 12 + 2}
    icon={renameIcon}
    initial={entry.name}
    select="basename"
    ariaLabel={i18n.t("fileTree.renameTitle")}
    oncommit={onRenameCommit}
    oncancel={onRenameCancel}
  />
{:else}
<ContextMenu.Root>
  <ContextMenu.Trigger>
    {#snippet child({ props })}
      <TooltipSimple title={rel}>
        {#snippet children(tp)}
          <button
            {...tp}
            {...props}
            type="button"
            data-path={entry.path}
            class={cn(
              "flex h-7 w-full items-center gap-1 rounded-md pr-1 text-left",
              // Two independent marks, in priority order. The *selection* (last-clicked
              // row) is the loud one and clears on Esc / a click in the empty area —
              // VSCode-style. Under it, the file the center area is currently showing
              // keeps a quiet neutral fill, so after a search you can see where the file
              // you opened lives without it competing with the selection. Merely being
              // open in some tab still gets nothing but bolder text (below).
              selected
                ? "bg-primary/15 ring-1 ring-inset ring-primary/25"
                : activeFile
                  ? "bg-foreground/[0.055] hover:bg-foreground/[0.075]"
                  : "hover:bg-accent/40",
            )}
            style="padding-left: {depth * 12 + 2}px"
            onpointerdown={(e) => {
              dragged = false;
              beginDrag(e, entry);
            }}
            onpointermove={moveDrag}
            onpointerup={(e) => {
              if (endDrag(e)) dragged = true;
            }}
            onclick={() => {
              if (dragged) {
                dragged = false;
                return;
              }
              onActivate();
            }}
          >
            {#if entry.isDir}
              {#if isExpanded}
                <Icon icon={ChevronDownIcon} class={cn(icon.decorative, "shrink-0 text-muted-foreground")} />
              {:else}
                <Icon icon={ChevronRightIcon} class={cn(icon.decorative, "shrink-0 text-muted-foreground")} />
              {/if}
              <Icon icon={FolderIcon}
                class={cn(icon.decorative, "shrink-0", changed ? color : "text-muted-foreground")}
              />
            {:else}
              <span class="w-3 shrink-0"></span>
              <Icon icon={FileIcon} class={cn(icon.decorative, "shrink-0", color || "text-muted-foreground")} />
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
              {entry.name}
            </span>
          </button>
        {/snippet}
      </TooltipSimple>
    {/snippet}
  </ContextMenu.Trigger>
  <FileTreeContextMenu {entry} {rel} {isExpanded} {root} {onNewFile} {onNewFolder} {onRename} {onDelete} />
</ContextMenu.Root>
{/if}
