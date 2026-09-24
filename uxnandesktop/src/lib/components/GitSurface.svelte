<script lang="ts">
  // The dock's Git surface: the working tree and its history, one after the
  // other in the same place — the flow they are (change, commit, see it land).
  // A segmented switch picks the view; the choice is remembered per workspace
  // (`dock.gitView`). Changes carries its count, so a dirty tree is visible
  // from the History view too.

  import * as Tabs from "$lib/components/ui/tabs";
  import ChangesPanel from "./ChangesPanel.svelte";
  import HistoryPanel from "./HistoryPanel.svelte";
  import { dock } from "$lib/state/dock.svelte";
  import { git } from "$lib/state/git.svelte";
  import { divider, tab as tabStyle } from "$lib/design";
  import { i18n } from "$lib/i18n";
  import { cn } from "$lib/utils";
  import type { DockGitView } from "$lib/types";

  const view = $derived(dock.gitView());
  const changed = $derived(git.files.length);

  const active = "bg-accent text-foreground";
  const idle = "text-muted-foreground hover:text-foreground";
</script>

<Tabs.Root
  value={view}
  onValueChange={(v) => dock.setGitView(v as DockGitView)}
  class="flex min-h-0 min-w-0 w-full flex-1 flex-col gap-0"
>
  <div class={cn("flex shrink-0 items-center px-2 py-1.5", divider.bottom)}>
    <Tabs.List class={cn(tabStyle.segmentedList, "w-full")}>
      <Tabs.Trigger value="changes" class={cn(tabStyle.segmentedTrigger, tabStyle.gitView, view === "changes" ? active : idle)}>
        {i18n.t("rightPanel.changesTab")}
        {#if changed > 0}
          <span class="rounded-full bg-foreground/10 px-1.5 text-[10px] tabular-nums leading-4">{changed}</span>
        {/if}
      </Tabs.Trigger>
      <Tabs.Trigger value="history" class={cn(tabStyle.segmentedTrigger, tabStyle.gitView, view === "history" ? active : idle)}>
        {i18n.t("history.tab")}
      </Tabs.Trigger>
    </Tabs.List>
  </div>
  <Tabs.Content value="changes" class="min-h-0 min-w-0 flex-1 overflow-hidden">
    <ChangesPanel />
  </Tabs.Content>
  <Tabs.Content value="history" class="min-h-0 min-w-0 flex-1 overflow-hidden">
    <HistoryPanel />
  </Tabs.Content>
</Tabs.Root>
