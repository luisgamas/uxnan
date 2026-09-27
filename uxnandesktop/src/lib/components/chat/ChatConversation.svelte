<script lang="ts">
  // A started chat: one bridge thread, live. Whatever the phone does to it —
  // a message, a stop, an answered approval, a rename, a model switch — shows
  // up here as it happens, and the reverse, because both are clients of the
  // same bridge (architecture/02a §5.8.16, "one owner, two views").
  //
  // A pane like a file or commit tab (`pane.root` / `pane.header`). The header
  // names the conversation and its fixed agent. What can change mid-chat lives
  // in the composer's toolbar: the model (`ModelPicker`) and its run options (`RunOptionsPicker`)
  // and the access mode (`ChatAccessMenu`). Anything waiting on the user — an open approval or
  // question, follow-ups queued behind the running turn — is pinned above the
  // composer (the dock) until it is answered, here or on the phone.
  import { tick, untrack } from "svelte";
  import * as DropdownMenu from "$lib/components/ui/dropdown-menu";
  import { Button } from "$lib/components/ui/button";
  import { Icon } from "$lib/components/ui/icon";
  import { Spinner } from "$lib/components/ui/spinner";
  import MoreHorizontalIcon from "@hugeicons/core-free-icons/MoreHorizontalIcon";
  import SmartPhone01Icon from "@hugeicons/core-free-icons/SmartPhone01Icon";
  import ArrowDown01Icon from "@hugeicons/core-free-icons/ArrowDown01Icon";
  import Cancel01Icon from "@hugeicons/core-free-icons/Cancel01Icon";
  import Clock01Icon from "@hugeicons/core-free-icons/Clock01Icon";
  import ArrowUp02Icon from "@hugeicons/core-free-icons/ArrowUp02Icon";
  import PencilEdit02Icon from "@hugeicons/core-free-icons/PencilEdit02Icon";
  import NoteEditIcon from "@hugeicons/core-free-icons/NoteEditIcon";
  import Delete02Icon from "@hugeicons/core-free-icons/Delete02Icon";
  import type { AccessMode } from "$shared/models/thread";
  import AgentLogo from "$lib/components/AgentLogo.svelte";
  import { TooltipSimple } from "$lib/components/ui/tooltip";
  import ChatUserText from "./ChatUserText.svelte";
  import ChatAccessMenu from "./ChatAccessMenu.svelte";
  import ChatComposer from "./ChatComposer.svelte";
  import ChatImages from "./ChatImages.svelte";
  import ChatFiles from "./ChatFiles.svelte";
  import type { AgentCommandInvocation } from "$shared/agents/agent-capabilities";
  import type { TurnAttachment } from "$shared/models/workspace";
  import ModelPicker from "$lib/components/ModelPicker.svelte";
  import RunOptionsPicker from "$lib/components/RunOptionsPicker.svelte";
  import ChatRequest from "./ChatRequest.svelte";
  import ChatTurnView from "./ChatTurnView.svelte";
  import { chat, sessionKey } from "$lib/bridge/chat.svelte";
  import { terminalSessions } from "$lib/state/terminalSessions.svelte";
  import { usage } from "$lib/state/usage.svelte";
  import { usageProviderForAgent } from "$lib/usageCatalog";
  import { pressingWindow } from "$lib/usagePace";
  import { readingPosition, saveReadingPosition } from "$lib/bridge/readingPosition";
  import { chatActionUi, chatActionsFor } from "$lib/bridge/chatActions.svelte";
  import { bridgeAgentLogo } from "$lib/bridge/agents";
  import { userText, type PendingSend } from "$lib/bridge/conversation.svelte";
  import { requestIdOf } from "$lib/bridge/timeline";
  import { terminals, type ChatTab } from "$lib/state/terminals.svelte";
  import { toast, toastError } from "$lib/toast";
  import { i18n } from "$lib/i18n";
  import { cn } from "$lib/utils";
  import { chat as chatTokens, icon, pane, text } from "$lib/design";
  import { railAnchors } from "$lib/bridge/railAnchors";
  import ChatScrollRail from "./ChatScrollRail.svelte";

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


  // Created (and loaded) once, when the pane mounts — never inside a
  // `$derived`, which may not write state. `ChatPane` re-keys this component
  // per thread, so one instance always shows one conversation.
  const conversation = chat.conversation(untrack(() => threadId));

  // --- the composer's text ---------------------------------------------------
  // Kept as the tab's draft (persisted with the layout), a beat after typing
  // stops, so it survives switching tabs and closing the app.
  let draft = $state(untrack(() => tab.draft ?? ""));
  $effect(() => {
    const text = draft;
    const timer = setTimeout(() => (tab.draft = text || undefined), 300);
    return () => clearTimeout(timer);
  });
  /** Earlier messages of this thread, oldest first, for ↑ recall. */
  const history = $derived(conversation.turns.map((t) => userText(t)).filter((t) => t.length > 0));

  // --- drafts set aside --------------------------------------------------------
  // A message coming back to be edited takes the composer; what it held is set
  // aside, whole, instead of being merged into it — kept with the tab, like the
  // draft, until it is put back or thrown away.
  let composer = $state<ReturnType<typeof ChatComposer> | null>(null);
  let rescued = $state<string[]>(untrack(() => tab.rescued ?? []));
  function setRescued(next: string[]) {
    rescued = next;
    tab.rescued = next.length > 0 ? next : undefined;
  }

  /** Puts a message back into the composer, setting aside what was there. */
  function putBack(text: string) {
    if (draft.trim() && draft.trim() !== text.trim()) setRescued([draft, ...rescued]);
    draft = text;
  }

  /** A saved draft returns to the composer; one being written takes its place. */
  function restoreDraft(index: number) {
    const chosen = rescued[index];
    if (chosen === undefined) return;
    const rest = rescued.filter((_, i) => i !== index);
    setRescued(draft.trim() ? [draft, ...rest] : rest);
    draft = chosen;
  }

  /** A failed message back in the composer, its images too, to be reworded. */
  function editFailed(p: PendingSend) {
    conversation.dropPending(p.clientTurnId);
    putBack(p.request.command ? p.text : (p.request.text ?? ""));
    if (p.request.attachments?.length) composer?.restoreAttachments(p.request.attachments);
  }

  /** Withdraws a queued message into the composer — only once the bridge has
   *  taken it off the queue, so it is never both queued and in the draft. */
  async function editQueued(turnId: string, text: string) {
    try {
      await chat.cancel(threadId, turnId);
      putBack(text);
    } catch (err) {
      toastError(err);
    }
  }

  // While this conversation is in view, a finished or failed turn is not
  // news: the tab chip and the sidebar row go back to idle.
  $effect(() => {
    if (!active) return;
    if (chat.activity.of(threadId) === "done" || chat.activity.of(threadId) === "blocked") {
      chat.activity.seen(threadId);
    }
  });
  const thread = $derived(chat.threads.get(threadId));
  /** Deleted on another client (or the bridge lost it): nothing to show. */
  const missing = $derived(chat.threadsLoaded && !thread);
  const agent = $derived(chat.agent(thread?.agentId));

  // Where the agent's plan stands, for the context ring: the plan is read
  // (once, then every few minutes while open) whether or not it is activated
  // in Settings → Providers.
  // A terminal holding this conversation's session is its writer for now
  // (architecture/02a §5.8.19): the composer waits, and the banner offers to
  // take the session back here — or to jump to that terminal, when it is one
  // of this window's.
  const hold = $derived(chat.holdOf(thread));
  const holdingTab = $derived(
    hold ? terminalSessions.held().get(sessionKey(hold.agentId, hold.sessionId))?.tabId : undefined,
  );
  const terminalState = $derived(terminalSessions.openInTerminalState(thread));
  let takingBack = $state(false);

  async function continueHere() {
    if (!hold || takingBack) return;
    takingBack = true;
    try {
      const outcome = await chat.requestHandoff(hold);
      if (outcome !== "released" && outcome !== "notHeld") {
        toast(i18n.t(`sessions.handoff.${outcome}`));
      }
    } catch (err) {
      toastError(err);
    } finally {
      takingBack = false;
    }
  }

  function goToTerminal() {
    if (!holdingTab) return;
    const workspace = terminals.workspaceOfTab(holdingTab);
    if (workspace !== undefined) terminals.revealTab(workspace, holdingTab);
  }

  const planProvider = $derived(usageProviderForAgent(thread?.agentId));
  $effect(() => {
    const provider = planProvider?.id;
    if (!provider || !active) return;
    void usage.ensureProvider(provider);
    const timer = setInterval(() => void usage.ensureProvider(provider), 5 * 60_000);
    return () => clearInterval(timer);
  });
  const plan = $derived.by(() => {
    if (!planProvider) return null;
    const pressing = pressingWindow(usage.byProvider[planProvider.id], Date.now());
    return pressing ? { name: planProvider.name, ...pressing } : null;
  });
  const models = $derived(chat.cachedModels(thread?.agentId));
  /** The thread's model; before it has one, the agent's default — the one
   *  its turns run on (the phone reads the same). */
  const model = $derived(
    models.find((m) => m.id === thread?.model) ??
      (thread?.model ? undefined : models.find((m) => m.isDefault)),
  );
  let optionValues = $state<Record<string, string | boolean>>({});
  let modelsLoading = $state(false);

  $effect(() => {
    const id = thread?.agentId;
    if (!id) return;
    modelsLoading = true;
    void chat.modelsFor(id).finally(() => (modelsLoading = false));
  });

  const accessMode = $derived<AccessMode>(thread?.accessMode ?? "fullAccess");

  /** A queued message can go now: into the running turn when the agent takes
   *  input mid-turn, or — nothing running (a paused queue) — as the next turn. */
  const canSendNow = $derived(
    !conversation.running || chat.agent(thread?.agentId)?.capabilities?.steering === true,
  );

  /** Turns shown in the timeline; queued ones wait below, as ghosts. */
  const shown = $derived(conversation.turns.filter((t) => t.status !== "queued"));
  const queued = $derived(
    conversation.queue.turnIds
      .map((id) => conversation.turns.find((t) => t.id === id))
      .filter((t) => t !== undefined),
  );

  // --- scrolling -----------------------------------------------------------
  let scroller = $state<HTMLDivElement | null>(null);
  // Returning to a conversation read this session opens where it was left;
  // otherwise (or when it was left at its end) at the end.
  const saved = readingPosition(untrack(() => threadId));
  let following = $state(saved?.atEnd ?? true);
  let restored = saved === undefined || saved.atEnd;

  // Put the reader back once the saved stretch of the timeline is there.
  $effect(() => {
    void conversation.turns.length;
    if (restored || !scroller || conversation.turns.length === 0) return;
    const el = scroller;
    void tick().then(() => {
      if (restored || !saved) return;
      el.scrollTop = saved.top;
      restored = true;
    });
  });

  // --- the scroll rail: a mark per message sent -----------------------------
  const anchors = $derived(railAnchors(shown, i18n.t("chat.railImage")));
  /** The anchor whose message is on screen: the last one whose turn begins
   *  above the upper third of the pane. */
  let railCurrent = $state<number | null>(null);
  function measureRail() {
    if (!scroller || anchors.length === 0) {
      railCurrent = null;
      return;
    }
    const line = scroller.getBoundingClientRect().top + scroller.clientHeight / 3;
    let found: number | null = null;
    anchors.forEach((anchor, index) => {
      const el = scroller?.querySelector<HTMLElement>(`[data-turn-id="${CSS.escape(anchor.turnId)}"]`);
      if (el && el.getBoundingClientRect().top <= line) found = index;
    });
    railCurrent = found ?? 0;
  }
  $effect(() => {
    void anchors.length;
    void tick().then(measureRail);
  });
  function jumpToAnchor(index: number) {
    const id = anchors[index]?.turnId;
    const el = id ? scroller?.querySelector<HTMLElement>(`[data-turn-id="${CSS.escape(id)}"]`) : null;
    el?.scrollIntoView({ block: "start", behavior: "smooth" });
  }

  function onScroll() {
    if (!scroller) return;
    measureRail();
    const distance = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
    following = distance < 80;
    if (restored) {
      saveReadingPosition(threadId, { top: scroller.scrollTop, atEnd: following });
    }
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
    void conversation.openRequests.length;
    void queued.length;
    const last = conversation.turns[conversation.turns.length - 1];
    void last?.messages.map((m) => (typeof m.content === "string" ? m.content.length : 0));
    if (!following || !scroller) return;
    void tick().then(() => {
      if (scroller) scroller.scrollTop = scroller.scrollHeight;
    });
  });

  function jumpToEnd() {
    following = true;
    restored = true;
    if (scroller) scroller.scrollTop = scroller.scrollHeight;
  }

  // --- actions -------------------------------------------------------------
  async function send(
    message: string,
    extras: { command?: AgentCommandInvocation; attachments?: TurnAttachment[] },
  ) {
    following = true;
    await chat.send(threadId, message, { options: optionValues, ...extras });
  }

  // The thread's agent's commands (one function per agent and folder, so the
  // composer asks again only when those change).
  const agentKey = $derived(thread?.agentId);
  const loadCommands = $derived.by(() => {
    const id = agentKey;
    const folder = cwd;
    return id ? () => chat.commandsFor(id, folder) : undefined;
  });

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
    <!-- The conversation and the agent that drives it (fixed for its life). -->
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
      <DropdownMenu.Root>
        <DropdownMenu.Trigger>
          {#snippet child({ props })}
            <Button variant="ghost" size="icon-xs" aria-label={i18n.t("chat.more")} {...props}>
              <Icon icon={MoreHorizontalIcon} class={icon.action} />
            </Button>
          {/snippet}
        </DropdownMenu.Trigger>
        <DropdownMenu.Content width="simple" align="end">
          <!-- The same actions as the chat's sidebar row (`chatActionsFor`);
               opening is moot here. -->
          {#if thread && terminalState !== "unavailable"}
            <DropdownMenu.Item
              class={text.menu}
              disabled={terminalState === "working"}
              onclick={() => terminalSessions.openInTerminal(thread)}
            >
              {terminalState === "working" ? i18n.t("sessions.openInTerminalWait") : i18n.t("sessions.openInTerminal")}
            </DropdownMenu.Item>
            <DropdownMenu.Separator />
          {/if}
          {#if thread}
            {#each chatActionsFor(thread).filter((a) => a !== "open") as action (action)}
              {#if action === "delete"}<DropdownMenu.Separator />{/if}
              <DropdownMenu.Item
                class={cn(text.menu, action === "delete" && "text-destructive")}
                onclick={() => chatActionUi.run(action, thread, () => undefined)}
              >
                {i18n.t(`chat.action.${action}`)}
              </DropdownMenu.Item>
            {/each}
          {/if}
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
            <div data-turn-id={turn.id}>
              <ChatTurnView {turn} {threadId} {cwd} {conversation} />
            </div>
          {/each}

          {#each conversation.pending as p (p.clientTurnId)}
            {@const failed = p.error !== undefined}
            {@const images = (p.request.attachments ?? [])
              .filter((a) => a.type !== "file")
              .map((a, i) => ({
                id: `${p.clientTurnId}-${i}`,
                load: () => Promise.resolve(`data:${a.mimeType};base64,${a.base64Data ?? ""}`),
              }))}
            {@const sentFiles = (p.request.attachments ?? [])
              .filter((a) => a.type === "file")
              .map((a, i) => ({
                id: `${p.clientTurnId}-f${i}`,
                name: a.name ?? "file",
                bytes: Math.floor(((a.base64Data ?? "").length * 3) / 4),
              }))}
            <div class="flex flex-col items-end gap-1">
              {#if images.length > 0}
                <ChatImages {images} class={cn("max-w-[85%]", !failed && "opacity-70")} />
              {/if}
              <ChatFiles files={sentFiles} class={cn(!failed && "opacity-70")} />
              {#if p.text}
                <ChatUserText text={p.text} class={cn(!failed && "opacity-70")} />
              {/if}
              {#if failed}
                <p class="flex items-center gap-2 text-xs text-destructive">
                  {p.error || i18n.t("chat.notSent")}
                  <Button
                    variant="link"
                    size="xs"
                    class="h-auto px-0"
                    onclick={() => void chat.retry(threadId, p.clientTurnId)}
                  >
                    {i18n.t("chat.retry")}
                  </Button>
                  {#if p.request.command || p.request.text || p.request.attachments?.length}
                    <Button variant="link" size="xs" class="h-auto px-0" onclick={() => editFailed(p)}>
                      {i18n.t("chat.edit")}
                    </Button>
                  {/if}
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
        </div>
      </div>
      <ChatScrollRail {anchors} current={railCurrent} onselect={jumpToAnchor} />
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

    <!-- Dock + composer -->
    <div class={cn(chatTokens.column, "shrink-0 pb-4 pt-1")}>
      {#if thread?.status === "archived"}
        <!-- Archived here or on the phone: read-only until restored. -->
        <div class="mb-2 flex items-center gap-2 rounded-lg bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
          <span class="flex-1">{i18n.t("chat.archivedBanner")}</span>
          <Button
            size="sm"
            variant="outline"
            onclick={() => void chat.unarchive(threadId).catch(toastError)}
          >
            {i18n.t("chat.action.unarchive")}
          </Button>
        </div>
      {/if}
      {#if hold && thread?.status !== "archived"}
        <!-- The session is open in a terminal: one writer at a time. -->
        <div class="mb-2 flex items-center gap-2 rounded-lg bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
          <span class="min-w-0 flex-1">
            {hold.busy
              ? i18n.t("sessions.heldBannerWorking", { name: hold.holder.name })
              : i18n.t("sessions.heldBanner", { name: hold.holder.name })}
          </span>
          {#if holdingTab}
            <Button size="sm" variant="ghost" onclick={goToTerminal}>
              {i18n.t("sessions.goToTerminal")}
            </Button>
          {/if}
          <Button size="sm" variant="outline" disabled={hold.busy || takingBack} onclick={() => void continueHere()}>
            {takingBack ? i18n.t("sessions.opening") : i18n.t("sessions.continueHere")}
          </Button>
        </div>
      {/if}
      {#if conversation.openRequests.length > 0 || queued.length > 0 || conversation.queue.paused || rescued.length > 0}
        <div class={chatTokens.dock}>
          {#each conversation.openRequests as request, ri (requestIdOf(request))}
            <ChatRequest block={request} {threadId} {conversation} keys={ri === 0} />
          {/each}

          {#if conversation.queue.paused}
            <div
              class="flex items-center gap-2 rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-200"
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

          {#if queued.length > 0}
            <div class={cn(chatTokens.card, "flex flex-col gap-0.5 p-1.5")}>
              <span class={cn(text.menuLabel, "px-1.5 pb-1 pt-0.5")}>
                {i18n.plural(queued.length, "chat.queuedCountOne", "chat.queuedCount")}
              </span>
              {#each queued as turn (turn.id)}
                <div class="flex min-h-7 items-center gap-2 rounded-md px-1.5 text-xs">
                  <Icon icon={Clock01Icon} class={cn(icon.decorative, "shrink-0 text-muted-foreground")} />
                  <span class="min-w-0 flex-1 truncate">
                    {turn.messages.find((m) => m.role === "user")?.content ?? ""}
                  </span>
                  {#if canSendNow}
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      aria-label={i18n.t("chat.sendQueuedNow")}
                      title={i18n.t("chat.sendQueuedNow")}
                      onclick={() => void chat.sendQueuedNow(threadId, turn.id).catch(toastError)}
                    >
                      <Icon icon={ArrowUp02Icon} class={icon.status} />
                    </Button>
                  {/if}
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label={i18n.t("chat.editQueued")}
                    title={i18n.t("chat.editQueued")}
                    onclick={() =>
                      void editQueued(turn.id, String(turn.messages.find((m) => m.role === "user")?.content ?? ""))}
                  >
                    <Icon icon={PencilEdit02Icon} class={icon.status} />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label={i18n.t("chat.cancelQueued")}
                    title={i18n.t("chat.cancelQueued")}
                    onclick={() => void chat.cancel(threadId, turn.id).catch(toastError)}
                  >
                    <Icon icon={Cancel01Icon} class={icon.status} />
                  </Button>
                </div>
              {/each}
            </div>
          {/if}

          {#if rescued.length > 0}
            <div class={cn(chatTokens.card, "flex flex-col gap-0.5 p-1.5")}>
              <span class={cn(text.menuLabel, "px-1.5 pb-1 pt-0.5")}>
                {i18n.plural(rescued.length, "chat.savedDraftsOne", "chat.savedDrafts")}
              </span>
              {#each rescued as saved, index (index)}
                <div class="flex min-h-7 items-center gap-2 rounded-md px-1.5 text-xs">
                  <Icon icon={NoteEditIcon} class={cn(icon.decorative, "shrink-0 text-muted-foreground")} />
                  <button
                    type="button"
                    class="min-w-0 flex-1 truncate text-left hover:text-foreground"
                    title={i18n.t("chat.restoreDraft")}
                    onclick={() => restoreDraft(index)}
                  >
                    {saved.trim()}
                  </button>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label={i18n.t("chat.restoreDraft")}
                    title={i18n.t("chat.restoreDraft")}
                    onclick={() => restoreDraft(index)}
                  >
                    <Icon icon={PencilEdit02Icon} class={icon.status} />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label={i18n.t("chat.discardDraft")}
                    title={i18n.t("chat.discardDraft")}
                    onclick={() => setRescued(rescued.filter((_, i) => i !== index))}
                  >
                    <Icon icon={Delete02Icon} class={icon.status} />
                  </Button>
                </div>
              {/each}
            </div>
          {/if}
        </div>
      {/if}

      <ChatComposer
        bind:this={composer}
        bind:value={draft}
        {history}
        running={conversation.running}
        disabled={thread?.status === "archived" || hold !== undefined}
        autofocus={active}
        context={conversation.usage?.contextWindow
          ? { tokens: conversation.usage.tokens, limit: conversation.usage.contextWindow }
          : null}
        {plan}
        onsend={send}
        onstop={() => void stop()}
        {loadCommands}
        mentionRoot={cwd}
        acceptsImages={agent?.capabilities?.images === true}
      >
        {#snippet leading()}
          <ModelPicker
            variant="pill"
            {models}
            value={thread?.model ?? ""}
            loading={modelsLoading}
            allowDefault={false}
            onSelect={(id) => void setModel(id)}
          />
          <RunOptionsPicker options={model?.options ?? []} bind:values={optionValues} />
        {/snippet}
        {#snippet trailing()}
          <ChatAccessMenu value={accessMode} onChange={(mode) => void setAccess(mode)} />
        {/snippet}
      </ChatComposer>
    </div>
  </div>
{/if}

