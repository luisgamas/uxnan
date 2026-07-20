<script lang="ts">
  // "Choose a folder" dialog — returns the browsed directory's path via
  // `onselect`. Reuses the shared in-app DirectoryBrowser (path bar + refresh +
  // live watch + keyboard nav), so it feels identical to the "Add project" picker
  // but selects a location instead of registering a project. Used to pick the
  // parent directory for a custom worktree location.
  import * as Dialog from "$lib/components/ui/dialog";
  import { Button } from "$lib/components/ui/button";
  import { i18n } from "$lib/i18n";
  import { isMac } from "$lib/keybindings";
  import { text } from "$lib/design";
  import Kbd from "./Kbd.svelte";
  import DirectoryBrowser from "./DirectoryBrowser.svelte";
  import type { DirListing } from "$lib/types";

  let {
    open = $bindable(false),
    title = i18n.t("folderSelect.title"),
    description = i18n.t("folderSelect.desc"),
    confirmLabel = i18n.t("folderSelect.select"),
    onselect,
  }: {
    open?: boolean;
    title?: string;
    description?: string;
    confirmLabel?: string;
    /** Called with the chosen directory path; the dialog then closes. */
    onselect: (path: string) => void;
  } = $props();

  let listing = $state<DirListing | null>(null);
  let path = $state("");
  let browserKey = $state<((e: KeyboardEvent) => void) | undefined>(undefined);

  function choose() {
    if (!listing) return;
    onselect(listing.path);
    open = false;
  }
</script>

<Dialog.Root bind:open>
  <Dialog.Content class="gap-0 overflow-hidden p-0 sm:max-w-[560px]" onkeydown={browserKey}>
    <div class="flex flex-col gap-1 border-b border-border/60 px-4 pb-3 pt-4 pr-10">
      <Dialog.Title class="text-[15px] font-semibold leading-none">{title}</Dialog.Title>
      <Dialog.Description class={text.meta}>{description}</Dialog.Description>
    </div>

    <DirectoryBrowser active={open} bind:listing bind:path bind:keydownHandler={browserKey} onPrimary={choose} />

    <div
      class="flex min-w-0 items-center justify-between gap-3 border-t border-border/60 bg-muted/30 px-4 py-2.5"
    >
      <div
        class="hidden min-w-0 flex-1 items-center gap-4 overflow-hidden text-[11px] text-muted-foreground sm:flex"
      >
        <span class="flex shrink-0 items-center gap-1.5">
          <span class="flex items-center gap-1"><Kbd>↑</Kbd><Kbd>↓</Kbd></span>
          {i18n.t("palette.hintNavigate")}
        </span>
        <span class="flex shrink-0 items-center gap-1.5">
          <span class="flex items-center gap-1"><Kbd>{isMac ? "⌘" : "Ctrl"}</Kbd><Kbd>↵</Kbd></span>
          {i18n.t("folderSelect.hintSelect")}
        </span>
        <span class="flex shrink-0 items-center gap-1.5">
          <Kbd>Esc</Kbd>{i18n.t("palette.hintExit")}
        </span>
      </div>
      <div class="flex shrink-0 items-center gap-2">
        <Button variant="ghost" size="sm" onclick={() => (open = false)}>{i18n.t("common.cancel")}</Button>
        <Button size="sm" disabled={!listing} onclick={choose}>{confirmLabel}</Button>
      </div>
    </div>
  </Dialog.Content>
</Dialog.Root>
