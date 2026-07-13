<script lang="ts">
  // Multi-agent orchestration console (spec 02d §3). Two surfaces, one modal:
  //  · Broadcast — the fan-out router (pick recipients explicitly and route a
  //    message to them, backpressured). The original "difusión".
  //  · Runs — the deterministic run engine: a DAG of steps where one step's
  //    output can feed the next, steps with no dependency run in parallel, and
  //    the run is durable (survives a restart).
  import * as Dialog from "$lib/components/ui/dialog";
  import * as Tabs from "$lib/components/ui/tabs";
  import { Badge } from "$lib/components/ui/badge";
  import { app } from "$lib/state/app.svelte";
  import { orchestration } from "$lib/state/orchestration.svelte";
  import { cn } from "$lib/utils";
  import { divider, tab as tabStyle, text } from "$lib/design";
  import { i18n } from "$lib/i18n";
  import OrchestrationBroadcast from "./orchestration/OrchestrationBroadcast.svelte";
  import OrchestrationRuns from "./orchestration/OrchestrationRuns.svelte";

  // Plain string state so it binds cleanly to `Tabs.Root value` (string).
  let tab = $state("broadcast");
</script>

<Dialog.Root bind:open={app.orchestrationOpen}>
  <Dialog.Content class="sm:max-w-[720px]">
    <Dialog.Header>
      <Dialog.Title class="flex items-center gap-2">
        {i18n.t("orchestration.title")}
        {#if orchestration.pendingTotal > 0}
          <Badge variant="secondary" class={cn("font-normal", text.indicator)}>
            {i18n.t("orchestration.queued", { n: orchestration.pendingTotal })}
          </Badge>
        {/if}
      </Dialog.Title>
    </Dialog.Header>

    <Tabs.Root bind:value={tab} class="flex min-h-0 flex-col gap-3">
      <Tabs.List class={cn("h-8 shrink-0 justify-start gap-3 rounded-none bg-transparent p-0", divider.bottom)}>
        <Tabs.Trigger
          value="broadcast"
          class={cn("px-1 pb-2 text-[13px]", tabStyle.base, tab === "broadcast" ? tabStyle.activeLine : tabStyle.inactiveLine)}
        >
          {i18n.t("orchestration.tabBroadcast")}
        </Tabs.Trigger>
        <Tabs.Trigger
          value="runs"
          class={cn("px-1 pb-2 text-[13px]", tabStyle.base, tab === "runs" ? tabStyle.activeLine : tabStyle.inactiveLine)}
        >
          {i18n.t("orchestration.tabRuns")}
        </Tabs.Trigger>
      </Tabs.List>

      <Tabs.Content value="broadcast" class="flex min-h-0 flex-col gap-2">
        <OrchestrationBroadcast />
      </Tabs.Content>
      <Tabs.Content value="runs" class="flex min-h-0 flex-col gap-2">
        <OrchestrationRuns />
      </Tabs.Content>
    </Tabs.Root>
  </Dialog.Content>
</Dialog.Root>
