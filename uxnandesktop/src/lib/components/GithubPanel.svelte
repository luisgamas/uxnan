<script lang="ts">
  // Right-panel "GitHub" tab — a narrow, worktree-scoped view: the PR for the
  // active branch (with its checks roll-up + quick actions) and this branch's CI
  // runs. Anything bigger (review, diff, logs) opens the full GitHub section.
  import { app } from "$lib/state/app.svelte";
  import { github } from "$lib/state/github.svelte";
  import { projects } from "$lib/state/projects.svelte";
  import { i18n } from "$lib/i18n";
  import { cn } from "$lib/utils";
  import { icon, iconButton, text, surface } from "$lib/design";
  import { githubRunList, openExternal } from "$lib/api";
  import type { RunListItem } from "$lib/types";
  import { Button } from "$lib/components/ui/button";
  import CreatePrForm from "./CreatePrForm.svelte";
  import GitPullRequestIcon from "@lucide/svelte/icons/git-pull-request";
  import ExternalLinkIcon from "@lucide/svelte/icons/external-link";
  import RefreshCwIcon from "@lucide/svelte/icons/refresh-cw";
  import ArrowUpRightIcon from "@lucide/svelte/icons/arrow-up-right";

  let runs = $state<RunListItem[]>([]);
  let runsLoading = $state(false);
  let showCreate = $state(false);

  const ctx = $derived(github.context);

  async function loadRuns() {
    const p = projects.activeWorktreePath;
    if (!p || !github.available || !ctx?.branch) {
      runs = [];
      return;
    }
    runsLoading = true;
    try {
      runs = await githubRunList(p, ctx.branch, 5);
    } catch {
      runs = [];
    } finally {
      runsLoading = false;
    }
  }

  // Reload the branch runs whenever the worktree/branch changes.
  $effect(() => {
    void ctx?.branch;
    void loadRuns();
  });

  function checkColor(state: string): string {
    if (state === "success") return "text-emerald-500";
    if (state === "failure") return "text-red-500";
    if (state === "pending") return "text-amber-500";
    return "text-muted-foreground";
  }
  function runColor(run: RunListItem): string {
    if (run.conclusion === "success") return "bg-emerald-500";
    if (run.conclusion === "failure" || run.conclusion === "cancelled") return "bg-red-500";
    if (run.status === "completed") return "bg-muted-foreground";
    return "bg-amber-500 animate-pulse";
  }

  function openSection(section: "pulls" | "actions") {
    app.openGitHub(section);
  }
</script>

<div class="scrollbar-sleek flex h-full min-h-0 flex-col overflow-y-auto p-2">
  {#if !github.available}
    <!-- Not installed / not signed in -->
    <div class="flex flex-col items-center gap-2 px-3 py-8 text-center">
      <GitPullRequestIcon class="size-6 text-muted-foreground" />
      <p class={cn("text-muted-foreground", text.meta)}>
        {github.status && !github.status.ghInstalled ? i18n.t("github.notInstalled") : i18n.t("github.notSignedIn")}
      </p>
      <Button variant="outline" size="sm" onclick={() => app.openGitHub("settings")}>
        {i18n.t("github.open")}
      </Button>
    </div>
  {:else if !projects.activeWorktreePath}
    <!-- No active worktree — like the other right-panel tabs, this is empty until
         a project/worktree is selected. The full GitHub section works standalone. -->
    <div class="flex flex-col items-center gap-2 px-3 py-10 text-center">
      <GitPullRequestIcon class="size-6 text-muted-foreground/50" />
      <p class={cn("text-muted-foreground", text.meta)}>{i18n.t("github.panel.noWorktree")}</p>
      <Button variant="outline" size="sm" onclick={() => app.openGitHub()}>{i18n.t("github.open")}</Button>
    </div>
  {:else if !ctx}
    <div class="px-3 py-8 text-center">
      <p class={cn("text-muted-foreground", text.meta)}>{i18n.t("github.notARepo")}</p>
    </div>
  {:else}
    <!-- Repo + branch header -->
    <div class="flex items-center gap-1 px-1 pb-2">
      <span class={cn("min-w-0 flex-1 truncate", text.section)}>{ctx.nameWithOwner}</span>
      <Button variant="ghost" size="icon-sm" class={iconButton.xs} aria-label={i18n.t("github.refresh")} onclick={() => { void github.refreshContext(); void loadRuns(); }}>
        <RefreshCwIcon class="size-3" />
      </Button>
    </div>
    {#if ctx.branch}
      <div class={cn("mb-2 truncate px-1 text-muted-foreground", text.meta)}>
        {i18n.t("github.panel.branch")}: <span class="font-mono">{ctx.branch}</span>
      </div>
    {/if}

    <!-- PR card -->
    {#if ctx.pr}
      {@const pr = ctx.pr}
      <div class={cn("mb-3 rounded-lg p-2.5", surface.panel)}>
        <button
          class="flex w-full items-start gap-2 text-left"
          onclick={() => openSection("pulls")}
        >
          <GitPullRequestIcon class={cn("mt-0.5 size-4 shrink-0", pr.isDraft ? "text-muted-foreground" : "text-emerald-500")} />
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
          <Button variant="outline" size="sm" class="h-7 flex-1" onclick={() => openSection("pulls")}>
            {i18n.t("github.pr.review")}
          </Button>
          <Button variant="ghost" size="icon-sm" class={iconButton.action} aria-label={i18n.t("github.openOnGitHub")} onclick={() => openExternal(pr.url)}>
            <ExternalLinkIcon class="size-3.5" />
          </Button>
        </div>
      </div>
    {:else if showCreate}
      <div class="mb-3">
        <CreatePrForm
          worktreePath={projects.activeWorktreePath}
          defaultTitle={ctx.branch ?? ""}
          compact
          onCreated={() => (showCreate = false)}
          onCancel={() => (showCreate = false)}
        />
      </div>
    {:else}
      <div class={cn("mb-3 rounded-lg p-2.5 text-center", surface.panel)}>
        <p class={cn("mb-2 text-muted-foreground", text.meta)}>{i18n.t("github.panel.noPr")}</p>
        <Button size="sm" class="w-full" onclick={() => (showCreate = true)}>
          {i18n.t("github.panel.createPr")}
        </Button>
      </div>
    {/if}

    <!-- CI runs for this branch -->
    <div class="flex items-center gap-1 px-1 pb-1">
      <span class={cn("flex-1", text.section)}>{i18n.t("github.panel.runs")}</span>
      <Button variant="ghost" size="icon-sm" class={iconButton.xs} aria-label={i18n.t("github.nav.actions")} onclick={() => openSection("actions")}>
        <ArrowUpRightIcon class="size-3" />
      </Button>
    </div>
    {#if runsLoading}
      <p class={cn("px-1 py-2", text.meta)}>{i18n.t("github.loading")}</p>
    {:else if runs.length === 0}
      <p class={cn("px-1 py-2 text-muted-foreground", text.meta)}>{i18n.t("github.actions.empty")}</p>
    {:else}
      <div class="flex flex-col gap-px">
        {#each runs as run (run.databaseId)}
          <button class="flex items-center gap-2 rounded-md px-1.5 py-1.5 text-left hover:bg-accent/50" onclick={() => openExternal(run.url)}>
            <span class={cn("size-2 shrink-0 rounded-full", runColor(run))}></span>
            <div class="min-w-0 flex-1">
              <div class={cn("truncate", text.body)}>{run.displayTitle || run.name}</div>
              <div class={cn("truncate text-muted-foreground", text.indicator)}>{run.workflowName ?? run.name}</div>
            </div>
          </button>
        {/each}
      </div>
    {/if}
  {/if}
</div>
