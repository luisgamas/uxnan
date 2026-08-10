import { beforeEach, describe, expect, it } from "vitest";

import { mountWithProviders } from "../../test/render";
import { app } from "$lib/state/app.svelte";
import { projects } from "$lib/state/projects.svelte";
import type { RepoData, WorktreeEntry } from "$lib/types";
import GithubWorktreeDialog from "./GithubWorktreeDialog.svelte";

const repo: RepoData = {
  id: "repo-1",
  name: "sample",
  path: "C:/projects/sample",
  worktrees: [],
  isGit: true,
};

const main: WorktreeEntry = {
  path: repo.path,
  branch: "main",
  head: "abc123",
  isMain: true,
};

beforeEach(() => {
  app.repos = [repo];
  projects.worktreesByRepo = { [repo.id]: [main] };
  projects.error = null;
});

describe("GithubWorktreeDialog", () => {
  it("keeps GitHub naming automatic and storage details hidden", () => {
    const { screen } = mountWithProviders(GithubWorktreeDialog, {
      props: {
        open: true,
        repoId: repo.id,
        kind: "pr",
        number: 42,
        title: "Improve project import",
        headRefName: "feature/import",
      },
    });

    expect(screen.queryByLabelText("Branch")).not.toBeInTheDocument();
    expect(screen.queryByText(/sample--feature-import/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create worktree" })).toBeEnabled();
  });
});
