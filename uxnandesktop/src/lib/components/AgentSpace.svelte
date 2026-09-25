<script lang="ts">
  // The agents running in a workspace (a project's main worktree, or a worktree) —
  // uxnan's "agent view". Each agent is a two-line row (conversation title + preview
  // + status) that jumps to its terminal on click. Bridge conversations for the
  // folder are listed in the same view (`ChatRow`) — the ones open in a tab or
  // doing something, then the most recent (`sidebarChats`), a chat started on
  // the phone included — and open in a chat tab on click. Collapsible: when
  // collapsed the header shows a compact strip of each one's logo ringed by its
  // status color. Only renders when there's at least one.
  import { projects } from "$lib/state/projects.svelte";
  import { terminals } from "$lib/state/terminals.svelte";
  import { resolveAgentDisplay } from "$lib/state/agentDisplay";
  import { zeroSessions, isZeroAgent } from "$lib/state/zeroSessions.svelte";
  import { cn } from "$lib/utils";
  import { icon, row } from "$lib/design";
  import { TooltipSimple } from "$lib/components/ui/tooltip";
  import { i18n } from "$lib/i18n";
  import AgentRow from "./AgentRow.svelte";
  import ChatRow from "./ChatRow.svelte";
  import { chat } from "$lib/bridge/chat.svelte";
  import { sidebarChats } from "$lib/bridge/chatList";
  import { bridgeAgentLogo } from "$lib/bridge/agents";
  import { keyTarget } from "$lib/pathid";
  import { isLocalTarget } from "$lib/target";
  import AgentAvatar from "./AgentAvatar.svelte";
  import { Icon } from "$lib/components/ui/icon";
  import ChevronRightIcon from "@hugeicons/core-free-icons/ChevronRightIcon";
  import { Button } from "$lib/components/ui/button";
  import { visibleAgentCount } from "$lib/agent-space-layout";

  let { path }: { path: string } = $props();

  /** The workspace key for this path — the pair (machine, path), which is what
   *  terminals are filed under. */
  const wsKey = $derived(projects.workspaceFor(path));

  /** Avatars shown in the collapsed strip before overflowing into a "+N". */
  const MAX_AVATARS = 4;
  let avatarStrip: HTMLDivElement | undefined = $state();
  let visibleCount = $state(0);

  const tabs = $derived(terminals.agentTabs(wsKey));
  /** Threads open in a chat tab anywhere (a listed one focuses that tab). */
  const openThreads = $derived(
    new Set(
      [...terminals.tabsWithWorkspace()]
        .map(({ tab }) => (tab.kind === "chat" ? tab.threadId : undefined))
        .filter((id): id is string => !!id),
    ),
  );
  // Chats run on the local bridge: listed for folders on this machine only.
  const chats = $derived(
    isLocalTarget(keyTarget(wsKey))
      ? sidebarChats(chat.threadsFor(path), {
          open: openThreads,
          activityOf: (id) => chat.activity.of(id),
        })
      : [],
  );
  const total = $derived(tabs.length + chats.length);
  const shownChatId = $derived(
    terminals.activeWorkspace === path ? terminals.activeChatThreadId() : null,
  );
  // The terminal currently shown in the center (to highlight its row).
  const revealedId = $derived(
    terminals.activeWorkspace === path ? terminals.activePtyId() : null,
  );

  // Persisted (open by default) — a list you closed used to reopen on restart.
  const expanded = $derived(!projects.isAgentSpaceCollapsed(path));

  // Zero reports no hook/OSC — poll its on-disk session while it's open here.
  const hasZero = $derived(tabs.some(isZeroAgent));
  $effect(() => {
    const strip = avatarStrip;
    const count = total;
    if (!strip) return;
    const measure = () => {
      visibleCount = visibleAgentCount(count, strip.clientWidth, MAX_AVATARS);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(strip);
    measure();
    return () => observer.disconnect();
  });
  $effect(() => {
    if (hasZero) zeroSessions.ensurePolling();
  });

  function reveal(tabId: string) {
    projects.setActiveWorktree(path);
    terminals.revealTab(wsKey, tabId);
  }

  function openChat(threadId: string) {
    projects.openChatAt(path, { threadId });
  }
</script>

{#if total > 0}
  <div class="flex w-full min-w-0 flex-col">
    <!-- Header: a quiet "Agents · n" toggle. Collapsed, a status-ringed logo strip
         to its right summarizes who's here and how they're doing. -->
    <div class={row.agentSpaceHeader}>
      <TooltipSimple title={i18n.t(expanded ? "project.collapse" : "project.expand")}>
        {#snippet children(tp)}
          <Button
            {...tp}
            variant="ghost"
            size="xs"
            class="text-muted-foreground/70 hover:text-foreground"
            onclick={() => projects.toggleAgentSpace(path)}
          >
            <Icon icon={ChevronRightIcon}
              class={cn(icon.status, "shrink-0 transition-transform", expanded && "rotate-90")}
            />
            <span class="text-[10px] font-medium uppercase tracking-[0.05em]">{i18n.t("agents.spaceLabel")}</span>
            <span class="text-[10px] tabular-nums text-muted-foreground/50">{total}</span>
          </Button>
        {/snippet}
      </TooltipSimple>

      {#if !expanded}
        <!-- Capacity is measured from this single-line strip. Rightmost agents
             collapse into the reserved `+N` footprint before they can overflow. -->
        <div class={row.agentAvatarStrip} bind:this={avatarStrip}>
          {#each tabs.slice(0, visibleCount) as t (t.id)}
            {@const d = resolveAgentDisplay(t)}
            <TooltipSimple
              title={`${t.agentName ?? ""}${d ? ` · ${i18n.t(`monitor.${d.status}`)}` : ""}`}
            >
              {#snippet children(tp)}
                <Button
                  {...tp}
                  variant="ghost"
                  size="icon-xs"
                  class="transition-transform hover:scale-110"
                  aria-label={t.agentName ?? t.title ?? i18n.t("agents.spaceLabel")}
                  onclick={() => reveal(t.id)}
                >
                  <AgentAvatar
                    logo={t.agentIcon}
                    status={d?.status ?? "idle"}
                    stale={d?.stale ?? false}
                  />
                </Button>
              {/snippet}
            </TooltipSimple>
          {/each}
          {#each chats.slice(0, Math.max(0, visibleCount - tabs.length)) as t (t.id)}
            <TooltipSimple title={`${t.title} · ${i18n.t(`monitor.${chat.activity.of(t.id)}`)}`}>
              {#snippet children(tp)}
                <Button
                  {...tp}
                  variant="ghost"
                  size="icon-xs"
                  class="transition-transform hover:scale-110"
                  aria-label={t.title}
                  onclick={() => openChat(t.id)}
                >
                  <AgentAvatar logo={bridgeAgentLogo(t.agentId)} status={chat.activity.of(t.id)} stale={false} />
                </Button>
              {/snippet}
            </TooltipSimple>
          {/each}
          {#if total > visibleCount}
            <span class={row.agentOverflow}>
              +{total - visibleCount}
            </span>
          {/if}
        </div>
      {/if}
    </div>

    {#if expanded}
      <!-- Expanded agents keep their shared inset without drawing another rail;
           only subagents use a vertical relationship line inside AgentRow. -->
      <div class={row.agentSpaceDetail}>
        {#each tabs as t (t.id)}
          <AgentRow
            tab={t}
            workspacePath={path}
            active={revealedId === t.id}
            onreveal={() => reveal(t.id)}
          />
        {/each}
        {#each chats as t (t.id)}
          <ChatRow thread={t} active={shownChatId === t.id} onopen={() => openChat(t.id)} />
        {/each}
      </div>
    {/if}
  </div>
{/if}
