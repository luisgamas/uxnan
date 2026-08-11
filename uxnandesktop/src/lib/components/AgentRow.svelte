<script lang="ts">
  // One agent in the expanded agent view: a two-line row — status indicator + logo +
  // conversation title + relative time on the first line, and a muted preview
  // (current tool while working, else the latest reply, else the status) on the
  // second. Clicking reveals the agent's terminal. The title/preview come from the
  // hook data already in `agentStatus` (or Zero's on-disk session) via
  // `resolveAgentView`.
  import { cn } from "$lib/utils";
  import { focus, icon, row, text } from "$lib/design";
  import { TooltipSimple } from "$lib/components/ui/tooltip";
  import { i18n } from "$lib/i18n";
  import { clock, relTime } from "$lib/time.svelte";
  import { resolveAgentView } from "$lib/state/agentDisplay";
  import type { TerminalTab } from "$lib/state/terminals.svelte";
  import AgentLogo from "./AgentLogo.svelte";
  import AgentStatusIndicator from "./AgentStatusIndicator.svelte";

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
            row.agent,
            focus.ring,
            "hover:bg-foreground/[0.04] dark:hover:bg-foreground/[0.05]",
          )}
          onclick={onreveal}
        >
          {#if active}
            <span class={row.agentActiveIndicator} aria-hidden="true"></span>
          {/if}
          <span class={cn(row.agentLeading, icon.status)}>
            <AgentStatusIndicator status={view.status} stale={view.stale} />
          </span>
          <AgentLogo logo={tab.agentIcon} class={cn(row.agentLeading, icon.status)} />
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
              {#if tab.agentModel}
                <!-- Only shown when the launch profile pinned a model; uxnan can't
                     see a model the CLI picked on its own, so it doesn't claim one. -->
                <span
                  class={row.agentModel}
                  title={tab.agentModel}
                >
                  {tab.agentModel}
                </span>
              {/if}
              {#if time}
                <span class={cn("shrink-0 tabular-nums", text.meta)}>{time}</span>
              {/if}
            </span>
            <span class={cn("flex items-center gap-1 truncate", text.meta)}>
              {#if view.interrupted}
                <!-- An interruption is an outcome, not chatter: give it a marker so
                     it doesn't read as just another grey preview line. -->
                <span class="size-1.5 shrink-0 rounded-full bg-amber-500"></span>
              {/if}
              <span class="min-w-0 truncate">
                {secondary}{#if tab.exited}<span class="ml-1">· {i18n.t("terminal.exited")}</span
                  >{/if}
              </span>
            </span>
          </span>
        </button>
      {/snippet}
    </TooltipSimple>
    {#if activeSubs.length}
      <div class={row.agentDetail}>
        {#each activeSubs as sub (sub.id)}
          <div class="flex items-center gap-1.5">
            <span class={cn("flex shrink-0 items-center justify-center", icon.status)}>
              <AgentStatusIndicator status={sub.status} stale={false} />
            </span>
            {#if sub.agentType}
              <!-- The child's kind, as a quiet chip: it labels the row without
                   competing with the task, which is what the eye is looking for. -->
              <span
                class="shrink-0 rounded bg-foreground/[0.06] px-1 text-[10px] leading-4 text-muted-foreground/80"
                title={i18n.t("agentView.subagentType")}
              >
                {sub.agentType}
              </span>
            {/if}
            <!-- No elapsed time on a child on purpose: the shared clock ticks
                 every 30 s, which is right for the parent's "4m" and useless for
                 a child that lives 12 s — it would sit frozen and then jump. -->
            <span class={cn("min-w-0 flex-1 truncate", text.meta)}>
              {sub.description || i18n.t("agentView.subagent")}{#if sub.tool}<span
                  class="text-muted-foreground/60">{" · "}{sub.tool}</span
                >{/if}
            </span>
          </div>
        {/each}
      </div>
    {/if}
  </div>
{/if}
