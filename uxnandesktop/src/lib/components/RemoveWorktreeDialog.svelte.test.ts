import { beforeEach, describe, expect, it } from "vitest";

import { mountWithProviders } from "../../test/render";
import { app } from "$lib/state/app.svelte";
import { projects, type WorktreeRow } from "$lib/state/projects.svelte";
import type { RepoData } from "$lib/types";
import RemoveWorktreeDialog from "./RemoveWorktreeDialog.svelte";

const repo: RepoData = {
  id: "repo-1",
  name: "sample",
  path: "C:/projects/sample",
  worktrees: [],
  isGit: true,
};

const row: WorktreeRow = {
  path: "C:/projects/sample--feature",
  branch: "feature",
  head: "abc123",
  isMain: false,
  repoId: repo.id,
  repoName: repo.name,
};

beforeEach(() => {
  app.repos = [repo];
  projects.statusByPath = {};
  projects.error = null;
});

describe("RemoveWorktreeDialog", () => {
  // The bug: the effect that resets the form on open also *tracked* the
  // worktree's git status and its live agent tabs. Both move on their own while
  // the dialog sits there — the status poll every few seconds, an agent tab on
  // every burst of terminal output — so ticking a box and then letting an agent
  // print a line silently cleared it. Pressing the button did it too: the
  // removal changes exactly that state.
  it("keeps the user's choices when the worktree status changes underneath", async () => {
    const { screen, user } = mountWithProviders(RemoveWorktreeDialog, {
      props: { open: true, row },
      commands: {
        branch_list: () => ({ branches: ["main"], remoteBranches: [], defaultBase: "main" }),
      },
    });

    const boxes = await screen.findAllByRole("checkbox");
    const local = boxes[0];
    // Unchecked to begin with: this worktree has not landed, so the reset ran on
    // open and seeded from `defaults`. That is the half of the effect worth
    // keeping — the assertions below are about it not running a second time.
    expect(local).not.toBeChecked();

    await user.click(local);
    expect(local).toBeChecked();

    // What the status poll does on its next pass.
    projects.statusByPath = {
      ...projects.statusByPath,
      [row.path]: { dirty: 2, ahead: 1, behind: 0 },
    };
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(local, "a background status refresh cleared the form").toBeChecked();
  });

});
