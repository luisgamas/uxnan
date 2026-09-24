<script lang="ts">
  // A started chat: one bridge thread, live. Whatever the phone does to it —
  // a message, a stop, an answered approval, a rename, a model switch — shows
  // up here as it happens, and the reverse, because both are clients of the
  // same bridge (plan 030, "one owner, two views").
  import { tick } from "svelte";
  import * as DropdownMenu from "$lib/components/ui/dropdown-menu";
  import { Button } from "$lib/components/ui/button";
  import { Icon } from "$lib/components/ui/icon";
  import { Spinner } from "$lib/components/ui/spinner";
  import MoreHorizontalIcon from "@hugeicons/core-free-icons/MoreHorizontalIcon";
  import SmartPhone01Icon from "@hugeicons/core-free-icons/SmartPhone01Icon";
  import ArrowDown01Icon from "@hugeicons/core-free-icons/ArrowDown01Icon";
  import type { AccessMode } from "$shared/models/thread";
  import AgentLogo from "$lib/components/AgentLogo.svelte";
  import { TooltipSimple } from "$lib/components/ui/tooltip";
  import ChatComposer from "./ChatComposer.svelte";
  import ChatModelPicker from "./ChatModelPicker.svelte";
  import ChatTurnView from "./ChatTurnView.svelte";
  import { chat } from "$lib/bridge/chat.svelte";
  import { bridgeAgentLogo } from "$lib/bridge/agents";
  import { toastError } from "$lib/toast";
  import { i18n } from "$lib/i18n";
  import { cn } from "$lib/utils";
  import { icon, text } from "$lib/design";
  import TabRenameDialog from "$lib/components/TabRenameDialog.svelte";
  import type { ChatTab } from "$lib/state/terminals.svelte";

  let {
    tab,
    threadId,
    cwd,
    active,
  }: {
    tab: ChatTab;
    threadId: string;
    cwd: string;
    active: boolean;
  } = $props();

  let renaming = $state(false);

  const conversation = $derived(chat.conversation(threadId));
  const thread = $derived(chat.threads.get(threadId));
  const agent = $derived(chat.agent(thread?.agentId));
  const model = $derived(chat.cachedModels(thread?.agentId).find((m) => m.id === thread?.model));
  let optionValues = $state<Record<string, string | boolean>>({});

  const ACCESS_MODES = ["requestApproval", "approveForMe", "fullAccess"] as const satisfies readonly AccessMode[];

  /** Turns shown in the timeline; queued ones wait below, as ghosts. */
  const shown = $derived(conversation.turns.filter((t) => t.status !== "queued"));
  const queued = $derived(
    conversation.queue.turnIds
      .map((id) => conversation.turns.find((t) => t.id === id))
      .filter((t) => t !== undefined),
  );

  // --- scrolling -----------------------------------------------------------
  let scroller = $state<HTMLDivElement | null>(null);
  let following = $state(true);

  function onScroll() {
    if (!scroller) return;
    const distance = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
    following = distance < 80;
    if (scroller.scrollTop < 40 && conversation.hasOlder && !conversation.loadingOlder) {
      const before = scroller.scrollHeight;
      void conversation.loadOlder().then(async () => {
        await tick();
        if (scroller) scroller.scrollTop += scroller.scrollHeight - before;
      });
    }
  }

  // Follow the conversation while the reader is at the bottom; never yank
  // them down while they are reading older turns.
  $effect(() => {
    void conversation.turns.length;
    void conversation.pending.length;
    const last = conversation.turns[conversation.turns.length - 1];
    void (last?.messages.map((m) => (typeof m.content === "string" ? m.content.length : 0)));
    if (!following || !scroller) return;
    void tick().then(() => {
      if (scroller) scroller.scrollTop = scroller.scrollHeight;
    });
  });

  function jumpToEnd() {
    following = true;
    if (scroller) scroller.scrollTop = scroller.scrollHeight;
  }

  // --- actions -------------------------------------------------------------
  async function send(text: string) {
    following = true;
    await chat.send(threadId, text, { options: optionValues });
  }

  async function stop() {
    const turnId = conversation.activeTurnId;
    if (!turnId) return;
    try {
      await chat.cancel(threadId, turnId);
    } catch (err) {
      toastError(err);
    }
  }

  async function setModel(next: string | undefined) {
    if (!next) return;
    try {
      await chat.setModel(threadId, next);
      optionValues = {};
    } catch (err) {
      toastError(err);
    }
  }

  async function setAccess(mode: AccessMode) {
    try {
      await chat.setAccessMode(threadId, mode);
    } catch (err) {
      toastError(err);
    }
  }


  async function archive() {
    try {
      await chat.archive(threadId);
    } catch (err) {
      toastError(err);
    }
  }
</script>

<div class="flex h-full min-h-0 flex-col">
  <!-- Header: who drives it (fixed), which model (switchable), how much it may do. -->
  <div class="flex h-10 shrink-0 items-center gap-2 border-b border-border/60 px-3">
    <AgentLogo logo={bridgeAgentLogo(thread?.agentId)} class={icon.brand} />
    <div class="flex min-w-0 flex-1 items-center gap-1.5">
      <span class={cn(text.bodyStrong, "truncate")}>{thread?.title || i18n.t("chat.newChat")}</span>
      <TooltipSimple title={i18n.t("chat.syncedHint")}>
        {#snippet children(tp)}
          <span {...tp} class="flex shrink-0 text-muted-foreground/60">
            <Icon icon={SmartPhone01Icon} class={icon.status} />
          </span>
        {/snippet}
      </TooltipSimple>
    </div>
    <span class={cn(text.meta, "hidden shrink-0 sm:inline")}>{agent?.displayName ?? thread?.agentId}</span>
    <ChatModelPicker
      agentId={thread?.agentId}
      value={thread?.model}
      resolved={conversation.resolvedModel}
      onchange={(m) => void setModel(m)}
    />
    <DropdownMenu.Root>
      <DropdownMenu.Trigger>
        {#snippet child({ props })}
          <Button
            variant="ghost"
            size="xs"
            class="gap-1 font-normal text-muted-foreground hover:text-foreground"
            {...props}
          >
            {i18n.t(`chat.access.${thread?.accessMode ?? "fullAccess"}`)}
            <Icon icon={ArrowDown01Icon} class={cn(icon.status, "opacity-70")} />
          </Button>
        {/snippet}
      </DropdownMenu.Trigger>
      <DropdownMenu.Content width="wide" align="end">
        {#each ACCESS_MODES as mode (mode)}
          <DropdownMenu.Item class={text.menu} onclick={() => void setAccess(mode)}>
            <div class="flex min-w-0 flex-col">
              <span class={cn((thread?.accessMode ?? "fullAccess") === mode && "font-medium")}>
                {i18n.t(`chat.access.${mode}`)}
              </span>
              <span class={text.meta}>{i18n.t(`chat.accessDesc.${mode}`)}</span>
            </div>
          </DropdownMenu.Item>
        {/each}
      </DropdownMenu.Content>
    </DropdownMenu.Root>
    <DropdownMenu.Root>
      <DropdownMenu.Trigger>
        {#snippet child({ props })}
          <Button variant="ghost" size="icon-xs" aria-label={i18n.t("chat.more")} {...props}>
            <Icon icon={MoreHorizontalIcon} class={icon.action} />
          </Button>
        {/snippet}
      </DropdownMenu.Trigger>
      <DropdownMenu.Content width="simple" align="end">
        <DropdownMenu.Item class={text.menu} onclick={() => (renaming = true)}>
          {i18n.t("chat.rename")}
        </DropdownMenu.Item>
        <DropdownMenu.Item class={text.menu} onclick={() => void archive()}>
          {i18n.t("chat.archive")}
        </DropdownMenu.Item>
      </DropdownMenu.Content>
    </DropdownMenu.Root>
  </div>

  <!-- Timeline -->
  <div class="relative min-h-0 flex-1">
    <div bind:this={scroller} onscroll={onScroll} class="uxnan-scroll h-full overflow-y-auto">
      <div class="mx-auto flex w-full max-w-3xl flex-col gap-5 px-5 py-5">
        {#if conversation.loadingOlder}
          <div class="flex justify-center"><Spinner class="size-4 text-muted-foreground" /></div>
        {:else if conversation.hasOlder}
          <Button variant="ghost" size="xs" class="self-center" onclick={() => void conversation.loadOlder()}>
            {i18n.t("chat.loadEarlier")}
          </Button>
        {/if}

        {#if conversation.loading && !conversation.loaded}
          <div class="flex justify-center py-10"><Spinner class="size-5 text-muted-foreground" /></div>
        {:else if conversation.error && !conversation.loaded}
          <p class={cn(text.meta, "text-center")}>{conversation.error}</p>
        {:else if shown.length === 0 && conversation.pending.length === 0}
          <p class={cn(text.meta, "py-10 text-center")}>{i18n.t("chat.emptyThread")}</p>
        {/if}

        {#each shown as turn (turn.id)}
          <ChatTurnView {turn} {threadId} {cwd} {conversation} />
        {/each}

        {#each conversation.pending as p (p.clientTurnId)}
          <div class="flex flex-col items-end gap-1">
            <div
              class={cn(
                "max-w-[85%] rounded-2xl rounded-br-md bg-muted px-3.5 py-2 text-[13px] leading-5 whitespace-pre-wrap break-words",
                !p.error && "opacity-70",
              )}
            >
              {p.text}
            </div>
            {#if p.error}
              <p class="flex items-center gap-2 text-[11px] text-destructive">
                {p.error}
                <button
                  type="button"
                  class="underline underline-offset-2"
                  onclick={() => conversation.dropPending(p.clientTurnId)}
                >
                  {i18n.t("chat.dismiss")}
                </button>
              </p>
            {/if}
          </div>
        {/each}

        {#each queued as turn (turn.id)}
          <div class="flex flex-col items-end gap-1">
            <div
              class="max-w-[85%] rounded-2xl rounded-br-md border border-dashed border-border px-3.5 py-2 text-[13px] leading-5 text-muted-foreground whitespace-pre-wrap break-words"
            >
              {turn.messages.find((m) => m.role === "user")?.content ?? ""}
            </div>
            <p class={cn(text.meta, "flex items-center gap-2 text-[11px]")}>
              {i18n.t("chat.queued")}
              <button
                type="button"
                class="underline underline-offset-2 hover:text-foreground"
                onclick={() => void chat.cancel(threadId, turn.id).catch(toastError)}
              >
                {i18n.t("chat.cancelQueued")}
              </button>
            </p>
          </div>
        {/each}
      </div>
    </div>
    {#if !following}
      <Button
        variant="secondary"
        size="icon-sm"
        class="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full shadow-md"
        aria-label={i18n.t("chat.jumpToEnd")}
        onclick={jumpToEnd}
      >
        <Icon icon={ArrowDown01Icon} class={icon.action} />
      </Button>
    {/if}
  </div>

  <!-- Composer -->
  <div class="mx-auto w-full max-w-3xl shrink-0 px-5 pb-4 pt-1">
    {#if conversation.queue.paused}
      <div class="mb-2 flex items-center gap-2 rounded-lg bg-amber-500/10 px-3 py-2 text-[12px] text-amber-800 dark:text-amber-200">
        <span class="flex-1">
          {i18n.t(conversation.queue.reason === "turnError" ? "chat.queuePausedError" : "chat.queuePausedStopped")}
        </span>
        <Button size="xs" variant="outline" onclick={() => void chat.resumeQueue(threadId).catch(toastError)}>
          {i18n.t("chat.queueResume")}
        </Button>
        <Button size="xs" variant="ghost" onclick={() => void chat.clearQueue(threadId).catch(toastError)}>
          {i18n.t("chat.queueClear")}
        </Button>
      </div>
    {/if}
    <ChatComposer
      running={conversation.running}
      disabled={thread?.status === "archived"}
      runOptions={model?.options ?? []}
      bind:optionValues
      autofocus={active}
      onsend={send}
      onstop={() => void stop()}
    />
    {#if conversation.usage?.contextWindow}
      <p class={cn(text.meta, "mt-1 text-right text-[11px] tabular-nums")}>
        {i18n.t("chat.context", {
          percent: String(Math.min(100, Math.round((conversation.usage.tokens / conversation.usage.contextWindow) * 100))),
        })}
      </p>
    {/if}
  </div>
</div>

{#if renaming}
  <TabRenameDialog {tab} onclose={() => (renaming = false)} />
{/if}
