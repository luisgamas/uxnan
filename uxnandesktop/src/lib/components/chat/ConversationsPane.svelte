<script lang="ts">
  // The Conversations tab: every conversation the bridge has — this folder's
  // project or all of them — searchable by title (here, at once) and by what
  // was said (the bridge's `thread/search`: it owns the history; this window
  // holds no turns of most of them), filtered, grouped by age, with a details
  // pane and every action a conversation offers (architecture/02a §5.8.21).
  // The same catalog the phone lists: closing a chat's tab only closes a view,
  // archiving is what takes a conversation out of the lists, everywhere.
  //
  // Wide, the list and the details sit side by side; narrow (a split pane), the
  // details replace the list until "Back".
  import type { Thread, ThreadSearchHit, Turn, TurnList } from "$shared/models/thread";
  import { SvelteMap } from "svelte/reactivity";
  import { chatFor } from "$lib/bridge/chat.svelte";
  import { isUnknownMethodError } from "$lib/bridge/client.svelte";
  import { chatActionUi, chatActionsFor } from "$lib/bridge/chatActions.svelte";
  import {
    conversationRows,
    groupByAge,
    type ConversationFilters,
    type ConversationOriginFilter,
    type ConversationScope,
    type ConversationStateFilter,
  } from "$lib/bridge/conversationsView";
  import { bridgeAgentLogo, hookAgentForBridgeAgent } from "$lib/bridge/agents";
  import { resumeInvocation } from "$lib/agentResume";
  import { TooltipSimple } from "$lib/components/ui/tooltip";
  import { terminalSessionsFor } from "$lib/state/terminalSessions.svelte";
  import { projects } from "$lib/state/projects.svelte";
  import { terminals, type ConversationsTab } from "$lib/state/terminals.svelte";
  import type { Project } from "$shared/models/project";
  import AgentLogo from "$lib/components/AgentLogo.svelte";
  import ChatBridgeGate from "./ChatBridgeGate.svelte";
  import ChatHostGate from "./ChatHostGate.svelte";
  import { sshHostId } from "$lib/target";
  import AgentStatusIndicator from "$lib/components/AgentStatusIndicator.svelte";
  import { Button } from "$lib/components/ui/button";
  import * as DropdownMenu from "$lib/components/ui/dropdown-menu";
  import * as InputGroup from "$lib/components/ui/input-group";
  import { Segmented } from "$lib/components/ui/segmented";
  import { Spinner } from "$lib/components/ui/spinner";
  import { Icon } from "$lib/components/ui/icon";
  import SearchIcon from "@hugeicons/core-free-icons/Search01Icon";
  import FilterIcon from "@hugeicons/core-free-icons/FilterHorizontalIcon";
  import ArrowLeftIcon from "@hugeicons/core-free-icons/ArrowLeft01Icon";
  import MoreHorizontalIcon from "@hugeicons/core-free-icons/MoreHorizontalIcon";
  import BubbleChatIcon from "@hugeicons/core-free-icons/BubbleChatIcon";
  import { relativeTime } from "$lib/relativeTime";
  import { toastError } from "$lib/toast";
  import { i18n } from "$lib/i18n";
  import { cn } from "$lib/utils";
  import { focus, icon, pane, row, text } from "$lib/design";

  let { tab, active }: { tab: ConversationsTab; active: boolean } = $props();

  const chat = $derived(chatFor(tab.target));
  const sessions = $derived(terminalSessionsFor(tab.target));

  const STATE_FILTERS: ConversationStateFilter[] = ["any", "working", "needsYou", "failed", "idle"];

  let scope = $state<ConversationScope>("project");
  let agentId = $state<string | undefined>(undefined);
  let stateFilter = $state<ConversationStateFilter>("any");
  let origin = $state<ConversationOriginFilter>("any");
  let archived = $state(false);
  let query = $state("");
  let selectedId = $state<string | undefined>(undefined);
  /** Narrow layout: the details replace the list while one is open. */
  let showingDetails = $state(false);

  // Asked to show a folder again (`openConversations`): back to its project.
  $effect(() => {
    void tab.focusSerial;
    scope = "project";
  });

  // The folder's project, as the bridge resolves it (a worktree maps to its
  // repository) — what "This project" means.
  let projectId = $state<string | undefined>(undefined);
  $effect(() => {
    const cwd = tab.cwd;
    const client = chat.client;
    if (!client.connected) return;
    let cancelled = false;
    client
      .call<Project>("project/resolve", { cwd })
      .then((project) => {
        if (!cancelled) projectId = project.id;
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  });
  const projectName = $derived(
    (projectId ? chat.projects.get(projectId)?.name : undefined) ??
      tab.cwd.replace(/\\/g, "/").replace(/\/+$/, "").split("/").pop() ??
      tab.cwd,
  );

  // What was said, answered by the bridge: debounced, newest page first.
  const hits = new SvelteMap<string, ThreadSearchHit>();
  let searching = $state(false);
  let searchCursor = $state<string | undefined>(undefined);
  let contentSearch = $state<"on" | "unsupported">("on");
  let searchSerial = 0;
  async function runSearch(more: boolean) {
    const q = query.trim();
    const serial = ++searchSerial;
    if (!more) {
      hits.clear();
      searchCursor = undefined;
    }
    if (q.length < 2 || !chat.client.connected) {
      searching = false;
      return;
    }
    searching = true;
    try {
      const result = await chat.search({
        query: q,
        ...(scope === "project" && projectId ? { projectId } : {}),
        includeArchived: archived,
        ...(more && searchCursor ? { cursor: searchCursor } : {}),
      });
      if (serial !== searchSerial) return;
      for (const hit of result.hits) hits.set(hit.threadId, hit);
      searchCursor = result.nextCursor;
    } catch (err) {
      if (serial !== searchSerial) return;
      if (isUnknownMethodError(err)) {
        contentSearch = "unsupported";
      } else {
        toastError(err);
      }
    } finally {
      if (serial === searchSerial) searching = false;
    }
  }
  $effect(() => {
    // Re-asked when what it searches changes.
    void query;
    void scope;
    void archived;
    void projectId;
    const timer = setTimeout(() => void runSearch(false), 250);
    return () => clearTimeout(timer);
  });

  const filters = $derived<ConversationFilters>({
    scope,
    ...(projectId ? { projectId } : {}),
    cwd: tab.cwd,
    ...(agentId ? { agentId } : {}),
    state: stateFilter,
    origin,
    archived,
    query,
  });
  const rows = $derived(
    conversationRows([...chat.threads.values()], filters, {
      activityOf: (id) => chat.activity.of(id),
      hits,
    }),
  );
  const groups = $derived(groupByAge(rows, Date.now()));
  const selected = $derived(selectedId ? chat.threads.get(selectedId) : undefined);
  const agentsListed = $derived(
    [...new Set([...chat.threads.values()].map((t) => t.agentId).filter((a): a is string => !!a))]
      .map((id) => ({ id, name: chat.agent(id)?.displayName ?? id }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  );
  const filtersOn = $derived(
    (agentId ? 1 : 0) + (stateFilter !== "any" ? 1 : 0) + (origin !== "any" ? 1 : 0) + (archived ? 1 : 0),
  );

  // Keep a selection on screen: the first row when none (or it left the list).
  $effect(() => {
    if (selectedId && rows.some((r) => r.thread.id === selectedId)) return;
    selectedId = rows[0]?.thread.id;
  });

  function select(threadId: string) {
    selectedId = threadId;
    showingDetails = true;
  }

  /** The branch a folder is checked out on, when it is a worktree this window knows. */
  function branchOf(cwd: string | undefined): string | undefined {
    if (!cwd) return undefined;
    const target = cwd.replace(/\\/g, "/").replace(/\/+$/, "");
    for (const list of Object.values(projects.worktreesByRepo)) {
      const found = list.find((w) => w.path.replace(/\\/g, "/").replace(/\/+$/, "") === target);
      if (found?.branch) return found.branch;
    }
    return undefined;
  }

  function spaceOf(thread: Thread): string {
    const project = chat.projects.get(thread.projectId)?.name ?? i18n.t("conversations.noProject");
    const branch = branchOf(thread.cwd);
    return branch ? `${project} · ${branch}` : project;
  }

  function originOf(thread: Thread): string | undefined {
    return thread.origin ? i18n.t(`conversations.origin.${thread.origin.kind}`) : undefined;
  }

  function openChat(thread: Thread) {
    terminals.openChat({ cwd: thread.cwd ?? tab.cwd, target: tab.target, threadId: thread.id });
  }

  // The selected conversation's last exchange, read once per selection and
  // whenever it moves (only its newest turn: a page, never the history).
  let last = $state<Turn | undefined>(undefined);
  let lastLoading = $state(false);
  $effect(() => {
    const thread = selected;
    last = undefined;
    if (!thread || thread.turnCount === 0 || !chat.client.connected) return;
    void thread.updatedAt;
    let cancelled = false;
    lastLoading = true;
    chat.client
      .call<TurnList>("turn/list", { threadId: thread.id, limit: 1, fromEnd: true })
      .then((page) => {
        if (!cancelled) last = page.turns.at(-1);
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) lastLoading = false;
      });
    return () => {
      cancelled = true;
    };
  });
  function said(turn: Turn | undefined, role: "user" | "assistant"): string {
    const content = turn?.messages.find((m) => m.role === role)?.content;
    const value = typeof content === "string" ? content.trim() : "";
    return value.length > 400 ? `${value.slice(0, 399)}…` : value;
  }

  const terminalState = $derived(sessions.openInTerminalState(selected));
  /** Why "Continue in terminal" is off, when it is. */
  const terminalReason = $derived.by(() => {
    if (!selected || terminalState === "ready") return undefined;
    if (terminalState === "working") return i18n.t("sessions.openInTerminalWait");
    const agentName = chat.agent(selected.agentId)?.displayName ?? selected.agentId ?? "";
    const hook = hookAgentForBridgeAgent(selected.agentId);
    if (!hook || !resumeInvocation({ agent: hook, id: "probe", capturedAt: 0 })) {
      return i18n.t("transfer.noTerminal", { agent: agentName });
    }
    if (!selected.agentSessionId) return i18n.t("conversations.noSessionYet");
    return i18n.t("conversations.alreadyInTerminal");
  });
</script>

{#snippet snippetText(hit: ThreadSearchHit)}
  {@const match = hit.matches[0]}
  {#if match}
    <span class={cn(text.meta, "line-clamp-1 break-all")}>
      {match.snippet.slice(0, match.matchStart)}<mark class="rounded-[3px] bg-amber-400/25 px-0.5 text-foreground">{match.snippet.slice(match.matchStart, match.matchStart + match.matchLength)}</mark>{match.snippet.slice(match.matchStart + match.matchLength)}
    </span>
  {/if}
{/snippet}

{#snippet actionsMenu(thread: Thread)}
  <DropdownMenu.Root>
    <DropdownMenu.Trigger>
      {#snippet child({ props })}
        <Button variant="ghost" size="icon-xs" aria-label={i18n.t("chat.more")} {...props}>
          <Icon icon={MoreHorizontalIcon} class={icon.action} />
        </Button>
      {/snippet}
    </DropdownMenu.Trigger>
    <DropdownMenu.Content width="simple" align="end">
      {#each chatActionsFor(thread) as action (action)}
        {#if action === "delete"}<DropdownMenu.Separator />{/if}
        <DropdownMenu.Item
          class={cn(text.menu, action === "delete" && "text-destructive")}
          onclick={() => chatActionUi.run(action, thread, () => openChat(thread))}
        >
          {i18n.t(`chat.action.${action}`)}
        </DropdownMenu.Item>
      {/each}
    </DropdownMenu.Content>
  </DropdownMenu.Root>
{/snippet}

{#if !chat.client.connected}
  <div class={pane.root}>
    {#if sshHostId(chat.client.target)}
      <ChatHostGate bridge={chat.client} />
    {:else}
      <ChatBridgeGate />
    {/if}
  </div>
{:else}
<div class={cn(pane.root, "@container")}>
  <!-- Toolbar: search, scope and filters. -->
  <header class="flex shrink-0 flex-wrap items-center gap-2 border-b border-border/60 px-3 py-2">
    <InputGroup.Root class="h-8 min-w-40 flex-1">
      <InputGroup.Addon>
        <Icon icon={SearchIcon} class={icon.action} />
      </InputGroup.Addon>
      <InputGroup.Input
        bind:value={query}
        autofocus={active}
        placeholder={contentSearch === "on"
          ? i18n.t("conversations.searchPlaceholder")
          : i18n.t("conversations.searchTitlesOnly")}
        aria-label={i18n.t("conversations.search")}
      />
      {#if searching}
        <InputGroup.Addon align="inline-end">
          <Spinner class={icon.action} />
        </InputGroup.Addon>
      {/if}
    </InputGroup.Root>
    <Segmented
      value={scope}
      label={i18n.t("conversations.scope")}
      options={[
        { value: "project", label: i18n.t("conversations.scopeProject") },
        { value: "all", label: i18n.t("conversations.scopeAll") },
      ]}
      onValueChange={(v) => (scope = v as ConversationScope)}
    />
    <DropdownMenu.Root>
      <DropdownMenu.Trigger>
        {#snippet child({ props })}
          <Button variant="ghost" size="sm" class="h-8 gap-1.5" {...props}>
            <Icon icon={FilterIcon} class={icon.action} />
            {i18n.t("conversations.filters")}
            {#if filtersOn > 0}
              <span class={cn(text.indicator, "tabular-nums text-muted-foreground")}>{filtersOn}</span>
            {/if}
          </Button>
        {/snippet}
      </DropdownMenu.Trigger>
      <DropdownMenu.Content width="standard" align="end">
        <DropdownMenu.Label class={text.menuLabel}>{i18n.t("conversations.filterAgent")}</DropdownMenu.Label>
        <DropdownMenu.RadioGroup value={agentId ?? ""} onValueChange={(v) => (agentId = v || undefined)}>
          <DropdownMenu.RadioItem class={text.menu} value="">{i18n.t("conversations.anyAgent")}</DropdownMenu.RadioItem>
          {#each agentsListed as a (a.id)}
            <DropdownMenu.RadioItem class={text.menu} value={a.id}>{a.name}</DropdownMenu.RadioItem>
          {/each}
        </DropdownMenu.RadioGroup>
        <DropdownMenu.Separator />
        <DropdownMenu.Label class={text.menuLabel}>{i18n.t("conversations.filterState")}</DropdownMenu.Label>
        <DropdownMenu.RadioGroup value={stateFilter} onValueChange={(v) => (stateFilter = v as ConversationStateFilter)}>
          {#each STATE_FILTERS as value (value)}
            <DropdownMenu.RadioItem class={text.menu} {value}>{i18n.t(`conversations.state.${value}`)}</DropdownMenu.RadioItem>
          {/each}
        </DropdownMenu.RadioGroup>
        <DropdownMenu.Separator />
        <DropdownMenu.Label class={text.menuLabel}>{i18n.t("conversations.filterOrigin")}</DropdownMenu.Label>
        <DropdownMenu.RadioGroup value={origin} onValueChange={(v) => (origin = v as ConversationOriginFilter)}>
          <DropdownMenu.RadioItem class={text.menu} value="any">{i18n.t("conversations.anyOrigin")}</DropdownMenu.RadioItem>
          <DropdownMenu.RadioItem class={text.menu} value="phone">{i18n.t("conversations.origin.phone")}</DropdownMenu.RadioItem>
          <DropdownMenu.RadioItem class={text.menu} value="desktop">{i18n.t("conversations.origin.desktop")}</DropdownMenu.RadioItem>
        </DropdownMenu.RadioGroup>
        <DropdownMenu.Separator />
        <DropdownMenu.CheckboxItem class={text.menu} bind:checked={archived}>
          {i18n.t("conversations.showArchived")}
        </DropdownMenu.CheckboxItem>
      </DropdownMenu.Content>
    </DropdownMenu.Root>
  </header>

  <div class="flex min-h-0 flex-1">
    <!-- The list. -->
    <div
      class={cn(
        "uxnan-scroll min-h-0 min-w-0 flex-1 overflow-y-auto px-2 py-2 @[44rem]:max-w-[26rem] @[44rem]:border-r @[44rem]:border-border/60",
        showingDetails && "hidden @[44rem]:block",
      )}
    >
      <p class={cn(text.meta, "px-2 pb-2")}>
        {scope === "project"
          ? i18n.t("conversations.countProject", { n: String(rows.length), project: projectName })
          : i18n.t("conversations.countAll", { n: String(rows.length) })}
      </p>
      {#if rows.length === 0}
        <p class={cn(text.meta, "px-2 py-8 text-center")}>
          {query.trim().length > 0 ? i18n.t("conversations.noMatch") : i18n.t("conversations.empty")}
        </p>
      {/if}
      {#each groups as band (band.group)}
        <div class="flex flex-col gap-0.5 pb-3">
          <span class={cn(text.section, "px-2 pb-1")}>{i18n.t(`conversations.age.${band.group}`)}</span>
          {#each band.rows as entry (entry.thread.id)}
            {@const thread = entry.thread}
            {@const status = chat.activity.of(thread.id)}
            <button
              type="button"
              class={cn(
                row.list,
                "items-start",
                thread.id === selectedId ? row.listActive : row.listInactive,
                focus.ring,
              )}
              onclick={() => select(thread.id)}
              ondblclick={() => openChat(thread)}
            >
              <AgentLogo logo={bridgeAgentLogo(thread.agentId)} class={cn(icon.brand, "mt-0.5 shrink-0")} />
              <span class="flex min-w-0 flex-1 flex-col gap-0.5">
                <span class="flex min-w-0 items-center gap-2">
                  <span class="min-w-0 flex-1 truncate text-foreground">{thread.title}</span>
                  {#if status !== "idle"}
                    <AgentStatusIndicator {status} />
                  {/if}
                  <span class={cn(text.meta, "shrink-0 tabular-nums")}>
                    {relativeTime(thread.updatedAt, i18n.locale)}
                  </span>
                </span>
                <span class={cn(text.meta, "truncate")}>
                  {[spaceOf(thread), originOf(thread)].filter(Boolean).join(" · ")}
                </span>
                {#if entry.hit}{@render snippetText(entry.hit)}{/if}
              </span>
            </button>
          {/each}
        </div>
      {/each}
      {#if searchCursor && query.trim().length >= 2}
        <Button variant="ghost" size="sm" class="mx-2" disabled={searching} onclick={() => void runSearch(true)}>
          {i18n.t("conversations.searchMore")}
        </Button>
      {/if}
    </div>

    <!-- The details of the selected one. -->
    <div
      class={cn(
        "uxnan-scroll min-h-0 min-w-0 flex-1 overflow-y-auto",
        !showingDetails && "hidden @[44rem]:block",
      )}
    >
      {#if selected}
        <div class="flex flex-col gap-4 px-5 py-4">
          <div class="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon-xs"
              class="@[44rem]:hidden"
              aria-label={i18n.t("conversations.back")}
              onclick={() => (showingDetails = false)}
            >
              <Icon icon={ArrowLeftIcon} class={icon.action} />
            </Button>
            <AgentLogo logo={bridgeAgentLogo(selected.agentId)} class={cn(icon.brand, "shrink-0")} />
            <h3 class={cn(text.title, "min-w-0 flex-1 truncate")}>{selected.title}</h3>
            {@render actionsMenu(selected)}
          </div>

          <dl class="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-[13px]">
            <dt class={text.meta}>{i18n.t("conversations.agent")}</dt>
            <dd class="min-w-0 truncate">
              {chat.agent(selected.agentId)?.displayName ?? selected.agentId ?? "—"}{selected.model ? ` · ${selected.model}` : ""}
            </dd>
            <dt class={text.meta}>{i18n.t("conversations.space")}</dt>
            <dd class="min-w-0 truncate" title={selected.cwd}>{spaceOf(selected)}</dd>
            <dt class={text.meta}>{i18n.t("conversations.stateLabel")}</dt>
            <dd class="min-w-0 truncate">
              {selected.status === "archived"
                ? i18n.t("conversations.archived")
                : i18n.t(`conversations.activity.${chat.activity.of(selected.id)}`)}
            </dd>
            <dt class={text.meta}>{i18n.t("conversations.startedWhere")}</dt>
            <dd class="min-w-0 truncate">
              <!-- Where it started only when the bridge recorded it; never a bare dash. -->
              {[
                selected.origin
                  ? i18n.t("conversations.startedOn", { where: originOf(selected) ?? "", name: selected.origin.name })
                  : undefined,
                relativeTime(selected.createdAt, i18n.locale),
              ]
                .filter(Boolean)
                .join(" · ")}
            </dd>
            {#if selected.transfer}
              {@const source = chat.threads.get(selected.transfer.sourceThreadId)}
              <dt class={text.meta}>{i18n.t("conversations.continues")}</dt>
              <dd class="min-w-0 truncate">
                {#if source}
                  <button type="button" class={cn("truncate underline-offset-2 hover:underline", focus.ring)} onclick={() => select(source.id)}>
                    {source.title}
                  </button>
                {:else}
                  {selected.transfer.sourceTitle}
                {/if}
                · {i18n.t(`transfer.status.${selected.transfer.status}`)}
              </dd>
            {/if}
            {#if selected.continuations?.length}
              <dt class={text.meta}>{i18n.t("conversations.continuedIn")}</dt>
              <dd class="flex min-w-0 flex-col">
                {#each selected.continuations as next (next.threadId)}
                  {@const target = chat.threads.get(next.threadId)}
                  {#if target}
                    <button type="button" class={cn("truncate text-left underline-offset-2 hover:underline", focus.ring)} onclick={() => select(target.id)}>
                      {chat.agent(next.agentId)?.displayName ?? next.agentId} — {target.title}
                    </button>
                  {/if}
                {/each}
              </dd>
            {/if}
          </dl>

          <div class="flex flex-wrap gap-2">
            <Button size="sm" onclick={() => openChat(selected)}>
              <Icon icon={BubbleChatIcon} class={icon.button} />
              {i18n.t("conversations.continueInChat")}
            </Button>
            <!-- Always shown, as the same agent's session reopened in a
                 terminal (the existing resume path); when it cannot, it says
                 why — Zero has no interactive resume, a conversation with no
                 message yet has no session, one open in a terminal already is. -->
            <TooltipSimple title={terminalReason ?? ""}>
              {#snippet children(tp)}
                <span {...(terminalReason ? tp : {})} class="inline-flex">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={terminalState !== "ready"}
                    onclick={() => sessions.openInTerminal(selected)}
                  >
                    {terminalState === "working" ? i18n.t("sessions.openInTerminalWait") : i18n.t("conversations.continueInTerminal")}
                  </Button>
                </span>
              {/snippet}
            </TooltipSimple>
            {#if selected.status !== "archived"}
              <Button size="sm" variant="outline" onclick={() => chatActionUi.run("transfer", selected, () => undefined)}>
                {i18n.t("conversations.continueWithAgent")}
              </Button>
              <Button size="sm" variant="ghost" onclick={() => chatActionUi.run("fork", selected, () => undefined)}>
                {i18n.t("chat.action.fork")}
              </Button>
            {/if}
          </div>

          {#if terminalReason && terminalState !== "working"}
            <p class={cn(text.meta, "-mt-2")}>{terminalReason}</p>
          {/if}

          <section class="flex flex-col gap-2">
            <span class={text.section}>{i18n.t("conversations.lastExchange")}</span>
            {#if lastLoading && !last}
              <Spinner class={cn(icon.decorative, "text-muted-foreground")} />
            {:else if last}
              {#if said(last, "user")}
                <p class="rounded-lg bg-muted px-3 py-2 text-[13px] leading-5 whitespace-pre-wrap break-words">{said(last, "user")}</p>
              {/if}
              {#if said(last, "assistant")}
                <p class="px-1 text-[13px] leading-5 whitespace-pre-wrap break-words text-foreground/90">{said(last, "assistant")}</p>
              {/if}
            {:else}
              <p class={text.meta}>{i18n.t("chat.emptyThread")}</p>
            {/if}
          </section>
        </div>
      {:else}
        <p class={cn(text.meta, "px-5 py-10 text-center")}>{i18n.t("conversations.pick")}</p>
      {/if}
    </div>
  </div>
</div>
{/if}
