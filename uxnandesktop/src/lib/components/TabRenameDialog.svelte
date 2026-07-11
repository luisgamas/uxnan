<script lang="ts">
  // Renames a center-panel tab. For a terminal/diff/commit tab it's a free-form
  // label (stored as the tab's `customTitle`). For a FILE tab it renames the real
  // file on disk (same folder) — so it always shows a confirmation note that the
  // file itself is being renamed, plus a warning when the extension changes or is
  // dropped. Mounted only while a tab is being renamed (keyed by the parent).
  import * as Dialog from "$lib/components/ui/dialog";
  import { Button } from "$lib/components/ui/button";
  import { Input } from "$lib/components/ui/input";
  import { terminals, tabDisplayTitle, type GroupTab } from "$lib/state/terminals.svelte";
  import { cn } from "$lib/utils";
  import { text } from "$lib/design";
  import { i18n } from "$lib/i18n";
  import FileWarningIcon from "@lucide/svelte/icons/triangle-alert";
  import PencilIcon from "@lucide/svelte/icons/pencil";

  let {
    tab,
    onclose,
  }: {
    tab: GroupTab;
    /** Called once the dialog has closed (parent clears its target). */
    onclose: () => void;
  } = $props();

  const isFile = $derived(tab.kind === "file");
  const original = $derived(
    tab.kind === "file" ? (tab.path.split("/").pop() ?? tab.path) : tabDisplayTitle(tab),
  );

  let open = $state(true);
  let value = $state("");
  let busy = $state(false);
  let error = $state<string | null>(null);

  // Seed the field once on mount (the component is re-created per rename).
  $effect(() => {
    value = original;
  });
  // Closing (Escape / outside / Cancel / success) unmounts via the parent.
  $effect(() => {
    if (!open) onclose();
  });

  /** The extension (with leading dot) of a bare file name; "" for none/dotfiles. */
  function ext(name: string): string {
    const i = name.trim().lastIndexOf(".");
    return i > 0 ? name.trim().slice(i) : "";
  }
  const oldExt = $derived(ext(original));
  const newExt = $derived(ext(value));
  const extChanged = $derived(isFile && value.trim().length > 0 && newExt !== oldExt);

  const unchanged = $derived(value.trim() === original.trim());
  const canSubmit = $derived(!busy && value.trim().length > 0 && !unchanged);

  async function submit() {
    if (!canSubmit) return;
    error = null;
    if (!isFile) {
      terminals.renameTab(tab.id, value);
      open = false;
      return;
    }
    busy = true;
    try {
      await terminals.renameFileTab(tab.id, value.trim());
      open = false;
    } catch (e) {
      error = e instanceof Error ? e.message : i18n.t("tab.renameError");
    } finally {
      busy = false;
    }
  }
</script>

<Dialog.Root bind:open>
  <Dialog.Content class="sm:max-w-[440px]">
    <Dialog.Header>
      <Dialog.Title>
        {isFile ? i18n.t("tab.renameFileTitle") : i18n.t("tab.renameTabTitle")}
      </Dialog.Title>
      {#if isFile}
        <Dialog.Description>{i18n.t("tab.fileRenameNote")}</Dialog.Description>
      {/if}
    </Dialog.Header>

    <div class="flex flex-col gap-3 py-1">
      <div class="relative">
        <PencilIcon
          class="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground/80"
        />
        <Input
          class="pl-8"
          bind:value
          placeholder={isFile ? i18n.t("tab.fileNamePlaceholder") : i18n.t("tab.namePlaceholder")}
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
      <Button disabled={!canSubmit} onclick={submit}>
        {isFile ? i18n.t("common.rename") : i18n.t("common.save")}
      </Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
