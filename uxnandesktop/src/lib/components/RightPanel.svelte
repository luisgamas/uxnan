<script lang="ts">
  // Right-panel review: the active worktree's changed files (staged / changes),
  // per-file stage / unstage / discard, a commit composer, push/pull, and a
  // diff viewer. Status updates live via the backend `git:status-changed` event.
  import { onMount } from "svelte";
  import { Button } from "$lib/components/ui/button";
  import { projects } from "$lib/state/projects.svelte";
  import { git, type FileEntry } from "$lib/state/git.svelte";
  import { cn } from "$lib/utils";
  import { icon, iconButton, text } from "$lib/design";
  import { i18n } from "$lib/i18n";
  import ConfirmDialog from "./ConfirmDialog.svelte";
  import RefreshCwIcon from "@lucide/svelte/icons/refresh-cw";
  import PlusIcon from "@lucide/svelte/icons/plus";
  import MinusIcon from "@lucide/svelte/icons/minus";
  import EyeIcon from "@lucide/svelte/icons/eye";
  import Undo2Icon from "@lucide/svelte/icons/undo-2";
  import GitCommitIcon from "@lucide/svelte/icons/git-commit-horizontal";
  import ArrowUpIcon from "@lucide/svelte/icons/arrow-up";
  import ArrowDownIcon from "@lucide/svelte/icons/arrow-down";
  import XIcon from "@lucide/svelte/icons/x";

  type Area = "staged" | "changes";

  // Subscribe to live status events once.
  onMount(() => void git.startListening());

  // Reload whenever the active worktree changes.
  $effect(() => {
    void git.load(projects.activeWorktreePath);
  });

  const worktreeName = $derived(
    git.path ? (git.path.replace(/[\\/]+$/, "").split(/[\\/]/).pop() ?? git.path) : "",
  );
  const canCommit = $derived(
    git.staged.length > 0 && git.message.trim().length > 0 && !git.committing,
  );

  // Discard confirmation target.
  let discardOpen = $state(false);
  let discardTarget = $state<FileEntry | null>(null);
  function askDiscard(f: FileEntry) {
    discardTarget = f;
    discardOpen = true;
  }

  function badge(f: FileEntry, area: Area): { letter: string; cls: string } {
    if (area === "changes" && f.untracked)
      return { letter: "U", cls: "text-emerald-600 dark:text-emerald-400" };
    const code = area === "staged" ? f.index : f.worktree;
    const cls =
      code === "M"
        ? "text-amber-600 dark:text-amber-400"
        : code === "A"
          ? "text-emerald-600 dark:text-emerald-400"
          : code === "D"
            ? "text-red-600 dark:text-red-400"
            : code === "R" || code === "C"
              ? "text-sky-600 dark:text-sky-400"
              : "text-muted-foreground";
    return { letter: code.trim() || "•", cls };
  }

  const fileName = (p: string) => p.split("/").pop() ?? p;
  const fileDir = (p: string) => {
    const i = p.lastIndexOf("/");
    return i < 0 ? "" : p.slice(0, i);
  };
</script>

{#snippet fileRow(f: FileEntry, area: Area)}
  {@const b = badge(f, area)}
  {@const isOpen =
    git.selected?.file === f.path && git.selected?.staged === (area === "staged")}
  <div
    class={cn(
      "group flex items-center gap-1.5 rounded-md py-1 pl-1.5 pr-1",
      isOpen ? "bg-accent/70" : "hover:bg-accent/40",
    )}
    title={f.path}
  >
    <span class={cn("w-3 shrink-0 text-center font-mono font-semibold", text.indicator, b.cls)}>
      {b.letter}
    </span>
    <span class={cn("min-w-0 flex-1 truncate font-medium", text.body, b.cls)}>
      {fileName(f.path)}
      {#if fileDir(f.path)}
        <span class={cn("ml-1 font-normal", text.meta)}>{fileDir(f.path)}</span>
      {/if}
    </span>
    <Button
      variant="ghost"
      size="icon"
      class={cn(iconButton.action, isOpen ? "text-foreground" : "opacity-70 group-hover:opacity-100")}
      title={i18n.t("rightPanel.viewDiff")}
      onclick={() => void git.openDiff(f.path, area === "staged")}
    >
      <EyeIcon class={icon.button} />
    </Button>
    <div class="flex shrink-0 items-center opacity-0 group-hover:opacity-100">
      <Button
        variant="ghost"
        size="icon"
        class={iconButton.action}
        disabled={git.busy}
        title={i18n.t("rightPanel.discard")}
        onclick={() => askDiscard(f)}
      >
        <Undo2Icon class={icon.button} />
      </Button>
      {#if area === "staged"}
        <Button
          variant="ghost"
          size="icon"
          class={iconButton.action}
          disabled={git.busy}
          title={i18n.t("rightPanel.unstage")}
          onclick={() => void git.unstage(f.path)}
        >
          <MinusIcon class={icon.button} />
        </Button>
      {:else}
        <Button
          variant="ghost"
          size="icon"
          class={iconButton.action}
          disabled={git.busy}
          title={i18n.t("rightPanel.stage")}
          onclick={() => void git.stage(f.path)}
        >
          <PlusIcon class={icon.button} />
        </Button>
      {/if}
    </div>
  </div>
{/snippet}

<div class="flex h-full min-h-0 flex-col">
  <!-- Header: active worktree + refresh -->
  <header class="flex h-9 shrink-0 items-center gap-1.5 border-b border-sidebar-border px-2">
    <span class={cn("flex-1 truncate", text.section)}>
      {i18n.t("rightPanel.changes")}
      {#if worktreeName}
        <span class="text-muted-foreground/60">· {worktreeName}</span>
      {/if}
    </span>
    {#if git.path}
      <Button
        variant="ghost"
        size="icon"
        class="size-6"
        title={i18n.t("rightPanel.refresh")}
        onclick={() => void git.refresh()}
      >
        <RefreshCwIcon class={cn(icon.button, git.loading && "animate-spin")} />
      </Button>
    {/if}
  </header>

  {#if !git.path}
    <p class={cn("p-3", text.meta)}>{i18n.t("rightPanel.selectWorktree")}</p>
  {:else}
    {#if git.error}
      <div class="flex shrink-0 items-start gap-1.5 border-b border-sidebar-border px-3 py-1.5">
        <p class={cn("min-w-0 flex-1 text-destructive", text.body)}>{git.error}</p>
        <button
          class="shrink-0 rounded p-0.5 text-destructive/70 hover:text-destructive"
          title={i18n.t("common.dismiss")}
          aria-label={i18n.t("common.dismiss")}
          onclick={() => (git.error = null)}
        >
          <XIcon class={icon.decorative} />
        </button>
      </div>
    {/if}

    <div class="uxnan-scroll min-h-0 flex-1 overflow-y-auto p-2">
      {#if git.staged.length === 0 && git.changed.length === 0}
        <p class={cn("px-1 py-2", text.meta)}>
          {git.loading ? i18n.t("common.loading") : i18n.t("rightPanel.noChanges")}
        </p>
      {/if}

      {#if git.staged.length > 0}
        <div class="mb-1 flex items-center justify-between pl-1.5 pr-0.5">
          <span class={text.section}>
            {i18n.t("rightPanel.staged")}
            <span class="text-muted-foreground/60">({git.staged.length})</span>
          </span>
          <Button
            variant="ghost"
            size="sm"
            class={cn("h-6", text.body)}
            disabled={git.busy}
            onclick={() => void git.unstageAll()}
          >
            {i18n.t("rightPanel.unstageAll")}
          </Button>
        </div>
        <div class="mb-3 flex flex-col">
          {#each git.staged as f (f.path)}
            {@render fileRow(f, "staged")}
          {/each}
        </div>
      {/if}

      {#if git.changed.length > 0}
        <div class="mb-1 flex items-center justify-between pl-1.5 pr-0.5">
          <span class={text.section}>
            {i18n.t("rightPanel.changes")}
            <span class="text-muted-foreground/60">({git.changed.length})</span>
          </span>
          <Button
            variant="ghost"
            size="sm"
            class={cn("h-6", text.body)}
            disabled={git.busy}
            onclick={() => void git.stageAll()}
          >
            {i18n.t("rightPanel.stageAll")}
          </Button>
        </div>
        <div class="flex flex-col">
          {#each git.changed as f (f.path)}
            {@render fileRow(f, "changes")}
          {/each}
        </div>
      {/if}
    </div>

    <!-- Commit composer + sync -->
    <div class="shrink-0 border-t border-sidebar-border p-2">
      <textarea
        class="uxnan-scroll w-full resize-none rounded-md border border-input bg-transparent px-2 py-1.5 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
        rows="2"
        placeholder={i18n.t("rightPanel.commitPlaceholder")}
        bind:value={git.message}
      ></textarea>
      <Button
        class="mt-1.5 w-full"
        size="sm"
        disabled={!canCommit}
        onclick={() => void git.commit()}
      >
        <GitCommitIcon data-icon="inline-start" />
        {git.committing ? i18n.t("rightPanel.committing") : i18n.t("rightPanel.commit")}
      </Button>

      {#if git.ahead > 0 || git.behind > 0}
        <div class="mt-1.5 flex gap-1.5">
          <Button
            variant="outline"
            size="sm"
            class="flex-1"
            disabled={git.syncing || git.behind === 0}
            title={i18n.t("rightPanel.pull")}
            onclick={() => void git.pull()}
          >
            <ArrowDownIcon data-icon="inline-start" />
            {i18n.t("rightPanel.pull")}
            {#if git.behind > 0}<span class={text.indicator}>{git.behind}</span>{/if}
          </Button>
          <Button
            variant="outline"
            size="sm"
            class="flex-1"
            disabled={git.syncing || git.ahead === 0}
            title={i18n.t("rightPanel.push")}
            onclick={() => void git.push()}
          >
            <ArrowUpIcon data-icon="inline-start" />
            {i18n.t("rightPanel.push")}
            {#if git.ahead > 0}<span class={text.indicator}>{git.ahead}</span>{/if}
          </Button>
        </div>
      {/if}
    </div>
  {/if}
</div>

<ConfirmDialog
  bind:open={discardOpen}
  title={i18n.t("rightPanel.discardTitle")}
  description={discardTarget ? i18n.t("rightPanel.discardDesc", { file: discardTarget.path }) : ""}
  confirmLabel={i18n.t("rightPanel.discard")}
  danger
  onconfirm={() => {
    if (discardTarget) return git.discard(discardTarget.path, discardTarget.untracked);
  }}
/>
