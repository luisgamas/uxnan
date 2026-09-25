<script lang="ts">
  // The dialogs a chat action needs, mounted once for the whole window: a new
  // name (the shared `TabRenameDialog`, which renames the bridge thread) and a
  // confirmed delete (the shared `ConfirmDialog`). Every menu that offers the
  // actions (`chatActionsFor`) only sets `chatActionUi`.
  import ConfirmDialog from "$lib/components/ConfirmDialog.svelte";
  import TabRenameDialog from "$lib/components/TabRenameDialog.svelte";
  import { chat } from "$lib/bridge/chat.svelte";
  import { chatActionUi } from "$lib/bridge/chatActions.svelte";
  import type { ChatTab } from "$lib/state/terminals.svelte";
  import { errorMessage } from "$lib/toast";
  import { i18n } from "$lib/i18n";

  /** The dialog renames through a chat tab; this one stands for the thread. */
  const renameTarget = $derived<ChatTab | null>(
    chatActionUi.renaming
      ? {
          kind: "chat",
          id: `rename:${chatActionUi.renaming.id}`,
          title: chatActionUi.renaming.title,
          cwd: chatActionUi.renaming.cwd ?? "",
          threadId: chatActionUi.renaming.id,
        }
      : null,
  );

  let deleteOpen = $state(false);
  let deleteError = $state<string | null>(null);
  $effect(() => {
    if (chatActionUi.deleting) {
      deleteError = null;
      deleteOpen = true;
    }
  });

  async function confirmDelete(): Promise<boolean> {
    const target = chatActionUi.deleting;
    if (!target) return true;
    try {
      await chat.remove(target.id);
      chatActionUi.deleting = null;
      return true;
    } catch (err) {
      deleteError = errorMessage(err);
      return false;
    }
  }
</script>

{#if renameTarget}
  {#key renameTarget.id}
    <TabRenameDialog tab={renameTarget} onclose={() => (chatActionUi.renaming = null)} />
  {/key}
{/if}

<ConfirmDialog
  bind:open={deleteOpen}
  danger
  title={i18n.t("chat.deleteTitle")}
  description={i18n.t("chat.deleteDesc", { title: chatActionUi.deleting?.title ?? "" })}
  confirmLabel={i18n.t("chat.deleteConfirm")}
  error={deleteError}
  onconfirm={confirmDelete}
  ondismiss={() => (chatActionUi.deleting = null)}
/>
