<script lang="ts">
  // Canonical destructive-confirmation dialog (remove project / worktree,
  // close all tabs, …). All callers share one layout: an optional danger hero
  // icon, the title + description, an optional inline error, and a ghost Cancel
  // plus a confirm button. `onconfirm` may return `false` to keep the dialog
  // open (e.g. a remove that failed and now offers a force option).
  import * as Dialog from "$lib/components/ui/dialog";
  import { Button } from "$lib/components/ui/button";
  import { i18n } from "$lib/i18n";
  import { cn } from "$lib/utils";
  import { icon, text } from "$lib/design";
  import TriangleAlertIcon from "@lucide/svelte/icons/triangle-alert";

  let {
    open = $bindable(false),
    title,
    description = "",
    confirmLabel = "Confirm",
    danger = false,
    error = null,
    onconfirm,
    oncancel,
  }: {
    open?: boolean;
    title: string;
    description?: string;
    confirmLabel?: string;
    danger?: boolean;
    error?: string | null;
    onconfirm: () => void | Promise<boolean | void>;
    oncancel?: () => void;
  } = $props();

  let busy = $state(false);

  async function confirm() {
    busy = true;
    try {
      const result = await onconfirm();
      if (result !== false) open = false;
    } catch {
      // A thrown rejection means the action failed; keep the dialog open so
      // the caller can surface an error (callers that report via a returned
      // `false` + error prop are unaffected).
    } finally {
      busy = false;
    }
  }

  function cancel() {
    oncancel?.();
    open = false;
  }
</script>

<Dialog.Root bind:open>
  <Dialog.Content
    class="flex min-w-0 flex-col gap-4 sm:max-w-[440px]"
    showCloseButton={false}
  >
    <div class="flex min-w-0 gap-3">
      {#if danger}
        <div class="flex size-9 shrink-0 items-center justify-center rounded-lg bg-destructive/10">
          <TriangleAlertIcon class={cn(icon.button, "text-destructive")} />
        </div>
      {/if}
      <div class="flex min-w-0 flex-1 flex-col gap-2">
        <Dialog.Title class={cn(text.title, "break-words")}>{title}</Dialog.Title>
        {#if description}
          <Dialog.Description class={cn(text.body, "break-words")}>{description}</Dialog.Description>
        {/if}
      </div>
    </div>

    {#if error}
      <p
        class={cn(
          "mt-2 break-words rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-destructive",
          text.body,
        )}
      >
        {error}
      </p>
    {/if}

    <Dialog.Footer class="min-w-0">
      <Button variant="ghost" onclick={cancel}>{i18n.t("common.cancel")}</Button>
      <Button variant={danger ? "destructive" : "default"} disabled={busy} onclick={confirm}>
        {confirmLabel}
      </Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
