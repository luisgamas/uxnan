// Shared GitHub list-item presentation: which icon and which tone a PR, issue or
// workflow run gets. Both surfaces that list them — the full inline section
// (`GitHub.svelte`) and the right-panel tab (`GithubPanel.svelte`) — read these,
// so a merged PR is purple in exactly one place and can't drift between the two.

import type { RunListItem } from "$lib/types";
import GitPullRequestIcon from "@lucide/svelte/icons/git-pull-request";
import GitPullRequestDraftIcon from "@lucide/svelte/icons/git-pull-request-draft";
import GitPullRequestClosedIcon from "@lucide/svelte/icons/git-pull-request-closed";
import GitMergeIcon from "@lucide/svelte/icons/git-merge";
import CircleDotIcon from "@lucide/svelte/icons/circle-dot";
import CheckCircle2Icon from "@lucide/svelte/icons/check-circle-2";

/** The icon for a PR's state (merged / closed / draft / open). */
export function prStateIcon(state: string, isDraft: boolean) {
  const s = state.toUpperCase();
  if (s === "MERGED") return GitMergeIcon;
  if (s === "CLOSED") return GitPullRequestClosedIcon;
  if (isDraft) return GitPullRequestDraftIcon;
  return GitPullRequestIcon;
}

/** The tone for that icon — GitHub's own colors. */
export function prStateIconClass(state: string, isDraft: boolean): string {
  const s = state.toUpperCase();
  if (s === "MERGED") return "text-purple-500";
  if (s === "CLOSED") return "text-red-500";
  if (isDraft) return "text-muted-foreground";
  return "text-emerald-500";
}

/** The icon for an issue's state (open / closed). */
export function issueStateIcon(state: string) {
  return state.toUpperCase() === "OPEN" ? CircleDotIcon : CheckCircle2Icon;
}

/** The tone for that icon. */
export function issueStateIconClass(state: string): string {
  return state.toUpperCase() === "OPEN" ? "text-emerald-500" : "text-purple-500";
}

/** The status dot for a workflow run. In-flight runs pulse; a completed run
 *  without a conclusion (e.g. skipped) stays neutral rather than claiming green. */
export function runDotClass(run: RunListItem): string {
  if (run.conclusion === "success") return "bg-emerald-500";
  if (run.conclusion === "failure" || run.conclusion === "cancelled") return "bg-red-500";
  if (run.status === "completed") return "bg-muted-foreground";
  return "bg-amber-500 animate-pulse";
}
