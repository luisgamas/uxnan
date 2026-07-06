<script lang="ts">
  // Diff viewer rendered inside a center **diff tab** (one instance per open
  // diff; its state is the `DiffViewerState` passed in). Shows the file's diff
  // with the unified/side-by-side toggle and per-hunk staging. Self-contained:
  // hunk actions apply against the diff's own worktree, independent of the right
  // panel's active worktree.
  import type { DiffViewerState } from "$lib/state/git.svelte";
  import { cn } from "$lib/utils";
  import { icon, text } from "$lib/design";
  import { TooltipSimple } from "$lib/components/ui/tooltip";
  import { i18n } from "$lib/i18n";
  import DiffView from "./DiffView.svelte";
  import ImageDiffView from "./ImageDiffView.svelte";
  import FileDiffIcon from "@lucide/svelte/icons/file-diff";

  let { state }: { state: DiffViewerState } = $props();
</script>

<div class="flex h-full min-h-0 flex-col bg-background">
  <header class="flex h-9 shrink-0 items-center gap-2 border-b border-border/60 px-2">
    <FileDiffIcon class={cn(icon.decorative, "shrink-0 text-muted-foreground")} />
    <TooltipSimple title={state.file}>
      {#snippet children(tp)}
        <span {...tp} class={cn("min-w-0 flex-1 truncate font-mono", text.body)}>{state.file}</span>
      {/snippet}
    </TooltipSimple>
    <span class={cn("shrink-0 rounded-sm bg-muted px-1.5 py-0.5", text.indicator)}>
      {state.staged ? i18n.t("rightPanel.diffStaged") : i18n.t("rightPanel.diffUnstaged")}
    </span>
  </header>

  <div class="min-h-0 flex-1 overflow-hidden p-2">
    {#if state.diffLoading}
      <p class={cn("p-4", text.meta)}>{i18n.t("common.loading")}</p>
    {:else if state.isImage}
      {#if !state.imageOld && !state.imageNew}
        <p class={cn("p-4", text.meta)}>{i18n.t("rightPanel.diffEmpty")}</p>
      {:else}
        <ImageDiffView old={state.imageOld} new={state.imageNew} />
      {/if}
    {:else if state.diff.trim().length === 0}
      <p class={cn("p-4", text.meta)}>{i18n.t("rightPanel.diffEmpty")}</p>
    {:else}
      <DiffView
        diff={state.diff}
        area={state.staged ? "staged" : "changes"}
        onHunk={(patch, action) => void state.applyHunk(patch, action)}
      />
    {/if}
  </div>
</div>
