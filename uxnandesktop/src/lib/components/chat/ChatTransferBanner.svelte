<script lang="ts">
  // Where a conversation came from and where it went on (architecture/02a
  // §5.8.21), at the top of its timeline: "Continued from ‘…’ (Codex) · ≈12.4k
  // tokens of context · delivered" — with the exact context the agent got, one
  // click away — and, on a conversation others continue, a line for each.
  // Honest about delivery: the status is the bridge's, proven against the turn.
  import type { Thread } from "$shared/models/thread";
  import type { ThreadTransferContextResult } from "$shared/jsonrpc/methods";
  import { useChat } from "$lib/bridge/chat.svelte";
  import { terminals } from "$lib/state/terminals.svelte";
  import * as Dialog from "$lib/components/ui/dialog";
  import { Button } from "$lib/components/ui/button";
  import { Icon } from "$lib/components/ui/icon";
  import { Spinner } from "$lib/components/ui/spinner";
  import ArrowTurnForwardIcon from "@hugeicons/core-free-icons/ArrowTurnForwardIcon";
  import { toastError } from "$lib/toast";
  import { i18n } from "$lib/i18n";
  import { cn } from "$lib/utils";
  import { focus, icon, text } from "$lib/design";

  let { thread }: { thread: Thread } = $props();
  const chat = useChat();

  const transfer = $derived(thread.transfer);
  const source = $derived(transfer ? chat.threads.get(transfer.sourceThreadId) : undefined);
  const tokens = $derived(
    transfer ? new Intl.NumberFormat(i18n.locale, { notation: "compact", maximumFractionDigits: 1 }).format(transfer.context.approxTokens) : "",
  );

  let contextOpen = $state(false);
  let context = $state<ThreadTransferContextResult | null>(null);
  async function showContext() {
    contextOpen = true;
    if (context) return;
    try {
      context = await chat.transferContext(thread.id);
    } catch (err) {
      contextOpen = false;
      toastError(err);
    }
  }

  function openThread(target: Thread) {
    terminals.openChat({ cwd: target.cwd ?? thread.cwd ?? "", target: chat.target, threadId: target.id });
  }
</script>

{#if transfer}
  <div class={cn("flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-border/60 bg-muted/30 px-3 py-2", text.meta)}>
    <Icon icon={ArrowTurnForwardIcon} class={cn(icon.decorative, "shrink-0")} />
    <span class="min-w-0 truncate">
      {i18n.t(transfer.strategy === "fork" ? "transfer.banner.forkedFrom" : "transfer.banner.continuedFrom")}
      {#if source}
        <button type="button" class={cn("text-foreground underline-offset-2 hover:underline", focus.ring)} onclick={() => openThread(source)}>
          {source.title}
        </button>
      {:else}
        <span class="text-foreground">{transfer.sourceTitle}</span>
      {/if}
      {#if transfer.sourceAgentId}({chat.agent(transfer.sourceAgentId)?.displayName ?? transfer.sourceAgentId}){/if}
    </span>
    <span class="shrink-0">· {i18n.t("transfer.banner.tokens", { n: tokens })}</span>
    <span class="shrink-0">· {i18n.t(`transfer.status.${transfer.status}`)}</span>
    <Button variant="ghost" size="sm" class="ml-auto h-6 px-2 text-xs" onclick={() => void showContext()}>
      {i18n.t("transfer.banner.showContext")}
    </Button>
  </div>
{/if}
{#each thread.continuations ?? [] as next (next.threadId)}
  {@const target = chat.threads.get(next.threadId)}
  {#if target}
    <div class={cn("flex min-w-0 items-center gap-2 rounded-lg border border-border/60 bg-muted/30 px-3 py-2", text.meta)}>
      <Icon icon={ArrowTurnForwardIcon} class={cn(icon.decorative, "shrink-0")} />
      <span class="min-w-0 truncate">
        {i18n.t("transfer.banner.continuedIn", { agent: chat.agent(next.agentId)?.displayName ?? next.agentId ?? "" })}
        <button type="button" class={cn("text-foreground underline-offset-2 hover:underline", focus.ring)} onclick={() => openThread(target)}>
          {target.title}
        </button>
      </span>
    </div>
  {/if}
{/each}

<Dialog.Root bind:open={contextOpen}>
  <Dialog.Content size="large">
    <Dialog.Header>
      <Dialog.Title class={text.title}>{i18n.t("transfer.contextTitle")}</Dialog.Title>
      <Dialog.Description class={text.meta}>
        {#if context}
          {i18n.t("transfer.contextSummary", {
            turns: String(context.summary.turns),
            omitted: String(context.summary.omittedTurns),
            tokens,
          })}
        {/if}
      </Dialog.Description>
    </Dialog.Header>
    <Dialog.Body>
      {#if context}
        <pre class="uxnan-scroll max-h-[60vh] overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted/60 p-3 font-mono text-[11px] leading-4">{context.text}</pre>
      {:else}
        <Spinner class={icon.decorative} />
      {/if}
    </Dialog.Body>
  </Dialog.Content>
</Dialog.Root>
