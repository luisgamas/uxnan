<script lang="ts">
  // A chat tab before its first message: choose the agent (fixed for the life
  // of the conversation — another CLI cannot continue a native session) and,
  // optionally, a model (switchable later). Or pick up a conversation that
  // already runs in this folder — one started on the phone included — since
  // every client sees the same bridge threads.
  //
  // A centered hero: the question, then the composer, whose toolbar carries the
  // agent and its model in one pill (`ModelPicker` with its rail of agents),
  // the model's run options, and the access mode the conversation will start
  // in — chosen here, before the first message. Below it, kept short on
  // purpose: the three newest conversations here and "See all", which opens the
  // Conversations tab (the whole catalog, searchable — architecture/02a
  // §5.8.21); any of them can seed this one ("Continue from…": its context goes
  // with the first message, to the agent chosen here). The agents' own
  // sessions in this folder that no conversation continues yet — started in a
  // terminal, here or elsewhere (§5.8.19) — are not listed here: one quiet line
  // says how many there are and opens the Conversations tab on them.
  //
  // The screen is composer-first: the hero and the composer sit at a fixed
  // anchor of the pane, and the history below them has a reserved box of its
  // own, so no amount of history — or the moment it arrives — moves them.
  import { untrack } from "svelte";
  import { hosts } from "$lib/state/hosts.svelte";
  import { sshHostId } from "$lib/target";
  import type { Thread, TransferStrategy } from "$shared/models/thread";
  import { TRANSFER_STRATEGIES } from "$shared/models/thread";
  import * as ContextMenu from "$lib/components/ui/context-menu";
  import * as DropdownMenu from "$lib/components/ui/dropdown-menu";
  import { Button } from "$lib/components/ui/button";
  import { Icon } from "$lib/components/ui/icon";
  import ChevronDownIcon from "@hugeicons/core-free-icons/ChevronDownIcon";
  import CancelIcon from "@hugeicons/core-free-icons/Cancel01Icon";
  import ArrowTurnForwardIcon from "@hugeicons/core-free-icons/ArrowTurnForwardIcon";
  import ArrowRightIcon from "@hugeicons/core-free-icons/ArrowRight01Icon";
  import { chatActionUi, chatActionsFor } from "$lib/bridge/chatActions.svelte";
  import AgentLogo from "$lib/components/AgentLogo.svelte";
  import ModelPicker, { type PickerAgent } from "$lib/components/ModelPicker.svelte";
  import RunOptionsPicker from "$lib/components/RunOptionsPicker.svelte";
  import { Separator } from "$lib/components/ui/separator";
  import { SvelteSet } from "svelte/reactivity";
  import ChatComposer from "./ChatComposer.svelte";
  import ChatAccessMenu from "./ChatAccessMenu.svelte";
  import type { AccessMode } from "$shared/models/thread";
  import { effectiveAccessMode } from "$lib/bridge/accessMode";
  import type { AgentCommandInvocation } from "$shared/agents/agent-capabilities";
  import type { TurnAttachment } from "$shared/models/workspace";
  import { useChat } from "$lib/bridge/chat.svelte";
  import { bridgeAgentForCommand, bridgeAgentLogo } from "$lib/bridge/agents";
  import { app } from "$lib/state/app.svelte";
  import { terminals, type ChatTab } from "$lib/state/terminals.svelte";
  import { relativeTime } from "$lib/relativeTime";
  import { toastError } from "$lib/toast";
  import { i18n } from "$lib/i18n";
  import { cn } from "$lib/utils";
  import { chat as chatTokens, icon, row, text } from "$lib/design";

  let { tab, active }: { tab: ChatTab; active: boolean } = $props();
  // The replica — and the bridge — of the machine this chat is on.
  const chat = useChat();
  const bridge = chat.client;
  /** The host whose own bridge holds this chat, if it is not this machine's. */
  const onHost = sshHostId(bridge.target);

  const agents = $derived(chat.agents);
  let agentId = $state<string | undefined>(undefined);
  let model = $state("");
  let optionValues = $state<Record<string, string | boolean>>({});
  /** The access mode picked before the first message; unset = the agent's default. */
  let access = $state<AccessMode | undefined>(undefined);
  let starting = $state(false);
  // The composer's text is the tab's draft (persisted with the layout).
  let draft = $state(untrack(() => tab.draft ?? ""));
  let composer = $state<ReturnType<typeof ChatComposer> | null>(null);
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

  const pickerAgents = $derived<PickerAgent[]>(
    agents.map((a) => ({
      id: a.agentId,
      label: a.displayName,
      logo: bridgeAgentLogo(a.agentId),
      available: a.available,
      ...(a.available ? {} : { note: i18n.t("chat.notInstalled") }),
    })),
  );
  // Another agent's models, asked for when the picker shows them.
  const browsing = new SvelteSet<string>();
  function browseAgent(id: string) {
    if (chat.cachedModels(id).length > 0 || browsing.has(id)) return;
    browsing.add(id);
    void chat.modelsFor(id).finally(() => browsing.delete(id));
  }
  const models = $derived(chat.cachedModels(agentId));
  const caps = $derived(chat.agent(agentId)?.capabilities);
  const accessModes = $derived<AccessMode[]>(caps?.accessModes ?? []);
  const accessMode = $derived(caps ? effectiveAccessMode(caps, access) : undefined);
  // "Default" runs the agent's own default model: offer that model's knobs.
  const runOptions = $derived(
    (models.find((m) => m.id === model) ?? (model ? undefined : models.find((m) => m.isDefault)))
      ?.options ?? [],
  );
  /** How many recent conversations the screen shows; the rest is "See all". */
  const RECENT_SHOWN = 3;
  const existing = $derived(chat.threadsFor(tab.cwd).filter((t) => t.status !== "archived"));
  /** How many the Conversations tab lists for this folder's project. */
  const projectCount = $derived.by(() => {
    const projectId = chat.threadsFor(tab.cwd)[0]?.projectId;
    if (!projectId) return existing.length;
    return [...chat.threads.values()].filter((t) => t.projectId === projectId && t.status !== "archived")
      .length;
  });
  /** The conversation this one continues, when one was picked ("Continue from…"). */
  let seed = $state<{ threadId: string; strategy: TransferStrategy } | null>(null);
  const seedThread = $derived(seed ? chat.threads.get(seed.threadId) : undefined);
  // How many of the agents' own sessions here no conversation continues yet:
  // asked once the bridge is there (again after a reconnect); listed by the
  // Conversations tab, not here.
  $effect(() => {
    const cwd = tab.cwd;
    if (!bridge.connected) return;
    void chat.refreshAgentSessions(cwd).catch(() => undefined);
  });
  const sessionCount = $derived(chat.agentSessionsOf(tab.cwd)?.sessions.length);

  const folder = $derived(
    tab.cwd.replace(/\\/g, "/").replace(/\/+$/, "").split("/").pop() ?? tab.cwd,
  );

  function pickAgent(id: string) {
    if (id === agentId) return;
    agentId = id;
    model = "";
    optionValues = {};
  }
  function pickModel(id: string, agent?: string) {
    if (agent) pickAgent(agent);
    model = id;
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
        // Picked to continue: the bridge prepares its context, and this first
        // message carries it to the agent chosen here.
        ...(seed && seedThread ? { continueFrom: seed } : {}),
      });
      // A mode picked here applies from the first turn; the agent's default
      // needs nothing sent.
      if (caps && accessMode !== undefined && accessMode !== effectiveAccessMode(caps, thread.accessMode)) {
        await chat.setAccessMode(thread.id, accessMode);
      }
      terminals.bindChatThread(tab.id, thread.id);
      // The conversation is empty on the bridge, so the first page is known
      // without a round trip; the bridge names the thread from this message.
      const conversation = chat.conversation(thread.id);
      conversation.loaded = true;
      await chat.send(thread.id, message, { options: optionValues, ...extras });
    } catch (err) {
      // Nothing was sent: give the text back — its chips with it — instead
      // of losing it.
      if (composer) composer.load(message, extras.attachments ?? []);
      else draft = message;
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
      <ContextMenu.Item class={text.menu} onclick={() => (seed = { threadId: thread.id, strategy: "selection" })}>
        {i18n.t("chat.continueFromThis")}
      </ContextMenu.Item>
      <ContextMenu.Separator />
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

<div class="uxnan-scroll h-full min-h-0 overflow-y-auto">
  <!-- Three rows: a gap above the hero (a share of the pane, so it sits at the
       same height however much history there is), the hero with its composer,
       and the box the history lives in (room for three recent rows and the
       sessions line, which never pushes what is above). Short panes scroll
       the pane, with the composer still the first thing in it. -->
  <div
    class={cn(
      chatTokens.column,
      "grid h-full min-h-[34rem] max-w-2xl grid-rows-[minmax(1rem,24%)_auto_minmax(12.5rem,1fr)] pb-6",
    )}
  >
    <div aria-hidden="true"></div>
    <div class="flex flex-col gap-5">
      <div class="flex flex-col items-center gap-1.5 text-center">
        <h2 class={chatTokens.hero}>
          {i18n.t("chat.startTitle", { folder })}
        </h2>
        <p class={cn(text.meta, "max-w-md")}>
          {onHost
            ? i18n.t("chat.startHintHost", { host: hosts.labelOf(onHost) })
            : i18n.t("chat.startHint")}
        </p>
      </div>

      <div class="flex flex-col gap-1.5">
        {#if seedThread && seed}
          <!-- What this conversation continues: its context goes with the first
               message, to the agent chosen below. -->
          <div class={cn("flex min-w-0 items-center gap-2 rounded-lg border border-border/60 bg-muted/40 px-2.5 py-1.5", text.meta)}>
            <Icon icon={ArrowTurnForwardIcon} class={cn(icon.decorative, "shrink-0")} />
            <span class="min-w-0 flex-1 truncate">
              {i18n.t("chat.continuingFrom", { title: seedThread.title })}
            </span>
            <DropdownMenu.Root>
              <DropdownMenu.Trigger>
                {#snippet child({ props })}
                  <Button variant="ghost" size="sm" class="h-6 gap-1 px-1.5 text-xs" {...props}>
                    {i18n.t(`transfer.strategy.${seed?.strategy ?? "selection"}`)}
                    <Icon icon={ChevronDownIcon} class={icon.status} />
                  </Button>
                {/snippet}
              </DropdownMenu.Trigger>
              <DropdownMenu.Content width="standard" align="end">
                <DropdownMenu.RadioGroup
                  value={seed.strategy}
                  onValueChange={(v) => {
                    if (seed) seed = { ...seed, strategy: v as TransferStrategy };
                  }}
                >
                  {#each TRANSFER_STRATEGIES.filter((v) => v !== "fork") as value (value)}
                    <DropdownMenu.RadioItem class={text.menu} {value}>
                      <span class="flex flex-col">
                        <span>{i18n.t(`transfer.strategy.${value}`)}</span>
                        <span class={text.meta}>{i18n.t(`transfer.strategyDesc.${value}`)}</span>
                      </span>
                    </DropdownMenu.RadioItem>
                  {/each}
                </DropdownMenu.RadioGroup>
              </DropdownMenu.Content>
            </DropdownMenu.Root>
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={i18n.t("chat.continueFromClear")}
              onclick={() => (seed = null)}
            >
              <Icon icon={CancelIcon} class={icon.action} />
            </Button>
          </div>
        {/if}
        <ChatComposer
          bind:this={composer}
          bind:value={draft}
          draftKey={tab.id}
          disabled={!agentId || starting}
          autofocus={active}
          placeholder={i18n.t("chat.startPlaceholder")}
          onsend={start}
          {loadCommands}
          mentionRoot={tab.cwd}
          acceptsImages={chat.agent(agentId)?.capabilities?.images === true}
        >
          {#snippet leading()}
            <ModelPicker
              variant="pill"
              agents={pickerAgents}
              {agentId}
              {models}
              value={model}
              loading={modelsLoading || agents.length === 0}
              modelsOf={(id) => chat.cachedModels(id)}
              loadingOf={(id) => browsing.has(id)}
              onBrowse={browseAgent}
              disabled={!agentId}
              onSelect={pickModel}
            />
            <RunOptionsPicker options={runOptions} bind:values={optionValues} disabled={!agentId} />
          {/snippet}
          {#snippet trailing()}
            {#if accessMode !== undefined}
              <Separator orientation="vertical" class="mx-0.5 h-4! bg-border/60" />
              <ChatAccessMenu value={accessMode} modes={accessModes} onChange={(mode) => (access = mode)} />
            {/if}
          {/snippet}
        </ChatComposer>
        <div class="flex items-center gap-2 px-1">
          <p class={cn(text.meta, "min-w-0 flex-1")}>{i18n.t("chat.agentFixedHint")}</p>
          {#if existing.length > 0 && !seed}
            <DropdownMenu.Root>
              <DropdownMenu.Trigger>
                {#snippet child({ props })}
                  <Button variant="ghost" size="sm" class="h-6 shrink-0 px-1.5 text-xs" {...props}>
                    {i18n.t("chat.continueFrom")}
                  </Button>
                {/snippet}
              </DropdownMenu.Trigger>
              <DropdownMenu.Content width="standard" align="end" class="max-h-72 overflow-y-auto">
                {#each existing.slice(0, 12) as thread (thread.id)}
                  <DropdownMenu.Item
                    class={cn(text.menu, "gap-2")}
                    onclick={() => (seed = { threadId: thread.id, strategy: "selection" })}
                  >
                    <AgentLogo logo={bridgeAgentLogo(thread.agentId)} class={cn(icon.brand, "shrink-0")} />
                    <span class="min-w-0 flex-1 truncate">{thread.title}</span>
                  </DropdownMenu.Item>
                {/each}
              </DropdownMenu.Content>
            </DropdownMenu.Root>
          {/if}
        </div>
      </div>

    </div>

    <!-- The history: at most the three newest conversations here, then one
         quiet line for the agents' own sessions. Nothing here expands in place
         — the Conversations tab holds the rest. It appears in a box that was
         already reserved, so it can arrive late without moving anything. -->
    <div class="flex flex-col gap-2 pt-7">
      {#if chat.threadsLoaded && chat.threads.size > 0}
        <div class="animate-in fade-in flex flex-col gap-1 duration-200">
          <div class="flex items-center gap-2 px-1">
            <span class={cn(text.section, "flex-1")}>{i18n.t("chat.recent")}</span>
            <Button
              variant="ghost"
              size="sm"
              class="h-7"
              onclick={() => terminals.openConversations({ cwd: tab.cwd, target: chat.target })}
            >
              {projectCount > 0
                ? i18n.t("chat.seeAllConversations", { n: String(projectCount) })
                : i18n.t("chat.seeAllConversationsNone")}
            </Button>
          </div>
          {#each existing.slice(0, RECENT_SHOWN) as thread (thread.id)}
            {@render threadRow(thread)}
          {/each}
        </div>
      {/if}
      {#if chat.threadsLoaded && sessionCount !== undefined && sessionCount > 0}
        <Button
          variant="ghost"
          size="sm"
          class="animate-in fade-in h-7 max-w-full self-start gap-1.5 px-2.5 text-muted-foreground duration-200"
          onclick={() =>
            terminals.openConversations({ cwd: tab.cwd, target: chat.target, view: "sessions" })}
        >
          <span class="min-w-0 truncate">
            {i18n.plural(sessionCount, "sessions.outsideOne", "sessions.outside")}
          </span>
          <Icon icon={ArrowRightIcon} class={cn(icon.action, "shrink-0")} />
        </Button>
      {/if}
    </div>
  </div>
</div>
