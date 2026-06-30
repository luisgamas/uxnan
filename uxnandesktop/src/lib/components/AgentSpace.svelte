<script lang="ts">
  // The agent terminals open in a workspace (a project's main worktree, or a
  // worktree), each as a clickable row that jumps to its terminal. A spinner
  // shows while an agent is producing output. Collapsible — when collapsed the
  // header still surfaces an aggregate (count + a working spinner). Only renders
  // when there's at least one agent terminal (plain terminals get no row).
  import { projects } from "$lib/state/projects.svelte";
  import { terminals } from "$lib/state/terminals.svelte";
  import { resolveAgentDisplay } from "$lib/state/agentDisplay";
  import { cn } from "$lib/utils";
  import { text } from "$lib/design";
  import { i18n } from "$lib/i18n";
  import AgentLogo from "./AgentLogo.svelte";
  import AgentStatusDot from "./AgentStatusDot.svelte";
  import ChevronRightIcon from "@lucide/svelte/icons/chevron-right";

  let { path }: { path: string } = $props();

  const tabs = $derived(terminals.agentTabs(path));
  const anyWorking = $derived(
    tabs.some((t) => resolveAgentDisplay(t)?.status === "working"),
  );
  // The terminal currently shown in the center (to highlight its row).
  const revealedId = $derived(
    terminals.activeWorkspace === path ? terminals.activePtyId() : null,
  );

  let expanded = $state(true);

  function reveal(tabId: string) {
    projects.setActiveWorktree(path);
    terminals.revealTab(path, tabId);
  }
</script>

{#if tabs.length > 0}
  <div class="flex flex-col">
    <!-- Compact section header: a quiet, small "Agents · n" toggle that recedes
         so the agent rows read as the content. -->
    <button
      class="flex items-center gap-1 rounded px-1 py-0.5 text-muted-foreground/70 transition-colors hover:text-foreground"
      onclick={() => (expanded = !expanded)}
      title={i18n.t(expanded ? "project.collapse" : "project.expand")}
    >
      <ChevronRightIcon
        class={cn("size-3 shrink-0 transition-transform", expanded && "rotate-90")}
      />
      <span class="text-[8px] font-medium uppercase tracking-[0.05em]">{i18n.t("agents.spaceLabel")}</span>
      <span class="text-[8px] text-muted-foreground/50">{tabs.length}</span>
      {#if !expanded && anyWorking}
        <AgentStatusDot status="working" />
      {/if}
    </button>

    {#if expanded}
      <!-- Agents live in the worktree's own (selected) surface, aligned under the
           "Agents · n" header. The active agent reads from a quiet row fill alone
           (no accent line) — the container already tells you which worktree, this
           tells you which agent. -->
      <div class="flex flex-col">
        {#each tabs as t (t.id)}
          {@const d = resolveAgentDisplay(t)}
          {@const isActive = revealedId === t.id}
          <button
            class={cn(
              "flex items-center gap-2 rounded-md py-1 pl-1 pr-1 text-left transition-colors hover:bg-foreground/[0.04] dark:hover:bg-foreground/[0.05]",
              isActive && "bg-foreground/[0.05] dark:bg-foreground/[0.06]",
            )}
            title={d ? `${t.agentName} · ${i18n.t(`monitor.${d.status}`)}` : t.agentName}
            onclick={() => reveal(t.id)}
          >
            <span class="flex size-3 shrink-0 items-center justify-center">
              {#if d}
                <AgentStatusDot status={d.status} stale={d.stale} />
              {/if}
            </span>
            <AgentLogo logo={t.agentIcon} class="size-3.5 shrink-0" />
            <!-- Agents are quiet nested items: 12px, muted unless active — so the
                 branch name (and the worktree line) keep the visual lead. -->
            <span
              class={cn(
                "min-w-0 flex-1 truncate text-xs",
                isActive ? "font-medium text-foreground" : "text-muted-foreground",
              )}
            >
              {t.agentName}{#if t.exited}<span class={cn("ml-1", text.meta)}>· {i18n.t("terminal.exited")}</span>{/if}
            </span>
          </button>
        {/each}
      </div>
    {/if}
  </div>
{/if}
