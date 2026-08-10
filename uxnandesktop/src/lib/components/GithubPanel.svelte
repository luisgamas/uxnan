<script lang="ts">
  // Right-panel "GitHub" tab — a narrow, worktree-scoped digest of the repo the
  // active worktree belongs to: the PR for its branch (checks roll-up + quick
  // actions), the repo's latest pull requests, its latest CI runs and its latest
  // issues. Every row is a way *into* the full section: clicking one opens the
  // inline GitHub view already showing that item's detail (`github.openSection`
  // with a pending detail), so nothing here re-implements a review, a log or an
  // issue thread — and nothing sends you to the browser to read them.
  import { github } from "$lib/state/github.svelte";
  import { projects } from "$lib/state/projects.svelte";
  import { app } from "$lib/state/app.svelte";
  import { resourceMode } from "$lib/state/resourceMode.svelte";
  import { i18n } from "$lib/i18n";
  import { cn } from "$lib/utils";
  import { iconButton, text, surface } from "$lib/design";
  import { githubRunList, githubPrList, githubIssueList, openExternal } from "$lib/api";
  import { relTimeLong } from "$lib/relTime";
  import {
    prStateIcon,
    prStateIconClass,
    issueStateIcon,
    issueStateIconClass,
    runDotClass,
  } from "$lib/githubDisplay";
  import type { RunListItem, PrListItem, IssueListItem } from "$lib/types";
  import { Button } from "$lib/components/ui/button";
  import { TooltipSimple } from "$lib/components/ui/tooltip";
  import CreatePrForm from "./CreatePrForm.svelte";
  import FreshnessHint from "./FreshnessHint.svelte";
  import GithubWorktreeDialog from "./GithubWorktreeDialog.svelte";
  import { Icon } from "$lib/components/ui/icon";
  import GitPullRequestIcon from "@hugeicons/core-free-icons/GitPullRequestIcon";
  import ExternalLinkIcon from "@hugeicons/core-free-icons/ExternalLinkIcon";
  import RefreshCwIcon from "@hugeicons/core-free-icons/RefreshIcon";
  import ArrowUpRightIcon from "@hugeicons/core-free-icons/ArrowUpRight01Icon";
  import GitBranchPlusIcon from "@hugeicons/core-free-icons/GitBranchPlusIcon";

  /** How many items each list shows. A right panel is a digest, not a browser —
   *  the section's own lists are the place to page through everything. */
  const LIMIT = 5;

  let runs = $state<RunListItem[]>([]);
  let prs = $state<PrListItem[]>([]);
  let issues = $state<IssueListItem[]>([]);
  let runsLoading = $state(false);
  let prsLoading = $state(false);
  let issuesLoading = $state(false);
  let listsPath = $state<string | null>(null);
  let listSeq = 0;

  // Worktree-from-issue, using the same automatic naming + agent dialog as the
  // section — it owns the issue-develop call.
  let worktreeDialogOpen = $state(false);
  let worktreeIssueNumber = $state<number | null>(null);
  let worktreeIssueTitle = $state("");

  const activePath = $derived(projects.activeWorktreePath);
  // Never render the previous worktree's repo while the next context request is
  // in flight. The store clears on a path change too; this is the view-level
  // invariant that keeps the digest scoped to exactly the active worktree.
  const ctx = $derived(github.contextPath === activePath ? github.context : null);
  /** The repo the section should open on — a worktree's own path works for `gh`,
   *  but the section is per *project*, so it gets the project root. */
  const repoPath = $derived(projects.activeRepo?.path ?? null);
  const repoId = $derived(projects.activeRepo?.id ?? null);

  /** The create-PR form's identity. Its contents live in the store under this
   *  key, which is also what keeps the form *open*: a local flag would be reset
   *  by the very remount we're protecting the typing from. */
  const draftKey = $derived(activePath ? `worktree:${activePath}` : null);
  const prDraft = $derived(github.prDraft(draftKey));

  /** The three lists are repo-wide (not branch-scoped): this panel answers "what
   *  is happening in this repo", and a branch filter is what made the CI list
   *  show the same handful of runs forever. */
  async function loadLists() {
    const seq = ++listSeq;
    const p = activePath;
    if (p !== listsPath) {
      listsPath = p;
      runs = [];
      prs = [];
      issues = [];
    }
    if (!p || !github.available || !ctx) {
      runs = [];
      prs = [];
      issues = [];
      runsLoading = false;
      prsLoading = false;
      issuesLoading = false;
      return;
    }
    runsLoading = true;
    prsLoading = true;
    issuesLoading = true;
    // Independent results, applied atomically only if this is still the newest
    // request for the same worktree. This closes the A → B → A stale-response
    // race without making one failed list blank the other two.
    const [nextRuns, nextPrs, nextIssues] = await Promise.allSettled([
      githubRunList(p, null, LIMIT),
      githubPrList(p, "all", null, LIMIT),
      githubIssueList(p, "all", null, LIMIT),
    ]);
    if (seq !== listSeq || activePath !== p) return;
    runs = nextRuns.status === "fulfilled" ? nextRuns.value : [];
    prs = nextPrs.status === "fulfilled" ? nextPrs.value : [];
    issues = nextIssues.status === "fulfilled" ? nextIssues.value : [];
    runsLoading = false;
    prsLoading = false;
    issuesLoading = false;
  }

  // Reload after every successful context poll, not only when the branch name
  // changes: PRs, CI and issues can change while the checked-out branch stays
  // exactly the same. Wait for the matching context load to settle first.
  $effect(() => {
    void activePath;
    void github.available;
    void github.contextRevision;
    if (activePath && (github.contextPath !== activePath || github.contextLoading)) return;
    void loadLists();
  });

  async function refreshAll() {
    // The completed context refresh advances `contextRevision`, which drives the
    // list reload above. Keeping one path avoids six duplicate `gh` calls.
    await github.refreshContext();
  }

  function checkColor(state: string): string {
    if (state === "success") return "text-emerald-500";
    if (state === "failure") return "text-red-500";
    if (state === "pending") return "text-amber-500";
    return "text-muted-foreground";
  }

  /** A short "2 hours ago" for a list row, or "" when the API gave no date. */
  function when(iso: string | null): string {
    if (!iso) return "";
    const ms = Date.parse(iso);
    return Number.isNaN(ms) ? "" : relTimeLong(ms, Date.now(), i18n.locale);
  }

  /** Open the section on `section`, optionally straight into one item's detail. */
  function openSection(
    section: "pulls" | "issues" | "actions",
    detail: Parameters<typeof github.openSection>[2] = null,
  ) {
    if (!repoPath) return;
    github.openSection(repoPath, section, detail);
  }

  function startWorktree(issue: IssueListItem) {
    worktreeIssueNumber = issue.number;
    worktreeIssueTitle = issue.title;
    worktreeDialogOpen = true;
  }
</script>

<div class="scrollbar-sleek flex h-full min-h-0 flex-col overflow-y-auto p-2">
  {#if !github.available}
    <!-- Not installed / not signed in -->
    <div class="flex flex-col items-center gap-2 px-3 py-8 text-center">
      <Icon icon={GitPullRequestIcon} class="size-6 text-muted-foreground" />
      <p class={cn("text-muted-foreground", text.meta)}>
        {github.status && !github.status.ghInstalled ? i18n.t("github.notInstalled") : i18n.t("github.notSignedIn")}
      </p>
      <Button variant="outline" size="sm" onclick={() => app.openSettings("github")}>
        {i18n.t("github.account.title")}
      </Button>
    </div>
  {:else if !projects.activeWorktreePath}
    <!-- No active worktree — like the other right-panel tabs, this is empty until
         a project/worktree is selected. The full GitHub section works standalone. -->
    <div class="flex flex-col items-center gap-2 px-3 py-10 text-center">
      <Icon icon={GitPullRequestIcon} class="size-6 text-muted-foreground/50" />
      <p class={cn("text-muted-foreground", text.meta)}>{i18n.t("github.panel.noWorktree")}</p>
    </div>
  {:else if !ctx}
    <!-- Nothing to show yet for THIS worktree: either the first read is still in
         flight or it answered "not a GitHub repo". Note what this branch is NOT:
         it is not entered because a *background* refresh is running. Gating the
         whole panel on `contextLoading` swapped it for this placeholder on every
         poll tick, which tore down an open create-PR form along with it — a
         refresh may add information, never destroy what the user is looking at. -->
    <div class="px-3 py-8 text-center">
      <p class={cn("text-muted-foreground", text.meta)}>
        {github.contextLoading || github.contextPath !== activePath
          ? i18n.t("github.loading")
          : i18n.t("github.notARepo")}
      </p>
    </div>
  {:else}
    <!-- Repo + branch header -->
    <div class="flex items-center gap-1 px-1 pb-2">
      <span class={cn("min-w-0 flex-1 truncate", text.section)}>{ctx.nameWithOwner}</span>
      <TooltipSimple title={i18n.t("github.panel.openViewTip")}>
        {#snippet children(props)}
          <Button
            {...props}
            variant="ghost"
            size="icon-sm"
            class={iconButton.xs}
            aria-label={i18n.t("github.panel.openViewTip")}
            onclick={() => openSection("pulls")}
          >
            <Icon icon={ArrowUpRightIcon} class="size-3" />
          </Button>
        {/snippet}
      </TooltipSimple>
      {#if resourceMode.freshness.github}
        <FreshnessHint label={i18n.t("resourceMode.freshness.github")} onrefresh={refreshAll} />
      {/if}
      <TooltipSimple title={i18n.t("github.panel.refreshTip")}>
        {#snippet children(props)}
          <Button
            {...props}
            variant="ghost"
            size="icon-sm"
            class={iconButton.xs}
            aria-label={i18n.t("github.panel.refreshTip")}
            onclick={refreshAll}
          >
            <Icon icon={RefreshCwIcon} class="size-3" />
          </Button>
        {/snippet}
      </TooltipSimple>
    </div>
    {#if ctx.branch}
      <div class={cn("mb-2 truncate px-1 text-muted-foreground", text.meta)}>
        {i18n.t("github.panel.branch")}: <span class="font-mono">{ctx.branch}</span>
      </div>
    {/if}

    <!-- PR card (this branch) -->
    {#if ctx.pr}
      {@const pr = ctx.pr}
      <div class={cn("mb-3 rounded-lg p-2.5", surface.panel)}>
        <button
          class="flex w-full items-start gap-2 text-left"
          onclick={() => openSection("pulls", { kind: "pr", number: pr.number })}
        >
          <Icon icon={GitPullRequestIcon} class={cn("mt-0.5 size-4 shrink-0", pr.isDraft ? "text-muted-foreground" : "text-emerald-500")} />
          <div class="min-w-0 flex-1">
            <div class={cn("truncate", text.body)}>{pr.title}</div>
            <div class={cn("truncate text-muted-foreground", text.meta)}>
              {i18n.t("github.panel.openPr", { n: pr.number })} · {pr.state}
            </div>
          </div>
        </button>
        {#if pr.checks.total > 0}
          <div class={cn("mt-2 flex items-center gap-1.5", text.indicator, checkColor(pr.checks.state))}>
            <span class={cn("size-2 rounded-full", pr.checks.state === "success" ? "bg-emerald-500" : pr.checks.state === "failure" ? "bg-red-500" : pr.checks.state === "pending" ? "bg-amber-500" : "bg-muted-foreground")}></span>
            {i18n.t("github.panel.checksPass", { passed: pr.checks.passed, total: pr.checks.total })}
          </div>
        {/if}
        <div class="mt-2 flex items-center gap-1">
          <Button
            variant="outline"
            size="sm"
            class="h-7 flex-1"
            onclick={() => openSection("pulls", { kind: "pr", number: pr.number })}
          >
            {i18n.t("github.pr.review")}
          </Button>
          <TooltipSimple title={i18n.t("github.openOnGitHub")}>
            {#snippet children(props)}
              <Button
                {...props}
                variant="ghost"
                size="icon-sm"
                class={iconButton.action}
                aria-label={i18n.t("github.openOnGitHub")}
                onclick={() => openExternal(pr.url)}
              >
                <Icon icon={ExternalLinkIcon} class="size-3.5" />
              </Button>
            {/snippet}
          </TooltipSimple>
        </div>
      </div>
    {:else if prDraft}
      <div class="mb-3">
        <CreatePrForm
          worktreePath={projects.activeWorktreePath}
          defaultTitle={ctx.branch ?? ""}
          compact
          lockHead
          {draftKey}
          onCreated={refreshAll}
        />
      </div>
    {:else}
      <div class={cn("mb-3 rounded-lg p-2.5 text-center", surface.panel)}>
        <p class={cn("mb-2 text-muted-foreground", text.meta)}>{i18n.t("github.panel.noPr")}</p>
        <Button
          size="sm"
          class="w-full"
          onclick={() => draftKey && github.startPrDraft(draftKey, { title: ctx.branch ?? "" })}
        >
          {i18n.t("github.panel.createPr")}
        </Button>
      </div>
    {/if}

    <!-- Latest pull requests (any state) -->
    {@render sectionHeader(i18n.t("github.pr.title"), i18n.t("github.panel.openPulls"), () => openSection("pulls"))}
    {#if prsLoading && prs.length === 0}
      <p class={cn("px-1 py-2", text.meta)}>{i18n.t("github.loading")}</p>
    {:else if prs.length === 0}
      <p class={cn("px-1 py-2 text-muted-foreground", text.meta)}>{i18n.t("github.pr.empty")}</p>
    {:else}
      <div class="mb-3 flex flex-col gap-px">
        {#each prs as pr (pr.number)}
          {@const glyph = prStateIcon(pr.state, pr.isDraft)}
          <button
            class="flex items-center gap-2 rounded-md px-1.5 py-1.5 text-left hover:bg-accent/50"
            onclick={() => openSection("pulls", { kind: "pr", number: pr.number })}
          >
            <Icon icon={glyph} class={cn("size-3.5 shrink-0", prStateIconClass(pr.state, pr.isDraft))} />
            <div class="min-w-0 flex-1">
              <div class={cn("truncate", text.body)}>{pr.title}</div>
              <div class={cn("truncate text-muted-foreground", text.indicator)}>
                #{pr.number}{when(pr.updatedAt) ? ` · ${when(pr.updatedAt)}` : ""}
              </div>
            </div>
          </button>
        {/each}
      </div>
    {/if}

    <!-- Latest CI runs across the repo -->
    {@render sectionHeader(i18n.t("github.panel.runs"), i18n.t("github.panel.openActions"), () => openSection("actions"))}
    {#if runsLoading && runs.length === 0}
      <p class={cn("px-1 py-2", text.meta)}>{i18n.t("github.loading")}</p>
    {:else if runs.length === 0}
      <p class={cn("px-1 py-2 text-muted-foreground", text.meta)}>{i18n.t("github.actions.empty")}</p>
    {:else}
      <div class="mb-3 flex flex-col gap-px">
        {#each runs as run (run.databaseId)}
          <button
            class="flex items-center gap-2 rounded-md px-1.5 py-1.5 text-left hover:bg-accent/50"
            onclick={() =>
              openSection("actions", {
                kind: "run",
                id: run.databaseId,
                title: run.displayTitle || run.name,
              })}
          >
            <span class={cn("size-2 shrink-0 rounded-full", runDotClass(run))}></span>
            <div class="min-w-0 flex-1">
              <div class={cn("truncate", text.body)}>{run.displayTitle || run.name}</div>
              <div class={cn("truncate text-muted-foreground", text.indicator)}>
                {run.workflowName ?? run.name}{when(run.createdAt) ? ` · ${when(run.createdAt)}` : ""}
              </div>
            </div>
          </button>
        {/each}
      </div>
    {/if}

    <!-- Latest issues (any state), each able to start a worktree -->
    {@render sectionHeader(i18n.t("github.issue.title"), i18n.t("github.panel.openIssues"), () => openSection("issues"))}
    {#if issuesLoading && issues.length === 0}
      <p class={cn("px-1 py-2", text.meta)}>{i18n.t("github.loading")}</p>
    {:else if issues.length === 0}
      <p class={cn("px-1 py-2 text-muted-foreground", text.meta)}>{i18n.t("github.issue.empty")}</p>
    {:else}
      <div class="flex flex-col gap-px">
        {#each issues as issue (issue.number)}
          {@const glyph = issueStateIcon(issue.state)}
          <div class="group flex items-center gap-1 rounded-md pr-1 hover:bg-accent/50">
            <button
              class="flex min-w-0 flex-1 items-center gap-2 px-1.5 py-1.5 text-left"
              onclick={() => openSection("issues", { kind: "issue", number: issue.number })}
            >
              <Icon icon={glyph} class={cn("size-3.5 shrink-0", issueStateIconClass(issue.state))} />
              <div class="min-w-0 flex-1">
                <div class={cn("truncate", text.body)}>{issue.title}</div>
                <div class={cn("truncate text-muted-foreground", text.indicator)}>
                  #{issue.number}{when(issue.updatedAt) ? ` · ${when(issue.updatedAt)}` : ""}
                </div>
              </div>
            </button>
            <!-- Secondary action, so it reveals on hover (and on keyboard focus). -->
            <TooltipSimple title={i18n.t("github.issue.startWork")}>
              {#snippet children(props)}
                <Button
                  {...props}
                  variant="ghost"
                  size="icon-sm"
                  class={cn(
                    iconButton.xs,
                    "opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100",
                  )}
                  aria-label={i18n.t("github.issue.startWork")}
                  onclick={() => startWorktree(issue)}
                >
                  <Icon icon={GitBranchPlusIcon} class="size-3" />
                </Button>
              {/snippet}
            </TooltipSimple>
          </div>
        {/each}
      </div>
    {/if}
  {/if}
</div>

<GithubWorktreeDialog
  bind:open={worktreeDialogOpen}
  {repoId}
  kind="issue"
  number={worktreeIssueNumber}
  title={worktreeIssueTitle}
/>

<!-- One header recipe for all three lists: title + a button into that pane. -->
{#snippet sectionHeader(title: string, openLabel: string, onOpen: () => void)}
  <div class="flex items-center gap-1 px-1 pb-1">
    <span class={cn("min-w-0 flex-1 truncate", text.section)}>{title}</span>
    <TooltipSimple title={openLabel}>
      {#snippet children(props)}
        <Button
          {...props}
          variant="ghost"
          size="icon-sm"
          class={iconButton.xs}
          aria-label={openLabel}
          onclick={onOpen}
        >
          <Icon icon={ArrowUpRightIcon} class="size-3" />
        </Button>
      {/snippet}
    </TooltipSimple>
  </div>
{/snippet}
