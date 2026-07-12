<script lang="ts">
  // Broadcast panel (spec 02d §3.2) — the fan-out router: lists every running
  // agent grouped by type, lets you mark one as the coordinator (task-graph
  // root), and routes a message to all agents, to one type (fan-out), or to the
  // coordinator's workers. Delivery is backpressured: each agent gets its next
  // queued message only once it reports free again. This is the original
  // "difusión" surface, now one tab of the orchestration console — distinct from
  // the "Runs" tab (the deterministic run engine).
  import * as Select from "$lib/components/ui/select";
  import { Button } from "$lib/components/ui/button";
  import { Badge } from "$lib/components/ui/badge";
  import { Textarea } from "$lib/components/ui/textarea";
  import { app } from "$lib/state/app.svelte";
  import { projects } from "$lib/state/projects.svelte";
  import { terminals } from "$lib/state/terminals.svelte";
  import { orchestration } from "$lib/state/orchestration.svelte";
  import { agentTypes, resolveTargets, type OrchestrationTarget } from "$lib/orchestration";
  import type { DisplayStatus } from "$lib/state/agentDisplay";
  import { cn } from "$lib/utils";
  import { icon, iconButton, text } from "$lib/design";
  import { TooltipSimple } from "$lib/components/ui/tooltip";
  import { i18n } from "$lib/i18n";
  import AgentLogo from "../AgentLogo.svelte";
  import AgentStatusDot from "../AgentStatusDot.svelte";
  import CrownIcon from "@lucide/svelte/icons/crown";
  import EraserIcon from "@lucide/svelte/icons/eraser";
  import ExternalLinkIcon from "@lucide/svelte/icons/external-link";
  import SendIcon from "@lucide/svelte/icons/send-horizontal";

  const agents = $derived(orchestration.agents);
  const types = $derived(agentTypes(agents));
  const hasCoordinator = $derived(!!orchestration.coordinator);

  // Message composer + routing target. Target is encoded as a string so it slots
  // into the Select, then decoded to an `OrchestrationTarget` on send.
  let message = $state("");
  let targetKey = $state("all");

  // Keep the target valid as agents come and go (e.g. its type disappeared).
  $effect(() => {
    const valid =
      targetKey === "all" ||
      (targetKey === "workers" && hasCoordinator) ||
      (targetKey.startsWith("type:") && types.includes(targetKey.slice(5)));
    if (!valid) targetKey = "all";
  });

  function decodeTarget(key: string): OrchestrationTarget {
    if (key === "workers") {
      return { kind: "tabs", tabIds: orchestration.workers.map((w) => w.tabId) };
    }
    if (key.startsWith("type:")) return { kind: "type", type: key.slice(5) };
    return { kind: "all" };
  }

  const target = $derived(decodeTarget(targetKey));
  // How many live agents the current target resolves to (drives the send count).
  const resolvedCount = $derived(resolveTargets(agents, target).length);

  const targetLabel = $derived.by(() => {
    if (targetKey === "workers") return i18n.t("orchestration.targetWorkers");
    if (targetKey.startsWith("type:")) {
      return i18n.t("orchestration.targetType", { type: typeLabel(targetKey.slice(5)) });
    }
    return i18n.t("orchestration.targetAll");
  });

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
    const n = orchestration.send(target, message);
    if (n > 0) message = "";
  }

  function reveal(workspace: string, tabId: string) {
    // revealTab switches to the workspace and activates the tab. For a real
    // worktree, also select it in the sidebar (highlight + clear its unread).
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

<p class={cn(text.meta, "pb-2")}>{i18n.t("orchestration.desc")}</p>

{#if agents.length === 0}
  <div class="flex flex-col items-center gap-1 py-8 text-center">
    <p class={cn("font-medium", text.body)}>{i18n.t("orchestration.emptyTitle")}</p>
    <p class={text.meta}>{i18n.t("orchestration.emptyDesc")}</p>
  </div>
{:else}
  <!-- Live agents, grouped by type -->
  <div class="flex max-h-[42vh] flex-col gap-3 overflow-auto pr-1">
    {#each types as type (type)}
      {@const group = agents.filter((a) => a.type === type)}
      <div class="flex flex-col gap-1">
        <div class="flex items-center gap-1.5">
          <span class={text.section}>{typeLabel(type)}</span>
          <span class={cn("text-muted-foreground/60", text.indicator)}>{group.length}</span>
        </div>
        {#each group as a (a.tabId)}
          {@const isCoord = orchestration.coordinatorId === a.tabId}
          {@const queued = orchestration.pendingFor(a.tabId)}
          <div
            class={cn(
              "flex items-center gap-2 rounded-md border border-border px-2 py-1.5",
              isCoord && "border-primary/60 bg-primary/5",
            )}
          >
            <AgentStatusDot status={dotStatus(a)} />
            <AgentLogo logo={a.icon} class="size-4 shrink-0" />
            <div class="min-w-0 flex-1">
              <div class={cn("truncate", text.body)}>{a.name}</div>
              <div class={cn("truncate", text.meta)}>{contextName(a.workspace)}</div>
            </div>
            {#if queued > 0}
              <Badge variant="outline" class={cn("font-normal", text.indicator)}>
                {i18n.t("orchestration.queued", { n: queued })}
              </Badge>
            {/if}
            <TooltipSimple title={i18n.t(isCoord ? "orchestration.unsetCoordinator" : "orchestration.setCoordinator")}>
              {#snippet children(tp)}
                <Button
                  {...tp}
                  variant="ghost"
                  size="icon"
                  class={cn(iconButton.action, isCoord && "text-primary")}
                  aria-pressed={isCoord}
                  onclick={() => orchestration.setCoordinator(a.tabId)}
                >
                  <CrownIcon class={icon.button} />
                </Button>
              {/snippet}
            </TooltipSimple>
            {#if queued > 0}
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

  <!-- Composer: message + routing target -->
  <div class="flex flex-col gap-2 border-t border-border/60 pt-3">
    <Textarea
      bind:value={message}
      placeholder={i18n.t("orchestration.messagePlaceholder")}
      class="min-h-16 text-xs"
      onkeydown={onComposerKey}
    />
    <div class="flex items-center gap-2">
      <Select.Root type="single" bind:value={targetKey}>
        <Select.Trigger class="h-8 w-56 text-xs">{targetLabel}</Select.Trigger>
        <Select.Content>
          <Select.Item value="all" label={i18n.t("orchestration.targetAll")}>
            {i18n.t("orchestration.targetAll")}
          </Select.Item>
          {#if hasCoordinator}
            <Select.Item value="workers" label={i18n.t("orchestration.targetWorkers")}>
              {i18n.t("orchestration.targetWorkers")}
            </Select.Item>
          {/if}
          {#each types as type (type)}
            {@const label = i18n.t("orchestration.targetType", { type: typeLabel(type) })}
            <Select.Item value={`type:${type}`} {label}>{label}</Select.Item>
          {/each}
        </Select.Content>
      </Select.Root>
      <div class="flex-1"></div>
      <Button size="sm" disabled={!message.trim() || resolvedCount === 0} onclick={send}>
        <SendIcon data-icon="inline-start" />
        {resolvedCount > 0
          ? i18n.t("orchestration.sendN", { n: resolvedCount })
          : i18n.t("orchestration.send")}
      </Button>
    </div>
    <p class={text.meta}>{i18n.t("orchestration.backpressureHint")}</p>
  </div>
{/if}
