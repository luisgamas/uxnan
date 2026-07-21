<script lang="ts">
  // The inline "New File" / "New Folder" draft row (VSCode-style): an editable input
  // is inserted into the tree at the creation site instead of opening a modal. The
  // typed value may be an intercalated path (`folder/file.js`) — the backend creates
  // the intermediate folders. The input behavior (focus, commit/cancel, inline error)
  // lives in the shared `TreeInlineInput`; this only supplies the file/folder icon.
  import { cn } from "$lib/utils";
  import { icon } from "$lib/design";
  import { i18n } from "$lib/i18n";
  import TreeInlineInput from "./TreeInlineInput.svelte";
  import FolderIcon from "@lucide/svelte/icons/folder";
  import FileIcon from "@lucide/svelte/icons/file";

  let {
    kind,
    depth = 0,
    oncommit,
    oncancel,
  }: {
    kind: "file" | "folder";
    depth?: number;
    /** Persist the (trimmed) name/path. Throw to show the message inline. */
    oncommit: (value: string) => Promise<void>;
    oncancel: () => void;
  } = $props();
</script>

{#snippet leadingIcon()}
  <span class="w-3 shrink-0"></span>
  {#if kind === "folder"}
    <FolderIcon class={cn(icon.decorative, "shrink-0 text-muted-foreground")} />
  {:else}
    <FileIcon class={cn(icon.decorative, "shrink-0 text-muted-foreground")} />
  {/if}
{/snippet}

<TreeInlineInput
  indent={depth * 12 + 2}
  icon={leadingIcon}
  placeholder={kind === "folder"
    ? i18n.t("fileTree.newFolderPlaceholder")
    : i18n.t("fileTree.newFilePlaceholder")}
  ariaLabel={kind === "folder"
    ? i18n.t("fileTree.newFolderTitle")
    : i18n.t("fileTree.newFileTitle")}
  {oncommit}
  {oncancel}
/>
