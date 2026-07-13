<script lang="ts">
  // The GitHub section — a full-screen overlay (mirrors Settings.svelte) that is
  // the big-space home for pull requests, issues, Actions, an overview and the
  // account/session panel. Everything is `gh`-backed via the github store; the
  // narrow per-worktree view lives in the right panel (GithubPanel.svelte).
  import { app } from "$lib/state/app.svelte";
  import { github } from "$lib/state/github.svelte";
  import { projects } from "$lib/state/projects.svelte";
  import type { GithubSection } from "$lib/state/app.svelte";
  import { i18n } from "$lib/i18n";
  import { cn } from "$lib/utils";
  import { icon, iconButton, text, divider, panel } from "$lib/design";
  import { toast, toastError } from "$lib/toast";
  import {
    githubPrView,
    githubPrDiff,
    githubPrComment,
    githubPrReview,
    githubPrMerge,
    githubPrCheckout,
    githubIssueView,
    githubIssueComment,
    githubIssueCreate,
    githubIssueDevelop,
    githubRunLog,
    githubRunRerun,
    githubRunCancel,
    aiCommitAgents,
    aiCommitModels,
    openExternal,
  } from "$lib/api";
  import type { PrDetail, IssueDetail } from "$lib/types";
  import { splitCommitDiff } from "$lib/diffParse";
  import { relTime } from "$lib/relTime";
  import { Button } from "$lib/components/ui/button";
  import { Input } from "$lib/components/ui/input";
  import { Textarea } from "$lib/components/ui/textarea";
  import { Switch } from "$lib/components/ui/switch";
  import Combobox from "$lib/components/Combobox.svelte";
  import SettingsSection from "$lib/components/SettingsSection.svelte";
  import SettingsRow from "$lib/components/SettingsRow.svelte";
  import DiffView from "$lib/components/DiffView.svelte";
  import CreatePrForm from "$lib/components/CreatePrForm.svelte";
  import ConfirmDialog from "$lib/components/ConfirmDialog.svelte";
  import ArrowLeftIcon from "@lucide/svelte/icons/arrow-left";
  import RefreshCwIcon from "@lucide/svelte/icons/refresh-cw";
  import ExternalLinkIcon from "@lucide/svelte/icons/external-link";
  import GitPullRequestIcon from "@lucide/svelte/icons/git-pull-request";
  import GitBranchIcon from "@lucide/svelte/icons/git-branch";
  import CircleDotIcon from "@lucide/svelte/icons/circle-dot";
  import CheckCircle2Icon from "@lucide/svelte/icons/check-circle-2";
  import PlayIcon from "@lucide/svelte/icons/play";
  import LayoutDashboardIcon from "@lucide/svelte/icons/layout-dashboard";
  import SettingsIcon from "@lucide/svelte/icons/settings";
  import CheckIcon from "@lucide/svelte/icons/check";
  import XIcon from "@lucide/svelte/icons/x";
  import PlusIcon from "@lucide/svelte/icons/plus";
  import ChevronRightIcon from "@lucide/svelte/icons/chevron-right";
  import ChevronDownIcon from "@lucide/svelte/icons/chevron-down";
  import TriangleAlertIcon from "@lucide/svelte/icons/triangle-alert";
  import GitCommitIcon from "@lucide/svelte/icons/git-commit-horizontal";
  import MessageSquareIcon from "@lucide/svelte/icons/message-square";
  import FileDiffIcon from "@lucide/svelte/icons/file-diff";
  import UsersIcon from "@lucide/svelte/icons/users";

  // The section acts on the explicitly-SELECTED repo (not the active worktree).
  const path = () => github.sectionRepoPath;
  // A "data" pane (needs a repo) vs Settings (works without one).
  const dataPane = $derived(app.githubSection !== "settings");

  /** Switch the section's repo (clearing any open detail from the old repo). */
  function switchRepo(p: string) {
    clearDetail();
    void github.selectSectionRepo(p);
  }
  /** The registered repo id for the selected repo (for worktree-creating actions). */
  const selectedRepoId = () =>
    app.repos.find((r) => r.path === github.sectionRepoPath)?.id ?? null;

  // Section nav — one item per pane (Account/Session lives inside Settings now).
  const navItems = [
    { id: "overview", key: "github.nav.overview", icon: LayoutDashboardIcon },
    { id: "pulls", key: "github.nav.pulls", icon: GitPullRequestIcon },
    { id: "issues", key: "github.nav.issues", icon: CircleDotIcon },
    { id: "actions", key: "github.nav.actions", icon: PlayIcon },
    { id: "settings", key: "github.nav.settings", icon: SettingsIcon },
  ] as const;

  function close() {
    app.githubOpen = false;
  }
  function onKeyDown(e: KeyboardEvent) {
    if (e.key === "Escape" && app.githubOpen) {
      e.preventDefault();
      // If a detail view is open, go back to its list first.
      if (prDetail || issueDetail || runLog !== null || prError || issueError) {
        clearDetail();
      } else {
        close();
      }
    }
  }

  // --- data loading per pane ------------------------------------------------
  let prState = $state("open");
  let issueState = $state("open");
  let runsBranchOnly = $state(false);
  let busy = $state(false);

  function clearDetail() {
    prDetail = null;
    prDiff = "";
    prError = null;
    issueDetail = null;
    issueError = null;
    runLog = null;
    runError = null;
  }

  /** Navigate to a pane: clear any open detail first, then switch. */
  function goto(section: GithubSection) {
    clearDetail();
    app.githubSection = section;
  }

  function loadPane(pane: GithubSection) {
    if (pane === "pulls") void github.loadPrs(prState);
    else if (pane === "issues") void github.loadIssues(issueState);
    else if (pane === "actions") void github.loadRuns(runsBranchOnly);
  }

  // Refresh status + pick a default repo when the section opens (once).
  $effect(() => {
    if (!app.githubOpen) return;
    clearDetail();
    void github.refreshStatus();
    void github.refreshRateLimit();
    github.ensureSectionRepo();
  });
  // Load the active pane's list when the pane, the SELECTED REPO, availability or a
  // filter changes. NOTE: no `clearDetail()` here — detail state is owned by
  // `goto()` / the item handlers, so a poll can never wipe an open detail.
  $effect(() => {
    if (!app.githubOpen || !github.available) return;
    void app.githubSection;
    void github.sectionRepoPath;
    void prState;
    void issueState;
    void runsBranchOnly;
    loadPane(app.githubSection);
  });

  function doRefresh() {
    void github.refreshStatus();
    void github.refreshRateLimit();
    void github.loadSectionContext();
    loadPane(app.githubSection);
  }

  // --- Pull requests --------------------------------------------------------
  let prDetail = $state<PrDetail | null>(null);
  let prDiff = $state("");
  let prDiffLoading = $state(false);
  let prLoading = $state(false);
  let prError = $state<string | null>(null);
  let reviewBody = $state("");
  let mergeMethod = $state<"merge" | "squash" | "rebase">("squash");
  let deleteBranch = $state(true);
  let mergeConfirmOpen = $state(false);
  let selectedPrNumber = $state<number | null>(null);
  let commentBody = $state("");
  let commitsOpen = $state(false);
  // Which per-file diffs are expanded (path → true). All collapsed by default; the
  // DiffView for a file is only rendered while expanded (lazy, so a huge PR is cheap).
  let expandedFiles = $state<Record<string, boolean>>({});
  // The PR diff split into one chunk per file (reuses the commit-diff splitter).
  const prFiles = $derived(prDiff.trim() ? splitCommitDiff(prDiff) : []);

  function toggleFile(path: string) {
    expandedFiles = { ...expandedFiles, [path]: !expandedFiles[path] };
  }
  function setAllFiles(open: boolean) {
    const next: Record<string, boolean> = {};
    for (const f of prFiles) next[f.path] = open;
    expandedFiles = next;
  }

  async function postComment() {
    const p = path();
    if (!p || !prDetail || !commentBody.trim()) return;
    busy = true;
    try {
      await githubPrComment(p, String(prDetail.number), commentBody.trim());
      commentBody = "";
      toast.success(i18n.t("github.toast.commented"));
      await selectPr(prDetail.number);
    } catch (e) {
      toastError(e);
    } finally {
      busy = false;
    }
  }

  async function selectPr(n: number) {
    const p = path();
    if (!p) return;
    selectedPrNumber = n;
    prLoading = true;
    prDetail = null;
    prDiff = "";
    prError = null;
    prDiffLoading = true;
    expandedFiles = {};
    commitsOpen = false;
    commentBody = "";
    // 1) The PR overview (metadata + checks + files) — shown as soon as it lands.
    try {
      prDetail = await githubPrView(p, String(n));
    } catch (e) {
      prError = errText(e);
      prLoading = false;
      prDiffLoading = false;
      return;
    }
    prLoading = false;
    // 2) The diff, loaded separately so a large/slow diff never blocks the view.
    try {
      prDiff = await githubPrDiff(p, String(n));
    } catch {
      prDiff = "";
    } finally {
      prDiffLoading = false;
    }
  }

  async function submitReview(verb: "approve" | "request-changes" | "comment") {
    const p = path();
    if (!p || !prDetail) return;
    busy = true;
    try {
      await githubPrReview(p, String(prDetail.number), verb, reviewBody.trim() || null);
      reviewBody = "";
      toast.success(i18n.t("github.toast.reviewSubmitted"));
      await selectPr(prDetail.number);
    } catch (e) {
      toastError(e);
    } finally {
      busy = false;
    }
  }

  function requestMerge() {
    if (!prDetail) return;
    if (app.settings.github?.confirmPr ?? true) mergeConfirmOpen = true;
    else void mergePr();
  }

  async function mergePr(): Promise<boolean> {
    const p = path();
    if (!p || !prDetail) return false;
    busy = true;
    try {
      await githubPrMerge(p, String(prDetail.number), mergeMethod, deleteBranch);
      toast.success(i18n.t("github.toast.prMerged"));
      clearDetail();
      await github.loadPrs(prState);
      return true;
    } catch (e) {
      toastError(e);
      return false;
    } finally {
      busy = false;
    }
  }

  async function checkoutPr(n: number) {
    const repoId = selectedRepoId();
    if (!repoId) return;
    busy = true;
    try {
      const entry = await githubPrCheckout(repoId, String(n));
      await projects.loadWorktrees(repoId);
      projects.setActiveWorktree(entry.path);
      toast.success(i18n.t("github.toast.checkedOut"));
      close();
    } catch (e) {
      toastError(e);
    } finally {
      busy = false;
    }
  }

  // Create PR — the form itself lives in the reusable CreatePrForm component
  // (title + body, manual or AI-drafted, confirm-gated). This just toggles it.
  let showCreatePr = $state(false);

  // --- Issues ---------------------------------------------------------------
  let issueDetail = $state<IssueDetail | null>(null);
  let issueLoading = $state(false);
  let issueError = $state<string | null>(null);
  let selectedIssueNumber = $state<number | null>(null);
  let showCreateIssue = $state(false);
  let newIssueTitle = $state("");
  let newIssueBody = $state("");
  let issueCommentBody = $state("");

  function selectedIssueRetry() {
    if (selectedIssueNumber) void selectIssue(selectedIssueNumber);
  }

  async function postIssueComment() {
    const p = path();
    if (!p || !issueDetail || !issueCommentBody.trim()) return;
    busy = true;
    try {
      await githubIssueComment(p, String(issueDetail.number), issueCommentBody.trim());
      issueCommentBody = "";
      toast.success(i18n.t("github.toast.commented"));
      await selectIssue(issueDetail.number);
    } catch (e) {
      toastError(e);
    } finally {
      busy = false;
    }
  }

  async function selectIssue(n: number) {
    const p = path();
    if (!p) return;
    selectedIssueNumber = n;
    issueLoading = true;
    issueDetail = null;
    issueError = null;
    issueCommentBody = "";
    try {
      issueDetail = await githubIssueView(p, String(n));
    } catch (e) {
      issueError = errText(e);
    } finally {
      issueLoading = false;
    }
  }

  async function createIssue() {
    const p = path();
    if (!p || !newIssueTitle.trim()) return;
    busy = true;
    try {
      const url = await githubIssueCreate(p, newIssueTitle.trim(), newIssueBody);
      toast.success(i18n.t("github.toast.issueCreated"));
      showCreateIssue = false;
      newIssueTitle = "";
      newIssueBody = "";
      await github.loadIssues(issueState);
      if (url) void openExternal(url);
    } catch (e) {
      toastError(e);
    } finally {
      busy = false;
    }
  }

  async function developIssue(n: number) {
    const repoId = selectedRepoId();
    if (!repoId) return;
    busy = true;
    try {
      const entry = await githubIssueDevelop(repoId, String(n));
      await projects.loadWorktrees(repoId);
      projects.setActiveWorktree(entry.path);
      toast.success(i18n.t("github.toast.branchCreated"));
      close();
    } catch (e) {
      toastError(e);
    } finally {
      busy = false;
    }
  }

  // --- Actions --------------------------------------------------------------
  let runLog = $state<string | null>(null);
  let runLogLoading = $state(false);
  let runError = $state<string | null>(null);
  let selectedRunId = $state<number | null>(null);
  let selectedRunTitle = $state("");

  async function viewRunLog(id: number, title: string) {
    const p = path();
    if (!p) return;
    selectedRunId = id;
    selectedRunTitle = title;
    runLogLoading = true;
    runLog = "";
    runError = null;
    try {
      runLog = await githubRunLog(p, String(id), false);
    } catch (e) {
      runError = errText(e);
    } finally {
      runLogLoading = false;
    }
  }

  async function rerunRun(id: number, failed: boolean) {
    const p = path();
    if (!p) return;
    busy = true;
    try {
      await githubRunRerun(p, String(id), failed);
      toast.success(i18n.t("github.toast.rerun"));
    } catch (e) {
      toastError(e);
    } finally {
      busy = false;
    }
  }

  async function cancelRun(id: number) {
    const p = path();
    if (!p) return;
    busy = true;
    try {
      await githubRunCancel(p, String(id));
      toast.success(i18n.t("github.toast.cancelled"));
      await github.loadRuns(runsBranchOnly);
    } catch (e) {
      toastError(e);
    } finally {
      busy = false;
    }
  }

  // Whether a detail view (PR / issue / run log) is open — hides the repo bar.
  const detailOpen = $derived(
    !!(prDetail || prLoading || prError || issueDetail || issueLoading || issueError) ||
      runLog !== null ||
      !!runError,
  );

  // --- Settings pane: AI agent/model pickers --------------------------------
  let aiAgents = $state<string[]>([]);
  let aiModels = $state<{ value: string; label: string }[]>([]);

  async function loadAiAgents() {
    try {
      aiAgents = await aiCommitAgents();
    } catch {
      aiAgents = [];
    }
    const agent = app.settings.github?.aiAgentId;
    if (agent) void loadAiModels(agent);
  }
  async function loadAiModels(agent: string) {
    try {
      const models = await aiCommitModels(agent);
      aiModels = models.map((m) => ({ value: m.id, label: m.displayName ?? m.id }));
    } catch {
      aiModels = [];
    }
  }
  $effect(() => {
    if (app.githubOpen && app.githubSection === "settings") void loadAiAgents();
  });

  function ensureGithub() {
    if (!app.settings.github) app.settings.github = {};
    return app.settings.github;
  }
  function persist() {
    void app.persistSettings();
  }

  function stateFilterGroups(kind: "pr" | "issue") {
    const base =
      kind === "pr"
        ? [
            { value: "open", label: i18n.t("github.pr.open") },
            { value: "closed", label: i18n.t("github.pr.closed") },
            { value: "merged", label: i18n.t("github.pr.merged") },
            { value: "all", label: i18n.t("github.pr.all") },
          ]
        : [
            { value: "open", label: i18n.t("github.pr.open") },
            { value: "closed", label: i18n.t("github.pr.closed") },
            { value: "all", label: i18n.t("github.pr.all") },
          ];
    return [{ items: base }];
  }

  // --- shared visual helpers ------------------------------------------------
  function checkDotClass(state: string): string {
    if (state === "success") return "bg-emerald-500";
    if (state === "failure") return "bg-red-500";
    if (state === "pending") return "bg-amber-500";
    return "bg-muted-foreground/50";
  }
  function checkTextClass(state: string): string {
    if (state === "success") return "text-emerald-600 dark:text-emerald-400";
    if (state === "failure") return "text-red-600 dark:text-red-400";
    if (state === "pending") return "text-amber-600 dark:text-amber-400";
    return "text-muted-foreground";
  }
  function reviewTone(decision: string | null): "ok" | "warn" | "muted" {
    if (decision === "APPROVED") return "ok";
    if (decision === "CHANGES_REQUESTED") return "warn";
    return "muted";
  }
  function prettyDecision(decision: string | null): string {
    if (!decision) return "";
    return decision
      .toLowerCase()
      .split("_")
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ");
  }
  // State pill (colored by lifecycle): draft=muted, open=green, merged=purple, closed=red.
  function stateTone(state: string, isDraft: boolean): "ok" | "warn" | "merged" | "muted" {
    if (isDraft) return "muted";
    const s = state.toUpperCase();
    if (s === "OPEN") return "ok";
    if (s === "MERGED") return "merged";
    if (s === "CLOSED") return "warn";
    return "muted";
  }
  function stateLabel(state: string, isDraft: boolean): string {
    if (isDraft) return i18n.t("github.pr.stateDraft");
    const s = state.toUpperCase();
    if (s === "MERGED") return i18n.t("github.pr.stateMerged");
    if (s === "CLOSED") return i18n.t("github.pr.stateClosed");
    return i18n.t("github.pr.stateOpen");
  }
  function reviewLabel(state: string): string {
    const s = state.toUpperCase();
    if (s === "APPROVED") return i18n.t("github.review.approved");
    if (s === "CHANGES_REQUESTED") return i18n.t("github.review.changesRequested");
    if (s === "DISMISSED") return i18n.t("github.review.dismissed");
    return i18n.t("github.review.commented");
  }
  function fileStatusLabel(status: string): string {
    if (status === "added") return i18n.t("github.file.added");
    if (status === "deleted") return i18n.t("github.file.deleted");
    if (status === "renamed") return i18n.t("github.file.renamed");
    return i18n.t("github.file.modified");
  }
  function fileStatusClass(status: string): string {
    if (status === "added") return "text-emerald-600 dark:text-emerald-400";
    if (status === "deleted") return "text-red-600 dark:text-red-400";
    if (status === "renamed") return "text-sky-600 dark:text-sky-400";
    return "text-amber-600 dark:text-amber-400";
  }
  /** Relative time from an ISO date (best-effort). */
  function ago(iso: string | null): string {
    if (!iso) return "";
    const ms = Date.parse(iso);
    if (Number.isNaN(ms)) return "";
    return relTime(ms, Date.now());
  }
  /** Conversation timeline: comments + reviews (with a verdict/body), oldest first. */
  function timeline(pr: PrDetail): { author: string | null; body: string; at: string | null; review?: string }[] {
    const items = [
      ...pr.comments.map((c) => ({ author: c.author, body: c.body, at: c.createdAt })),
      ...pr.reviews.map((r) => ({ author: r.author, body: r.body, at: r.submittedAt, review: r.state })),
    ];
    return items.sort((a, b) => Date.parse(a.at ?? "") - Date.parse(b.at ?? ""));
  }
  function errText(e: unknown): string {
    if (e && typeof e === "object" && "message" in e) return String((e as { message: unknown }).message);
    return String(e);
  }
</script>

<svelte:window onkeydown={onKeyDown} />

{#if app.githubOpen}
  <div class="flex h-full w-full flex-col bg-background text-foreground">
    <!-- Header: back + title, mirroring Settings (no leading icon). Right padding
         reserves the floating window controls' zone. -->
    <header
      data-tauri-drag-region
      class={cn("flex h-9 shrink-0 items-center gap-2 pl-3 pr-[140px]", divider.bottom)}
    >
      <Button
        variant="ghost"
        size="icon-sm"
        class={iconButton.action}
        aria-label={i18n.t("common.close")}
        onclick={close}
      >
        <ArrowLeftIcon class={icon.button} />
      </Button>
      <h1 class="text-sm font-semibold tracking-tight">{i18n.t("github.title")}</h1>
    </header>

    <div class="flex min-h-0 flex-1">
      <!-- Section nav: one persistent repository selector at the top (the scope for
           the whole section), then the panes. -->
      <nav
        class="scrollbar-sleek flex w-56 shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-border/60 p-2"
        aria-label={i18n.t("github.title")}
      >
        {#if github.available && github.sectionRepoOptions.length > 0}
          <div class="mb-2 flex flex-col gap-1 px-1">
            <div class="flex items-center justify-between px-1">
              <span class={cn(text.section)}>{i18n.t("github.repo")}</span>
              <button
                class="flex size-5 items-center justify-center rounded text-muted-foreground transition-colors hover:text-foreground"
                aria-label={i18n.t("github.refresh")}
                onclick={doRefresh}
              >
                <RefreshCwIcon class={cn("size-3", github.sectionContextLoading && "animate-spin")} />
              </button>
            </div>
            <Combobox
              value={github.sectionRepoPath ?? ""}
              groups={[{ items: github.sectionRepoOptions.map((r) => ({ value: r.path, label: r.name, keywords: [r.path] })) }]}
              triggerClass="w-full"
              searchPlaceholder={i18n.t("common.search")}
              onChange={switchRepo}
            />
          </div>
          <div class={cn("mb-1", divider.bottom)}></div>
        {/if}
        {#each navItems as item (item.id)}
          {@const Icon = item.icon}
          <button
            class={cn(
              "flex h-8 items-center gap-2 rounded-md px-2 text-left text-[13px] font-medium tracking-tight transition-colors",
              app.githubSection === item.id
                ? "bg-accent text-accent-foreground"
                : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
            )}
            onclick={() => goto(item.id)}
          >
            <Icon class={icon.button} />
            <span class="flex-1">{i18n.t(item.key)}</span>
            {#if item.id === "pulls" && github.sectionContext?.pr}
              <span class={cn("size-1.5 rounded-full", checkDotClass(github.sectionContext.pr.checks.state))}></span>
            {/if}
          </button>
        {/each}
      </nav>

      <!-- Content -->
      <div class="scrollbar-sleek min-h-0 flex-1 overflow-y-auto">
        {#if !github.available && dataPane}
          {@render gatePane()}
        {:else if github.available && dataPane && !github.sectionRepoPath}
          {@render noReposPane()}
        {:else}
          <div class="px-8 py-7">
            <div class="mx-auto w-full max-w-4xl pb-16">
              {#if app.githubSection === "overview"}
                {@render overviewPane()}
              {:else if app.githubSection === "pulls"}
                {@render pullsPane()}
              {:else if app.githubSection === "issues"}
                {@render issuesPane()}
              {:else if app.githubSection === "actions"}
                {@render actionsPane()}
              {:else if app.githubSection === "settings"}
                {@render settingsPane()}
              {/if}
            </div>
          </div>
        {/if}
      </div>
    </div>
  </div>
{/if}

<!-- ============================ reusable bits ============================ -->

{#snippet pill(label: string, tone: "ok" | "warn" | "info" | "muted" | "merged")}
  <span
    class={cn(
      "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium",
      tone === "ok" && "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
      tone === "warn" && "border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400",
      tone === "merged" && "border-purple-500/30 bg-purple-500/10 text-purple-600 dark:text-purple-400",
      tone === "info" && "border-border/60 bg-muted/60 text-foreground",
      tone === "muted" && "border-border/60 bg-muted/40 text-muted-foreground",
    )}
  >
    {label}
  </span>
{/snippet}

{#snippet emptyState(Icon: typeof PlusIcon, title: string, desc: string)}
  <div class="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border/60 px-6 py-12 text-center">
    <Icon class={cn(icon.empty, "text-muted-foreground/60")} />
    <p class={cn(text.subheading)}>{title}</p>
    <p class={cn("max-w-sm text-muted-foreground", text.meta)}>{desc}</p>
  </div>
{/snippet}

{#snippet detailError(message: string, back: () => void, retry: () => void)}
  <div class="flex flex-col items-center gap-3 rounded-xl border border-destructive/30 bg-destructive/5 px-6 py-10 text-center">
    <TriangleAlertIcon class={cn(icon.empty, "text-destructive/70")} />
    <p class={cn("max-w-md break-words text-destructive", text.body)}>{message}</p>
    <div class="flex gap-2">
      <Button variant="ghost" size="sm" onclick={back}>{i18n.t("common.back")}</Button>
      <Button variant="outline" size="sm" onclick={retry}>{i18n.t("github.refresh")}</Button>
    </div>
  </div>
{/snippet}

{#snippet loadingRow()}
  <div class={cn("flex items-center justify-center gap-2 py-10", text.meta)}>
    <RefreshCwIcon class="size-3.5 animate-spin" />
    {i18n.t("github.loading")}
  </div>
{/snippet}

<!-- ================================ panes ================================ -->

{#snippet gatePane()}
  <div class="flex h-full items-center justify-center p-8">
    <div class="w-full max-w-md rounded-xl border border-border/60 bg-card/50 px-8 py-10 text-center shadow-xs">
      <div class="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-muted">
        <GitPullRequestIcon class="size-6 text-muted-foreground" />
      </div>
      {#if github.status && !github.status.ghInstalled}
        <h2 class={cn("mb-2", text.heading)}>{i18n.t("github.notInstalled")}</h2>
        <p class={cn("text-muted-foreground", text.body)}>{i18n.t("github.notInstalledDesc")}</p>
      {:else}
        <h2 class={cn("mb-2", text.heading)}>{i18n.t("github.notSignedIn")}</h2>
        <p class={cn("text-muted-foreground", text.body)}>{i18n.t("github.notSignedInDesc")}</p>
      {/if}
      <Button variant="outline" size="sm" class="mt-5" onclick={doRefresh}>
        <RefreshCwIcon class={icon.button} />
        {i18n.t("github.refresh")}
      </Button>
    </div>
  </div>
{/snippet}

{#snippet noReposPane()}
  <div class="flex h-full items-center justify-center p-8">
    <div class="w-full max-w-md rounded-xl border border-border/60 bg-card/50 px-8 py-10 text-center shadow-xs">
      <div class="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-muted">
        <GitBranchIcon class="size-6 text-muted-foreground" />
      </div>
      <h2 class={cn("mb-2", text.heading)}>{i18n.t("github.noRepos")}</h2>
      <p class={cn("text-muted-foreground", text.body)}>{i18n.t("github.noReposDesc")}</p>
    </div>
  </div>
{/snippet}

{#snippet overviewPane()}
  <SettingsSection bare title={i18n.t("github.overview.title")} description={i18n.t("github.overview.desc")}>
    <div class="space-y-5">
      <!-- Active repository card -->
      <div class={cn("p-4", panel.card)}>
        <div class={cn("mb-3 flex items-center gap-1.5", text.section)}>
          <GitBranchIcon class="size-3.5" />
          {i18n.t("github.overview.repo")}
        </div>
        {#if github.sectionContext}
          <div class="flex items-center gap-2">
            <span class={cn("min-w-0 flex-1 truncate", text.title)}>{github.sectionContext.nameWithOwner}</span>
            {#if github.sectionContext.branch}
              <span class="inline-flex items-center gap-1 rounded-md bg-muted/70 px-2 py-0.5 font-mono text-[11px] text-muted-foreground">
                <GitBranchIcon class="size-3" />{github.sectionContext.branch}
              </span>
            {/if}
          </div>
          {#if github.sectionContext.pr}
            {@const pr = github.sectionContext.pr}
            <button
              class={cn("mt-3 flex w-full items-center gap-2.5 rounded-lg border border-border/50 p-3 text-left transition-colors hover:bg-accent/50")}
              onclick={() => { app.githubSection = "pulls"; void selectPr(pr.number); }}
            >
              <GitPullRequestIcon class={cn("size-4 shrink-0", pr.isDraft ? "text-muted-foreground" : "text-emerald-500")} />
              <div class="min-w-0 flex-1">
                <div class={cn("truncate", text.bodyStrong)}>{pr.title}</div>
                <div class={cn("truncate text-muted-foreground", text.meta)}>{i18n.t("github.panel.openPr", { n: pr.number })} · {pr.state}</div>
              </div>
              {#if pr.checks.total > 0}
                <span class={cn("inline-flex shrink-0 items-center gap-1.5", text.indicator, checkTextClass(pr.checks.state))}>
                  <span class={cn("size-2 rounded-full", checkDotClass(pr.checks.state))}></span>
                  {i18n.t("github.panel.checksPass", { passed: pr.checks.passed, total: pr.checks.total })}
                </span>
              {/if}
              <ChevronRightIcon class="size-4 shrink-0 text-muted-foreground/60" />
            </button>
          {:else}
            <div class="mt-3 flex items-center justify-between rounded-lg border border-dashed border-border/60 p-3">
              <span class={cn("text-muted-foreground", text.meta)}>{i18n.t("github.panel.noPr")}</span>
              <Button size="sm" variant="outline" onclick={() => goto("pulls")}>{i18n.t("github.panel.createPr")}</Button>
            </div>
          {/if}
        {:else}
          <div class={cn("text-muted-foreground", text.meta)}>{i18n.t("github.notARepo")}</div>
        {/if}
      </div>

      <!-- Quick nav -->
      <div class="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {@render navCard(GitPullRequestIcon, i18n.t("github.nav.pulls"), () => goto("pulls"))}
        {@render navCard(CircleDotIcon, i18n.t("github.nav.issues"), () => goto("issues"))}
        {@render navCard(PlayIcon, i18n.t("github.nav.actions"), () => goto("actions"))}
      </div>
    </div>
  </SettingsSection>
{/snippet}

{#snippet navCard(Icon: typeof PlayIcon, label: string, onClick: () => void)}
  <button
    class={cn("group flex items-center gap-3 p-3.5 text-left transition-colors hover:bg-accent/50", panel.card)}
    onclick={onClick}
  >
    <div class="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground group-hover:text-foreground">
      <Icon class="size-[18px]" />
    </div>
    <span class={cn("flex-1", text.bodyStrong)}>{label}</span>
    <ChevronRightIcon class="size-4 text-muted-foreground/50" />
  </button>
{/snippet}

{#snippet pullsPane()}
  {#if prDetail || prLoading || prError}
    {@render prDetailView()}
  {:else}
    <SettingsSection bare title={i18n.t("github.pr.title")} description={i18n.t("github.pr.desc")}>
      {#snippet headerAction()}
        <div class="flex items-center gap-2">
          <Combobox
            value={prState}
            groups={stateFilterGroups("pr")}
            triggerClass="w-36"
            onChange={(v) => { prState = v; void github.loadPrs(v); }}
          />
          <Button size="sm" onclick={() => (showCreatePr = !showCreatePr)}>
            <PlusIcon class={icon.button} />
            {i18n.t("github.pr.create")}
          </Button>
        </div>
      {/snippet}
      <div class="space-y-3">
        {#if showCreatePr}
          <CreatePrForm
            worktreePath={path()}
            defaultTitle={github.sectionContext?.branch ?? ""}
            onCreated={() => { showCreatePr = false; void github.loadPrs(prState); }}
            onCancel={() => (showCreatePr = false)}
          />
        {/if}
        {#if github.prsLoading}
          {@render loadingRow()}
        {:else if github.prs.length === 0}
          <div class="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border/60 px-6 py-12 text-center">
            <GitPullRequestIcon class={cn(icon.empty, "text-muted-foreground/60")} />
            <p class={cn(text.subheading)}>{prState === "open" ? i18n.t("github.pr.emptyOpen") : i18n.t("github.pr.empty")}</p>
            {#if prState !== "all"}
              <Button variant="outline" size="sm" onclick={() => { prState = "all"; void github.loadPrs("all"); }}>
                {i18n.t("github.viewAll")}
              </Button>
            {/if}
          </div>
        {:else}
          <div class={cn("divide-y divide-border/50 overflow-hidden", panel.card)}>
            {#each github.prs as pr (pr.number)}
              <button class="flex w-full items-center gap-3 px-3.5 py-2.5 text-left transition-colors hover:bg-accent/50" onclick={() => selectPr(pr.number)}>
                <GitPullRequestIcon class={cn("size-4 shrink-0", pr.isDraft ? "text-muted-foreground" : "text-emerald-500")} />
                <div class="min-w-0 flex-1">
                  <div class={cn("truncate", text.bodyStrong)}>{pr.title}</div>
                  <div class={cn("truncate text-muted-foreground", text.meta)}>
                    #{pr.number}{pr.author ? ` · ${pr.author}` : ""}{pr.headRefName ? ` · ${pr.headRefName}` : ""}
                  </div>
                </div>
                {#if pr.isDraft}
                  {@render pill(i18n.t("github.pr.draft"), "muted")}
                {/if}
                {#if pr.reviewDecision}
                  {@render pill(prettyDecision(pr.reviewDecision), reviewTone(pr.reviewDecision) === "ok" ? "ok" : reviewTone(pr.reviewDecision) === "warn" ? "warn" : "info")}
                {/if}
                <ChevronRightIcon class="size-4 shrink-0 text-muted-foreground/50" />
              </button>
            {/each}
          </div>
        {/if}
      </div>
    </SettingsSection>
  {/if}
{/snippet}

{#snippet prDetailView()}
  <div class="space-y-4">
    <button class={cn("flex items-center gap-1 text-muted-foreground transition-colors hover:text-foreground", text.meta)} onclick={clearDetail}>
      <ArrowLeftIcon class="size-3.5" /> {i18n.t("github.pr.title")}
    </button>
    {#if prLoading}
      {@render loadingRow()}
    {:else if prError}
      {@render detailError(prError, clearDetail, () => selectedPrNumber && selectPr(selectedPrNumber))}
    {:else if prDetail}
      {@const pr = prDetail}
      {@const isOpen = pr.state.toUpperCase() === "OPEN"}
      <!-- Title + state -->
      <div class="flex items-start gap-2.5">
        <GitPullRequestIcon class={cn("mt-0.5 size-5 shrink-0", pr.state.toUpperCase() === "MERGED" ? "text-purple-500" : isOpen && !pr.isDraft ? "text-emerald-500" : "text-muted-foreground")} />
        <div class="min-w-0 flex-1">
          <div class="flex flex-wrap items-center gap-2">
            <h2 class={cn(text.heading, "min-w-0 break-words")}>{pr.title}</h2>
            {@render pill(stateLabel(pr.state, pr.isDraft), stateTone(pr.state, pr.isDraft))}
          </div>
          <div class={cn("mt-1 text-muted-foreground", text.meta)}>
            #{pr.number}{pr.author ? ` · ${pr.author}` : ""}
            {#if pr.baseRefName && pr.headRefName}
              · <span class="font-mono">{pr.headRefName} → {pr.baseRefName}</span>
            {/if}
          </div>
        </div>
        <Button variant="ghost" size="icon-sm" class={iconButton.action} onclick={() => openExternal(pr.url)} aria-label={i18n.t("github.openOnGitHub")}>
          <ExternalLinkIcon class={icon.button} />
        </Button>
      </div>

      <!-- Summary pills -->
      <div class="flex flex-wrap items-center gap-1.5">
        {#if pr.reviewDecision}{@render pill(prettyDecision(pr.reviewDecision), reviewTone(pr.reviewDecision))}{/if}
        {#if pr.checksSummary.total > 0}{@render pill(i18n.t("github.panel.checksPass", { passed: pr.checksSummary.passed, total: pr.checksSummary.total }), pr.checksSummary.state === "success" ? "ok" : pr.checksSummary.state === "failure" ? "warn" : "info")}{/if}
        {@render pill(`+${pr.additions} −${pr.deletions}`, "info")}
        {@render pill(i18n.t("github.pr.commitsCount", { n: pr.commits.length }), "info")}
        {@render pill(i18n.t("github.pr.files", { n: pr.changedFiles }), "info")}
        {#each pr.labels.slice(0, 6) as label, li (li)}{@render pill(label, "muted")}{/each}
      </div>

      <!-- Reviewers -->
      {#if pr.reviewers.length > 0}
        <div class="flex flex-wrap items-center gap-2">
          <span class={cn("inline-flex items-center gap-1.5", text.section)}><UsersIcon class="size-3.5" />{i18n.t("github.pr.reviewers")}</span>
          {#each pr.reviewers as r, ri (ri)}{@render pill(r, "muted")}{/each}
        </div>
      {/if}

      <!-- Actions (only for an open PR; closed/merged shows a notice instead) -->
      {#if isOpen}
        <div class={cn("flex flex-wrap items-center gap-2 p-3", panel.card)}>
          <Combobox
            value={mergeMethod}
            groups={[{ items: [
              { value: "squash", label: i18n.t("github.pr.methodSquash") },
              { value: "merge", label: i18n.t("github.pr.methodMerge") },
              { value: "rebase", label: i18n.t("github.pr.methodRebase") },
            ] }]}
            triggerClass="w-52"
            onChange={(v) => (mergeMethod = v as typeof mergeMethod)}
          />
          <label class="flex items-center gap-1.5 text-[13px]">
            <Switch checked={deleteBranch} onCheckedChange={(v) => (deleteBranch = v)} />
            {i18n.t("github.pr.deleteBranch")}
          </label>
          <Button size="sm" disabled={busy} onclick={requestMerge}>{i18n.t("github.pr.merge")}</Button>
          <div class="flex-1"></div>
          <Button variant="outline" size="sm" disabled={busy} onclick={() => checkoutPr(pr.number)}>
            <GitBranchIcon class={icon.button} />
            {i18n.t("github.pr.checkout")}
          </Button>
        </div>

        <!-- Review composer -->
        <div class={cn("space-y-2 p-3", panel.card)}>
          <span class={cn(text.section)}>{i18n.t("github.pr.review")}</span>
          <Textarea placeholder={i18n.t("github.pr.reviewBody")} bind:value={reviewBody} rows={2} />
          <div class="flex gap-2">
            <Button variant="outline" size="sm" disabled={busy} class="gap-1 text-emerald-600 dark:text-emerald-400" onclick={() => submitReview("approve")}>
              <CheckIcon class="size-3.5" /> {i18n.t("github.pr.approve")}
            </Button>
            <Button variant="outline" size="sm" disabled={busy} class="gap-1 text-red-600 dark:text-red-400" onclick={() => submitReview("request-changes")}>
              <XIcon class="size-3.5" /> {i18n.t("github.pr.requestChanges")}
            </Button>
            <Button variant="outline" size="sm" disabled={busy || !reviewBody.trim()} onclick={() => submitReview("comment")}>
              {i18n.t("github.pr.comment")}
            </Button>
          </div>
        </div>
      {:else}
        <div class="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border/50 bg-muted/40 px-3.5 py-2.5">
          <span class={cn("text-muted-foreground", text.body)}>{i18n.t("github.pr.closedNotice", { state: stateLabel(pr.state, false) })}</span>
          <Button variant="outline" size="sm" disabled={busy} onclick={() => checkoutPr(pr.number)}>
            <GitBranchIcon class={icon.button} />
            {i18n.t("github.pr.checkout")}
          </Button>
        </div>
      {/if}

      <ConfirmDialog
        bind:open={mergeConfirmOpen}
        title={i18n.t("github.confirm.mergeTitle")}
        description={i18n.t("github.confirm.mergeDesc", { n: pr.number })}
        confirmLabel={i18n.t("github.pr.merge")}
        onconfirm={mergePr}
      />

      <!-- Conversation: description + comments + reviews, then a comment field -->
      <div class={cn("overflow-hidden", panel.card)}>
        <div class={cn("flex items-center gap-1.5 border-b border-border/50 px-3.5 py-2", text.section)}>
          <MessageSquareIcon class="size-3.5" />{i18n.t("github.pr.conversation")}
        </div>
        {#if pr.body.trim()}
          <div class="border-b border-border/50 px-3.5 py-3">
            <div class={cn("mb-1 flex items-center gap-2", text.meta)}>
              {#if pr.author}<span class="font-medium text-foreground">{pr.author}</span>{/if}
              {i18n.t("github.pr.description")}
            </div>
            <div class={cn("whitespace-pre-wrap", text.body)}>{pr.body}</div>
          </div>
        {/if}
        {#each timeline(pr) as item, ti (ti)}
          <div class="border-b border-border/50 px-3.5 py-3">
            <div class={cn("mb-1 flex flex-wrap items-center gap-2", text.meta)}>
              <span class="font-medium text-foreground">{item.author ?? "—"}</span>
              {#if item.review}{@render pill(reviewLabel(item.review), reviewTone(item.review))}{/if}
              {#if item.at}<span>{ago(item.at)}</span>{/if}
            </div>
            {#if item.body.trim()}<div class={cn("whitespace-pre-wrap", text.body)}>{item.body}</div>{/if}
          </div>
        {/each}
        {#if !pr.body.trim() && timeline(pr).length === 0}
          <p class={cn("px-3.5 py-4 text-muted-foreground", text.meta)}>{i18n.t("github.pr.noComments")}</p>
        {/if}
        <div class="space-y-2 p-3">
          <Textarea placeholder={i18n.t("github.pr.commentPlaceholder")} bind:value={commentBody} rows={2} />
          <div class="flex justify-end">
            <Button size="sm" disabled={busy || !commentBody.trim()} onclick={postComment}>{i18n.t("github.pr.postComment")}</Button>
          </div>
        </div>
      </div>

      <!-- Commits (collapsible) -->
      {#if pr.commits.length > 0}
        <div class={cn("overflow-hidden", panel.card)}>
          <button class={cn("flex w-full items-center gap-1.5 px-3.5 py-2 text-left transition-colors hover:bg-accent/40", text.section)} onclick={() => (commitsOpen = !commitsOpen)}>
            {#if commitsOpen}<ChevronDownIcon class="size-3.5" />{:else}<ChevronRightIcon class="size-3.5" />{/if}
            <GitCommitIcon class="size-3.5" />
            {i18n.t("github.pr.commitsCount", { n: pr.commits.length })}
          </button>
          {#if commitsOpen}
            <div class="divide-y divide-border/50 border-t border-border/50">
              {#each pr.commits as c, cmi (cmi)}
                <div class="flex items-center gap-2.5 px-3.5 py-2">
                  <span class="shrink-0 rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">{c.oid.slice(0, 7)}</span>
                  <span class={cn("min-w-0 flex-1 truncate", text.body)}>{c.message}</span>
                  {#if c.author}<span class={cn("shrink-0 text-muted-foreground", text.indicator)}>{c.author}</span>{/if}
                  {#if c.committedAt}<span class={cn("shrink-0 text-muted-foreground", text.indicator)}>{ago(c.committedAt)}</span>{/if}
                </div>
              {/each}
            </div>
          {/if}
        </div>
      {/if}

      <!-- Checks -->
      {#if pr.checks.length > 0}
        <div class={cn("overflow-hidden", panel.card)}>
          <div class={cn("flex items-center gap-1.5 border-b border-border/50 px-3.5 py-2", text.section)}>
            <span class={cn("size-2 rounded-full", checkDotClass(pr.checksSummary.state))}></span>
            {i18n.t("github.pr.checks")}
          </div>
          <div class="divide-y divide-border/50">
            <!-- Index key: matrix CI can emit multiple checks with the SAME name
                 (e.g. `pr-comment-on-failure`), which would crash a name-keyed each. -->
            {#each pr.checks as c, ci (ci)}
              <div class="flex items-center gap-2 px-3.5 py-2">
                <span class={cn("size-2 shrink-0 rounded-full", c.bucket === "pass" ? "bg-emerald-500" : c.bucket === "fail" ? "bg-red-500" : c.bucket === "pending" ? "bg-amber-500" : "bg-muted-foreground/50")}></span>
                <span class={cn("min-w-0 flex-1 truncate", text.body)}>{c.name}</span>
                {#if c.workflow}<span class={cn("shrink-0 truncate text-muted-foreground", text.indicator)}>{c.workflow}</span>{/if}
                {#if c.link}
                  <Button variant="ghost" size="icon-sm" class={iconButton.xs} onclick={() => c.link && openExternal(c.link)} aria-label={i18n.t("github.openOnGitHub")}>
                    <ExternalLinkIcon class="size-3" />
                  </Button>
                {/if}
              </div>
            {/each}
          </div>
        </div>
      {/if}

      <!-- Files changed: one collapsible diff per file (collapsed by default; each
           DiffView renders only while expanded, so a huge PR stays cheap). -->
      <div class={cn("overflow-hidden", panel.card)}>
        <div class="flex flex-wrap items-center justify-between gap-2 border-b border-border/50 px-3.5 py-2">
          <span class={cn(text.section)}>
            {i18n.t("github.pr.filesChanged")} · {pr.changedFiles} · <span class="text-emerald-600 dark:text-emerald-400">+{pr.additions}</span> <span class="text-red-600 dark:text-red-400">−{pr.deletions}</span>
          </span>
          {#if prFiles.length > 1}
            <div class="flex gap-1">
              <Button variant="ghost" size="sm" class="h-6" onclick={() => setAllFiles(true)}>{i18n.t("github.pr.expandAll")}</Button>
              <Button variant="ghost" size="sm" class="h-6" onclick={() => setAllFiles(false)}>{i18n.t("github.pr.collapseAll")}</Button>
            </div>
          {/if}
        </div>
        {#if prDiffLoading}
          {@render loadingRow()}
        {:else if prFiles.length === 0}
          <p class={cn("px-3.5 py-4", text.meta)}>{i18n.t("github.none")}</p>
        {:else}
          <div class="divide-y divide-border/50">
            {#each prFiles as f, fi (fi)}
              <div>
                <button class="flex w-full items-center gap-2 px-3.5 py-2 text-left transition-colors hover:bg-accent/40" onclick={() => toggleFile(f.path)}>
                  {#if expandedFiles[f.path]}
                    <ChevronDownIcon class="size-3.5 shrink-0 text-muted-foreground" />
                  {:else}
                    <ChevronRightIcon class="size-3.5 shrink-0 text-muted-foreground" />
                  {/if}
                  <FileDiffIcon class="size-3.5 shrink-0 text-muted-foreground" />
                  <span class="min-w-0 flex-1 truncate font-mono text-[12px]">{f.path}</span>
                  <span class={cn("shrink-0", text.indicator, fileStatusClass(f.status))}>{fileStatusLabel(f.status)}</span>
                </button>
                {#if expandedFiles[f.path]}
                  <div class="max-h-[70vh] overflow-auto border-t border-border/50 p-2">
                    <svelte:boundary>
                      <DiffView diff={f.diff} />
                      {#snippet failed()}
                        <div class="p-3 text-center">
                          <p class={cn("text-muted-foreground", text.meta)}>{i18n.t("github.diffError")}</p>
                          <Button variant="outline" size="sm" class="mt-2" onclick={() => openExternal(pr.url)}>
                            <ExternalLinkIcon class={icon.button} />
                            {i18n.t("github.openOnGitHub")}
                          </Button>
                        </div>
                      {/snippet}
                    </svelte:boundary>
                  </div>
                {/if}
              </div>
            {/each}
          </div>
        {/if}
      </div>
    {/if}
  </div>
{/snippet}

{#snippet issuesPane()}
  {#if issueDetail || issueLoading || issueError}
    {@render issueDetailView()}
  {:else}
    <SettingsSection bare title={i18n.t("github.issue.title")} description={i18n.t("github.issue.desc")}>
      {#snippet headerAction()}
        <div class="flex items-center gap-2">
          <Combobox
            value={issueState}
            groups={stateFilterGroups("issue")}
            triggerClass="w-36"
            onChange={(v) => { issueState = v; void github.loadIssues(v); }}
          />
          <Button size="sm" onclick={() => (showCreateIssue = !showCreateIssue)}>
            <PlusIcon class={icon.button} />
            {i18n.t("github.issue.create")}
          </Button>
        </div>
      {/snippet}
      <div class="space-y-3">
        {#if showCreateIssue}
          <div class={cn("space-y-2 p-3", panel.card)}>
            <Input placeholder={i18n.t("github.pr.titleLabel")} bind:value={newIssueTitle} />
            <Textarea placeholder={i18n.t("github.pr.bodyLabel")} bind:value={newIssueBody} rows={4} />
            <div class="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onclick={() => (showCreateIssue = false)}>{i18n.t("common.cancel")}</Button>
              <Button size="sm" disabled={busy || !newIssueTitle.trim()} onclick={createIssue}>{i18n.t("github.issue.create")}</Button>
            </div>
          </div>
        {/if}
        {#if github.issuesLoading}
          {@render loadingRow()}
        {:else if github.issues.length === 0}
          <div class="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border/60 px-6 py-12 text-center">
            <CircleDotIcon class={cn(icon.empty, "text-muted-foreground/60")} />
            <p class={cn(text.subheading)}>{issueState === "open" ? i18n.t("github.issue.emptyOpen") : i18n.t("github.issue.empty")}</p>
            {#if issueState !== "all"}
              <Button variant="outline" size="sm" onclick={() => { issueState = "all"; void github.loadIssues("all"); }}>
                {i18n.t("github.viewAll")}
              </Button>
            {/if}
          </div>
        {:else}
          <div class={cn("divide-y divide-border/50 overflow-hidden", panel.card)}>
            {#each github.issues as issue (issue.number)}
              <button class="flex w-full items-center gap-3 px-3.5 py-2.5 text-left transition-colors hover:bg-accent/50" onclick={() => selectIssue(issue.number)}>
                <CircleDotIcon class="size-4 shrink-0 text-emerald-500" />
                <div class="min-w-0 flex-1">
                  <div class={cn("truncate", text.bodyStrong)}>{issue.title}</div>
                  <div class={cn("truncate text-muted-foreground", text.meta)}>
                    #{issue.number}{issue.author ? ` · ${issue.author}` : ""}{issue.comments ? ` · ${i18n.t("github.issue.comments", { n: issue.comments })}` : ""}
                  </div>
                </div>
                {#each issue.labels.slice(0, 3) as label (label)}{@render pill(label, "muted")}{/each}
                <ChevronRightIcon class="size-4 shrink-0 text-muted-foreground/50" />
              </button>
            {/each}
          </div>
        {/if}
      </div>
    </SettingsSection>
  {/if}
{/snippet}

{#snippet issueDetailView()}
  <div class="space-y-4">
    <button class={cn("flex items-center gap-1 text-muted-foreground transition-colors hover:text-foreground", text.meta)} onclick={clearDetail}>
      <ArrowLeftIcon class="size-3.5" /> {i18n.t("github.issue.title")}
    </button>
    {#if issueLoading}
      {@render loadingRow()}
    {:else if issueError}
      {@render detailError(issueError, clearDetail, () => selectedIssueRetry())}
    {:else if issueDetail}
      {@const issue = issueDetail}
      {@const issueOpen = issue.state.toUpperCase() === "OPEN"}
      <div class="flex items-start gap-2.5">
        {#if issueOpen}
          <CircleDotIcon class="mt-0.5 size-5 shrink-0 text-emerald-500" />
        {:else}
          <CheckCircle2Icon class="mt-0.5 size-5 shrink-0 text-purple-500" />
        {/if}
        <div class="min-w-0 flex-1">
          <h2 class={cn(text.heading, "break-words")}>{issue.title}</h2>
          <div class="mt-1.5 flex flex-wrap items-center gap-1.5">
            {@render pill(
              issueOpen ? i18n.t("github.issue.stateOpen") : i18n.t("github.issue.stateClosed"),
              issueOpen ? "ok" : "merged",
            )}
            <span class={cn("text-muted-foreground", text.meta)}>#{issue.number}{issue.author ? ` · ${issue.author}` : ""}</span>
          </div>
        </div>
        <Button variant="outline" size="sm" disabled={busy} onclick={() => developIssue(issue.number)}>
          <GitBranchIcon class={icon.button} />
          {i18n.t("github.issue.startWork")}
        </Button>
        <Button variant="ghost" size="icon-sm" class={iconButton.action} onclick={() => openExternal(issue.url)} aria-label={i18n.t("github.openOnGitHub")}>
          <ExternalLinkIcon class={icon.button} />
        </Button>
      </div>
      {#if issue.labels.length > 0}
        <div class="flex flex-wrap gap-1.5">
          {#each issue.labels as label (label)}{@render pill(label, "muted")}{/each}
        </div>
      {/if}

      <!-- Conversation: description + comments, then a comment field -->
      <div class={cn("overflow-hidden", panel.card)}>
        <div class={cn("flex items-center gap-1.5 border-b border-border/50 px-3.5 py-2", text.section)}>
          <MessageSquareIcon class="size-3.5" />{i18n.t("github.pr.conversation")}
        </div>
        {#if issue.body.trim()}
          <div class="border-b border-border/50 px-3.5 py-3">
            <div class={cn("mb-1 flex items-center gap-2", text.meta)}>
              {#if issue.author}<span class="font-medium text-foreground">{issue.author}</span>{/if}
              {i18n.t("github.pr.description")}
            </div>
            <div class={cn("whitespace-pre-wrap", text.body)}>{issue.body}</div>
          </div>
        {/if}
        {#each issue.comments as c, ci (ci)}
          <div class="border-b border-border/50 px-3.5 py-3">
            <div class={cn("mb-1 flex flex-wrap items-center gap-2", text.meta)}>
              <span class="font-medium text-foreground">{c.author ?? "—"}</span>
              {#if c.createdAt}<span>{ago(c.createdAt)}</span>{/if}
            </div>
            {#if c.body.trim()}<div class={cn("whitespace-pre-wrap", text.body)}>{c.body}</div>{/if}
          </div>
        {/each}
        {#if !issue.body.trim() && issue.comments.length === 0}
          <p class={cn("px-3.5 py-4 text-muted-foreground", text.meta)}>{i18n.t("github.pr.noComments")}</p>
        {/if}
        <div class="space-y-2 p-3">
          <Textarea placeholder={i18n.t("github.pr.commentPlaceholder")} bind:value={issueCommentBody} rows={2} />
          <div class="flex justify-end">
            <Button size="sm" disabled={busy || !issueCommentBody.trim()} onclick={postIssueComment}>{i18n.t("github.pr.postComment")}</Button>
          </div>
        </div>
      </div>
    {/if}
  </div>
{/snippet}

{#snippet actionsPane()}
  {#if runLog !== null || runError}
    <div class="space-y-3">
      <button class={cn("flex items-center gap-1 text-muted-foreground transition-colors hover:text-foreground", text.meta)} onclick={clearDetail}>
        <ArrowLeftIcon class="size-3.5" /> {i18n.t("github.actions.title")}
      </button>
      {#if selectedRunTitle}<h2 class={cn(text.subheading, "truncate")}>{selectedRunTitle}</h2>{/if}
      {#if selectedRunId}
        <div class="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" disabled={busy} onclick={() => selectedRunId && rerunRun(selectedRunId, false)}>{i18n.t("github.actions.rerun")}</Button>
          <Button variant="outline" size="sm" disabled={busy} onclick={() => selectedRunId && rerunRun(selectedRunId, true)}>{i18n.t("github.actions.rerunFailed")}</Button>
          <Button variant="outline" size="sm" disabled={busy} onclick={() => selectedRunId && cancelRun(selectedRunId)}>{i18n.t("github.actions.cancel")}</Button>
        </div>
      {/if}
      {#if runLogLoading}
        {@render loadingRow()}
      {:else if runError}
        {@render detailError(runError, clearDetail, () => selectedRunId && viewRunLog(selectedRunId, selectedRunTitle))}
      {:else}
        <pre class="scrollbar-sleek max-h-[70vh] overflow-auto rounded-xl border border-border/50 bg-[var(--ux-editor-surface,var(--ux-panel))] p-3.5 font-mono text-[12px] leading-relaxed text-foreground">{runLog}</pre>
      {/if}
    </div>
  {:else}
    <SettingsSection bare title={i18n.t("github.actions.title")} description={i18n.t("github.actions.desc")}>
      {#snippet headerAction()}
        <label class="flex items-center gap-2 text-[13px] text-muted-foreground">
          <Switch checked={runsBranchOnly} onCheckedChange={(v) => { runsBranchOnly = v; void github.loadRuns(v); }} />
          {i18n.t("github.actions.branchOnly")}
        </label>
      {/snippet}
      <div class="space-y-3">
        {#if github.runsLoading}
          {@render loadingRow()}
        {:else if github.runs.length === 0}
          {@render emptyState(PlayIcon, i18n.t("github.actions.empty"), i18n.t("github.actions.desc"))}
        {:else}
          <div class={cn("divide-y divide-border/50 overflow-hidden", panel.card)}>
            {#each github.runs as run (run.databaseId)}
              <div class="flex items-center gap-3 px-3.5 py-2.5">
                <span
                  class={cn("size-2.5 shrink-0 rounded-full", run.conclusion === "success" ? "bg-emerald-500" : run.conclusion === "failure" || run.conclusion === "cancelled" ? "bg-red-500" : run.status === "completed" ? "bg-muted-foreground/50" : "bg-amber-500 animate-pulse")}
                ></span>
                <div class="min-w-0 flex-1">
                  <div class={cn("truncate", text.bodyStrong)}>{run.displayTitle || run.name}</div>
                  <div class={cn("truncate text-muted-foreground", text.meta)}>
                    {run.workflowName ?? run.name}{run.headBranch ? ` · ${run.headBranch}` : ""}{run.event ? ` · ${run.event}` : ""}
                  </div>
                </div>
                <Button variant="ghost" size="sm" onclick={() => viewRunLog(run.databaseId, run.displayTitle || run.name)}>{i18n.t("github.actions.viewLog")}</Button>
                <Button variant="ghost" size="icon-sm" class={iconButton.action} onclick={() => openExternal(run.url)} aria-label={i18n.t("github.openOnGitHub")}>
                  <ExternalLinkIcon class={icon.button} />
                </Button>
              </div>
            {/each}
          </div>
        {/if}
      </div>
    </SettingsSection>
  {/if}
{/snippet}

{#snippet settingsPane()}
  <div class="space-y-8">
    <!-- Account / Session (folded in from its own tab). -->
    <SettingsSection title={i18n.t("github.account.title")} description={i18n.t("github.account.desc")}>
    <SettingsRow label={i18n.t("github.account.status")}>
      {#snippet control()}
        <span class={cn("inline-flex items-center gap-1.5", text.body)}>
          <span class={cn("size-2 rounded-full", github.available ? "bg-emerald-500" : "bg-muted-foreground/50")}></span>
          {github.available ? i18n.t("github.account.connected") : i18n.t("github.account.disconnected")}
        </span>
      {/snippet}
    </SettingsRow>
    <SettingsRow label={i18n.t("github.account.cli")}>
      {#snippet control()}
        <span class={cn(text.body)}>{github.status?.ghInstalled ? i18n.t("github.account.installed") : i18n.t("github.account.missing")}</span>
      {/snippet}
    </SettingsRow>
    {#if github.status?.login}
      <SettingsRow label={i18n.t("github.account.signedInAs")}>
        {#snippet control()}
          <span class={cn("font-medium", text.body)}>{github.status?.login}</span>
        {/snippet}
      </SettingsRow>
    {/if}
    {#if github.status?.host}
      <SettingsRow label={i18n.t("github.account.host")}>
        {#snippet control()}
          <span class={cn("font-mono", text.body)}>{github.status?.host}</span>
        {/snippet}
      </SettingsRow>
    {/if}
    {#if github.status && github.status.scopes.length > 0}
      <SettingsRow label={i18n.t("github.account.scopes")}>
        {#snippet control()}
          <div class="flex flex-wrap justify-end gap-1">
            {#each github.status?.scopes ?? [] as scope (scope)}{@render pill(scope, "muted")}{/each}
          </div>
        {/snippet}
      </SettingsRow>
    {/if}
    {#if github.rateLimit}
      <SettingsRow label={i18n.t("github.account.rateLimit")}>
        {#snippet control()}
          <span class={cn(text.body)}>{i18n.t("github.account.rateLimitValue", { remaining: github.rateLimit?.remaining ?? 0, limit: github.rateLimit?.limit ?? 0 })}</span>
        {/snippet}
      </SettingsRow>
    {/if}
    {#if !github.available}
      <SettingsRow label={i18n.t("github.notSignedIn")}>
        {#snippet control()}
          <span class={cn("text-muted-foreground", text.meta)}>{i18n.t("github.account.signInHint")}</span>
        {/snippet}
      </SettingsRow>
    {/if}
    </SettingsSection>

    <SettingsSection title={i18n.t("github.settings.title")} description={i18n.t("github.settings.aiDesc")}>
    <SettingsRow label={i18n.t("github.settings.rightPanelTab")} description={i18n.t("github.settings.rightPanelTabDesc")}>
      {#snippet control()}
        <Switch
          checked={app.settings.github?.rightPanelTab ?? true}
          onCheckedChange={(v) => { ensureGithub().rightPanelTab = v; persist(); }}
        />
      {/snippet}
    </SettingsRow>
    <SettingsRow label={i18n.t("github.settings.statusBar")} description={i18n.t("github.settings.statusBarDesc")}>
      {#snippet control()}
        <Switch
          checked={app.settings.github?.statusBarEnabled ?? true}
          onCheckedChange={(v) => { ensureGithub().statusBarEnabled = v; persist(); }}
        />
      {/snippet}
    </SettingsRow>
    <SettingsRow label={i18n.t("github.settings.poll")} description={i18n.t("github.settings.pollDesc")}>
      {#snippet control()}
        <Input
          type="number"
          class="w-24"
          value={String(app.settings.github?.pollSeconds ?? 45)}
          onchange={(e) => { ensureGithub().pollSeconds = Math.max(0, Number((e.currentTarget as HTMLInputElement).value) || 0); persist(); github.startPolling(); }}
        />
      {/snippet}
    </SettingsRow>
    <SettingsRow label={i18n.t("github.settings.notifications")} description={i18n.t("github.settings.notificationsDesc")}>
      {#snippet control()}
        <Switch
          checked={app.settings.github?.notificationsEnabled ?? false}
          onCheckedChange={(v) => { ensureGithub().notificationsEnabled = v; persist(); if (v) void github.refreshNotifications(); }}
        />
      {/snippet}
    </SettingsRow>
    <SettingsRow label={i18n.t("github.settings.confirmPr")} description={i18n.t("github.settings.confirmPrDesc")}>
      {#snippet control()}
        <Switch
          checked={app.settings.github?.confirmPr ?? true}
          onCheckedChange={(v) => { ensureGithub().confirmPr = v; persist(); }}
        />
      {/snippet}
    </SettingsRow>
    <SettingsRow label={i18n.t("github.settings.aiAgent")} description={i18n.t("github.settings.aiDesc")}>
      {#snippet control()}
        <Combobox
          value={app.settings.github?.aiAgentId ?? ""}
          groups={[{ items: [
            { value: "", label: i18n.t("github.settings.aiNone") },
            ...aiAgents.map((a) => ({ value: a, label: a })),
          ] }]}
          triggerClass="w-48"
          onChange={(v) => { ensureGithub().aiAgentId = v || undefined; ensureGithub().aiModel = undefined; persist(); if (v) void loadAiModels(v); }}
        />
      {/snippet}
    </SettingsRow>
    {#if app.settings.github?.aiAgentId}
      <SettingsRow label={i18n.t("github.settings.aiModel")}>
        {#snippet control()}
          <Combobox
            value={app.settings.github?.aiModel ?? ""}
            groups={[{ items: [
              { value: "", label: i18n.t("github.settings.aiNone") },
              ...aiModels,
            ] }]}
            triggerClass="w-56"
            searchPlaceholder={i18n.t("common.search")}
            onChange={(v) => { ensureGithub().aiModel = v || undefined; persist(); }}
          />
        {/snippet}
      </SettingsRow>
    {/if}
    </SettingsSection>
  </div>
{/snippet}
