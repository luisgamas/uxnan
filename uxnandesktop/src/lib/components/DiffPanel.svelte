<script lang="ts">
  // Full-size diff viewer that takes over the center panel (overlaying the
  // terminals, which stay mounted underneath). Opened from the right-panel file
  // list; shows the selected file's diff with the unified/side-by-side toggle and
  // per-hunk staging. Closing returns to the terminals.
  import { git } from "$lib/state/git.svelte";
  import { Button } from "$lib/components/ui/button";
  import { cn } from "$lib/utils";
  import { icon, text } from "$lib/design";
  import { i18n } from "$lib/i18n";
  import DiffView from "./DiffView.svelte";
  import FileDiffIcon from "@lucide/svelte/icons/file-diff";
  import XIcon from "@lucide/svelte/icons/x";

  const file = $derived(git.selected?.file ?? "");
  const staged = $derived(git.selected?.staged ?? false);
</script>

<div class="flex h-full min-h-0 flex-col bg-background">
  <header class="flex h-9 shrink-0 items-center gap-2 border-b border-border px-2">
    <FileDiffIcon class={cn(icon.decorative, "shrink-0 text-muted-foreground")} />
    <span class={cn("min-w-0 flex-1 truncate font-mono", text.body)} title={file}>{file}</span>
    <span class={cn("shrink-0 rounded-sm bg-muted px-1.5 py-0.5", text.indicator)}>
      {staged ? i18n.t("rightPanel.diffStaged") : i18n.t("rightPanel.diffUnstaged")}
    </span>
    <Button
      variant="ghost"
      size="icon"
      class="size-6 shrink-0"
      title={i18n.t("diff.close")}
      onclick={() => git.closeDiff()}
    >
      <XIcon class={icon.button} />
    </Button>
  </header>

  <div class="min-h-0 flex-1 overflow-hidden p-2">
    {#if git.diffLoading}
      <p class={cn("p-4", text.meta)}>{i18n.t("common.loading")}</p>
    {:else if git.diff.trim().length === 0}
      <p class={cn("p-4", text.meta)}>{i18n.t("rightPanel.diffEmpty")}</p>
    {:else}
      <DiffView
        diff={git.diff}
        area={staged ? "staged" : "changes"}
        onHunk={(patch, action) => void git.applyHunk(patch, action)}
      />
    {/if}
  </div>
</div>
