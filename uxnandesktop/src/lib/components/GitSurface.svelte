<script lang="ts">
  // The dock's Git surface: the working tree and its history, one after the
  // other in the same place — the flow they are (change, commit, see it land).
  // A segmented switch picks the view; the choice is remembered per workspace
  // (`dock.gitView`). Changes carries its count, so a dirty tree is visible
  // from the History view too.

  import ChangesPanel from "./ChangesPanel.svelte";
  import HistoryPanel from "./HistoryPanel.svelte";
  import { Segmented } from "$lib/components/ui/segmented";
  import { dock } from "$lib/state/dock.svelte";
  import { git } from "$lib/state/git.svelte";
  import { divider } from "$lib/design";
  import { i18n } from "$lib/i18n";
  import { cn } from "$lib/utils";
  import type { DockGitView } from "$lib/types";

  const view = $derived(dock.gitView());
</script>

<div class="flex min-h-0 min-w-0 w-full flex-1 flex-col">
  <div class={cn("flex shrink-0 items-center px-2 py-1.5", divider.bottom)}>
    <Segmented
      fill
      value={view}
      label={i18n.t("dock.git")}
      options={[
        { value: "changes", label: i18n.t("rightPanel.changesTab"), count: git.files.length },
        { value: "history", label: i18n.t("history.tab") },
      ]}
      onValueChange={(v) => dock.setGitView(v as DockGitView)}
    />
  </div>
  <div class="min-h-0 min-w-0 flex-1 overflow-hidden">
    {#if view === "changes"}
      <ChangesPanel />
    {:else}
      <HistoryPanel />
    {/if}
  </div>
</div>
