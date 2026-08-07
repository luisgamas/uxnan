<script lang="ts">
  // Edit a worktree's note — the "why does this exist" line the hover card shows.
  // Seeded at creation from the name you typed, and editable afterwards because
  // the reason for a space is the thing most likely to change (or to have been
  // worth writing down only once you were already three commits in).
  import * as Dialog from "$lib/components/ui/dialog";
  import { Button } from "$lib/components/ui/button";
  import { Textarea } from "$lib/components/ui/textarea";
  import { projects, type WorktreeRow } from "$lib/state/projects.svelte";
  import { i18n } from "$lib/i18n";
  import { cn } from "$lib/utils";
  import { text } from "$lib/design";

  let {
    open = $bindable(false),
    row,
  }: { open?: boolean; row: WorktreeRow } = $props();

  let draft = $state("");

  $effect(() => {
    if (open) draft = projects.note(row.path);
  });

  function save() {
    projects.setNote(row.path, draft);
    open = false;
  }
</script>

<Dialog.Root bind:open>
  <Dialog.Content class="sm:max-w-[460px]">
    <Dialog.Header>
      <Dialog.Title>{i18n.t("worktree.noteTitle")}</Dialog.Title>
      <Dialog.Description class="break-words">
        {row.branch ?? i18n.t("worktree.detached")}
      </Dialog.Description>
    </Dialog.Header>

    <Textarea
      rows={4}
      class="resize-none"
      placeholder={i18n.t("worktree.notePlaceholder")}
      bind:value={draft}
    />
    <p class={text.meta}>{i18n.t("worktree.noteHelp")}</p>

    <Dialog.Footer>
      <Button variant="ghost" onclick={() => (open = false)}>{i18n.t("common.cancel")}</Button>
      <Button onclick={save}>{i18n.t("common.save")}</Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
