<script lang="ts">
  // A conversation's session, as the bridge records it: its agent and model,
  // the folder, where it was started, its ids (Uxnan's and the agent CLI's own
  // native session, to resume it outside Uxnan), and what it continues or is
  // continued by (architecture/02a §5.8.21). The phone shows the same.
  import type { Thread } from "$shared/models/thread";
  import { chatOfThread } from "$lib/bridge/chat.svelte";
  import { chatActionUi } from "$lib/bridge/chatActions.svelte";
  import * as Dialog from "$lib/components/ui/dialog";
  import { Button } from "$lib/components/ui/button";
  import { relativeTime } from "$lib/relativeTime";
  import { toast } from "$lib/toast";
  import { i18n } from "$lib/i18n";
  import { cn } from "$lib/utils";
  import { text } from "$lib/design";

  let { thread }: { thread: Thread } = $props();
  const chat = $derived(chatOfThread(thread.id));
  // The replica's copy follows changes while the dialog is open.
  const live = $derived(chat.threads.get(thread.id) ?? thread);
  let open = $state(true);

  async function copy(value: string) {
    await navigator.clipboard.writeText(value);
    toast(i18n.t("sessionInfo.copied"));
  }
</script>

{#snippet field(label: string, value: string | undefined, copyable = false)}
  <dt class={text.meta}>{label}</dt>
  <dd class="flex min-w-0 items-center gap-2">
    <span class={cn("min-w-0 flex-1 truncate", copyable && "font-mono text-xs")} title={value}>{value ?? "—"}</span>
    {#if copyable && value}
      <Button variant="ghost" size="sm" class="h-6 px-2 text-xs" onclick={() => void copy(value)}>
        {i18n.t("sessionInfo.copy")}
      </Button>
    {/if}
  </dd>
{/snippet}

<Dialog.Root
  bind:open
  onOpenChange={(next) => {
    if (!next) chatActionUi.inspecting = null;
  }}
>
  <Dialog.Content size="form">
    <Dialog.Header>
      <Dialog.Title class={text.title}>{i18n.t("sessionInfo.title")}</Dialog.Title>
      <Dialog.Description class={cn(text.meta, "truncate")}>{live.title}</Dialog.Description>
    </Dialog.Header>
    <Dialog.Body>
      <dl class="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-4 gap-y-2 text-[13px]">
        {@render field(i18n.t("conversations.agent"), chat.agent(live.agentId)?.displayName ?? live.agentId)}
        {@render field(i18n.t("sessionInfo.model"), live.model ?? i18n.t("sessionInfo.defaultModel"))}
        {@render field(i18n.t("sessionInfo.folder"), live.cwd)}
        {@render field(
          i18n.t("conversations.startedWhere"),
          live.origin
            ? `${i18n.t(`conversations.origin.${live.origin.kind}`)} · ${live.origin.name} · ${relativeTime(live.createdAt, i18n.locale)}`
            : relativeTime(live.createdAt, i18n.locale),
        )}
        {@render field(i18n.t("sessionInfo.conversationId"), live.id, true)}
        {@render field(i18n.t("sessionInfo.nativeSession"), live.agentSessionId ?? i18n.t("sessionInfo.noSessionYet"), !!live.agentSessionId)}
        {#if live.transfer}
          {@render field(
            i18n.t("conversations.continues"),
            `${live.transfer.sourceTitle} · ${i18n.t(`transfer.strategy.${live.transfer.strategy}`)} · ${i18n.t(`transfer.status.${live.transfer.status}`)}`,
          )}
        {/if}
      </dl>
    </Dialog.Body>
    <Dialog.Footer>
      <Button size="sm" variant="ghost" onclick={() => (open = false)}>{i18n.t("common.close")}</Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
