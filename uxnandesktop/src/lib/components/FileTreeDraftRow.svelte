<script lang="ts">
  // The inline "New File" / "New Folder" input row (VSCode-style): instead of a
  // modal, an editable row is inserted into the tree at the creation site. The
  // typed value may be an intercalated path (`folder/file.js`) — the backend
  // creates the intermediate folders. Enter commits; Escape cancels; blur commits
  // when valid (else cancels), matching VSCode. A failed commit shows the backend
  // error inline and keeps the row focused. Rendered by `FileTreePanel` inside the
  // flattened tree, indented to match its sibling rows.
  import { cn } from "$lib/utils";
  import { icon, text } from "$lib/design";
  import { i18n } from "$lib/i18n";
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

  let value = $state("");
  let busy = $state(false);
  let error = $state<string | null>(null);
  // Guards against a late blur firing after Enter/Escape already resolved the draft.
  let settled = false;

  /** Focus + reveal the input once it mounts (the menu that opened it has closed). */
  function focusInput(el: HTMLInputElement) {
    queueMicrotask(() => {
      el.focus();
      el.scrollIntoView({ block: "nearest" });
    });
  }

  async function commit(fromBlur: boolean) {
    if (busy || settled) return;
    const name = value.trim();
    if (!name) {
      cancel();
      return;
    }
    busy = true;
    error = null;
    try {
      await oncommit(name);
      settled = true; // parent clears the draft → this row unmounts
    } catch (e) {
      // On blur the field has already lost focus, so drop the draft rather than
      // leaving an unfocused, error-stuck row; on Enter keep it open to fix.
      if (fromBlur) {
        cancel();
        return;
      }
      error = e instanceof Error ? e.message : i18n.t("fileTree.invalidName");
      busy = false;
    }
  }

  function cancel() {
    if (settled) return;
    settled = true;
    oncancel();
  }
</script>

<div class="flex flex-col">
  <div
    class="flex h-7 w-full items-center gap-1 rounded-md pr-1"
    style="padding-left: {depth * 12 + 2}px"
  >
    <span class="w-3 shrink-0"></span>
    {#if kind === "folder"}
      <FolderIcon class={cn(icon.decorative, "shrink-0 text-muted-foreground")} />
    {:else}
      <FileIcon class={cn(icon.decorative, "shrink-0 text-muted-foreground")} />
    {/if}
    <!-- svelte-ignore a11y_autofocus -->
    <input
      use:focusInput
      bind:value
      spellcheck={false}
      autocomplete="off"
      placeholder={kind === "folder"
        ? i18n.t("fileTree.newFolderPlaceholder")
        : i18n.t("fileTree.newFilePlaceholder")}
      aria-label={kind === "folder"
        ? i18n.t("fileTree.newFolderTitle")
        : i18n.t("fileTree.newFileTitle")}
      aria-invalid={error ? "true" : undefined}
      class={cn(
        "min-w-0 flex-1 rounded-sm border bg-background px-1.5 py-0.5 outline-none placeholder:text-muted-foreground/50",
        text.body,
        error
          ? "border-destructive focus-visible:ring-2 focus-visible:ring-destructive/30"
          : "border-ring/50 focus-visible:ring-2 focus-visible:ring-ring/30",
      )}
      onkeydown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          void commit(false);
        } else if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          cancel();
        }
      }}
      onblur={() => void commit(true)}
    />
  </div>
  {#if error}
    <p
      class="pb-1 pr-1 text-[11px] leading-4 break-words text-destructive"
      style="padding-left: {depth * 12 + 20}px"
    >
      {error}
    </p>
  {/if}
</div>
