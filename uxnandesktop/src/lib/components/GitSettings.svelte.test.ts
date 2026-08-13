/**
 * Settings → Git → Worktree location. What matters here: it is an ordinary
 * settings row with a select (not a screen of cards), the row states the shape
 * the chosen layout produces, picking one persists it, the custom root appears
 * only for the layout that has one, and the surface is localized (EN/ES).
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import { mountWithProviders, until } from "../../test/render";
import { app } from "$lib/state/app.svelte";
import GitSettings from "./GitSettings.svelte";

// The test harness mounts no toaster, so what the user is TOLD is captured here
// instead: a refusal that never reaches them is the failure worth catching.
const toasts = vi.hoisted(() => ({ success: [] as string[], error: [] as string[] }));
vi.mock("$lib/toast", () => ({
  toast: {
    success: (message: string) => toasts.success.push(message),
    error: (message: string) => toasts.error.push(message),
  },
  toastError: (e: unknown) => toasts.error.push(String(e)),
}));

function baseCommands(identity: Record<string, unknown> = IDENTITY) {
  return {
    update_settings: () => ({ version: 1, repos: [], settings: {}, agentCache: [] }),
    git_identity: () => identity,
  };
}

const IDENTITY = {
  name: "Ada Lovelace",
  email: "ada@example.org",
  defaultBranch: "main",
  version: "2.45.1",
};

/** The worktree settings of the last persist call. */
function lastSent(backend: {
  lastCallTo(cmd: string): { args: Record<string, unknown> } | undefined;
}) {
  const args = backend.lastCallTo("update_settings")?.args as
    | { settings: Record<string, unknown> }
    | undefined;
  return (args?.settings?.worktrees ?? {}) as { location?: string; root?: string | null };
}

beforeEach(() => {
  document.body.style.pointerEvents = "";
  app.settings.language = "en";
  app.settings.worktrees = { location: "managed", root: null };
  toasts.success.length = 0;
  toasts.error.length = 0;
});

const CANDIDATES = [
  {
    path: "C:/Users/u/uxnan/worktrees/api/feat-login",
    group: "api",
    name: "feat-login",
    branch: "feat/login",
    scope: "worktree",
    kind: "orphaned",
    reason: "repoGone",
  },
  {
    path: "C:/Users/u/uxnan/worktrees/uxnan/fix-nav",
    group: "uxnan",
    name: "fix-nav",
    branch: "fix/nav",
    scope: "worktree",
    kind: "finished",
    reason: "merged",
  },
  {
    path: "C:/Users/u/uxnan/worktrees/closed/mi-rama",
    group: "closed",
    name: "mi-rama",
    branch: "mi-rama",
    scope: "worktree",
    kind: "unregistered",
    reason: "projectRemoved",
  },
  {
    path: "C:/Users/u/uxnan/repos/sample",
    group: "C:/Users/u/uxnan/repos",
    name: "sample",
    scope: "clone",
    kind: "clone",
    reason: "cloneFullyPushed",
  },
  {
    path: "C:/Users/u/uxnan/repos/unpushed",
    group: "C:/Users/u/uxnan/repos",
    name: "unpushed",
    scope: "clone",
    kind: "blocked",
    reason: "unpushedCommits",
    changedFiles: 2,
  },
  {
    path: "C:/Users/u/uxnan/worktrees/uxnan/wip-tests",
    group: "uxnan",
    name: "wip-tests",
    branch: "wip/tests",
    scope: "worktree",
    kind: "blocked",
    reason: "uncommittedChanges",
    changedFiles: 3,
  },
];

describe("GitSettings — cleanup", () => {
  it("scans on demand and buckets what it found", async () => {
    const { screen, user } = mountWithProviders(GitSettings, {
      commands: {
        ...baseCommands(),
        worktree_cleanup_scan: () => CANDIDATES,
        worktree_cleanup_sizes: () => [
          1024 * 1024 * 340,
          1024 * 1024 * 620,
          1024 * 1024 * 90,
          1024 * 1024 * 500,
        ],
      },
    });
    // Nothing is scanned until asked: this reads the disk.
    expect(screen.getByText(/Nothing scanned yet/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Look for old worktrees" }));
    expect(await screen.findByText("No longer owned by git")).toBeInTheDocument();
    expect(screen.getByText("Work finished")).toBeInTheDocument();
    expect(screen.getByText("No longer a project in uxnan")).toBeInTheDocument();
    // The two kinds are separated: a worktree and a repository are not the
    // same thing to be about to delete.
    expect(screen.getByText("Worktrees")).toBeInTheDocument();
    expect(screen.getByText("Cloned repositories")).toBeInTheDocument();
    expect(screen.getByText("Fully pushed")).toBeInTheDocument();
    // Both lists can hold back rows, each stating its own reason — so the
    // heading is neutral and appears once per list.
    expect(screen.getAllByText("Held back")).toHaveLength(2);
    expect(screen.getByText("its repository is gone from disk")).toBeInTheDocument();
    expect(screen.getByText("3 files not committed")).toBeInTheDocument();
    // Each counted reason carries its own noun rather than borrowing another's.
    expect(screen.getByText("2 commits are on no remote")).toBeInTheDocument();
  });

  it("pre-selects the orphans and never lets a blocked one be selected", async () => {
    const { screen, user } = mountWithProviders(GitSettings, {
      commands: {
        ...baseCommands(),
        worktree_cleanup_scan: () => CANDIDATES,
        worktree_cleanup_sizes: () => [0, 0, 0, 0],
      },
    });
    await user.click(screen.getByRole("button", { name: "Look for old worktrees" }));

    const orphan = await screen.findByRole("checkbox", { name: "api / feat-login" });
    const finished = screen.getByRole("checkbox", { name: "uxnan / fix-nav" });
    const blocked = screen.getByRole("checkbox", { name: "uxnan / wip-tests" });
    // Git owns nothing in an orphan, so there is nothing to weigh up.
    expect(orphan).toBeChecked();
    // Finished work is a judgement call: the user makes it. So is a checkout
    // whose project was closed — the repository and the branch are both intact.
    expect(finished).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "closed / mi-rama" })).not.toBeChecked();
    // A cloned repository IS the history, so it is never pre-selected either.
    expect(
      screen.getByRole("checkbox", { name: "C:/Users/u/uxnan/repos / sample" }),
    ).not.toBeChecked();
    // Unsaved work is never removable from here, at any cost.
    expect(blocked).toBeDisabled();
  });

  it("removes only what is selected and reports what was kept", async () => {
    const calls: string[][] = [];
    const { screen, user } = mountWithProviders(GitSettings, {
      commands: {
        ...baseCommands(),
        worktree_cleanup_scan: () => CANDIDATES,
        worktree_cleanup_sizes: () => [0, 0, 0, 0],
        worktree_cleanup_remove: (args: Record<string, unknown>) => {
          calls.push(args.paths as string[]);
          return {
            removed: [CANDIDATES[0].path],
            refused: [{ path: CANDIDATES[1].path, reason: "has uncommitted changes" }],
          };
        },
      },
    });
    await user.click(screen.getByRole("button", { name: "Look for old worktrees" }));
    await screen.findByText("No longer owned by git");
    await user.click(screen.getByRole("button", { name: "Clean up" }));

    await until(() => calls.length > 0, { label: "removal requested" });
    // Only the pre-selected orphan; the finished one was never ticked.
    expect(calls[0]).toEqual([CANDIDATES[0].path]);
    // A refusal is surfaced rather than swallowed.
    await until(() => toasts.error.length > 0, { label: "refusal surfaced" });
    expect(toasts.error[0]).toContain("fix-nav was kept");
    expect(toasts.success[0]).toBe("1 worktree removed");
  });

  it("says so plainly when there is nothing to clean", async () => {
    const { screen, user } = mountWithProviders(GitSettings, {
      commands: { ...baseCommands(), worktree_cleanup_scan: () => [] },
    });
    await user.click(screen.getByRole("button", { name: "Look for old worktrees" }));
    expect(
      await screen.findByText(/the managed folder holds only live work/),
    ).toBeInTheDocument();
  });
});

describe("GitSettings — identity", () => {
  it("shows who commits are authored as, and the two git facts around it", async () => {
    const { screen } = mountWithProviders(GitSettings, { commands: baseCommands() });
    expect(await screen.findByText("Ada Lovelace")).toBeInTheDocument();
    expect(screen.getByText("ada@example.org")).toBeInTheDocument();
    expect(screen.getByText("main")).toBeInTheDocument();
    expect(screen.getByText("2.45.1")).toBeInTheDocument();
  });

  it("says an unset identity is unset, and why that matters", async () => {
    const { screen } = mountWithProviders(GitSettings, { commands: baseCommands({}) });
    expect(await screen.findByText(/git refuses to commit/)).toBeInTheDocument();
    // Two rows unset (name + email); the default branch falls back to git's own.
    expect(screen.getAllByText("Not set")).toHaveLength(2);
    expect(screen.getByText("master")).toBeInTheDocument();
    expect(screen.getByText("Not found")).toBeInTheDocument();
  });
});

describe("GitSettings — worktree location", () => {
  it("is one settings row, showing the shape the layout produces", () => {
    const { screen } = mountWithProviders(GitSettings, { commands: baseCommands() });
    expect(screen.getByText("Worktree location")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Layout" })).toBeInTheDocument();
    expect(screen.getByText("~/uxnan/worktrees/<project>/<branch>")).toBeInTheDocument();
  });

  it("renders localized in Spanish", () => {
    app.settings.language = "es";
    const { screen } = mountWithProviders(GitSettings, { commands: baseCommands() });
    expect(screen.getByText("Ubicación de los worktrees")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Disposición" })).toBeInTheDocument();
  });

  it("picking a layout persists it and restates the shape", async () => {
    const { screen, backend, user } = mountWithProviders(GitSettings, {
      commands: baseCommands(),
    });
    await user.click(screen.getByRole("button", { name: "Layout" }));
    // bits-ui parks `pointer-events: none` on the body while the listbox is
    // open; jsdom keeps it, and userEvent then refuses to click the option.
    document.body.style.pointerEvents = "";
    await user.click(await screen.findByText("Beside the project"));
    await until(() => backend.called("update_settings"), { label: "layout persisted" });
    expect(lastSent(backend).location).toBe("sibling");
    expect(screen.getByText("<repository>/../<project>--<branch>")).toBeInTheDocument();
  });

  it("asks for a root only in the layout that has one, and persists what is typed", async () => {
    const { screen, backend, user } = mountWithProviders(GitSettings, {
      commands: baseCommands(),
    });
    // Managed and sibling both resolve their own root: no field to fill in.
    expect(screen.queryByLabelText("Worktree folder")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Layout" }));
    // bits-ui parks `pointer-events: none` on the body while the listbox is
    // open; jsdom keeps it, and userEvent then refuses to click the option.
    document.body.style.pointerEvents = "";
    await user.click(await screen.findByText("Custom folder"));
    const input = await screen.findByLabelText("Worktree folder");
    await user.type(input, "D:/trees");
    await until(() => lastSent(backend).root === "D:/trees", { label: "root persisted" });
    expect(lastSent(backend).location).toBe("custom");
  });
});
