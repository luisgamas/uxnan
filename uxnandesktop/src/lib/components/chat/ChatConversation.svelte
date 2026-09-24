<script lang="ts">
  // A started chat: one bridge thread, live. Whatever the phone does to it —
  // a message, a stop, an answered approval, a rename, a model switch — shows
  // up here as it happens, and the reverse, because both are clients of the
  // same bridge (plan 030, "one owner, two views").
  //
  // A pane like a file or commit tab (`pane.root` / `pane.header`); the header
  // carries the fixed agent, the switchable model (`AiModelPicker`) and the
  // access mode (`Select`).
  import { tick, untrack } from "svelte";
  import * as DropdownMenu from "$lib/components/ui/dropdown-menu";
  import * as Select from "$lib/components/ui/select";
  import { Button } from "$lib/components/ui/button";
  import { Icon } from "$lib/components/ui/icon";
  import { Spinner } from "$lib/components/ui/spinner";
  import MoreHorizontalIcon from "@hugeicons/core-free-icons/MoreHorizontalIcon";
  import SmartPhone01Icon from "@hugeicons/core-free-icons/SmartPhone01Icon";
  import ArrowDown01Icon from "@hugeicons/core-free-icons/ArrowDown01Icon";
  import type { AccessMode } from "$shared/models/thread";
  import AgentLogo from "$lib/components/AgentLogo.svelte";
  import AiModelPicker from "$lib/components/AiModelPicker.svelte";
  import TabRenameDialog from "$lib/components/TabRenameDialog.svelte";
  import { TooltipSimple } from "$lib/components/ui/tooltip";
  import ChatComposer from "./ChatComposer.svelte";
  import ChatTurnView from "./ChatTurnView.svelte";
  import { chat } from "$lib/bridge/chat.svelte";
  import { bridgeAgentLogo } from "$lib/bridge/agents";
  import { terminals, type ChatTab } from "$lib/state/terminals.svelte";
  import { toastError } from "$lib/toast";
  import { i18n } from "$lib/i18n";
  import { cn } from "$lib/utils";
  import { chat as chatTokens, icon, pane, text } from "$lib/design";

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

  // Created (and loaded) once, when the pane mounts — never inside a
  // `$derived`, which may not write state. `ChatPane` re-keys this component
  // per thread, so one instance always shows one conversation.
  const conversation = chat.conversation(untrack(() => threadId));
  const thread = $derived(chat.threads.get(threadId));
  /** Deleted on another client (or the bridge lost it): nothing to show. */
  const missing = $derived(chat.threadsLoaded && !thread);
  const agent = $derived(chat.agent(thread?.agentId));
  const models = $derived(chat.cachedModels(thread?.agentId));
  const model = $derived(models.find((m) => m.id === thread?.model));
  let optionValues = $state<Record<string, string | boolean>>({});
  let modelsLoading = $state(false);

  $effect(() => {
    const id = thread?.agentId;
    if (!id) return;
    modelsLoading = true;
    void chat.modelsFor(id).finally(() => (modelsLoading = false));
  });

  const ACCESS_MODES = [
    "requestApproval",
    "approveForMe",
    "fullAccess",
  ] as const satisfies readonly AccessMode[];
  const accessMode = $derived<AccessMode>(thread?.accessMode ?? "fullAccess");

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
    void last?.messages.map((m) => (typeof m.content === "string" ? m.content.length : 0));
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
  async function send(message: string) {
    following = true;
    await chat.send(threadId, message, { options: optionValues });
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

  async function setModel(next: string) {
    // "Default" is the agent's own choice at thread start; a running thread
    // keeps a concrete model, so picking it again changes nothing.
    if (!next || next === thread?.model) return;
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

{#if missing}
  <div class="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
    <p class={text.meta}>{i18n.t("chat.threadGone")}</p>
    <Button size="sm" variant="outline" onclick={() => terminals.bindChatThread(tab.id, undefined)}>
      {i18n.t("launcher.newChat")}
    </Button>
  </div>
{:else}
  <div class={pane.root}>
    <!-- Who drives it (fixed), which model (switchable), how much it may do. -->
    <header class={pane.header}>
      <AgentLogo logo={bridgeAgentLogo(thread?.agentId)} class={cn(icon.brand, "shrink-0")} />
      <span class={cn(text.bodyStrong, "min-w-0 truncate")}>
        {thread?.title || i18n.t("chat.newChat")}
      </span>
      <TooltipSimple title={i18n.t("chat.syncedHint")}>
        {#snippet children(tp)}
          <span {...tp} class="flex shrink-0 text-muted-foreground/60">
            <Icon icon={SmartPhone01Icon} class={icon.status} />
          </span>
        {/snippet}
      </TooltipSimple>
      <span class="flex-1"></span>
      <span class={cn(text.meta, "hidden shrink-0 lg:inline")}>
        {agent?.displayName ?? thread?.agentId}
      </span>
      <AiModelPicker
        {models}
        value={thread?.model ?? ""}
        loading={modelsLoading}
        size="sm"
        triggerClass="w-44"
        onSelect={(id) => void setModel(id)}
      />
      <Select.Root type="single" value={accessMode} onValueChange={(v) => void setAccess(v as AccessMode)}>
        <Select.Trigger size="compact" class="w-40" aria-label={i18n.t("chat.accessLabel")}>
          {i18n.t(`chat.access.${accessMode}`)}
        </Select.Trigger>
        <Select.Content>
          {#each ACCESS_MODES as mode (mode)}
            <Select.Item value={mode} label={i18n.t(`chat.access.${mode}`)}>
              <div class="flex min-w-0 flex-col">
                <span>{i18n.t(`chat.access.${mode}`)}</span>
                <span class={text.meta}>{i18n.t(`chat.accessDesc.${mode}`)}</span>
              </div>
            </Select.Item>
          {/each}
        </Select.Content>
      </Select.Root>
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
    </header>

    <!-- Timeline -->
    <div class="relative min-h-0 flex-1">
      <div bind:this={scroller} onscroll={onScroll} class="uxnan-scroll h-full overflow-y-auto">
        <div class={cn(chatTokens.column, "flex flex-col gap-5 py-5")}>
          {#if conversation.loadingOlder}
            <div class="flex justify-center">
              <Spinner class={cn(icon.decorative, "text-muted-foreground")} />
            </div>
          {:else if conversation.hasOlder}
            <Button
              variant="ghost"
              size="sm"
              class="self-center"
              onclick={() => void conversation.loadOlder()}
            >
              {i18n.t("chat.loadEarlier")}
            </Button>
          {/if}

          {#if conversation.loading && !conversation.loaded}
            <div class="flex justify-center py-10">
              <Spinner class={cn(icon.nav, "text-muted-foreground")} />
            </div>
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
              <div class={cn(chatTokens.userBubble, !p.error && "opacity-70")}>{p.text}</div>
              {#if p.error}
                <p class="flex items-center gap-2 text-xs text-destructive">
                  {p.error}
                  <Button
                    variant="link"
                    size="xs"
                    class="h-auto px-0"
                    onclick={() => conversation.dropPending(p.clientTurnId)}
                  >
                    {i18n.t("chat.dismiss")}
                  </Button>
                </p>
              {/if}
            </div>
          {/each}

          {#each queued as turn (turn.id)}
            <div class="flex flex-col items-end gap-1">
              <div class={chatTokens.queuedBubble}>
                {turn.messages.find((m) => m.role === "user")?.content ?? ""}
              </div>
              <p class={cn(text.meta, "flex items-center gap-2")}>
                {i18n.t("chat.queued")}
                <Button
                  variant="link"
                  size="xs"
                  class="h-auto px-0 text-muted-foreground"
                  onclick={() => void chat.cancel(threadId, turn.id).catch(toastError)}
                >
                  {i18n.t("chat.cancelQueued")}
                </Button>
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
    <div class={cn(chatTokens.column, "shrink-0 pb-4 pt-1")}>
      {#if conversation.queue.paused}
        <div
          class="mb-2 flex items-center gap-2 rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-200"
        >
          <span class="flex-1">
            {i18n.t(
              conversation.queue.reason === "turnError"
                ? "chat.queuePausedError"
                : "chat.queuePausedStopped",
            )}
          </span>
          <Button
            size="sm"
            variant="outline"
            onclick={() => void chat.resumeQueue(threadId).catch(toastError)}
          >
            {i18n.t("chat.queueResume")}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onclick={() => void chat.clearQueue(threadId).catch(toastError)}
          >
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
        <p class={cn(text.meta, "mt-1 text-right tabular-nums")}>
          {i18n.t("chat.context", {
            percent: String(
              Math.min(
                100,
                Math.round((conversation.usage.tokens / conversation.usage.contextWindow) * 100),
              ),
            ),
          })}
        </p>
      {/if}
    </div>
  </div>
{/if}

{#if renaming}
  <TabRenameDialog {tab} onclose={() => (renaming = false)} />
{/if}
