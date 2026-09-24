// The right dock — one panel, four surfaces: Files · Git · GitHub · Browser.
//
// It replaces two things that used to compete for the right side: the review
// panel (Files / Changes / History / GitHub tabs, open or closed app-wide) and
// the browser's own column (which hid the review panel while it was open).
// Now there is one place, one toggle and one set of rules:
//
// - **One toggle, one choice.** The status bar's button opens and closes the
//   dock; inside, one selector picks the surface. The first time a workspace
//   opens its dock nothing is chosen yet, so it shows a chooser of the surfaces
//   that workspace has.
// - **Per workspace.** Each workspace remembers whether its dock is open, which
//   surface it shows and which Git view (Changes / History). Switching
//   workspace brings its own dock back; a workspace with no memory starts with
//   the dock closed — the terminals get the room until something is asked for.
// - **Only what the workspace has.** A plain folder has no Git or GitHub; the
//   Global space has no project at all, so only the browser; a project on a
//   host has no GitHub (it reads this machine's `gh`). An unavailable surface
//   is never offered, and a remembered one that stopped being available brings
//   the chooser back.
// - **The browser is a surface, its page is not.** Showing another surface, or
//   closing the dock, hides the page without destroying it; the page itself is
//   owned by `state/browser.svelte.ts`.
//
// The memory lives in the settings document (`settings.dock.workspaces`), kept
// to the `MAX_REMEMBERED` most recently used workspaces.

import { app } from "$lib/state/app.svelte";
import { projects } from "$lib/state/projects.svelte";
import { terminals, GLOBAL_WORKSPACE } from "$lib/state/terminals.svelte";
import { git } from "$lib/state/git.svelte";
import { github } from "$lib/state/github.svelte";
import { browser } from "$lib/state/browser.svelte";
import { surfaceBadge, type SurfaceBadge } from "$lib/dockSurfaces";
import type { DockGitView, DockSurface, DockWorkspace } from "$lib/types";

/** Every surface, in the order the dock and the status bar show them. */
export const DOCK_SURFACES: DockSurface[] = ["files", "git", "github", "browser"];

/** How many workspaces the dock remembers; the least recently used go. */
export const MAX_REMEMBERED = 200;

/** What decides which surfaces a workspace has. */
export interface DockContext {
  /** The workspace belongs to a registered project (not the Global space). */
  project: boolean;
  /** That project is a git repository (not a plain folder). */
  git: boolean;
  /** That project is on this machine (not on a host). */
  local: boolean;
  /** The GitHub surface is enabled in Settings → GitHub. */
  githubEnabled: boolean;
  /** The integrated browser is enabled in Settings → Browser. */
  browserEnabled: boolean;
}

/** The surfaces a workspace has, in dock order. Pure, so it is tested directly. */
export function dockSurfaces(ctx: DockContext): DockSurface[] {
  const has: Record<DockSurface, boolean> = {
    files: ctx.project,
    git: ctx.project && ctx.git,
    github: ctx.project && ctx.git && ctx.local && ctx.githubEnabled,
    browser: ctx.browserEnabled,
  };
  return DOCK_SURFACES.filter((s) => has[s]);
}

/** The entries to keep: the `max` most recently touched. Pure. */
export function pruneRemembered(
  entries: Record<string, DockWorkspace>,
  max = MAX_REMEMBERED,
): Record<string, DockWorkspace> {
  const keys = Object.keys(entries);
  if (keys.length <= max) return entries;
  const keep = keys.sort((a, b) => entries[b].touched - entries[a].touched).slice(0, max);
  return Object.fromEntries(keep.map((k) => [k, entries[k]]));
}

const CLOSED: DockWorkspace = { open: false, surface: null, gitView: "changes", touched: 0 };

class DockStore {
  /** The workspace on screen. */
  get activeKey(): string {
    return terminals.activeWorkspace;
  }

  /** The surfaces the workspace on screen has. */
  get surfaces(): DockSurface[] {
    const repo = projects.activeRepo;
    return dockSurfaces({
      project: this.activeKey !== GLOBAL_WORKSPACE && repo !== null,
      git: repo?.isGit === true,
      local: !projects.activeIsRemote,
      githubEnabled: app.settings.github?.rightPanelTab ?? true,
      browserEnabled: app.settings.browser?.enabled ?? true,
    });
  }

  /** Whether the workspace on screen has `surface`. */
  has(surface: DockSurface): boolean {
    return this.surfaces.includes(surface);
  }

  private entry(workspace: string): DockWorkspace {
    return app.settings.dock?.workspaces[workspace] ?? CLOSED;
  }

  /** The surface a workspace shows when its dock is open, or null for the
   *  chooser: nothing chosen yet, or (on screen) a remembered surface the
   *  workspace no longer has. */
  surfaceOf(workspace = this.activeKey): DockSurface | null {
    const remembered = this.entry(workspace).surface;
    if (workspace !== this.activeKey || remembered === null) return remembered;
    return this.surfaces.includes(remembered) ? remembered : null;
  }

  /** Whether a workspace's dock is open (and, on screen, has anything to show). */
  isOpen(workspace = this.activeKey): boolean {
    if (!this.entry(workspace).open) return false;
    return workspace !== this.activeKey || this.surfaces.length > 0;
  }

  /** The surface a workspace's dock shows right now; null when it is closed or
   *  shows its chooser. */
  showing(workspace = this.activeKey): DockSurface | null {
    return this.isOpen(workspace) ? this.surfaceOf(workspace) : null;
  }

  /** The Git surface's view in a workspace. */
  gitView(workspace = this.activeKey): DockGitView {
    return this.entry(workspace).gitView;
  }

  private write(workspace: string, patch: Partial<DockWorkspace>): void {
    const current = this.entry(workspace);
    const next = { ...current, ...patch, touched: Date.now() };
    const workspaces = { ...(app.settings.dock?.workspaces ?? {}), [workspace]: next };
    app.settings.dock = { workspaces: pruneRemembered(workspaces) };
    void app.persistSettings();
  }

  /** Open a workspace's dock (the one on screen by default) on `surface` — the
   *  selector, the chooser, a shortcut, an agent's page. */
  show(surface: DockSurface, workspace = this.activeKey): void {
    const entry = this.entry(workspace);
    if (entry.open && entry.surface === surface) return;
    this.write(workspace, { open: true, surface });
  }

  /** Open the Git surface on one of its views. */
  showGit(view: DockGitView, workspace = this.activeKey): void {
    this.write(workspace, { open: true, surface: "git", gitView: view });
  }

  /** Close a workspace's dock (the one on screen by default). */
  hide(workspace = this.activeKey): void {
    if (this.entry(workspace).open) this.write(workspace, { open: false });
  }

  /** The dock toggle (the status-bar button, ⌘J): open the dock of the
   *  workspace on screen where it was — its surface, or the chooser — or close
   *  it. */
  toggle(): void {
    if (this.isOpen()) {
      this.hide();
      return;
    }
    if (this.surfaces.length === 0) return;
    this.write(this.activeKey, { open: true });
  }

  /** The badge a surface shows for the workspace on screen: the working tree's
   *  change count on Git, the pull request's checks on GitHub, an agent
   *  waiting for approval on the browser. */
  badge(surface: DockSurface): SurfaceBadge | null {
    return surfaceBadge(surface, {
      changes: surface === "git" ? git.files.length : 0,
      checks:
        surface === "github"
          ? (github.contextFor(projects.activeLocalPath)?.pr?.checks.state ?? null)
          : null,
      approval:
        surface === "browser" && browser.approvals.some((a) => a.workspace === this.activeKey),
    });
  }

  /** Switch the Git surface's view in the workspace on screen. */
  setGitView(view: DockGitView): void {
    if (this.gitView() !== view) this.write(this.activeKey, { gitView: view });
  }
}

export const dock = new DockStore();
