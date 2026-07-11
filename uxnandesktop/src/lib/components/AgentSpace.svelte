<script lang="ts">
  // The agents running in a workspace (a project's main worktree, or a worktree) —
  // uxnan's "agent view". Each agent is a two-line row (conversation title + preview
  // + status) that jumps to its terminal on click. Collapsible: when collapsed the
  // header shows a compact strip of each agent's logo ringed by its status color.
  // Only renders when there's at least one agent terminal.
  import { projects } from "$lib/state/projects.svelte";
  import { terminals } from "$lib/state/terminals.svelte";
  import { resolveAgentDisplay } from "$lib/state/agentDisplay";
  import { zeroSessions, isZeroAgent } from "$lib/state/zeroSessions.svelte";
  import { cn } from "$lib/utils";
  import { TooltipSimple } from "$lib/components/ui/tooltip";
  import { i18n } from "$lib/i18n";
  import AgentRow from "./AgentRow.svelte";
  import AgentAvatar from "./AgentAvatar.svelte";
  import ChevronRightIcon from "@lucide/svelte/icons/chevron-right";

  let { path }: { path: string } = $props();

  /** Avatars shown in the collapsed strip before overflowing into a "+N". */
  const MAX_AVATARS = 4;

  const tabs = $derived(terminals.agentTabs(path));
  // The terminal currently shown in the center (to highlight its row).
  const revealedId = $derived(
    terminals.activeWorkspace === path ? terminals.activePtyId() : null,
  );

  let expanded = $state(true);

  // Zero reports no hook/OSC — poll its on-disk session while it's open here.
  const hasZero = $derived(tabs.some(isZeroAgent));
  $effect(() => {
    if (hasZero) zeroSessions.ensurePolling();
  });

  function reveal(tabId: string) {
    projects.setActiveWorktree(path);
    terminals.revealTab(path, tabId);
  }
</script>

{#if tabs.length > 0}
  <div class="flex flex-col">
    <!-- Header: a quiet "Agents · n" toggle. Collapsed, a status-ringed logo strip
         to its right summarizes who's here and how they're doing. -->
    <div class="flex items-center gap-1 pr-1">
      <TooltipSimple title={i18n.t(expanded ? "project.collapse" : "project.expand")}>
        {#snippet children(tp)}
          <button
            {...tp}
            class="flex shrink-0 items-center gap-1 rounded px-1 py-0.5 text-muted-foreground/70 transition-colors hover:text-foreground"
            onclick={() => (expanded = !expanded)}
          >
            <ChevronRightIcon
              class={cn("size-3 shrink-0 transition-transform", expanded && "rotate-90")}
            />
            <span class="text-[8px] font-medium uppercase tracking-[0.05em]">{i18n.t("agents.spaceLabel")}</span>
            <span class="text-[8px] text-muted-foreground/50">{tabs.length}</span>
          </button>
        {/snippet}
      </TooltipSimple>

      {#if !expanded}
        <!-- No `overflow-hidden` (it would clip each avatar's status ring, which is
             a box-shadow drawn outside the circle) + vertical padding so the strip
             has room; overflow is bounded by capping the avatars with a "+N". -->
        <div class="flex min-w-0 flex-1 items-center gap-1.5 py-1">
          {#each tabs.slice(0, MAX_AVATARS) as t (t.id)}
            {@const d = resolveAgentDisplay(t)}
            <TooltipSimple
              title={`${t.agentName ?? ""}${d ? ` · ${i18n.t(`monitor.${d.status}`)}` : ""}`}
            >
              {#snippet children(tp)}
                <button {...tp} class="shrink-0" onclick={() => reveal(t.id)}>
                  <AgentAvatar
                    logo={t.agentIcon}
                    status={d?.status ?? "idle"}
                    stale={d?.stale ?? false}
                  />
                </button>
              {/snippet}
            </TooltipSimple>
          {/each}
          {#if tabs.length > MAX_AVATARS}
            <span class="shrink-0 text-[9px] tabular-nums text-muted-foreground/70">
              +{tabs.length - MAX_AVATARS}
            </span>
          {/if}
        </div>
      {/if}
    </div>

    {#if expanded}
      <div class="flex flex-col">
        {#each tabs as t (t.id)}
          <AgentRow
            tab={t}
            workspacePath={path}
            active={revealedId === t.id}
            onreveal={() => reveal(t.id)}
          />
        {/each}
      </div>
    {/if}
  </div>
{/if}
