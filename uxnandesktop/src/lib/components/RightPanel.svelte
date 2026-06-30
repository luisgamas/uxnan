<script lang="ts">
  // Right panel: two tabbed views over the active worktree. "Files" (first) is a
  // lazy file tree of the whole working tree; "Changes" (second) is the git
  // version-control review. Tab state is local; each panel keeps its own state in
  // a store, so flipping tabs preserves the tree expansion and the commit draft.
  import { onMount } from "svelte";
  import * as Tabs from "$lib/components/ui/tabs";
  import FileTreePanel from "./FileTreePanel.svelte";
  import ChangesPanel from "./ChangesPanel.svelte";
  import HistoryPanel from "./HistoryPanel.svelte";
  import { git } from "$lib/state/git.svelte";
  import { projects } from "$lib/state/projects.svelte";
  import { i18n } from "$lib/i18n";
  import { icon, surface } from "$lib/design";
  import { cn } from "$lib/utils";
  import FolderTreeIcon from "@lucide/svelte/icons/folder-tree";
  import GitCompareIcon from "@lucide/svelte/icons/git-compare-arrows";
  import GitBranchIcon from "@lucide/svelte/icons/git-branch";

  let tab = $state<"files" | "changes" | "history">("files");

  // Load git status here (the always-mounted parent), not in a tab body: the
  // "Files" tab colors its tree from this status, and the inactive "Changes" tab
  // is unmounted, so loading it there would leave the tree uncolored at startup.
  onMount(() => void git.startListening());
  $effect(() => {
    void git.load(projects.activeWorktreePath);
  });
</script>

<div class="flex h-full min-h-0 w-full flex-col">
  <!-- Region: Window-controls header — a drag strip; the min/max/close controls
       float over its right (fixed overlay rendered in +page.svelte). -->
  <div data-tauri-drag-region class="h-9 shrink-0 border-b"></div>
  <Tabs.Root bind:value={tab} class="flex min-h-0 w-full flex-1 flex-col gap-0">
  <Tabs.List
    class="h-8 shrink-0 justify-start gap-1 rounded-none border-b bg-transparent px-2 py-0"
  >
    <Tabs.Trigger
      value="files"
      class={cn("px-2 text-xs", tab === "files" && surface.tab)}
    >
      <FolderTreeIcon data-icon="inline-start" class={cn(icon.decorative)} />
      {i18n.t("fileTree.tab")}
    </Tabs.Trigger>
    <Tabs.Trigger
      value="changes"
      class={cn("px-2 text-xs", tab === "changes" && surface.tab)}
    >
      <GitCompareIcon data-icon="inline-start" class={cn(icon.decorative)} />
      {i18n.t("rightPanel.changesTab")}
    </Tabs.Trigger>
    <Tabs.Trigger
      value="history"
      class={cn("px-2 text-xs", tab === "history" && surface.tab)}
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
