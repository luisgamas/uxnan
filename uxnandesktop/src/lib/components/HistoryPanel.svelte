<script lang="ts">
  // History tab: the active worktree's commit log, with an optional branch graph
  // gutter (colored lanes for branches/merges) drawn to the left of each commit.
  // Clicking a commit opens its full diff as a center tab (CommitPane). The log
  // is paginated (a "load more" footer) and filterable. Data lives in the shared
  // `history` store so it survives tab re-mounts.
  import { history } from "$lib/state/history.svelte";
  import { terminals } from "$lib/state/terminals.svelte";
  import { projects } from "$lib/state/projects.svelte";
  import { i18n } from "$lib/i18n";
  import { cn } from "$lib/utils";
  import { icon, text } from "$lib/design";
  import { clipboardWrite } from "$lib/clipboard";
  import { toast } from "$lib/toast";
  import { computeGraph, type GraphRow } from "$lib/gitGraph";
  import type { CommitInfo } from "$lib/types";
  import VirtualList from "./VirtualList.svelte";
  import { Button } from "$lib/components/ui/button";
  import RefreshCwIcon from "@lucide/svelte/icons/refresh-cw";
  import SearchIcon from "@lucide/svelte/icons/search";
  import XIcon from "@lucide/svelte/icons/x";
  import GitBranchIcon from "@lucide/svelte/icons/git-branch";
  import CopyIcon from "@lucide/svelte/icons/copy";
  import TagIcon from "@lucide/svelte/icons/tag";

  // Keep the loaded log pointed at the active worktree (cheap no-op on re-mount).
  $effect(() => {
    history.ensure(projects.activeWorktreePath);
  });

  // Graph geometry (kept in lockstep with the row height below).
  const ROW_H = 44;
  const LANE_W = 14;
  const laneX = (lane: number) => lane * LANE_W + LANE_W / 2;

  // The graph is only meaningful over the full, unfiltered log (a filter breaks
  // parent chains), so it's drawn when graph view is on AND no filter is active.
  const graphOn = $derived(history.showGraph && history.query.trim().length === 0);
  const layout = $derived(graphOn ? computeGraph(history.commits) : null);
  const gutterWidth = $derived(layout ? layout.maxLanes * LANE_W : 0);

  // Local search toggle (mirrors the Changes tab).
  let searching = $state(false);
  function toggleSearch() {
    searching = !searching;
    if (!searching) history.query = "";
  }

  // Localized, compact relative time (e.g. "2 days ago"), via the platform.
  const rtf = $derived(new Intl.RelativeTimeFormat(i18n.locale, { numeric: "auto" }));
  function relativeTime(unixSeconds: number): string {
    const diff = unixSeconds * 1000 - Date.now();
    const abs = Math.abs(diff);
    const min = 60_000,
      hour = 60 * min,
      day = 24 * hour,
      week = 7 * day,
      month = 30 * day,
      year = 365 * day;
    if (abs < hour) return rtf.format(Math.round(diff / min), "minute");
    if (abs < day) return rtf.format(Math.round(diff / hour), "hour");
    if (abs < week) return rtf.format(Math.round(diff / day), "day");
    if (abs < month) return rtf.format(Math.round(diff / week), "week");
    if (abs < year) return rtf.format(Math.round(diff / month), "month");
    return rtf.format(Math.round(diff / year), "year");
  }

  async function copyHash(hash: string) {
    await clipboardWrite(hash);
    toast.success(i18n.t("history.hashCopied"));
  }

  // Open the commit's full diff as a center tab, mirroring how the Changes tab
  // opens a file diff (into the active region of the current workspace).
  function openCommit(commit: CommitInfo) {
    if (!history.path) return;
    terminals.openCommit(history.path, commit.hash, commit.subject);
  }

  // Classify a ref decoration for styling: HEAD pointer, tag, or a branch name.
  function refKind(label: string): "head" | "tag" | "branch" {
    if (label === "HEAD") return "head";
    if (label.startsWith("tag:")) return "tag";
    return "branch";
  }
  const refLabel = (label: string) =>
    label.startsWith("tag:") ? label.slice(4).trim() : label;
</script>

{#snippet graphGutter(rowLayout: GraphRow)}
  <svg
    width={gutterWidth}
    height={ROW_H}
    viewBox="0 0 {gutterWidth} {ROW_H}"
    class="shrink-0"
    aria-hidden="true"
  >
    {#each rowLayout.segments as seg, i (i)}
      {#if seg.kind === "through"}
        <line
          x1={laneX(seg.fromLane)}
          y1="0"
          x2={laneX(seg.fromLane)}
          y2={ROW_H}
          stroke={seg.color}
          stroke-width="1.5"
        />
      {:else if seg.kind === "in"}
        <line
          x1={laneX(seg.fromLane)}
          y1="0"
          x2={laneX(seg.toLane)}
          y2={ROW_H / 2}
          stroke={seg.color}
          stroke-width="1.5"
        />
      {:else}
        <line
          x1={laneX(seg.fromLane)}
          y1={ROW_H / 2}
          x2={laneX(seg.toLane)}
          y2={ROW_H}
          stroke={seg.color}
          stroke-width="1.5"
        />
      {/if}
    {/each}
    <circle
      cx={laneX(rowLayout.nodeLane)}
      cy={ROW_H / 2}
      r={rowLayout.isMerge ? 4 : 3.5}
      fill={rowLayout.isMerge ? "var(--background)" : rowLayout.nodeColor}
      stroke={rowLayout.nodeColor}
      stroke-width="1.5"
    />
  </svg>
{/snippet}

{#snippet commitRow(commit: CommitInfo, index: number)}
  {@const isOpen =
    history.path != null && terminals.isCommitOpen(history.path, commit.hash)}
  <div
    class={cn(
      "group flex items-center gap-2 pr-1",
      isOpen ? "bg-primary/15 ring-1 ring-inset ring-primary/25" : "hover:bg-accent/40",
      "h-11 cursor-pointer rounded-md",
    )}
    role="button"
    tabindex="0"
    title={i18n.t("history.viewCommit")}
    onclick={() => openCommit(commit)}
    onkeydown={(e) => (e.key === "Enter" || e.key === " ") && openCommit(commit)}
  >
    {#if layout && layout.rows[index]}
      {@render graphGutter(layout.rows[index])}
    {/if}
    <div class="flex min-w-0 flex-1 flex-col justify-center gap-0.5 py-1">
      <div class="flex min-w-0 items-center gap-1.5">
        {#each commit.refs as ref, i (i)}
          {@const kind = refKind(ref)}
          <span
            class={cn(
              "inline-flex shrink-0 items-center gap-0.5 rounded-sm px-1 py-px font-medium",
              text.indicator,
              kind === "head"
                ? "bg-primary/20 text-primary"
                : kind === "tag"
                  ? "bg-amber-500/20 text-amber-600 dark:text-amber-400"
                  : "bg-muted text-muted-foreground",
            )}
          >
            {#if kind === "tag"}<TagIcon class="size-2.5" />{/if}
            {refLabel(ref)}
          </span>
        {/each}
        <span class={cn("min-w-0 flex-1 truncate font-medium", text.body)}>
          {commit.subject}
        </span>
      </div>
      <div class={cn("flex items-center gap-1.5", text.meta)}>
        <span class="shrink-0 font-mono">{commit.shortHash}</span>
        <span class="min-w-0 truncate">{commit.authorName}</span>
        <span class="shrink-0">·</span>
        <span class="shrink-0">{relativeTime(commit.timestamp)}</span>
      </div>
    </div>
    <Button
      variant="ghost"
      size="icon"
      class="size-6 shrink-0 opacity-0 group-hover:opacity-100"
      title={i18n.t("history.copyHash")}
      onclick={(e) => {
        e.stopPropagation();
        void copyHash(commit.hash);
      }}
    >
      <CopyIcon class={icon.button} />
    </Button>
  </div>
{/snippet}

<div class="flex h-full min-h-0 flex-col">
  <!-- Header: count · graph toggle · search · refresh -->
  <header class="flex h-9 shrink-0 items-center gap-0.5 border-b border-sidebar-border px-2">
    {#if searching}
      <!-- svelte-ignore a11y_autofocus -->
      <input
        autofocus
        type="text"
        placeholder={i18n.t("history.searchPlaceholder")}
        bind:value={history.query}
        class={cn(
          "min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted-foreground/60",
          text.body,
        )}
        onkeydown={(e) => e.key === "Escape" && toggleSearch()}
      />
      <Button variant="ghost" size="icon" class="size-6" title={i18n.t("common.close")} onclick={toggleSearch}>
        <XIcon class={icon.button} />
      </Button>
    {:else}
      <span class={cn("flex-1 truncate", text.section)}>
        {#if history.commits.length > 0}
          {i18n.plural(
            history.filtered.length,
            "history.countOne",
            "history.countOther",
          )}
        {/if}
      </span>
      {#if history.path}
        <Button
          variant="ghost"
          size="icon"
          class={cn("size-6", history.showGraph && "text-primary")}
          title={i18n.t(history.showGraph ? "history.hideGraph" : "history.showGraph")}
          onclick={() => (history.showGraph = !history.showGraph)}
        >
          <GitBranchIcon class={icon.button} />
        </Button>
        <Button variant="ghost" size="icon" class="size-6" title={i18n.t("history.search")} onclick={toggleSearch}>
          <SearchIcon class={icon.button} />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          class="size-6"
          title={i18n.t("history.refresh")}
          onclick={() => void history.refresh()}
        >
          <RefreshCwIcon class={cn(icon.button, history.loading && "animate-spin")} />
        </Button>
      {/if}
    {/if}
  </header>

  {#if !history.path}
    <p class={cn("p-3", text.meta)}>{i18n.t("history.selectWorktree")}</p>
  {:else if history.error}
    <p class={cn("p-3", text.meta)}>{i18n.t("history.notRepo")}</p>
  {:else if history.commits.length === 0}
    <p class={cn("p-3", text.meta)}>
      {history.loading ? i18n.t("common.loading") : i18n.t("history.noCommits")}
    </p>
  {:else if history.filtered.length === 0}
    <p class={cn("p-3", text.meta)}>{i18n.t("history.noMatch")}</p>
  {:else}
    <VirtualList items={history.filtered} estimateSize={ROW_H} class="min-h-0 flex-1 px-2">
      {#snippet row(commit, index)}
        {@render commitRow(commit, index)}
      {/snippet}
    </VirtualList>

    {#if history.query.trim().length === 0 && !history.reachedEnd}
      <div class="shrink-0 border-t border-sidebar-border p-2">
        <Button
          variant="outline"
          size="sm"
          class="w-full"
          disabled={history.loadingMore}
          onclick={() => void history.loadMore()}
        >
          {history.loadingMore ? i18n.t("common.loading") : i18n.t("history.loadMore")}
        </Button>
      </div>
    {/if}
  {/if}
</div>
