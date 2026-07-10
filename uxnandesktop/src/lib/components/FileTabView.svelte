<script lang="ts">
  // Shell for a center **file tab** — the single tab per working file. Owns the one
  // header (name · dirty dot · view switch · contextual action) and hosts the file's
  // views: Edit (the CodeMirror editor), Preview (rendered Markdown / image) and
  // Changes (the working diff + staged/unstaged toggle + hunk staging). Which views
  // are offered depends on the file: a raster image has no Edit, a non-repo file no
  // Changes, plain code no Preview. Each visited view stays mounted (visibility
  // toggled) so switching never remounts the editor (losing unsaved edits) or
  // re-runs the git read — the redundancy this consolidation removes.
  import type { FileTab, FileView } from "$lib/state/terminals.svelte";
  import { terminals } from "$lib/state/terminals.svelte";
  import type { FileEditorState } from "$lib/state/files.svelte";
  import { isImagePath } from "$lib/diff";
  import { cn } from "$lib/utils";
  import { icon, text } from "$lib/design";
  import { Button } from "$lib/components/ui/button";
  import { TooltipSimple } from "$lib/components/ui/tooltip";
  import { i18n } from "$lib/i18n";
  import FileEditor from "./FileEditor.svelte";
  import FilePreview from "./FilePreview.svelte";
  import DiffPane from "./DiffPane.svelte";
  import FileIcon from "@lucide/svelte/icons/file";
  import PencilIcon from "@lucide/svelte/icons/pencil";
  import EyeIcon from "@lucide/svelte/icons/eye";
  import FileDiffIcon from "@lucide/svelte/icons/file-diff";
  import SaveIcon from "@lucide/svelte/icons/save";

  let {
    tab,
    fileState,
    active = false,
  }: { tab: FileTab; fileState: FileEditorState; active?: boolean } = $props();

  // --- which views this file offers -----------------------------------------
  const isImg = $derived(isImagePath(tab.path));
  const isSvg = $derived(/\.svg$/i.test(tab.path));
  const isMarkdown = $derived(/\.(md|markdown)$/i.test(tab.path));
  const previewKind: "image" | "markdown" | null = $derived(
    isImg ? "image" : isMarkdown ? "markdown" : null,
  );
  // A raster image isn't editable text; nor is a binary / too-large / missing file.
  const canEdit = $derived(
    !(isImg && !isSvg) && !fileState.binary && !fileState.tooLarge && !fileState.error,
  );
  const canPreview = $derived(previewKind !== null);
  const canChanges = $derived(tab.worktree !== null);

  interface ViewSpec {
    view: FileView;
    label: string;
    icon: typeof FileIcon;
  }
  const views = $derived(
    [
      canEdit && { view: "edit", label: i18n.t("view.edit"), icon: PencilIcon },
      canPreview && { view: "preview", label: i18n.t("view.preview"), icon: EyeIcon },
      canChanges && { view: "changes", label: i18n.t("view.changes"), icon: FileDiffIcon },
    ].filter(Boolean) as ViewSpec[],
  );
  /** The view actually shown: the tab's choice when still valid, else the first
   *  offered (capabilities resolve async, so the choice can become unavailable). */
  const shown: FileView = $derived(
    views.some((v) => v.view === tab.view) ? tab.view : (views[0]?.view ?? "edit"),
  );

  // Keep every *visited* view mounted (so the editor never remounts and the diff is
  // read once), growing the set as the user switches. The current view always
  // renders (see the body), so the initial paint doesn't wait on this effect.
  let mounted = $state<Set<FileView>>(new Set());
  $effect(() => {
    if (!mounted.has(shown)) mounted = new Set(mounted).add(shown);
  });

  // Lazily built on first entry to Changes (keyed by tab id in the store); recomputes
  // when the view flips so the just-built state is picked up.
  const diffState = $derived(
    tab.view === "changes" || mounted.has("changes")
      ? terminals.fileDiffState(tab.id)
      : undefined,
  );

  function switchView(v: FileView): void {
    terminals.setFileView(tab.id, v);
  }
  function setStaged(staged: boolean): void {
    terminals.setFileChangesStaged(tab.id, staged);
  }

  const segBase =
    "flex items-center gap-1 px-2 py-0.5 transition-colors " + text.indicator;
  const segActive = "bg-accent text-foreground";
  const segIdle = "text-muted-foreground hover:text-foreground";
</script>

<div class="flex h-full min-h-0 flex-col bg-background">
  <header class="flex h-9 shrink-0 items-center gap-2 border-b border-border/60 px-2">
    <FileIcon class={cn(icon.decorative, "shrink-0 text-muted-foreground")} />
    <TooltipSimple title={tab.path}>
      {#snippet children(tp)}
        <span {...tp} class={cn("min-w-0 flex-1 truncate font-mono", text.body)}>
          {fileState.rel || fileState.name}
          {#if fileState.dirty}
            <TooltipSimple title={i18n.t("editor.unsaved")}>
              {#snippet children(tp2)}
                <span {...tp2} class="text-amber-600 dark:text-amber-400">●</span>
              {/snippet}
            </TooltipSimple>
          {/if}
        </span>
      {/snippet}
    </TooltipSimple>

    <!-- Contextual action: Save (Edit) or the staged/unstaged toggle (Changes). -->
    {#if shown === "edit"}
      <TooltipSimple title={i18n.t("editor.save")}>
        {#snippet children(tp)}
          <Button
            {...tp}
            variant="ghost"
            size="sm"
            class={cn("h-6", text.body)}
            disabled={!fileState.dirty || fileState.saving}
            onclick={() => void fileState.save(fileState.content)}
          >
            <SaveIcon data-icon="inline-start" />
            {fileState.saving ? i18n.t("editor.saving") : i18n.t("editor.save")}
          </Button>
        {/snippet}
      </TooltipSimple>
    {:else if shown === "changes"}
      <div class="inline-flex shrink-0 overflow-hidden rounded-md border border-border">
        <button
          type="button"
          class={cn(segBase, "border-r border-border/60", !tab.staged ? segActive : segIdle)}
          onclick={() => setStaged(false)}
        >
          {i18n.t("preview.unstaged")}
        </button>
        <button
          type="button"
          class={cn(segBase, tab.staged ? segActive : segIdle)}
          onclick={() => setStaged(true)}
        >
          {i18n.t("preview.staged")}
        </button>
      </div>
    {/if}

    <!-- View switch (only when this file offers more than one view). -->
    {#if views.length > 1}
      <div class="inline-flex shrink-0 overflow-hidden rounded-md border border-border">
        {#each views as v, i (v.view)}
          {@const Icon = v.icon}
          <TooltipSimple title={v.label}>
            {#snippet children(tp)}
              <button
                {...tp}
                type="button"
                class={cn(
                  segBase,
                  i > 0 && "border-l border-border/60",
                  shown === v.view ? segActive : segIdle,
                )}
                aria-pressed={shown === v.view}
                onclick={() => switchView(v.view)}
              >
                <Icon class="size-3.5" />
                {v.label}
              </button>
            {/snippet}
          </TooltipSimple>
        {/each}
      </div>
    {/if}
  </header>

  <!-- Body: the current view always renders; a view stays mounted after its first
       visit (so the editor never remounts and the diff is read only once). -->
  <div class="relative min-h-0 flex-1">
    {#if canEdit && (shown === "edit" || mounted.has("edit"))}
      <div class="absolute inset-0" style:display={shown === "edit" ? "block" : "none"}>
        <FileEditor {fileState} active={active && shown === "edit"} />
      </div>
    {/if}
    {#if previewKind && (shown === "preview" || mounted.has("preview"))}
      <div class="absolute inset-0" style:display={shown === "preview" ? "block" : "none"}>
        <FilePreview path={tab.path} content={fileState.content} kind={previewKind} />
      </div>
    {/if}
    {#if shown === "changes" || mounted.has("changes")}
      <div class="absolute inset-0" style:display={shown === "changes" ? "block" : "none"}>
        {#if diffState}
          <DiffPane state={diffState} />
        {:else}
          <p class={cn("p-4", text.meta)}>{i18n.t("changes.none")}</p>
        {/if}
      </div>
    {/if}
  </div>
</div>
