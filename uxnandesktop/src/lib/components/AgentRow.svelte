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
  // Sub-agents (Task-tool children). The badge summarizes all of them; the
  // nested rows show only the ones still running (what's live right now).
  const subagents = $derived(view?.subagents ?? []);
  const activeSubs = $derived(subagents.filter((s) => s.status === "working"));
</script>

{#if view}
  <div class="flex flex-col">
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
              {#if subagents.length}
                <span
                  class={cn(
                    "shrink-0 rounded-full px-1.5 text-[10px] leading-4 tabular-nums",
                    activeSubs.length
                      ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                      : "bg-foreground/10 text-foreground/60",
                  )}
                  title={i18n.t("agentView.subagents", { n: subagents.length })}
                >
                  {activeSubs.length ? `${activeSubs.length}/${subagents.length}` : subagents.length}
                </span>
              {/if}
              {#if time}
                <span class={cn("shrink-0 tabular-nums", text.meta)}>{time}</span>
              {/if}
            </span>
            <span class={cn("truncate", text.meta)}>
              {secondary}{#if tab.exited}<span class="ml-1">· {i18n.t("terminal.exited")}</span
                >{/if}
            </span>
          </span>
        </button>
      {/snippet}
    </TooltipSimple>
    {#if activeSubs.length}
      <div class="ml-[1.375rem] mt-0.5 flex flex-col gap-0.5 border-l border-border/60 pl-2">
        {#each activeSubs as sub (sub.id)}
          <div class="flex items-center gap-1.5">
            <span class="flex size-3 shrink-0 items-center justify-center">
              <AgentStatusDot status={sub.status} stale={false} />
            </span>
            <span class={cn("truncate", text.meta)}>
              {sub.description || sub.agentType || i18n.t("agentView.subagent")}
            </span>
          </div>
        {/each}
      </div>
    {/if}
  </div>
{/if}
