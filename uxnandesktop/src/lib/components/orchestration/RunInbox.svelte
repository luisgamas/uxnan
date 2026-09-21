<script lang="ts">
  // The part of a driven run the step list cannot show: who drives it, and
  // what is waiting for that coordinator. A driven run's tasks are steps and
  // its questions are gates, so those already render; its inbox — the messages
  // the coordinator has not yet acknowledged — is the queue that tells the
  // person whether the coordinator is keeping up. A message leaves the list
  // the moment it is acknowledged, so an empty inbox means "read", not "idle".
  import { Badge } from "$lib/components/ui/badge";
  import { Button } from "$lib/components/ui/button";
  import { TooltipSimple } from "$lib/components/ui/tooltip";
  import { Icon } from "$lib/components/ui/icon";
  import { cn } from "$lib/utils";
  import { icon, iconButton, text } from "$lib/design";
  import { i18n } from "$lib/i18n";
  import { clock, relTime } from "$lib/time.svelte";
  import { terminals } from "$lib/state/terminals.svelte";
  import { inboxItemIcon, inboxItemLabelKey, inboxItemTone } from "$lib/orchestration/runDisplay";
  import type { InboxItem, Run } from "$lib/orchestration/run";
  import BotIcon from "@hugeicons/core-free-icons/BotIcon";
  import TerminalIcon from "@hugeicons/core-free-icons/ComputerTerminal01Icon";
  import ChevronRightIcon from "@hugeicons/core-free-icons/ChevronRightIcon";

  let { run }: { run: Run } = $props();

  // The coordinator's tab, when a launched agent drives the run and its tab is
  // still there. Read live: a closed coordinator turns the strip's label.
  const coordinatorId = $derived(run.driven?.coordinator);
  const coordinatorTab = $derived.by(() => {
    if (!coordinatorId) return null;
    const tab = terminals.findTab(coordinatorId);
    return tab?.kind === "terminal" ? tab : null;
  });
  const drivenLabel = $derived.by(() => {
    if (!coordinatorId) return i18n.t("orchestration.drivenByShell");
    if (!coordinatorTab) return i18n.t("orchestration.drivenCoordinatorGone");
    const agent = coordinatorTab.agentName ?? coordinatorTab.title;
    const title = coordinatorTab.customTitle ?? coordinatorTab.title;
    return i18n.t("orchestration.drivenBy", { agent: agent === title ? agent : `${agent} · ${title}` });
  });

  function revealCoordinator() {
    if (!coordinatorId) return;
    const workspace = terminals.workspaceOfTab(coordinatorId);
    if (workspace !== undefined) terminals.revealTab(workspace, coordinatorId);
  }

  const outcome = $derived(run.driven?.outcome);
  const outcomeKey = $derived(
    outcome === "success"
      ? "orchestration.outcomeSuccess"
      : outcome === "failure"
        ? "orchestration.outcomeFailure"
        : "orchestration.outcomeBlocked",
  );

  const inbox = $derived(run.inbox ?? []);
  const stepTitle = (item: InboxItem) => run.steps.find((s) => s.id === item.stepId)?.title || item.stepId;

  // Expanded message texts (delivery ids) — a worker's report is long.
  let expanded = $state<Set<string>>(new Set());
  function toggle(id: string) {
    const next = new Set(expanded);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    expanded = next;
  }
</script>

<!-- Who drives it -->
<div class="flex flex-col gap-1.5 rounded-md border border-border/50 bg-card/30 px-2.5 py-2">
  <div class="flex items-center gap-2">
    <Icon icon={BotIcon} class={cn(icon.decorative, "shrink-0 text-muted-foreground")} />
    <span class={cn("min-w-0 flex-1 truncate", text.body)}>{drivenLabel}</span>
    {#if outcome}
      <Badge
        variant="secondary"
        class={cn(
          "font-normal",
          text.indicator,
          outcome === "success" && "text-emerald-600 dark:text-emerald-400",
          outcome === "failure" && "text-destructive",
          outcome === "blocked" && "text-amber-600 dark:text-amber-400",
        )}
      >
        {i18n.t(outcomeKey)}
      </Badge>
    {/if}
    {#if coordinatorTab}
      <TooltipSimple title={i18n.t("orchestration.revealCoordinator")}>
        {#snippet children(tp)}
          <Button
            {...tp}
            variant="ghost"
            size="icon"
            class={iconButton.xs}
            aria-label={i18n.t("orchestration.revealCoordinator")}
            onclick={revealCoordinator}
          >
            <Icon icon={TerminalIcon} class={icon.action} />
          </Button>
        {/snippet}
      </TooltipSimple>
    {/if}
  </div>
  {#if run.driven?.summary}
    <p class={cn(text.meta, "pl-6")}>{run.driven.summary}</p>
  {/if}
</div>

<!-- What waits for the coordinator -->
<div class="flex flex-col gap-1">
  <div class="flex items-center gap-2">
    <span class={text.section}>{i18n.t("orchestration.inbox")}</span>
    {#if inbox.length > 0}
      <Badge variant="secondary" class={cn("font-normal", text.indicator)}>
        {i18n.t("orchestration.inboxWaiting", { count: inbox.length })}
      </Badge>
    {/if}
  </div>
  {#if inbox.length === 0}
    <p class={cn(text.meta, "py-1")}>{i18n.t("orchestration.inboxEmpty")}</p>
  {:else}
    {#each inbox as item (item.deliveryId)}
      {@const open = expanded.has(item.deliveryId)}
      <button
        type="button"
        class="flex flex-col gap-1 rounded-md border border-border/50 bg-card/30 px-2.5 py-1.5 text-left transition-colors hover:bg-accent/40"
        aria-expanded={open}
        onclick={() => toggle(item.deliveryId)}
      >
        <div class="flex items-center gap-2">
          <Icon icon={inboxItemIcon(item.type)} class={cn(icon.decorative, "shrink-0", inboxItemTone(item.type))} />
          <span class={cn("min-w-0 flex-1 truncate", text.bodyStrong)}>{stepTitle(item)}</span>
          <span class={cn(text.meta, "shrink-0")}>{i18n.t(inboxItemLabelKey(item.type))}</span>
          {#if item.dispatchId}
            <span class="shrink-0 font-mono text-[11px] text-muted-foreground/60">{item.dispatchId}</span>
          {/if}
          <span class={cn(text.meta, "shrink-0 tabular-nums")}>{relTime(item.at, clock.now)}</span>
          <Icon icon={ChevronRightIcon} class={cn("size-3 shrink-0 text-muted-foreground transition-transform", open && "rotate-90")} />
        </div>
        {#if open}
          <pre class="ml-6 max-h-60 overflow-auto whitespace-pre-wrap rounded border border-border/50 bg-muted/40 p-2 text-[11px] leading-relaxed">{item.text}</pre>
        {:else}
          <p class={cn(text.meta, "line-clamp-2 pl-6")}>{item.text}</p>
        {/if}
      </button>
    {/each}
  {/if}
</div>
