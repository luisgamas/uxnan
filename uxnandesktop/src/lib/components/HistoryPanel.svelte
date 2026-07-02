<script lang="ts">
  // History tab: the active worktree's commit log, with an optional branch graph
  // gutter (colored lanes for branches/merges) drawn to the left of each commit.
  // Clicking a commit expands it to its changed-file list; clicking a file opens
  // just that file's slice of the commit diff as a center tab (far more readable
  // than one giant blob). Hovering a commit peeks its full details. The log is
  // paginated (a "load more" footer) and filterable; data lives in the shared
  // `history` store so it survives tab re-mounts.
  import { history } from "$lib/state/history.svelte";
  import { terminals } from "$lib/state/terminals.svelte";
  import { projects } from "$lib/state/projects.svelte";
  import { i18n } from "$lib/i18n";
  import { cn } from "$lib/utils";
  import { icon, iconButton, text } from "$lib/design";
  import { clipboardWrite } from "$lib/clipboard";
  import { toast } from "$lib/toast";
  import { computeGraph, type GraphRow, type GraphEdge } from "$lib/gitGraph";
  import type { CommitFile, CommitFileStatus } from "$lib/diffParse";
  import type { CommitInfo } from "$lib/types";
  import VirtualList from "./VirtualList.svelte";
  import { Button } from "$lib/components/ui/button";
  import * as HoverCard from "$lib/components/ui/hover-card";
  import RefreshCwIcon from "@lucide/svelte/icons/refresh-cw";
  import SearchIcon from "@lucide/svelte/icons/search";
  import XIcon from "@lucide/svelte/icons/x";
  import GitBranchIcon from "@lucide/svelte/icons/git-branch";
  import CopyIcon from "@lucide/svelte/icons/copy";
  import TagIcon from "@lucide/svelte/icons/tag";
  import ChevronRightIcon from "@lucide/svelte/icons/chevron-right";
  import GitCommitIcon from "@lucide/svelte/icons/git-commit-horizontal";
  import UserIcon from "@lucide/svelte/icons/user";
  import ClockIcon from "@lucide/svelte/icons/clock";

  // Keep the loaded log pointed at the active worktree (cheap no-op on re-mount).
  $effect(() => {
    history.ensure(projects.activeWorktreePath);
  });

  // Graph geometry (kept in lockstep with the commit row height below). Circular
  // arc connectors in the VS Code style; see `edgePath`.
  const ROW_H = 44; // a commit row
  const FILE_H = 28; // an expanded file / status row
  const LANE_W = 14;
  const MID = ROW_H / 2;
  const NODE_R = Math.min(LANE_W, MID); // quarter-arc radius for node bends
  const SHIFT_R = 6; // gentle S radius for a passing lane shifting column
  const laneX = (lane: number) => lane * LANE_W + LANE_W / 2;

  function edgePath(e: GraphEdge): string {
    const x1 = laneX(e.fromLane);
    const x2 = laneX(e.toLane);
    switch (e.kind) {
      case "inNode":
        return `M ${x1} 0 V ${MID}`;
      case "outNode":
        return `M ${x1} ${MID} V ${ROW_H}`;
      case "mergeIn":
        return `M ${x1} 0 V ${MID - NODE_R} A ${NODE_R} ${NODE_R} 0 0 1 ${x1 - NODE_R} ${MID} H ${x2}`;
      case "mergeOut":
        return `M ${x1} ${MID} H ${x2 - NODE_R} A ${NODE_R} ${NODE_R} 0 0 1 ${x2} ${MID + NODE_R} V ${ROW_H}`;
      case "through":
      default:
        if (Math.abs(x1 - x2) < 0.5) return `M ${x1} 0 V ${ROW_H}`;
        return (
          `M ${x1} 0 V ${MID - SHIFT_R} ` +
          `A ${SHIFT_R} ${SHIFT_R} 0 0 1 ${x1 - SHIFT_R} ${MID} ` +
          `H ${x2 + SHIFT_R} ` +
          `A ${SHIFT_R} ${SHIFT_R} 0 0 0 ${x2} ${MID + SHIFT_R} V ${ROW_H}`
        );
    }
  }

  // The graph is only meaningful over the full, unfiltered log (a filter breaks
  // parent chains), so it's drawn when graph view is on AND no filter is active.
  const graphOn = $derived(history.showGraph && history.query.trim().length === 0);
  const layout = $derived(graphOn ? computeGraph(history.commits) : null);
  const gutterWidth = $derived(layout ? layout.maxLanes * LANE_W : 0);

  // Flatten commits + their (expanded) file lists into one row list. `cindex` is
  // the commit's index in the log, used to look up its graph row (which is
  // computed over the unfiltered log, so it only matters while `graphOn`).
  type Entry =
    | { kind: "commit"; commit: CommitInfo; cindex: number }
    | { kind: "file"; file: CommitFile; commit: CommitInfo; cindex: number }
    | { kind: "status"; text: string; cindex: number };

  const entries = $derived.by<Entry[]>(() => {
    const out: Entry[] = [];
    history.filtered.forEach((commit, cindex) => {
      out.push({ kind: "commit", commit, cindex });
      if (!history.isExpanded(commit.hash)) return;
      const fs = history.filesFor(commit.hash);
      if (!fs || fs.status === "loading")
        out.push({ kind: "status", text: i18n.t("common.loading"), cindex });
      else if (fs.status === "error")
        out.push({ kind: "status", text: i18n.t("history.filesError"), cindex });
      else if (fs.files.length === 0)
        out.push({ kind: "status", text: i18n.t("history.noFileChanges"), cindex });
      else for (const file of fs.files) out.push({ kind: "file", file, commit, cindex });
    });
    return out;
  });

  const rowSize = (i: number): number => (entries[i]?.kind === "commit" ? ROW_H : FILE_H);

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
  const dtf = $derived(
    new Intl.DateTimeFormat(i18n.locale, { dateStyle: "medium", timeStyle: "short" }),
  );
  const absoluteTime = (unixSeconds: number) => dtf.format(new Date(unixSeconds * 1000));

  async function copyHash(hash: string) {
    await clipboardWrite(hash);
    toast.success(i18n.t("history.hashCopied"));
  }

  // Click a commit → expand/collapse its changed-file list (no center tab).
  function toggleCommit(commit: CommitInfo) {
    history.toggleExpand(commit.hash);
  }
  // Click a file → open just that file's slice of the commit diff as a center tab.
  function openFile(commit: CommitInfo, file: CommitFile) {
    if (!history.path) return;
    terminals.openCommit(history.path, commit.hash, commit.subject, { file: file.path });
  }

  // Classify a ref decoration for styling: HEAD pointer, tag, or a branch name.
  function refKind(label: string): "head" | "tag" | "branch" {
    if (label === "HEAD") return "head";
    if (label.startsWith("tag:")) return "tag";
    return "branch";
  }
  const refLabel = (label: string) =>
    label.startsWith("tag:") ? label.slice(4).trim() : label;

  // Changed-file status → single letter + color.
  function statusMeta(s: CommitFileStatus): { letter: string; class: string } {
    switch (s) {
      case "added":
        return { letter: "A", class: "text-emerald-600 dark:text-emerald-400" };
      case "deleted":
        return { letter: "D", class: "text-red-600 dark:text-red-400" };
      case "renamed":
        return { letter: "R", class: "text-blue-600 dark:text-blue-400" };
      default:
        return { letter: "M", class: "text-amber-600 dark:text-amber-400" };
    }
  }
  function splitPath(p: string): { dir: string; name: string } {
    const i = p.replace(/\/+$/, "").lastIndexOf("/");
    return i < 0 ? { dir: "", name: p } : { dir: p.slice(0, i + 1), name: p.slice(i + 1) };
  }
</script>

{#snippet graphGutter(rowLayout: GraphRow)}
  <svg
    width={gutterWidth}
    height={ROW_H}
    viewBox="0 0 {gutterWidth} {ROW_H}"
    class="shrink-0"
    aria-hidden="true"
  >
    {#each rowLayout.edges as edge, i (i)}
      <path d={edgePath(edge)} fill="none" stroke={edge.color} stroke-width="1.5" stroke-linecap="round" />
    {/each}
    <circle
      cx={laneX(rowLayout.nodeLane)}
      cy={ROW_H / 2}
      r={(rowLayout.isMerge ? 5 : 3.5) + 1.5}
      fill="var(--background)"
    />
    {#if rowLayout.isMerge}
      <circle cx={laneX(rowLayout.nodeLane)} cy={ROW_H / 2} r="5" fill="none" stroke={rowLayout.nodeColor} stroke-width="1.5" />
      <circle cx={laneX(rowLayout.nodeLane)} cy={ROW_H / 2} r="2.5" fill={rowLayout.nodeColor} />
    {:else}
      <circle cx={laneX(rowLayout.nodeLane)} cy={ROW_H / 2} r="3.5" fill={rowLayout.nodeColor} />
    {/if}
  </svg>
{/snippet}

{#snippet commitRow(commit: CommitInfo, cindex: number)}
  {@const expanded = history.isExpanded(commit.hash)}
  <div
    class="group flex h-11 cursor-pointer items-center gap-1.5 rounded-md pr-1"
    role="button"
    tabindex="0"
    title={i18n.t("history.showFiles")}
    onclick={() => toggleCommit(commit)}
    onkeydown={(e) => (e.key === "Enter" || e.key === " ") && toggleCommit(commit)}
  >
    {#if layout && layout.rows[cindex]}
      {@render graphGutter(layout.rows[cindex])}
    {/if}
    <ChevronRightIcon
      class={cn(icon.decorative, "shrink-0 text-muted-foreground/70 transition-transform", expanded && "rotate-90")}
    />
    <HoverCard.Root>
      <HoverCard.Trigger>
        {#snippet child({ props })}
          <div {...props} class="flex min-w-0 flex-1 flex-col justify-center gap-0.5 py-1">
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
              <span class={cn("min-w-0 flex-1 truncate font-medium", text.body)}>{commit.subject}</span>
            </div>
            <div class={cn("flex items-center gap-1.5", text.meta)}>
              <span class="shrink-0 font-mono">{commit.shortHash}</span>
              <span class="min-w-0 truncate">{commit.authorName}</span>
              <span class="shrink-0">·</span>
              <span class="shrink-0">{relativeTime(commit.timestamp)}</span>
            </div>
          </div>
        {/snippet}
      </HoverCard.Trigger>
      <HoverCard.Content>
        {@render commitDetails(commit)}
      </HoverCard.Content>
    </HoverCard.Root>
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

{#snippet commitDetails(commit: CommitInfo)}
  <div class="flex flex-col gap-2">
    <div class={cn("font-medium leading-snug", text.body)}>{commit.subject}</div>
    {#if commit.body.trim()}
      <div class={cn("uxnan-scroll max-h-40 overflow-y-auto whitespace-pre-wrap", text.meta)}>
        {commit.body.trim()}
      </div>
    {/if}
    <div class="h-px bg-border/60"></div>
    <div class="flex flex-col gap-1">
      <div class={cn("flex items-center gap-1.5", text.meta)}>
        <GitCommitIcon class="size-3.5 shrink-0" />
        <span class="shrink-0 font-mono text-foreground">{commit.shortHash}</span>
        <span class="min-w-0 truncate font-mono">{commit.hash}</span>
      </div>
      <div class={cn("flex items-center gap-1.5", text.meta)}>
        <UserIcon class="size-3.5 shrink-0" />
        <span class="min-w-0 truncate">{commit.authorName}</span>
        {#if commit.authorEmail}
          <span class="min-w-0 truncate opacity-70">&lt;{commit.authorEmail}&gt;</span>
        {/if}
      </div>
      <div class={cn("flex items-center gap-1.5", text.meta)}>
        <ClockIcon class="size-3.5 shrink-0" />
        <span>{absoluteTime(commit.timestamp)}</span>
      </div>
    </div>
    {#if commit.refs.length}
      <div class="flex flex-wrap gap-1">
        {#each commit.refs as ref, i (i)}
          {@const kind = refKind(ref)}
          <span
            class={cn(
              "inline-flex items-center gap-0.5 rounded-sm px-1 py-px font-medium",
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
      </div>
    {/if}
  </div>
{/snippet}

{#snippet fileRow(entry: Extract<Entry, { kind: "file" }>)}
  {@const s = statusMeta(entry.file.status)}
  {@const p = splitPath(entry.file.path)}
  {@const isOpen =
    history.path != null && terminals.isCommitOpen(history.path, entry.commit.hash, entry.file.path)}
  <div
    class={cn(
      "group flex h-7 cursor-pointer items-center rounded-md",
      isOpen ? "bg-primary/15 ring-1 ring-inset ring-primary/25" : "hover:bg-accent/40",
    )}
    role="button"
    tabindex="0"
    title={i18n.t("history.viewFileDiff")}
    onclick={() => openFile(entry.commit, entry.file)}
    onkeydown={(e) => (e.key === "Enter" || e.key === " ") && openFile(entry.commit, entry.file)}
  >
    {#if graphOn}
      <div class="shrink-0" style="width:{gutterWidth}px" aria-hidden="true"></div>
    {/if}
    <div class="flex min-w-0 flex-1 items-center gap-1.5 pl-6 pr-1">
      <span class={cn("w-3 shrink-0 text-center font-mono font-semibold", text.indicator, s.class)}>
        {s.letter}
      </span>
      <span class={cn("min-w-0 flex-1 truncate", text.body)} title={entry.file.path}>
        {#if p.dir}<span class="text-muted-foreground">{p.dir}</span>{/if}{p.name}
      </span>
    </div>
  </div>
{/snippet}

{#snippet statusRow(entry: Extract<Entry, { kind: "status" }>)}
  <div class="flex h-7 items-center">
    {#if graphOn}
      <div class="shrink-0" style="width:{gutterWidth}px" aria-hidden="true"></div>
    {/if}
    <span class={cn("pl-6", text.meta)}>{entry.text}</span>
  </div>
{/snippet}

<div class="flex h-full min-h-0 flex-col">
  <!-- Header: count · graph toggle · search · refresh -->
  <header class="flex h-9 shrink-0 items-center gap-0.5 border-b border-sidebar-border/60 px-2">
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
      <Button variant="ghost" size="icon" class={iconButton.xs} title={i18n.t("common.close")} onclick={toggleSearch}>
        <XIcon class={icon.action} />
      </Button>
    {:else}
      <span class={cn("flex-1 truncate", text.section)}>
        {#if history.commits.length > 0}
          {i18n.plural(history.filtered.length, "history.countOne", "history.countOther")}
        {/if}
      </span>
      {#if history.path}
        <Button
          variant="ghost"
          size="icon"
          aria-pressed={history.showGraph}
          class={cn(
            iconButton.xs,
            history.showGraph &&
              "bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary",
          )}
          title={i18n.t(history.showGraph ? "history.hideGraph" : "history.showGraph")}
          onclick={() => (history.showGraph = !history.showGraph)}
        >
          <GitBranchIcon class={icon.action} />
        </Button>
        <Button variant="ghost" size="icon" class={iconButton.xs} title={i18n.t("history.search")} onclick={toggleSearch}>
          <SearchIcon class={icon.action} />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          class={iconButton.xs}
          title={i18n.t("history.refresh")}
          onclick={() => void history.refresh()}
        >
          <RefreshCwIcon class={cn(icon.action, history.loading && "animate-spin")} />
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
    <VirtualList items={entries} estimateSize={rowSize} class="min-h-0 flex-1 px-2">
      {#snippet row(entry)}
        {#if entry.kind === "commit"}
          {@render commitRow(entry.commit, entry.cindex)}
        {:else if entry.kind === "file"}
          {@render fileRow(entry)}
        {:else}
          {@render statusRow(entry)}
        {/if}
      {/snippet}
    </VirtualList>

    {#if history.query.trim().length === 0 && !history.reachedEnd}
      <div class="shrink-0 border-t border-sidebar-border/60 p-2">
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
