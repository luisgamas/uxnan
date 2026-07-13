<script lang="ts">
  // Broadcast panel (spec 02d §3.2) — the fan-out router with **explicit recipient
  // selection**: every running agent is a checkbox (grouped by type), you pick
  // exactly who receives, and the message is enqueued for each. Quick presets
  // (All / None, and a per-type "all") cover the common cases. Delivery is
  // backpressured: each agent gets its next queued message only once it reports
  // free again (with a hold cap so a stuck "busy" signal never wedges the queue).
  import { Button } from "$lib/components/ui/button";
  import { Badge } from "$lib/components/ui/badge";
  import { Textarea } from "$lib/components/ui/textarea";
  import { Checkbox } from "$lib/components/ui/checkbox";
  import { app } from "$lib/state/app.svelte";
  import { projects } from "$lib/state/projects.svelte";
  import { terminals } from "$lib/state/terminals.svelte";
  import { orchestration } from "$lib/state/orchestration.svelte";
  import { agentTypes } from "$lib/orchestration";
  import type { DisplayStatus } from "$lib/state/agentDisplay";
  import { untrack } from "svelte";
  import { cn } from "$lib/utils";
  import { icon, iconButton, text } from "$lib/design";
  import { TooltipSimple } from "$lib/components/ui/tooltip";
  import { i18n } from "$lib/i18n";
  import AgentLogo from "../AgentLogo.svelte";
  import AgentStatusDot from "../AgentStatusDot.svelte";
  import EraserIcon from "@lucide/svelte/icons/eraser";
  import ExternalLinkIcon from "@lucide/svelte/icons/external-link";
  import SendIcon from "@lucide/svelte/icons/send-horizontal";

  const agents = $derived(orchestration.agents);
  const types = $derived(agentTypes(agents));

  // Message composer.
  let message = $state("");
  // Selected recipients (tab ids). Starts as "everyone", prunes agents that go
  // away and auto-includes newly-appeared ones, so the default intuition stays
  // "broadcast to all" without re-selecting agents you deliberately unchecked.
  let selected = $state<Set<string>>(new Set());
  let prevIds = new Set<string>();
  let seeded = false;

  $effect(() => {
    const liveIds = new Set(agents.map((a) => a.tabId));
    untrack(() => {
      const next = new Set([...selected].filter((id) => liveIds.has(id)));
      if (!seeded) {
        for (const id of liveIds) next.add(id);
        seeded = true;
      } else {
        for (const id of liveIds) if (!prevIds.has(id)) next.add(id);
      }
      prevIds = liveIds;
      const changed = next.size !== selected.size || [...next].some((id) => !selected.has(id));
      if (changed) selected = next;
    });
  });

  const selectedCount = $derived(selected.size);

  function setSel(tabId: string, on: boolean) {
    const next = new Set(selected);
    if (on) next.add(tabId);
    else next.delete(tabId);
    selected = next;
  }
  function selectAll() {
    selected = new Set(agents.map((a) => a.tabId));
  }
  function selectNone() {
    selected = new Set();
  }
  function setGroup(type: string, on: boolean) {
    const next = new Set(selected);
    for (const a of agents) if (a.type === type) on ? next.add(a.tabId) : next.delete(a.tabId);
    selected = next;
  }
  function groupChecked(type: string): boolean {
    const g = agents.filter((a) => a.type === type);
    return g.length > 0 && g.every((a) => selected.has(a.tabId));
  }
  function groupIndeterminate(type: string): boolean {
    const g = agents.filter((a) => a.type === type);
    return !groupChecked(type) && g.some((a) => selected.has(a.tabId));
  }

  function typeLabel(type: string): string {
    return app.resolveAgent(type).name;
  }

  /** Effective status dot: precise hook state, else coarse activity / idle. */
  function dotStatus(a: { status: DisplayStatus | "idle"; busy: boolean }): DisplayStatus {
    if (a.status !== "idle") return a.status;
    return a.busy ? "working" : "idle";
  }

  function contextName(workspace: string): string {
    return projects.contextLabel(workspace).name;
  }

  function send() {
    const n = orchestration.send({ kind: "tabs", tabIds: [...selected] }, message);
    if (n > 0) message = "";
  }

  function reveal(workspace: string, tabId: string) {
    terminals.revealTab(workspace, tabId);
    if (workspace) projects.setActiveWorktree(workspace);
    app.orchestrationOpen = false;
  }

  // Ctrl/Cmd+Enter sends from the composer.
  function onComposerKey(e: KeyboardEvent) {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      send();
    }
  }
</script>

<p class={cn(text.meta, "pb-1")}>{i18n.t("orchestration.desc")}</p>

{#if agents.length === 0}
  <div class="flex flex-col items-center gap-1 py-8 text-center">
    <p class={cn("font-medium", text.body)}>{i18n.t("orchestration.emptyTitle")}</p>
    <p class={text.meta}>{i18n.t("orchestration.emptyDesc")}</p>
  </div>
{:else}
  <!-- Recipients header: label + count + presets -->
  <div class="flex items-center gap-2 pb-1.5">
    <span class={text.section}>{i18n.t("orchestration.recipients")}</span>
    <span class={cn("text-muted-foreground/60", text.indicator)}>
      {i18n.t("orchestration.selectedCount", { n: selectedCount, total: agents.length })}
    </span>
    <div class="flex-1"></div>
    <Button variant="ghost" size="sm" class="h-6 px-2 text-[11px]" onclick={selectAll}>
      {i18n.t("orchestration.selectAll")}
    </Button>
    <Button variant="ghost" size="sm" class="h-6 px-2 text-[11px]" onclick={selectNone}>
      {i18n.t("orchestration.selectNone")}
    </Button>
  </div>

  <!-- Live agents, grouped by type, each a checkbox recipient -->
  <div class="flex min-h-0 flex-1 flex-col gap-3 overflow-auto pr-1">
    {#each types as type (type)}
      {@const group = agents.filter((a) => a.type === type)}
      <div class="flex flex-col gap-1">
        <div class="flex items-center gap-2 pb-0.5">
          <Checkbox
            checked={groupChecked(type)}
            indeterminate={groupIndeterminate(type)}
            onCheckedChange={(v) => setGroup(type, v === true)}
            aria-label={typeLabel(type)}
            class="size-3.5"
          />
          <span class={text.section}>{typeLabel(type)}</span>
          <span class={cn("text-muted-foreground/60", text.indicator)}>{group.length}</span>
        </div>
        {#each group as a (a.tabId)}
          {@const on = selected.has(a.tabId)}
          {@const queued = orchestration.pendingFor(a.tabId)}
          {@const waiting = orchestration.waitingForFree(a.tabId)}
          <div
            class={cn(
              "flex items-center gap-2 rounded-md border px-2 py-1.5 transition-colors",
              on ? "border-border bg-foreground/[0.03]" : "border-border/60",
            )}
          >
            <Checkbox
              checked={on}
              onCheckedChange={(v) => setSel(a.tabId, v === true)}
              aria-label={a.name}
            />
            <button
              type="button"
              class="flex min-w-0 flex-1 items-center gap-2 text-left"
              onclick={() => setSel(a.tabId, !on)}
            >
              <AgentStatusDot status={dotStatus(a)} />
              <AgentLogo logo={a.icon} class="size-4 shrink-0" />
              <div class="min-w-0 flex-1">
                <div class={cn("truncate", text.body)}>{a.name}</div>
                <div class={cn("truncate", text.meta)}>
                  {#if waiting}
                    <span class="text-amber-600 dark:text-amber-400">
                      {i18n.t("orchestration.waitingForFree")}
                    </span>
                  {:else}
                    {contextName(a.workspace)}
                  {/if}
                </div>
              </div>
            </button>
            {#if queued > 0}
              <Badge variant="outline" class={cn("font-normal", text.indicator)}>
                {i18n.t("orchestration.queued", { n: queued })}
              </Badge>
              <TooltipSimple title={i18n.t("orchestration.clearQueue")}>
                {#snippet children(tp)}
                  <Button
                    {...tp}
                    variant="ghost"
                    size="icon"
                    class={iconButton.action}
                    onclick={() => orchestration.clearQueue(a.tabId)}
                  >
                    <EraserIcon class={icon.button} />
                  </Button>
                {/snippet}
              </TooltipSimple>
            {/if}
            <TooltipSimple title={i18n.t("orchestration.reveal")}>
              {#snippet children(tp)}
                <Button
                  {...tp}
                  variant="ghost"
                  size="icon"
                  class={iconButton.action}
                  onclick={() => reveal(a.workspace, a.tabId)}
                >
                  <ExternalLinkIcon class={icon.button} />
                </Button>
              {/snippet}
            </TooltipSimple>
          </div>
        {/each}
      </div>
    {/each}
  </div>

  <!-- Composer -->
  <div class="flex flex-col gap-2 border-t border-border/60 pt-3">
    <Textarea
      bind:value={message}
      placeholder={i18n.t("orchestration.messagePlaceholder")}
      class="min-h-16 text-xs"
      onkeydown={onComposerKey}
    />
    <div class="flex items-center gap-2">
      <p class={cn(text.meta, "flex-1")}>{i18n.t("orchestration.backpressureHint")}</p>
      <Button size="sm" disabled={!message.trim() || selectedCount === 0} onclick={send}>
        <SendIcon data-icon="inline-start" />
        {selectedCount > 0
          ? i18n.t("orchestration.sendN", { n: selectedCount })
          : i18n.t("orchestration.send")}
      </Button>
    </div>
  </div>
{/if}
