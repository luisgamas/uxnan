<script lang="ts">
  // Closing the whole "Ready to close" lane at once — the payoff of everything
  // that came before it, and the place where a careless rule would do the most
  // damage.
  //
  // So it shows the split before doing anything: what will be closed, and what it
  // is LEAVING ALONE and why. A batch that quietly skipped things would be worse
  // than no batch at all, because the count is the only thing you read.
  import * as Dialog from "$lib/components/ui/dialog";
  import { Button } from "$lib/components/ui/button";
  import { Spinner } from "$lib/components/ui/spinner";
  import { projects, type WorktreeRow } from "$lib/state/projects.svelte";
  import { i18n } from "$lib/i18n";
  import { cn } from "$lib/utils";
  import { icon, text } from "$lib/design";
  import { planBatchClose, type SkippedEntry } from "$lib/worktree-batch-close";
  import { Icon } from "$lib/components/ui/icon";
  import CircleCheckIcon from "@hugeicons/core-free-icons/CircleCheckIcon";
  import GitBranchIcon from "@hugeicons/core-free-icons/GitBranchIcon";
  import CircleSlashIcon from "@hugeicons/core-free-icons/CancelCircleIcon";

  let {
    open = $bindable(false),
    rows,
  }: { open?: boolean; rows: WorktreeRow[] } = $props();

  let busy = $state(false);

  const plan = $derived(
    planBatchClose(rows.map((row) => ({ item: row, inputs: projects.removalInputsFor(row) }))),
  );

  function rowLabel(row: WorktreeRow): string {
    return row.branch ?? i18n.t("worktree.detached");
  }

  function skipText(s: SkippedEntry<WorktreeRow>): string {
    switch (s.reason) {
      case "uncommitted":
        return i18n.t("batch.skipUncommitted");
      case "unpushed":
        return i18n.t("batch.skipUnpushed");
      case "live-agents":
        return i18n.t("batch.skipAgents");
      default:
        return i18n.t("batch.skipNotFinished");
    }
  }

  async function confirm() {
    busy = true;
    await projects.closeBatch(rows);
    busy = false;
    open = false;
  }
</script>

<Dialog.Root bind:open>
  <Dialog.Content size="medium" class="flex min-w-0 flex-col" showCloseButton={false}>
    <div class="flex min-w-0 gap-3">
      <div class="flex size-9 shrink-0 items-center justify-center rounded-lg bg-sky-500/10">
        <Icon icon={CircleCheckIcon} class={cn(icon.button, "text-sky-500")} />
      </div>
      <div class="flex min-w-0 flex-1 flex-col gap-1">
        <Dialog.Title class={cn(text.title, "break-words")}>
          {i18n.t("batch.title", { n: plan.close.length })}
        </Dialog.Title>
        <Dialog.Description class={cn(text.meta, "break-words")}>
          {i18n.t("batch.subtitle")}
        </Dialog.Description>
      </div>
    </div>

    {#if plan.close.length > 0}
      <div class="scrollbar-sleek flex max-h-56 flex-col gap-1 overflow-y-auto rounded-lg border border-border/60 p-2">
        {#each plan.close as entry (entry.item.path)}
          <div class="flex min-w-0 items-center gap-2">
            <Icon icon={GitBranchIcon} class={cn(icon.decorative, "shrink-0 text-muted-foreground")} />
            <span class={cn("min-w-0 flex-1 truncate", text.body)}>{rowLabel(entry.item)}</span>
            {#if entry.deleteLocal}
              <span class={cn("shrink-0 text-muted-foreground", text.indicator)}>
                {i18n.t("batch.andBranch")}
              </span>
            {/if}
          </div>
        {/each}
      </div>
    {/if}

    <!-- The half that matters most: a batch must never quietly shrink. -->
    {#if plan.skipped.length > 0}
      <div class="flex flex-col gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
        <p class={cn("font-medium text-amber-700 dark:text-amber-300", text.body)}>
          {i18n.t("batch.skippedHeading", { n: plan.skipped.length })}
        </p>
        {#each plan.skipped as s (s.item.path)}
          <div class="flex min-w-0 items-baseline gap-2">
            <Icon icon={CircleSlashIcon} class={cn(icon.decorative, "shrink-0 translate-y-0.5 text-amber-600/70 dark:text-amber-400/70")} />
            <span class={cn("min-w-0 flex-1 truncate", text.body)}>{rowLabel(s.item)}</span>
            <span class={cn("shrink-0", text.meta)}>{skipText(s)}</span>
          </div>
        {/each}
      </div>
    {/if}

    <Dialog.Footer class="min-w-0">
      <Button variant="ghost" disabled={busy} onclick={() => (open = false)}>
        {i18n.t("common.cancel")}
      </Button>
      <Button disabled={busy || plan.close.length === 0} onclick={confirm}>
        {#if busy}
          <Spinner data-icon="inline-start" aria-label={i18n.t("common.loading")} />
        {/if}
        {i18n.t("batch.confirm", { n: plan.close.length })}
      </Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
