<script lang="ts">
  // A chat tab before its first message: choose the agent (fixed for the life
  // of the conversation — another CLI cannot continue a native session) and,
  // optionally, a model (switchable later). Or pick up a conversation that
  // already runs in this folder — one started on the phone included — since
  // every client sees the same bridge threads.
  //
  // A centered hero: the question, then the composer, whose toolbar carries the
  // agent (the same `Combobox` + `AgentLogo` the new-worktree dialog uses) and
  // the model with its run options (`ModelPicker`) as quiet pills; the conversations
  // already running here are listed below it, and below those the agents' own
  // sessions in this folder that no conversation continues yet — started in a
  // terminal, here or elsewhere — to pick up as a chat (architecture/02a
  // §5.8.19). One open in a terminal says so, and picking it asks that terminal
  // to let it go first.
  import { untrack } from "svelte";
  import type { Thread } from "$shared/models/thread";
  import * as Collapsible from "$lib/components/ui/collapsible";
  import * as ContextMenu from "$lib/components/ui/context-menu";
  import { Button } from "$lib/components/ui/button";
  import { Badge } from "$lib/components/ui/badge";
  import { Icon } from "$lib/components/ui/icon";
  import ChevronDownIcon from "@hugeicons/core-free-icons/ChevronDownIcon";
  import { chatActionUi, chatActionsFor } from "$lib/bridge/chatActions.svelte";
  import AgentLogo from "$lib/components/AgentLogo.svelte";
  import ModelPicker from "$lib/components/ModelPicker.svelte";
  import RunOptionsPicker from "$lib/components/RunOptionsPicker.svelte";
  import Combobox, { type ComboGroup, type ComboItem } from "$lib/components/Combobox.svelte";
  import ChatComposer from "./ChatComposer.svelte";
  import type { AgentCommandInvocation } from "$shared/agents/agent-capabilities";
  import type { TurnAttachment } from "$shared/models/workspace";
  import { sessionKey, useChat } from "$lib/bridge/chat.svelte";
  import type { AgentSessionSummary } from "$shared/models/agent-session";
  import { toast } from "$lib/toast";
  import { bridgeAgentForCommand, bridgeAgentLogo } from "$lib/bridge/agents";
  import { app } from "$lib/state/app.svelte";
  import { terminals, type ChatTab } from "$lib/state/terminals.svelte";
  import { relativeTime } from "$lib/relativeTime";
  import { toastError } from "$lib/toast";
  import { i18n } from "$lib/i18n";
  import { cn } from "$lib/utils";
  import { chat as chatTokens, focus, icon, row, text } from "$lib/design";

  let { tab, active }: { tab: ChatTab; active: boolean } = $props();
  // The replica — and the bridge — of the machine this chat is on.
  const chat = useChat();
  const bridge = chat.client;

  const agents = $derived(chat.agents);
  let agentId = $state<string | undefined>(undefined);
  let model = $state("");
  let optionValues = $state<Record<string, string | boolean>>({});
  let starting = $state(false);
  // The composer's text is the tab's draft (persisted with the layout).
  let draft = $state(untrack(() => tab.draft ?? ""));
  $effect(() => {
    const text = draft;
    const timer = setTimeout(() => (tab.draft = text || undefined), 300);
    return () => clearTimeout(timer);
  });
  let modelsLoading = $state(false);

  // Preselect: the agent the launcher asked for, else the desktop's default
  // agent (Settings → Agents) when the bridge drives that CLI, else the first
  // one installed.
  $effect(() => {
    if (agentId && agents.some((a) => a.agentId === agentId)) return;
    const preferred = [tab.agentId, bridgeAgentForCommand(app.defaultAgent()?.command)];
    const wanted = preferred
      .map((id) => agents.find((a) => a.agentId === id && a.available))
      .find((a) => a !== undefined);
    agentId = (wanted ?? agents.find((a) => a.available))?.agentId;
  });

  $effect(() => {
    const id = agentId;
    if (!id) return;
    modelsLoading = true;
    void chat.modelsFor(id).finally(() => (modelsLoading = false));
  });

  const agentGroups = $derived<ComboGroup[]>([
    {
      items: agents.map((a) => ({
        value: a.agentId,
        label: a.displayName,
        disabled: !a.available,
        ...(a.available ? {} : { meta: i18n.t("chat.notInstalled") }),
      })),
    },
  ]);
  const models = $derived(chat.cachedModels(agentId));
  // "Default" runs the agent's own default model: offer that model's knobs.
  const runOptions = $derived(
    (models.find((m) => m.id === model) ?? (model ? undefined : models.find((m) => m.isDefault)))
      ?.options ?? [],
  );
  const existing = $derived(chat.threadsFor(tab.cwd).filter((t) => t.status !== "archived"));
  const archived = $derived(chat.threadsFor(tab.cwd).filter((t) => t.status === "archived"));
  let showAll = $state(false);
  let archivedOpen = $state(false);
  // The agents' own sessions here that no conversation continues yet.
  let sessions = $state<AgentSessionSummary[]>([]);
  let unlisted = $state<string[]>([]);
  let showAllSessions = $state(false);
  let pickingSession = $state<string | null>(null);
  $effect(() => {
    const cwd = tab.cwd;
    if (!bridge.connected) return;
    let cancelled = false;
    chat
      .listAgentSessions(cwd)
      .then((result) => {
        if (cancelled) return;
        sessions = result.sessions.filter((s) => !s.threadId);
        unlisted = result.unlisted;
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  });
  const unlistedNames = $derived(
    unlisted.map((id) => chat.agent(id)?.displayName ?? id).join(", "),
  );

  /** Continue one of the agents' sessions as this tab's conversation. */
  async function pickSession(session: AgentSessionSummary) {
    const key = sessionKey(session.agentId, session.sessionId);
    if (pickingSession) return;
    pickingSession = key;
    try {
      if (chat.holds.get(key) ?? session.hold) {
        const outcome = await chat.requestHandoff(session);
        if (outcome !== "released" && outcome !== "notHeld") {
          toast(i18n.t(`sessions.handoff.${outcome}`));
          return;
        }
      }
      const thread = await chat.startThread({
        cwd: tab.cwd,
        agentId: session.agentId,
        agentSessionId: session.sessionId,
        ...(session.title ? { title: session.title } : {}),
      });
      openExisting(thread.id);
    } catch (err) {
      toastError(err);
    } finally {
      pickingSession = null;
    }
  }

  const folder = $derived(
    tab.cwd.replace(/\\/g, "/").replace(/\/+$/, "").split("/").pop() ?? tab.cwd,
  );

  function pickAgent(id: string) {
    if (id === agentId) return;
    agentId = id;
    model = "";
    optionValues = {};
  }

  // The picked agent's commands; a new function when the agent changes, which
  // is what makes the composer ask again.
  const loadCommands = $derived.by(() => {
    const id = agentId;
    return id ? () => chat.commandsFor(id, tab.cwd) : undefined;
  });

  async function start(
    message: string,
    extras: { command?: AgentCommandInvocation; attachments?: TurnAttachment[] } = {},
  ) {
    if (!agentId || starting) return;
    starting = true;
    // The message is on its way: drop the saved draft NOW. The debounced save
    // above is cancelled when this view gives way to the conversation, and
    // the conversation reads `tab.draft` — so a draft left here came back into
    // the composer after the first message.
    tab.draft = undefined;
    try {
      const thread = await chat.startThread({
        cwd: tab.cwd,
        agentId,
        ...(model ? { model } : {}),
        // A name given to the tab before the first message is the user's.
        ...(tab.customTitle ? { title: tab.customTitle } : {}),
      });
      terminals.bindChatThread(tab.id, thread.id);
      // The conversation is empty on the bridge, so the first page is known
      // without a round trip; the bridge names the thread from this message.
      const conversation = chat.conversation(thread.id);
      conversation.loaded = true;
      await chat.send(thread.id, message, { options: optionValues, ...extras });
    } catch (err) {
      // Nothing was sent: give the text back instead of losing it.
      draft = message;
      tab.draft = message;
      toastError(err);
    } finally {
      starting = false;
    }
  }

  function openExisting(threadId: string) {
    // Another tab may already show it: focus that one instead of a twin.
    for (const { tab: other } of terminals.tabsWithWorkspace()) {
      if (other.kind === "chat" && other.threadId === threadId && other.id !== tab.id) {
        terminals.openChat({ cwd: tab.cwd, threadId });
        return;
      }
    }
    terminals.bindChatThread(tab.id, threadId);
  }
</script>

{#snippet threadRow(thread: Thread)}
  <!-- A conversation of this folder, with the same actions as its sidebar row
       (right-click): open, rename, archive or restore, delete. -->
  <ContextMenu.Root>
    <ContextMenu.Trigger>
      {#snippet child({ props })}
        <button
          {...props}
          type="button"
          class={cn(row.list, row.listInactive, thread.status === "archived" && "opacity-70")}
          onclick={() => openExisting(thread.id)}
        >
          <AgentLogo logo={bridgeAgentLogo(thread.agentId)} class={cn(icon.brand, "shrink-0")} />
          <span class="min-w-0 flex-1 truncate text-foreground">{thread.title}</span>
          <span class={cn(text.meta, "shrink-0")}>{relativeTime(thread.updatedAt, i18n.locale)}</span>
        </button>
      {/snippet}
    </ContextMenu.Trigger>
    <ContextMenu.Content width="simple">
      {#each chatActionsFor(thread) as action (action)}
        {#if action === "delete"}<ContextMenu.Separator />{/if}
        <ContextMenu.Item
          class={cn(text.menu, action === "delete" && "text-destructive")}
          onclick={() => chatActionUi.run(action, thread, () => openExisting(thread.id))}
        >
          {i18n.t(`chat.action.${action}`)}
        </ContextMenu.Item>
      {/each}
    </ContextMenu.Content>
  </ContextMenu.Root>
{/snippet}

{#snippet sessionRow(session: AgentSessionSummary)}
  {@const key = sessionKey(session.agentId, session.sessionId)}
  {@const hold = chat.holds.get(key) ?? session.hold}
  <button
    type="button"
    class={cn(row.list, row.listInactive)}
    disabled={pickingSession !== null}
    title={i18n.t("sessions.pickHint", { agent: chat.agent(session.agentId)?.displayName ?? session.agentId })}
    onclick={() => void pickSession(session)}
  >
    <AgentLogo logo={bridgeAgentLogo(session.agentId)} class={cn(icon.brand, "shrink-0")} />
    <span class={cn("min-w-0 flex-1 truncate", session.title ? "text-foreground" : "text-muted-foreground")}>
      {session.title ?? i18n.t("sessions.untitled")}
    </span>
    {#if hold}
      <Badge variant="outline" class={cn("shrink-0 font-normal", text.indicator)}>
        {hold.busy ? i18n.t("sessions.inTerminalWorking") : i18n.t("sessions.inTerminal")}
      </Badge>
    {/if}
    <span class={cn(text.meta, "shrink-0")}>
      {pickingSession === key
        ? i18n.t("sessions.opening")
        : relativeTime(Date.now() - session.updatedAgoMs, i18n.locale)}
    </span>
  </button>
{/snippet}

{#snippet agentPrefix(item: ComboItem)}
  <AgentLogo logo={bridgeAgentLogo(item.value)} class={cn(icon.brand, "shrink-0")} />
{/snippet}

<div class="uxnan-scroll h-full min-h-0 overflow-y-auto">
  <div class={cn(chatTokens.column, "flex min-h-full max-w-2xl flex-col justify-center gap-5 py-10")}>
    <div class="flex flex-col items-center gap-1.5 text-center">
      <h2 class={chatTokens.hero}>
        {i18n.t("chat.startTitle", { folder })}
      </h2>
      <p class={cn(text.meta, "max-w-md")}>{i18n.t("chat.startHint")}</p>
    </div>

    <div class="flex flex-col gap-1.5">
      <ChatComposer
        bind:value={draft}
        disabled={!agentId || starting}
        autofocus={active}
        placeholder={i18n.t("chat.startPlaceholder")}
        onsend={start}
        {loadCommands}
        mentionRoot={tab.cwd}
        acceptsImages={chat.agent(agentId)?.capabilities?.images === true}
      >
        {#snippet leading()}
          <Combobox
            value={agentId}
            groups={agentGroups}
            placeholder={agents.length === 0 ? i18n.t("chat.agentsLoading") : i18n.t("chat.chooseAgent")}
            searchPlaceholder={i18n.t("common.search")}
            itemPrefix={agentPrefix}
            triggerVariant="ghost"
            triggerClass={cn(chatTokens.pill, "w-auto max-w-48")}
            disabled={agents.length === 0}
            onChange={pickAgent}
          />
          <ModelPicker
            variant="pill"
            {models}
            value={model}
            loading={modelsLoading}
            disabled={!agentId}
            onSelect={(id) => (model = id)}
          />
          <RunOptionsPicker options={runOptions} bind:values={optionValues} disabled={!agentId} />
        {/snippet}
      </ChatComposer>
      <p class={cn(text.meta, "px-1")}>{i18n.t("chat.agentFixedHint")}</p>
    </div>

    {#if existing.length > 0}
      <div class="flex flex-col gap-1 pt-2">
        <span class={cn(text.section, "px-1")}>{i18n.t("chat.continue")}</span>
        {#each showAll ? existing : existing.slice(0, 8) as thread (thread.id)}
          {@render threadRow(thread)}
        {/each}
        {#if existing.length > 8}
          <Button variant="ghost" size="sm" class="self-start" onclick={() => (showAll = !showAll)}>
            {showAll ? i18n.t("chat.showFewer") : i18n.t("chat.showAll", { n: String(existing.length) })}
          </Button>
        {/if}
      </div>
    {/if}

    {#if sessions.length > 0}
      <div class="flex flex-col gap-1 pt-2">
        <span class={cn(text.section, "px-1")}>{i18n.t("sessions.section")}</span>
        <p class={cn(text.meta, "px-1 pb-1")}>{i18n.t("sessions.sectionHint")}</p>
        {#each showAllSessions ? sessions : sessions.slice(0, 6) as session (sessionKey(session.agentId, session.sessionId))}
          {@render sessionRow(session)}
        {/each}
        {#if sessions.length > 6}
          <Button variant="ghost" size="sm" class="self-start" onclick={() => (showAllSessions = !showAllSessions)}>
            {showAllSessions ? i18n.t("chat.showFewer") : i18n.t("chat.showAll", { n: String(sessions.length) })}
          </Button>
        {/if}
        {#if unlisted.length > 0}
          <p class={cn(text.meta, "px-1 pt-1")}>{i18n.t("sessions.unlisted", { agents: unlistedNames })}</p>
        {/if}
      </div>
    {/if}

    {#if archived.length > 0}
      <Collapsible.Root bind:open={archivedOpen}>
        <Collapsible.Trigger
          class={cn("flex w-full items-center gap-1.5 rounded-md px-1 py-1 text-left", text.section, focus.ring)}
        >
          {i18n.t("chat.archivedSection")}
          <span class="tabular-nums text-muted-foreground/60">{archived.length}</span>
          <Icon
            icon={ChevronDownIcon}
            class={cn(icon.status, "ml-auto transition-transform", archivedOpen && "rotate-180")}
          />
        </Collapsible.Trigger>
        <Collapsible.Content class="flex flex-col gap-1 pt-1">
          <p class={cn(text.meta, "px-1 pb-1")}>{i18n.t("chat.archivedHint")}</p>
          {#each archived as thread (thread.id)}
            {@render threadRow(thread)}
          {/each}
        </Collapsible.Content>
      </Collapsible.Root>
    {/if}
  </div>
</div>
