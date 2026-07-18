<script lang="ts">
  // Right panel: two tabbed views over the active worktree. "Files" (first) is a
  // lazy file tree of the whole working tree; "Changes" (second) is the git
  // version-control review. Tab state is local; each panel keeps its own state in
  // a store, so flipping tabs preserves the tree expansion and the commit draft.
  import * as Tabs from "$lib/components/ui/tabs";
  import FileTreePanel from "./FileTreePanel.svelte";
  import ChangesPanel from "./ChangesPanel.svelte";
  import HistoryPanel from "./HistoryPanel.svelte";
  import GithubPanel from "./GithubPanel.svelte";
  import { app } from "$lib/state/app.svelte";
  import { rightPanel } from "$lib/state/rightPanel.svelte";
  import { i18n } from "$lib/i18n";
  import { divider, icon, tab as tabStyle } from "$lib/design";
  import { cn } from "$lib/utils";
  import FolderTreeIcon from "@lucide/svelte/icons/folder-tree";
  import GitCompareIcon from "@lucide/svelte/icons/git-compare-arrows";
  import GitBranchIcon from "@lucide/svelte/icons/git-branch";
  import GitPullRequestIcon from "@lucide/svelte/icons/git-pull-request";

  let tab = $state<"files" | "changes" | "history" | "github">("files");

  // The GitHub tab is shown whenever it's enabled in settings — it stays put
  // regardless of the repo/sign-in state (the panel itself renders the right
  // "connect" / "not a GitHub repo" state). Keeping it always-mounted avoids the
  // tab appearing/disappearing (a layout jump) as the context resolves.
  const showGithub = $derived(app.settings.github?.rightPanelTab ?? true);
  $effect(() => {
    if (!showGithub && tab === "github") tab = "changes";
  });

  // --- Tab-strip width floor -------------------------------------------------
  // The panel can't be dragged narrower than its tab strip, so the tabs always
  // fit (no clipping / horizontal scroll). We measure the strip's intrinsic width
  // — the sum of the trigger widths + the gaps + the strip's own padding — and
  // publish it as the panel's minimum (`rightPanel.min`, read by the shell). The
  // triggers are `shrink-0`, so this width is independent of the panel width and
  // only changes when the tab set or their labels do.
  let tabStripEl = $state<HTMLElement | null>(null);
  function measureTabStrip(): void {
    const el = tabStripEl;
    if (!el) return;
    const kids = Array.from(el.children) as HTMLElement[];
    if (kids.length === 0) return;
    const cs = getComputedStyle(el);
    const gap = parseFloat(cs.columnGap || cs.gap || "0") || 0;
    const padL = parseFloat(cs.paddingLeft || "0") || 0;
    const padR = parseFloat(cs.paddingRight || "0") || 0;
    let width = padL + padR + gap * Math.max(0, kids.length - 1);
    for (const k of kids) width += k.offsetWidth;
    rightPanel.setTabsWidth(width);
  }
  // Re-measure when the tab set (GitHub tab on/off) or the labels (UI language)
  // change, deferred past layout — and once more after webfonts settle, since a
  // font swap resizes each trigger.
  $effect(() => {
    void i18n.locale;
    void showGithub;
    if (!tabStripEl) return;
    const raf = requestAnimationFrame(measureTabStrip);
    void document.fonts?.ready.then(measureTabStrip).catch(() => {});
    return () => cancelAnimationFrame(raf);
  });

  // Git status for the active worktree is loaded by the always-mounted shell
  // (`+page.svelte`), so the file-tree coloring, project-card badges and the
  // Changes tab all stay in sync even when this panel is closed.
</script>

<div class="flex h-full min-h-0 w-full flex-col">
  <!-- Region: Window-controls header — a drag strip; the min/max/close controls
       float over its right (fixed overlay rendered in +page.svelte). -->
  <div data-tauri-drag-region class={cn("h-9 shrink-0", divider.bottom)}></div>
  <Tabs.Root bind:value={tab} class="flex min-h-0 w-full flex-1 flex-col gap-0">
  <!-- Tabs never wrap or get clipped: the shell floors the panel width at this
       strip's measured width, so all tabs always fit. `justify-start` keeps them
       left-aligned; at the exact minimum the strip fills the panel edge-to-edge,
       so the strip's own `px-2` sits symmetrically and the tabs read as centered.
       `overflow-x-auto` stays only as a safety net for an unmeasured first paint.
       Each trigger keeps its width (`shrink-0`) instead of shrinking away. -->
  <Tabs.List
    bind:ref={tabStripEl}
    class={cn("scrollbar-sleek h-8 shrink-0 justify-start gap-1 overflow-x-auto rounded-none bg-transparent px-2 py-0", divider.bottom)}
  >
    <Tabs.Trigger
      value="files"
      class={cn("shrink-0 whitespace-nowrap px-3 text-[13px]", tabStyle.base, tab === "files" ? tabStyle.activeLine : tabStyle.inactiveLine)}
    >
      <FolderTreeIcon data-icon="inline-start" class={cn(icon.decorative)} />
      {i18n.t("fileTree.tab")}
    </Tabs.Trigger>
    <Tabs.Trigger
      value="changes"
      class={cn("shrink-0 whitespace-nowrap px-3 text-[13px]", tabStyle.base, tab === "changes" ? tabStyle.activeLine : tabStyle.inactiveLine)}
    >
      <GitCompareIcon data-icon="inline-start" class={cn(icon.decorative)} />
      {i18n.t("rightPanel.changesTab")}
    </Tabs.Trigger>
    <Tabs.Trigger
      value="history"
      class={cn("shrink-0 whitespace-nowrap px-3 text-[13px]", tabStyle.base, tab === "history" ? tabStyle.activeLine : tabStyle.inactiveLine)}
    >
      <GitBranchIcon data-icon="inline-start" class={cn(icon.decorative)} />
      {i18n.t("history.tab")}
    </Tabs.Trigger>
    {#if showGithub}
      <Tabs.Trigger
        value="github"
        class={cn("shrink-0 whitespace-nowrap px-3 text-[13px]", tabStyle.base, tab === "github" ? tabStyle.activeLine : tabStyle.inactiveLine)}
      >
        <GitPullRequestIcon data-icon="inline-start" class={cn(icon.decorative)} />
        {i18n.t("github.panel.tab")}
      </Tabs.Trigger>
    {/if}
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
  {#if showGithub}
    <Tabs.Content value="github" class="min-h-0 flex-1 overflow-hidden">
      <GithubPanel />
    </Tabs.Content>
  {/if}
  </Tabs.Root>
</div>
