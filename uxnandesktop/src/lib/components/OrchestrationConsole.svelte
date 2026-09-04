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
  <!-- Workspace content needs a viewport-relative canvas for its split run and
       log panes; the named workspace role supplies the desktop clamp.
       `pb-5` because the content shell is `py-0` by design: the top inset comes
       from `Dialog.Header`'s `pt-5` and the bottom one normally from
       `Dialog.Footer`'s action band. This console has no footer — each tab owns
       its own actions, the composer's Send among them — so without a bottom
       inset those buttons sat flat against the dialog's edge while the title
       above them had its full 20px. Matching `pt-5` restores the symmetry. -->
  <Dialog.Content size="workspace" class="flex max-h-[88vh] flex-col overflow-hidden pb-5">
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

    <Tabs.Root bind:value={tab} class="flex min-h-0 flex-1 flex-col gap-3">
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

      <Tabs.Content value="broadcast" class="flex min-h-0 flex-1 flex-col gap-2">
        <OrchestrationBroadcast />
      </Tabs.Content>
      <Tabs.Content value="runs" class="flex min-h-0 flex-1 flex-col gap-2">
        <OrchestrationRuns />
      </Tabs.Content>
    </Tabs.Root>
  </Dialog.Content>
</Dialog.Root>
