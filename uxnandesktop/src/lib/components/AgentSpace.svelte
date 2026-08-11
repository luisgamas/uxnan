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
  import { icon, row } from "$lib/design";
  import { TooltipSimple } from "$lib/components/ui/tooltip";
  import { i18n } from "$lib/i18n";
  import AgentRow from "./AgentRow.svelte";
  import AgentAvatar from "./AgentAvatar.svelte";
  import { Icon } from "$lib/components/ui/icon";
  import ChevronRightIcon from "@hugeicons/core-free-icons/ChevronRightIcon";
  import { Button } from "$lib/components/ui/button";
  import { visibleAgentCount } from "$lib/agent-space-layout";

  let { path }: { path: string } = $props();

  /** Avatars shown in the collapsed strip before overflowing into a "+N". */
  const MAX_AVATARS = 4;
  let avatarStrip: HTMLDivElement | undefined = $state();
  let visibleCount = $state(0);

  const tabs = $derived(terminals.agentTabs(path));
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
    tabs.length;
    if (!strip) return;
    const measure = () => {
      visibleCount = visibleAgentCount(tabs.length, strip.clientWidth, MAX_AVATARS);
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
    terminals.revealTab(path, tabId);
  }
</script>

{#if tabs.length > 0}
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
            <span class="text-[10px] tabular-nums text-muted-foreground/50">{tabs.length}</span>
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
          {#if tabs.length > visibleCount}
            <span class={row.agentOverflow}>
              +{tabs.length - visibleCount}
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
      </div>
    {/if}
  </div>
{/if}
