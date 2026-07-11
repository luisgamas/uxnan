<script lang="ts">
  // The **Changes** view of a center file tab: the file's working diff vs the
  // index/HEAD, with the unified/side-by-side toggle and per-hunk staging (image
  // files diff visually, before/after). Its state is the `DiffViewerState` passed
  // in; the tab shell (`FileTabView`) owns the header and the staged/unstaged
  // toggle. Self-contained — hunk actions apply against the diff's own worktree.
  import type { DiffViewerState } from "$lib/state/git.svelte";
  import { cn } from "$lib/utils";
  import { text } from "$lib/design";
  import { i18n } from "$lib/i18n";
  import DiffView from "./DiffView.svelte";
  import ImageDiffView from "./ImageDiffView.svelte";

  let { state }: { state: DiffViewerState } = $props();
</script>

<div class="h-full min-h-0 overflow-hidden bg-background p-2">
  {#if state.diffLoading}
    <p class={cn("p-4", text.meta)}>{i18n.t("common.loading")}</p>
  {:else if state.isImage}
    {#if !state.imageOld && !state.imageNew}
      <p class={cn("p-4", text.meta)}>{i18n.t("changes.none")}</p>
    {:else}
      <ImageDiffView old={state.imageOld} new={state.imageNew} />
    {/if}
  {:else if state.diff.trim().length === 0}
    <p class={cn("p-4", text.meta)}>{i18n.t("changes.none")}</p>
  {:else}
    <DiffView
      diff={state.diff}
      area={state.staged ? "staged" : "changes"}
      onHunk={(patch, action) => void state.applyHunk(patch, action)}
    />
  {/if}
</div>
