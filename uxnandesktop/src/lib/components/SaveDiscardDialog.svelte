<script lang="ts">
  // The single mounted instance of the Save / Discard / Cancel prompt, driven by
  // the `saveDiscard` service so non-component code (the tab-close path) can ask
  // what to do with unsaved file edits. Closing the dialog any other way (escape
  // / overlay) resolves to "cancel".
  import * as Dialog from "$lib/components/ui/dialog";
  import { Button } from "$lib/components/ui/button";
  import { i18n } from "$lib/i18n";
  import { saveDiscard } from "$lib/state/confirm.svelte";
</script>

<Dialog.Root
  open={saveDiscard.open}
  onOpenChange={(o) => {
    if (!o) saveDiscard.choose("cancel");
  }}
>
  <Dialog.Content class="sm:max-w-[440px]">
    <Dialog.Header>
      <Dialog.Title>{saveDiscard.title}</Dialog.Title>
      {#if saveDiscard.description}
        <Dialog.Description>{saveDiscard.description}</Dialog.Description>
      {/if}
    </Dialog.Header>
    <Dialog.Footer>
      <Button variant="ghost" onclick={() => saveDiscard.choose("cancel")}>
        {i18n.t("common.cancel")}
      </Button>
      <Button variant="destructive" onclick={() => saveDiscard.choose("discard")}>
        {saveDiscard.discardLabel}
      </Button>
      <Button variant="default" onclick={() => saveDiscard.choose("save")}>
        {saveDiscard.saveLabel}
      </Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
