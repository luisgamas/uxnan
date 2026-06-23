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
  import { icon, surface, text } from "$lib/design";
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
    <button
      class="flex items-center gap-1 rounded px-1 py-0.5 text-muted-foreground hover:text-foreground"
      onclick={() => (expanded = !expanded)}
      title={i18n.t(expanded ? "project.collapse" : "project.expand")}
    >
      <ChevronRightIcon
        class={cn(icon.button, "shrink-0 transition-transform", expanded && "rotate-90")}
      />
      <span class={text.section}>{i18n.t("agents.spaceLabel")}</span>
      <span class={cn("text-muted-foreground/60", text.indicator)}>{tabs.length}</span>
      {#if !expanded && anyWorking}
        <AgentStatusDot status="working" />
      {/if}
    </button>

    {#if expanded}
      <div class="flex flex-col">
        {#each tabs as t (t.id)}
          {@const d = resolveAgentDisplay(t)}
          <button
            class={cn(
              "flex items-center gap-1.5 rounded-md py-1 pl-1 pr-1 text-left hover:bg-accent/40",
              revealedId === t.id && surface.activeNested,
            )}
            title={d ? `${t.agentName} · ${i18n.t(`monitor.${d.status}`)}` : t.agentName}
            onclick={() => reveal(t.id)}
          >
            <span class="flex size-3 shrink-0 items-center justify-center">
              {#if d}
                <AgentStatusDot status={d.status} stale={d.stale} />
              {/if}
            </span>
            <AgentLogo logo={t.agentIcon} class="size-4 shrink-0" />
            <span class={cn("min-w-0 flex-1 truncate", text.body)}>
              {t.agentName}{#if t.exited}<span class={cn("ml-1", text.meta)}>· {i18n.t("terminal.exited")}</span>{/if}
            </span>
          </button>
        {/each}
      </div>
    {/if}
  </div>
{/if}
