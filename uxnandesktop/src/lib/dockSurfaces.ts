// What the right dock's surfaces look like and what they signal — shared by
// the dock's selector and chooser (`Dock.svelte`) and the status bar's dock
// button, so they can never disagree on an icon, a label or a signal.

import FolderTreeIcon from "@hugeicons/core-free-icons/FolderTreeIcon";
import GitBranchIcon from "@hugeicons/core-free-icons/GitBranchIcon";
import GithubIcon from "@hugeicons/core-free-icons/GithubIcon";
import GlobeIcon from "@hugeicons/core-free-icons/Globe02Icon";
import type { IconNode } from "$lib/components/ui/icon";
import type { MessageKey } from "$lib/i18n/locales/en";
import type { CheckSummary, DockSurface } from "$lib/types";

/** How a surface is drawn and reached. `action` is its keyboard action id;
 *  `descKey` is the one line the chooser shows under its name. */
export interface SurfaceMeta {
  icon: IconNode;
  labelKey: MessageKey;
  descKey: MessageKey;
  action: string;
}

export const SURFACE_META: Record<DockSurface, SurfaceMeta> = {
  files: { icon: FolderTreeIcon as IconNode, labelKey: "dock.files", descKey: "dock.filesDesc", action: "dockFiles" },
  git: { icon: GitBranchIcon as IconNode, labelKey: "dock.git", descKey: "dock.gitDesc", action: "dockGit" },
  github: { icon: GithubIcon as IconNode, labelKey: "dock.github", descKey: "dock.githubDesc", action: "dockGithub" },
  browser: { icon: GlobeIcon as IconNode, labelKey: "dock.browser", descKey: "dock.browserDesc", action: "dockBrowser" },
};

/** Something worth knowing about a surface without opening it. */
export type SurfaceBadge =
  | { kind: "count"; value: number }
  | { kind: "dot"; tone: "success" | "failure" | "pending" | "attention" };

/** What each surface has to say, gathered from the stores by the caller. */
export interface BadgeInputs {
  /** Changed entries in the working tree. */
  changes: number;
  /** The branch's pull request checks, when it has a pull request. */
  checks: CheckSummary["state"] | null;
  /** An agent waits for the person's approval in this workspace's browser. */
  approval: boolean;
}

/** The signal a surface carries, if any. Pure, so it is tested directly. */
export function surfaceBadge(surface: DockSurface, inputs: BadgeInputs): SurfaceBadge | null {
  switch (surface) {
    case "git":
      return inputs.changes > 0 ? { kind: "count", value: inputs.changes } : null;
    case "github":
      return inputs.checks && inputs.checks !== "none" ? { kind: "dot", tone: inputs.checks } : null;
    case "browser":
      return inputs.approval ? { kind: "dot", tone: "attention" } : null;
    default:
      return null;
  }
}

/** The dot colour for a badge tone. */
export const BADGE_TONE: Record<Extract<SurfaceBadge, { kind: "dot" }>["tone"], string> = {
  success: "bg-emerald-500",
  failure: "bg-red-500",
  pending: "bg-amber-500",
  attention: "bg-amber-500",
};

/** The words a badge stands for, as the selector's muted meta. */
export const BADGE_TEXT: Record<Extract<SurfaceBadge, { kind: "dot" }>["tone"], MessageKey> = {
  success: "dock.checksSuccess",
  failure: "dock.checksFailure",
  pending: "dock.checksPending",
  attention: "dock.waitingApproval",
};
