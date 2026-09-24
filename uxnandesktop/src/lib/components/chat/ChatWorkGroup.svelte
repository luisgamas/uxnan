<script lang="ts">
  // A run of consecutive steps (commands, edits, tool calls) as one unit, under
  // a one-line summary ("Ran 3 commands · 2 edits"). While the turn runs the
  // group stays open, so the step in flight is in view, and a pulsing dot marks
  // it; once the turn settles it closes to the summary, which opens back to the
  // steps. A single step needs no group and renders as its own row.
  import { untrack } from "svelte";
  import * as Collapsible from "$lib/components/ui/collapsible";
  import { Icon } from "$lib/components/ui/icon";
  import ArrowRight01Icon from "@hugeicons/core-free-icons/ArrowRight01Icon";
  import Layers01Icon from "@hugeicons/core-free-icons/Layers01Icon";
  import ChatActivity from "./ChatActivity.svelte";
  import { activityRunning, summarizeWork } from "$lib/bridge/timeline";
  import { i18n } from "$lib/i18n";
  import { cn } from "$lib/utils";
  import { chat, icon } from "$lib/design";

  let { blocks, live = false }: { blocks: Record<string, unknown>[]; live?: boolean } = $props();

  let open = $state(untrack(() => live));
  // Close once the turn settles: what is left to read is the summary.
  $effect(() => {
    if (!live) open = false;
  });

  const summary = $derived(summarizeWork(blocks));
  const inFlight = $derived(live && blocks.some((b) => activityRunning(b)));
  const parts = $derived(
    [
      summary.commands && i18n.plural(summary.commands, "chat.workCommandsOne", "chat.workCommands"),
      summary.edits && i18n.plural(summary.edits, "chat.workEditsOne", "chat.workEdits"),
      summary.tools && i18n.plural(summary.tools, "chat.workToolsOne", "chat.workTools"),
      summary.agents && i18n.plural(summary.agents, "chat.workAgentsOne", "chat.workAgents"),
    ].filter((p): p is string => typeof p === "string"),
  );
</script>

{#if blocks.length === 1}
  <ChatActivity block={blocks[0]} />
{:else}
  <Collapsible.Root bind:open>
    <Collapsible.Trigger class={chat.activity}>
      <Icon icon={Layers01Icon} class={cn(icon.decorative, "shrink-0 opacity-70")} />
      <span class="min-w-0 flex-1 truncate">{parts.join(" · ")}</span>
      {#if inFlight}
        <span class={chat.runningDot} role="status" aria-label={i18n.t("chat.working")}></span>
      {:else if summary.failed > 0}
        <span class="shrink-0 text-destructive">
          {i18n.plural(summary.failed, "chat.workFailedOne", "chat.workFailed")}
        </span>
      {/if}
      <Icon
        icon={ArrowRight01Icon}
        class={cn(icon.status, "shrink-0 transition-transform", open && "rotate-90")}
      />
    </Collapsible.Trigger>
    <Collapsible.Content>
      <div class={chat.activityList}>
        {#each blocks as block, i (i)}
          <ChatActivity {block} />
        {/each}
      </div>
    </Collapsible.Content>
  </Collapsible.Root>
{/if}
