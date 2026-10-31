<script lang="ts">
  // The agents' own sessions in a folder that no conversation continues yet —
  // started in a terminal, here or elsewhere, or in the agent's own app — as the
  // Conversations tab lists them (architecture/02a §5.8.19). The one place they
  // are listed: the new-chat screen only says how many there are and links here.
  //
  // Picking one continues it as a chat (`thread/start { agentSessionId }`). One
  // open in a terminal says so, and picking it first asks that terminal to let
  // it go; an agent whose CLI cannot list its sessions says so below the list.
  import type { Thread } from "$shared/models/thread";
  import { sessionKey, type AgentSessionRow, type ChatStore } from "$lib/bridge/chat.svelte";
  import { sessionRows } from "$lib/bridge/conversationsView";
  import { bridgeAgentLogo } from "$lib/bridge/agents";
  import AgentLogo from "$lib/components/AgentLogo.svelte";
  import { Badge } from "$lib/components/ui/badge";
  import { Spinner } from "$lib/components/ui/spinner";
  import { relativeTime } from "$lib/relativeTime";
  import { toast, toastError } from "$lib/toast";
  import { i18n } from "$lib/i18n";
  import { cn } from "$lib/utils";
  import { focus, icon, row, text } from "$lib/design";

  let {
    chat,
    cwd,
    agentId,
    query,
    folder,
    onPicked,
  }: {
    chat: ChatStore;
    /** The folder whose sessions these are. */
    cwd: string;
    /** Only this agent's sessions. */
    agentId?: string | undefined;
    /** Text typed in the tab's search field (titles only). */
    query: string;
    /** The folder's name, for the hint. */
    folder: string;
    /** The conversation that continues the picked session. */
    onPicked: (thread: Thread) => void;
  } = $props();

  const entry = $derived(chat.agentSessionsOf(cwd));
  const rows = $derived(sessionRows(entry?.sessions ?? [], { ...(agentId ? { agentId } : {}), query }));
  const unlistedNames = $derived(
    (entry?.unlisted ?? []).map((id) => chat.agent(id)?.displayName ?? id).join(", "),
  );
  let picking = $state<string | null>(null);

  /** Continue one of the agents' sessions as a conversation. */
  async function pick(session: AgentSessionRow) {
    const key = sessionKey(session.agentId, session.sessionId);
    if (picking) return;
    picking = key;
    try {
      if (chat.holds.get(key) ?? session.hold) {
        const outcome = await chat.requestHandoff(session);
        if (outcome !== "released" && outcome !== "notHeld") {
          toast(i18n.t(`sessions.handoff.${outcome}`));
          return;
        }
      }
      const thread = await chat.startThread({
        cwd,
        agentId: session.agentId,
        agentSessionId: session.sessionId,
        ...(session.title ? { title: session.title } : {}),
      });
      // It is a conversation now, not a session outside them.
      void chat.refreshAgentSessions(cwd).catch(() => undefined);
      onPicked(thread);
    } catch (err) {
      toastError(err);
    } finally {
      picking = null;
    }
  }
</script>

<div class="mx-auto flex w-full max-w-3xl flex-col gap-0.5">
  <p class={cn(text.meta, "px-2 pb-2")}>
    {i18n.t("conversations.sessionsHint", { folder })}
  </p>
  {#if !entry}
    <div class="flex justify-center py-8">
      <Spinner class={cn(icon.decorative, "text-muted-foreground")} />
    </div>
  {:else if rows.length === 0}
    <p class={cn(text.meta, "px-2 py-8 text-center")}>
      {query.trim().length > 0 || agentId
        ? i18n.t("conversations.noMatch")
        : i18n.t("conversations.sessionsEmpty")}
    </p>
  {/if}
  {#each rows as session (sessionKey(session.agentId, session.sessionId))}
    {@const key = sessionKey(session.agentId, session.sessionId)}
    {@const hold = chat.holds.get(key) ?? session.hold}
    <button
      type="button"
      class={cn(row.list, row.listInactive, focus.ring)}
      disabled={picking !== null}
      title={i18n.t("sessions.pickHint", { agent: chat.agent(session.agentId)?.displayName ?? session.agentId })}
      onclick={() => void pick(session)}
    >
      <AgentLogo logo={bridgeAgentLogo(session.agentId)} class={cn(icon.brand, "shrink-0")} />
      <span class={cn("min-w-0 flex-1 truncate", session.title ? "text-foreground" : "text-muted-foreground")}>
        {#if session.title}
          {session.title}
        {:else if session.titlePending}
          <!-- The bridge is naming it from its first exchange. -->
          {i18n.t("sessions.naming")}
        {:else}
          {i18n.t("sessions.untitled", {
            agent: chat.agent(session.agentId)?.displayName ?? session.agentId,
          })}
        {/if}
      </span>
      {#if hold}
        <Badge variant="outline" class={cn("shrink-0 font-normal", text.indicator)}>
          {hold.busy ? i18n.t("sessions.inTerminalWorking") : i18n.t("sessions.inTerminal")}
        </Badge>
      {/if}
      <span class={cn(text.meta, "shrink-0 tabular-nums")}>
        {picking === key ? i18n.t("sessions.opening") : relativeTime(session.updatedAt, i18n.locale)}
      </span>
    </button>
  {/each}
  {#if entry && entry.unlisted.length > 0}
    <p class={cn(text.meta, "px-2 pt-2")}>{i18n.t("sessions.unlisted", { agents: unlistedNames })}</p>
  {/if}
</div>
