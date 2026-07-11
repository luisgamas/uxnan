<script lang="ts">
  // Name-entry dialog shared by the file tree's New File / New Folder / Rename
  // actions. Validates a bare name up front (mirroring the backend guard), warns
  // when a rename changes/drops the extension, and surfaces the backend error
  // inline when `onsubmit` throws. Mounted once by the panel; `open` drives it and
  // the field re-seeds from `initial` each time it opens.
  import * as Dialog from "$lib/components/ui/dialog";
  import { Button } from "$lib/components/ui/button";
  import { Input } from "$lib/components/ui/input";
  import { cn } from "$lib/utils";
  import { text } from "$lib/design";
  import { i18n } from "$lib/i18n";
  import FileWarningIcon from "@lucide/svelte/icons/triangle-alert";
  import PencilIcon from "@lucide/svelte/icons/pencil";

  let {
    open = $bindable(false),
    title,
    submitLabel,
    initial = "",
    placeholder = "",
    isRename = false,
    onsubmit,
  }: {
    open?: boolean;
    title: string;
    submitLabel: string;
    /** Pre-filled value (the current name for rename; "" for a new entry). */
    initial?: string;
    placeholder?: string;
    /** Enables the extension-change warning + "unchanged" guard for renames. */
    isRename?: boolean;
    /** Persist the entered (trimmed) name. Throw to show the message inline. */
    onsubmit: (value: string) => Promise<void>;
  } = $props();

  let value = $state("");
  let busy = $state(false);
  let error = $state<string | null>(null);

  // Re-seed the field each time the dialog opens (it stays mounted between uses).
  $effect(() => {
    if (open) {
      value = initial;
      error = null;
      busy = false;
    }
  });

  /** The extension (with leading dot) of a bare name; "" for none/dotfiles. */
  function ext(name: string): string {
    const i = name.trim().lastIndexOf(".");
    return i > 0 ? name.trim().slice(i) : "";
  }
  const oldExt = $derived(ext(initial));
  const newExt = $derived(ext(value));
  const extChanged = $derived(isRename && value.trim().length > 0 && newExt !== oldExt);

  // Reject empties and any path fragment up front (the backend guards too).
  const trimmed = $derived(value.trim());
  const invalid = $derived(
    trimmed.length === 0 ||
      value.includes("/") ||
      value.includes("\\") ||
      trimmed === "." ||
      trimmed === "..",
  );
  const unchanged = $derived(isRename && trimmed === initial.trim());
  const canSubmit = $derived(!busy && !invalid && !unchanged);

  async function submit() {
    if (!canSubmit) return;
    busy = true;
    error = null;
    try {
      await onsubmit(trimmed);
      open = false;
    } catch (e) {
      error = e instanceof Error ? e.message : i18n.t("fileTree.invalidName");
    } finally {
      busy = false;
    }
  }
</script>

<Dialog.Root bind:open>
  <Dialog.Content class="sm:max-w-[440px]">
    <Dialog.Header>
      <Dialog.Title>{title}</Dialog.Title>
    </Dialog.Header>

    <div class="flex flex-col gap-3 py-1">
      <div class="relative">
        <PencilIcon
          class="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground/80"
        />
        <Input
          class="pl-8"
          bind:value
          {placeholder}
          autocomplete="off"
          spellcheck={false}
          onkeydown={(e) => e.key === "Enter" && submit()}
        />
      </div>

      {#if extChanged}
        <div
          class={cn(
            "flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-amber-700 dark:text-amber-300",
            text.body,
          )}
        >
          <FileWarningIcon class="mt-px size-4 shrink-0" />
          <span>
            {newExt
              ? i18n.t("tab.extChangeWarning", { old: oldExt || "—", new: newExt })
              : i18n.t("tab.extRemoveWarning")}
          </span>
        </div>
      {/if}

      {#if error}
        <p class="text-xs break-words text-destructive">{error}</p>
      {/if}
    </div>

    <Dialog.Footer>
      <Button disabled={!canSubmit} onclick={submit}>{submitLabel}</Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
