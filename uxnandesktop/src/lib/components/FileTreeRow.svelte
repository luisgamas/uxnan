<script lang="ts">
  // One file-tree row (chevron + indentation + git-change color), shared by the
  // lazy tree and the search-results tree (both render the same folder/file design).
  // Wrapped in the row context menu and carrying the pointer-drag gesture that drops
  // a path into a terminal — Tauri suppresses HTML5 dnd in the webview, so the drag
  // is pointer-based and the panel owns the gesture state, passing begin/move/end here.
  import type { FsEntry } from "$lib/types";
  import { cn } from "$lib/utils";
  import { icon, text } from "$lib/design";
  import { TooltipSimple } from "$lib/components/ui/tooltip";
  import * as ContextMenu from "$lib/components/ui/context-menu";
  import FileTreeContextMenu from "./FileTreeContextMenu.svelte";
  import ChevronRightIcon from "@lucide/svelte/icons/chevron-right";
  import ChevronDownIcon from "@lucide/svelte/icons/chevron-down";
  import FolderIcon from "@lucide/svelte/icons/folder";
  import FileIcon from "@lucide/svelte/icons/file";

  let {
    entry,
    depth = 0,
    isExpanded = false,
    isOpen = false,
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
    beginDrag,
    moveDrag,
    endDrag,
  }: {
    entry: FsEntry;
    depth?: number;
    isExpanded?: boolean;
    isOpen?: boolean;
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
    beginDrag: (e: PointerEvent, entry: FsEntry) => void;
    moveDrag: (e: PointerEvent) => void;
    /** Ends the gesture; returns true when it was a drag (suppress the click). */
    endDrag: (e: PointerEvent) => boolean;
  } = $props();

  // Suppress the click that a completed pointer-drag would otherwise fire.
  let dragged = false;
</script>

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
              isOpen ? "bg-primary/15 ring-1 ring-inset ring-primary/25" : "hover:bg-accent/40",
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
              {entry.name}
            </span>
          </button>
        {/snippet}
      </TooltipSimple>
    {/snippet}
  </ContextMenu.Trigger>
  <FileTreeContextMenu {entry} {rel} {isExpanded} {root} {onNewFile} {onNewFolder} {onRename} {onDelete} />
</ContextMenu.Root>
