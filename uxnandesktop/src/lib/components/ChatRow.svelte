<script lang="ts">
  // One bridge conversation in a worktree's agent view — the chat counterpart
  // of `AgentRow`, drawn with the same row tokens so terminal agents and chats
  // read as one list: the state glyph and the agent's mark, then the title and
  // how long ago it moved; a quiet second line says what it is doing (or, idle,
  // that it is a chat and on which model). A conversation started on the phone
  // is listed here as soon as the bridge knows it; clicking opens it in a tab
  // (or focuses the tab already showing it).
  import type { Thread } from "$shared/models/thread";
  import { cn } from "$lib/utils";
  import { focus, icon, row, text } from "$lib/design";
  import { TooltipSimple } from "$lib/components/ui/tooltip";
  import { i18n } from "$lib/i18n";
  import { clock, relTime } from "$lib/time.svelte";
  import { chat } from "$lib/bridge/chat.svelte";
  import { bridgeAgentLogo } from "$lib/bridge/agents";
  import { modelName } from "$lib/models";
  import AgentLogo from "./AgentLogo.svelte";
  import AgentStatusIndicator from "./AgentStatusIndicator.svelte";

  let {
    thread,
    active = false,
    onopen,
  }: {
    thread: Thread;
    active?: boolean;
    onopen: () => void;
  } = $props();

  const status = $derived(chat.activity.of(thread.id));
  const time = $derived(relTime(thread.updatedAt, clock.now));
  const secondary = $derived.by(() => {
    if (status !== "idle") return i18n.t(`monitor.${status}`);
    const agent = chat.agent(thread.agentId)?.displayName ?? thread.agentId ?? "";
    const model = thread.model ? modelName({ id: thread.model, displayName: thread.model }) : "";
    return [i18n.t("agentView.chat"), model || agent].filter(Boolean).join(" · ");
  });
</script>

<TooltipSimple title={thread.title}>
  {#snippet children(tp)}
    <button
      {...tp}
      class={cn(row.agent, focus.ring, "hover:bg-foreground/[0.04] dark:hover:bg-foreground/[0.05]")}
      onclick={onopen}
    >
      {#if active}
        <span class={row.agentActiveIndicator} aria-hidden="true"></span>
      {/if}
      <span class={cn(row.agentLeading, icon.nav)}>
        <AgentStatusIndicator {status} />
      </span>
      <AgentLogo logo={bridgeAgentLogo(thread.agentId)} class={cn(row.agentLeading, icon.brand)} />
      <span class="flex min-w-0 flex-1 flex-col leading-tight">
        <span class="flex items-baseline gap-1.5">
          <span
            class={cn(
              "min-w-0 flex-1 truncate text-xs",
              active ? "font-medium text-foreground" : "text-foreground/90",
            )}
          >
            {thread.title || i18n.t("chat.newChat")}
          </span>
          {#if time}
            <span class={cn("shrink-0 tabular-nums", text.meta)}>{time}</span>
          {/if}
        </span>
        <span class={cn("min-w-0 truncate", text.meta)}>{secondary}</span>
      </span>
    </button>
  {/snippet}
</TooltipSimple>
