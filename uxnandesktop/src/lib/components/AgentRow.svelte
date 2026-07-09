<script lang="ts">
  // One agent in the expanded agent view: a two-line row — status dot + logo +
  // conversation title + relative time on the first line, and a muted preview
  // (current tool while working, else the latest reply, else the status) on the
  // second. Clicking reveals the agent's terminal. The title/preview come from the
  // hook data already in `agentStatus` (or Zero's on-disk session) via
  // `resolveAgentView`.
  import { cn } from "$lib/utils";
  import { text } from "$lib/design";
  import { TooltipSimple } from "$lib/components/ui/tooltip";
  import { i18n } from "$lib/i18n";
  import { clock, relTime } from "$lib/time.svelte";
  import { resolveAgentView } from "$lib/state/agentDisplay";
  import type { TerminalTab } from "$lib/state/terminals.svelte";
  import AgentLogo from "./AgentLogo.svelte";
  import AgentStatusDot from "./AgentStatusDot.svelte";

  let {
    tab,
    workspacePath,
    active = false,
    onreveal,
  }: {
    tab: TerminalTab;
    /** The worktree cwd (drives Zero's session lookup). */
    workspacePath: string;
    active?: boolean;
    onreveal: () => void;
  } = $props();

  const view = $derived(resolveAgentView(tab, workspacePath));
  // Second line: interrupted marker → the raw preview → the status label.
  const secondary = $derived.by(() => {
    if (!view) return "";
    if (view.interrupted) return i18n.t("agentView.interrupted");
    return view.preview ?? i18n.t(`monitor.${view.status}`);
  });
  const time = $derived(view?.lastUpdate ? relTime(view.lastUpdate, clock.now) : "");
</script>

{#if view}
  <TooltipSimple title={view.title}>
    {#snippet children(tp)}
      <button
        {...tp}
        class={cn(
          "flex w-full items-start gap-2 rounded-md py-1 pl-1 pr-1 text-left transition-colors hover:bg-foreground/[0.04] dark:hover:bg-foreground/[0.05]",
          active && "bg-foreground/[0.05] dark:bg-foreground/[0.06]",
        )}
        onclick={onreveal}
      >
        <span class="mt-1 flex size-3 shrink-0 items-center justify-center">
          <AgentStatusDot status={view.status} stale={view.stale} />
        </span>
        <AgentLogo logo={tab.agentIcon} class="mt-0.5 size-3.5 shrink-0" />
        <span class="flex min-w-0 flex-1 flex-col leading-tight">
          <span class="flex items-baseline gap-1.5">
            <span
              class={cn(
                "min-w-0 flex-1 truncate text-xs",
                active ? "font-medium text-foreground" : "text-foreground/90",
              )}
            >
              {view.title}
            </span>
            {#if time}
              <span class={cn("shrink-0 tabular-nums", text.meta)}>{time}</span>
            {/if}
          </span>
          <span class={cn("truncate", text.meta)}>
            {secondary}{#if tab.exited}<span class="ml-1">· {i18n.t("terminal.exited")}</span>{/if}
          </span>
        </span>
      </button>
    {/snippet}
  </TooltipSimple>
{/if}
