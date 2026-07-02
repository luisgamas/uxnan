<script lang="ts">
  // Read-only viewer rendered inside a center **commit tab** (one instance per
  // open commit; its state is the `CommitViewerState` passed in). Shows the full
  // diff a commit introduced (vs its first parent). Self-contained: the diff is
  // loaded against the commit's own worktree, independent of the right panel.
  import type { CommitViewerState } from "$lib/state/git.svelte";
  import { cn } from "$lib/utils";
  import { icon, text } from "$lib/design";
  import { i18n } from "$lib/i18n";
  import DiffView from "./DiffView.svelte";
  import GitCommitIcon from "@lucide/svelte/icons/git-commit-horizontal";
  import FileDiffIcon from "@lucide/svelte/icons/file-diff";

  let { state }: { state: CommitViewerState } = $props();

  const fileName = $derived(state.file ? (state.file.split("/").pop() ?? state.file) : null);
</script>

<div class="flex h-full min-h-0 flex-col bg-background">
  <header class="flex h-9 shrink-0 items-center gap-2 border-b border-border/60 px-2">
    {#if fileName}
      <FileDiffIcon class={cn(icon.decorative, "shrink-0 text-muted-foreground")} />
      <span class={cn("min-w-0 flex-1 truncate", text.body)} title={state.file}>
        {fileName}
      </span>
      <span class={cn("min-w-0 max-w-[40%] shrink truncate", text.meta)} title={state.subject}>
        {state.subject}
      </span>
    {:else}
      <GitCommitIcon class={cn(icon.decorative, "shrink-0 text-muted-foreground")} />
      <span class={cn("min-w-0 flex-1 truncate", text.body)} title={state.subject}>
        {state.subject}
      </span>
    {/if}
    <span class={cn("shrink-0 rounded-sm bg-muted px-1.5 py-0.5 font-mono", text.indicator)}>
      {state.hash.slice(0, 7)}
    </span>
  </header>

  <div class="min-h-0 flex-1 overflow-hidden p-2">
    {#if state.diffLoading}
      <p class={cn("p-4", text.meta)}>{i18n.t("common.loading")}</p>
    {:else if state.diff.trim().length === 0}
      <p class={cn("p-4", text.meta)}>{i18n.t("rightPanel.diffEmpty")}</p>
    {:else}
      <DiffView diff={state.diff} />
    {/if}
  </div>
</div>
