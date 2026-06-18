<script lang="ts">
  // Right panel: two tabbed views over the active worktree. "Files" (first) is a
  // lazy file tree of the whole working tree; "Changes" (second) is the git
  // version-control review. Tab state is local; each panel keeps its own state in
  // a store, so flipping tabs preserves the tree expansion and the commit draft.
  import { onMount } from "svelte";
  import * as Tabs from "$lib/components/ui/tabs";
  import FileTreePanel from "./FileTreePanel.svelte";
  import ChangesPanel from "./ChangesPanel.svelte";
  import { git } from "$lib/state/git.svelte";
  import { projects } from "$lib/state/projects.svelte";
  import { i18n } from "$lib/i18n";
  import { icon } from "$lib/design";
  import { cn } from "$lib/utils";
  import FolderTreeIcon from "@lucide/svelte/icons/folder-tree";
  import GitCompareIcon from "@lucide/svelte/icons/git-compare-arrows";

  let tab = $state<"files" | "changes">("files");

  // Load git status here (the always-mounted parent), not in a tab body: the
  // "Files" tab colors its tree from this status, and the inactive "Changes" tab
  // is unmounted, so loading it there would leave the tree uncolored at startup.
  onMount(() => void git.startListening());
  $effect(() => {
    void git.load(projects.activeWorktreePath);
  });
</script>

<Tabs.Root bind:value={tab} class="flex h-full min-h-0 w-full flex-col gap-0">
  <Tabs.List
    variant="line"
    class="h-8 shrink-0 justify-start gap-3 rounded-none border-b border-sidebar-border bg-transparent px-2"
  >
    <Tabs.Trigger value="files" class="text-xs">
      <FolderTreeIcon data-icon="inline-start" class={cn(icon.decorative)} />
      {i18n.t("fileTree.tab")}
    </Tabs.Trigger>
    <Tabs.Trigger value="changes" class="text-xs">
      <GitCompareIcon data-icon="inline-start" class={cn(icon.decorative)} />
      {i18n.t("rightPanel.changesTab")}
    </Tabs.Trigger>
  </Tabs.List>
  <Tabs.Content value="files" class="min-h-0 flex-1 overflow-hidden">
    <FileTreePanel />
  </Tabs.Content>
  <Tabs.Content value="changes" class="min-h-0 flex-1 overflow-hidden">
    <ChangesPanel />
  </Tabs.Content>
</Tabs.Root>
