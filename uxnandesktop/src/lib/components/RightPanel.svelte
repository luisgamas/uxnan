<script lang="ts">
  // Right panel: two tabbed views over the active worktree. "Files" (first) is a
  // lazy file tree of the whole working tree; "Changes" (second) is the git
  // version-control review. Tab state is local; each panel keeps its own state in
  // a store, so flipping tabs preserves the tree expansion and the commit draft.
  import * as Tabs from "$lib/components/ui/tabs";
  import FileTreePanel from "./FileTreePanel.svelte";
  import ChangesPanel from "./ChangesPanel.svelte";
  import HistoryPanel from "./HistoryPanel.svelte";
  import { i18n } from "$lib/i18n";
  import { divider, icon, tab as tabStyle } from "$lib/design";
  import { cn } from "$lib/utils";
  import FolderTreeIcon from "@lucide/svelte/icons/folder-tree";
  import GitCompareIcon from "@lucide/svelte/icons/git-compare-arrows";
  import GitBranchIcon from "@lucide/svelte/icons/git-branch";

  let tab = $state<"files" | "changes" | "history">("files");

  // Git status for the active worktree is loaded by the always-mounted shell
  // (`+page.svelte`), so the file-tree coloring, project-card badges and the
  // Changes tab all stay in sync even when this panel is closed.
</script>

<div class="flex h-full min-h-0 w-full flex-col">
  <!-- Region: Window-controls header — a drag strip; the min/max/close controls
       float over its right (fixed overlay rendered in +page.svelte). -->
  <div data-tauri-drag-region class={cn("h-9 shrink-0", divider.bottom)}></div>
  <Tabs.Root bind:value={tab} class="flex min-h-0 w-full flex-1 flex-col gap-0">
  <Tabs.List
    class={cn("h-8 shrink-0 justify-start gap-1 rounded-none bg-transparent px-2 py-0", divider.bottom)}
  >
    <Tabs.Trigger
      value="files"
      class={cn("px-3 text-[13px]", tabStyle.base, tab === "files" ? tabStyle.activeLine : tabStyle.inactiveLine)}
    >
      <FolderTreeIcon data-icon="inline-start" class={cn(icon.decorative)} />
      {i18n.t("fileTree.tab")}
    </Tabs.Trigger>
    <Tabs.Trigger
      value="changes"
      class={cn("px-3 text-[13px]", tabStyle.base, tab === "changes" ? tabStyle.activeLine : tabStyle.inactiveLine)}
    >
      <GitCompareIcon data-icon="inline-start" class={cn(icon.decorative)} />
      {i18n.t("rightPanel.changesTab")}
    </Tabs.Trigger>
    <Tabs.Trigger
      value="history"
      class={cn("px-3 text-[13px]", tabStyle.base, tab === "history" ? tabStyle.activeLine : tabStyle.inactiveLine)}
    >
      <GitBranchIcon data-icon="inline-start" class={cn(icon.decorative)} />
      {i18n.t("history.tab")}
    </Tabs.Trigger>
  </Tabs.List>
  <Tabs.Content value="files" class="min-h-0 flex-1 overflow-hidden">
    <FileTreePanel />
  </Tabs.Content>
  <Tabs.Content value="changes" class="min-h-0 flex-1 overflow-hidden">
    <ChangesPanel />
  </Tabs.Content>
  <Tabs.Content value="history" class="min-h-0 flex-1 overflow-hidden">
    <HistoryPanel />
  </Tabs.Content>
  </Tabs.Root>
</div>
